import { useCallback, useEffect, useState } from 'react'
import { Tooltip } from './Tooltip'

// ─── Scheduled-restart banner (web) ──────────────────────────────────────────
// A Lich bump on magiserver merges at an announced 03:00 Central slot, and the
// merge redeploys — restarting the server and dropping every game session. The
// server publishes that slot on GET /maintenance (see magiserver
// src/lich-update-cron.ts); this turns it into a countdown so nobody is surprised.
//
// Two placements, one component: a full-width strip at the top of the game shell,
// and the floating pill in the login scene's notice slot.
//
// Admins (the server says so via canHold) also get Hold / Resume, which toggles the
// `hold` label on the bump PR. A held update shows only to admins — for players
// there is simply nothing scheduled.
//
// Desktop has no `window.dr.maintenance`: its Lich is the user's own, and nothing
// here restarts it.

const POLL_MS = 2 * 60_000
/** Dismissing hides the banner until this close to the restart, then it returns. */
const RECALL_MS = 15 * 60_000
const DISMISS_KEY = 'lantern-maintenance-dismissed'

export interface Maintenance {
  state: MaintenanceState | null
  refresh: () => void
  setState: (s: MaintenanceState | null) => void
}

export function useMaintenance(): Maintenance {
  const [state, setState] = useState<MaintenanceState | null>(null)
  const refresh = useCallback(() => {
    const get = window.dr.maintenance?.get
    if (!get) return
    get().then(setState).catch(() => { /* unreachable / older server: no banner */ })
  }, [])
  useEffect(() => {
    if (!window.dr.maintenance) return
    refresh()
    const id = window.setInterval(refresh, POLL_MS)
    // A backgrounded tab's timers are throttled; catch up the moment it's looked at.
    const onVis = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVis)
    // Signing in as an admin changes the answer (held updates, the Hold button).
    window.addEventListener('settings:saved', refresh)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('settings:saved', refresh)
    }
  }, [refresh])
  return { state, refresh, setState }
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [active])
  return now
}

function fmtCountdown(ms: number): string {
  if (ms <= 0) return 'any moment now'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h) return `in ${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `in ${m}m ${String(sec).padStart(2, '0')}s`
  return `in ${sec}s`
}

function fmtWhen(at: number, now: number): string {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString()
  return sameDay ? time : `${time} ${new Date(at).toLocaleDateString([], { weekday: 'short' })}`
}

const dismissKey = (n: MaintenanceNotice): string => `${n.phase}:${n.at}`
function readDismissed(): string {
  try { return localStorage.getItem(DISMISS_KEY) ?? '' } catch { return '' }
}

/** The in-game strip: owns its own poll. */
export function MaintenanceStrip() {
  const m = useMaintenance()
  return <MaintenanceBanner variant="strip" m={m} />
}

/** `m` comes from the caller so the login screen can also know whether to make room
 *  for it (its notice slot), without polling twice. The pill is not dismissible:
 *  the login scene is passed through in seconds, and it's where you'd decide
 *  whether to start a session at all. */
export function MaintenanceBanner({ variant, m }: { variant: 'strip' | 'pill'; m: Maintenance }) {
  const { state, setState, refresh } = m
  const notice = state?.notice ?? null
  const now = useNow(!!notice && notice.phase === 'scheduled')
  const [dismissed, setDismissed] = useState(readDismissed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (!notice) return null
  const left = notice.at - now
  // Dismissal holds until the last stretch; a new slot or phase is a new banner.
  if (variant === 'strip' && notice.phase === 'scheduled' && dismissed === dismissKey(notice) && left > RECALL_MS) return null

  const dismiss = () => {
    const k = dismissKey(notice)
    try { localStorage.setItem(DISMISS_KEY, k) } catch { /* private mode */ }
    setDismissed(k)
  }
  const hold = (on: boolean) => {
    const set = window.dr.maintenance?.setHold
    if (!set) return
    setBusy(true); setError('')
    set(on)
      .then(r => {
        if (!r.ok) { setError(r.error ?? 'Could not change the hold.'); return }
        if (state) setState({ ...state, notice: r.notice ?? null })
        else refresh()
      })
      .catch(() => setError('Could not reach the server.'))
      .finally(() => setBusy(false))
  }

  const versions = notice.from && notice.to
    ? <> (<b>{notice.from}</b> → <b>{notice.to}</b>)</>
    : null
  const message = notice.phase === 'merging'
    ? <>Updating Lich{versions} now. Lantern&rsquo;s server will restart within a few minutes and you&rsquo;ll need to reconnect.</>
    : notice.phase === 'held'
      ? <>Lich update{versions} is <b>on hold</b>. No restart is scheduled.</>
      : <>Lich update{versions}: Lantern&rsquo;s server restarts at <b>{fmtWhen(notice.at, now)}</b> (<span className="maint-countdown">{fmtCountdown(left)}</span>). Game sessions will disconnect briefly.</>

  const cls = variant === 'strip'
    ? 'maint-banner maint-strip' + (left <= RECALL_MS || notice.phase === 'merging' ? ' maint-soon' : '')
    : 'login-lich-update maint-banner maint-pill'

  return (
    <div className={cls} role="status" aria-live="polite">
      <div className="maint-text">
        <span>{message}</span>
        {error && <span className="maint-error">{error}</span>}
      </div>
      {state?.canHold && notice.phase !== 'merging' && (
        <Tooltip text={notice.phase === 'held'
          ? 'Release the hold. The restart is rescheduled with a fresh notice period.'
          : 'Admin: stop this restart. Adds the hold label to the bump PR.'}>
          <button className="maint-action" disabled={busy} onClick={() => hold(notice.phase !== 'held')}>
            {busy ? '…' : notice.phase === 'held' ? 'Resume' : 'Hold'}
          </button>
        </Tooltip>
      )}
      {variant === 'strip' && notice.phase === 'scheduled' && (
        <Tooltip text="Hide until 15 minutes before the restart">
          <button className="maint-close" onClick={dismiss} aria-label="Dismiss">✕</button>
        </Tooltip>
      )}
    </div>
  )
}
