import { useState, useEffect } from 'react'

// The "your logs won't be here forever" line, shown at the foot of both log panels.
//
// It exists because retention is the thing the free tier rations, and a user who
// doesn't know that experiences it as logs mysteriously vanishing. Saying it plainly
// — with the real numbers, and next to the download button — turns a surprise into a
// choice. Reading and downloading are NOT rationed at any tier; only how long we keep
// the files. So this is a prompt to save what you want, never a paywall on your data.
//
// Renders nothing on desktop (`limits === null`): those logs are on the user's own
// disk and nothing prunes them, so a warning would simply be false.

/** Shared loader — both panels show the notice, and neither should fetch twice. */
export function useTierLimits(): TierLimitsInfo | null {
  const [limits, setLimits] = useState<TierLimitsInfo | null>(null)
  useEffect(() => {
    let alive = true
    // `account` is web-only and `limits` may be absent against an older server, so
    // both are optional — a missing plan simply means no notice, never a crash.
    const get = window.dr.account?.limits
    if (!get) return
    get()
      .then(l => { if (alive) setLimits(l) })
      .catch(() => { /* older server — no notice */ })
    return () => { alive = false }
  }, [])
  return limits
}

const fmtSize = (n: number): string =>
  n >= 1024 * 1024 * 1024 ? `${(n / 1024 / 1024 / 1024).toFixed(1)} GB` : `${Math.round(n / 1024 / 1024)} MB`

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

export function RetentionNotice({ limits }: { limits: TierLimitsInfo | null }) {
  if (!limits) return null

  const graceDays = Math.ceil(limits.graceMs / 86_400_000)
  const inGrace = limits.graceMs > 0

  return (
    <div className={'retention-notice' + (limits.tier === 'free' ? ' is-free' : '')}>
      {inGrace ? (
        // A downgrade is being honoured gently. Say exactly when the old allowance
        // ends, because after that the next prune is what enforces the new one.
        <>
          <b>Your plan changed.</b> You&apos;re still on the previous plan&apos;s storage
          allowance for another {plural(graceDays, 'day')} — after that, logs older than{' '}
          {plural(limits.maxDays, 'day')} are removed. Download anything you want to keep.
        </>
      ) : (
        <>
          Logs are kept for <b>{plural(limits.effectiveDays, 'day')}</b>, up to{' '}
          <b>{fmtSize(limits.maxBytes)}</b> total
          {limits.tier === 'free' && <> on the free plan</>}. Whichever comes first —
          a heavy week can reach the size limit before the day limit. Download anything
          worth keeping; you can always read and export everything you still have.
        </>
      )}
    </div>
  )
}
