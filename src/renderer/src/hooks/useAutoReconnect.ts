import { useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { lastDropAtom, appendSystemLineAtom } from '../store/game'
import { shouldReconnect, reconnectBudget, RECONNECT_ATTEMPTS, RECONNECT_GAP_MS } from '../lib/disconnect'

// How long one attempt may take to come up before it counts as failed. Lich has to
// boot and log in before its port accepts us, which is most of this. Lich's own
// error events are deliberately not a failure signal: it reports any stderr line
// that looks like one, and a warning during a healthy boot would abort the attempt.
const CONNECT_TIMEOUT_MS = 60_000

const sleep = (ms: number): Promise<void> => new Promise(r => window.setTimeout(r, ms))

/** Resolves true once the game connects, false on an error, a drop, or the timeout. */
function untilConnected(): Promise<boolean> {
  return new Promise(resolve => {
    const done = (ok: boolean): void => { window.clearTimeout(timer); offs.forEach(off => off()); resolve(ok) }
    const offs = [
      window.dr.game.onConnected(()    => done(true)),
      window.dr.game.onError(()        => done(false)),
      window.dr.game.onDisconnected(() => done(false)),
    ]
    const timer = window.setTimeout(() => done(false), CONNECT_TIMEOUT_MS)
  })
}

/**
 * Sign `charName` back in the way a beacon does: saved password → SGE login → the
 * server and character recorded for the last successful login → connect. A launch
 * key is single-use, so getting a dropped session back always means logging in
 * again; there is no socket to simply reopen.
 *
 * Returns an error string, or '' once the connection is up. `fatal` marks a failure
 * that retrying can't fix (nothing saved to log in with).
 */
async function signBackIn(charName: string, accountName: string): Promise<{ error: string; fatal?: boolean }> {
  const s = await window.dr.settings.getAll()
  const lc = (v: string): string => v.toLowerCase()
  const path = [...(s.loginPaths ?? [])]
    .sort((x, y) => (y.usedAt ?? 0) - (x.usedAt ?? 0))
    .find(b => lc(b.charName) === lc(charName) && (!accountName || lc(b.account) === lc(accountName)))
  if (!path) return { error: `no saved login for ${charName}`, fatal: true }
  const pw = await window.dr.auth.getPassword(path.account)
  if (!pw) return { error: `no saved password for ${path.account}`, fatal: true }

  const login = await window.dr.auth.login(path.account, pw)
  if (!login.ok) return { error: login.error ?? 'sign-in failed' }
  const inst = await window.dr.auth.selectInstance(path.instance)
  if (!inst.ok) return { error: inst.error ?? 'could not reach the server list' }
  // SGE character ids can be reissued; fall back to the name before giving up.
  const char = inst.characters.find(c => c.id === path.charId)
    ?? inst.characters.find(c => lc(c.name) === lc(path.charName))
  if (!char) return { error: `${path.charName} is no longer on ${path.account}`, fatal: true }

  // Listen before asking: a direct connection can be up before the call returns.
  const connected = untilConnected()
  const result = await window.dr.auth.selectCharacter(char.id, char.name, path.account, path.lich)
  if (!result.ok) return { error: result.error ?? 'failed to connect' }
  return (await connected) ? { error: '' } : { error: 'the connection did not come up' }
}

/**
 * Get a dropped session back without being asked: up to three attempts, ten seconds
 * apart, whenever the connection goes down and nobody here took it down (see
 * lib/disconnect for how that is decided, and ReconnectBudget for what bounds it).
 *
 * `blocked` stops it: while watching someone else's session (not ours to log in),
 * and while the connect overlay is open (the player is signing in by hand, and both
 * would be driving the same login state).
 */
export function useAutoReconnect(charName: string, accountName: string, blocked: boolean): void {
  const drop = useAtomValue(lastDropAtom)
  const say  = useSetAtom(appendSystemLineAtom)
  // Bumped to abandon whatever run is in flight; a run checks it after every wait.
  const runRef     = useRef(0)
  const blockedRef = useRef(blocked)

  useEffect(() => {
    blockedRef.current = blocked
    if (!blocked) return
    runRef.current++
    // Opening the overlay means a manual sign-in is coming, which starts a clean slate.
    reconnectBudget.refill()
  }, [blocked])

  // A different character is a different session: abandon the old one's run (and
  // any run at all once the game layout is gone).
  useEffect(() => () => { runRef.current++ }, [charName])

  useEffect(() => {
    if (!drop) return
    const run = ++runRef.current
    const live = (): boolean => run === runRef.current && !blockedRef.current
    if (!shouldReconnect(drop.cause) || !charName || !live()) return

    void (async () => {
      if (reconnectBudget.remaining === 0) {
        say(`[reconnect] Not reconnecting: the connection has dropped ${RECONNECT_ATTEMPTS} times with no command sent in between. Use Connect in the character menu.`)
        return
      }
      while (reconnectBudget.remaining > 0) {
        const n = reconnectBudget.attempt
        say(`[reconnect] Reconnecting ${charName} in ${RECONNECT_GAP_MS / 1000} seconds (attempt ${n} of ${RECONNECT_ATTEMPTS}). Open Connect in the character menu to cancel.`)
        await sleep(RECONNECT_GAP_MS)
        if (!live()) return
        reconnectBudget.take()
        let res: { error: string; fatal?: boolean }
        try { res = await signBackIn(charName, accountName) }
        catch (e) { res = { error: e instanceof Error ? e.message : String(e) } }
        if (!live()) return
        if (!res.error) { say(`[reconnect] Reconnected on attempt ${n}.`); return }
        if (res.fatal) { say(`[reconnect] Can't reconnect automatically: ${res.error}. Use Connect in the character menu.`); return }
        say(`[reconnect] Attempt ${n} failed: ${res.error}.`)
      }
      say(`[reconnect] Gave up after ${RECONNECT_ATTEMPTS} attempts. Use Connect in the character menu to sign in again.`)
    })()
    // Keyed on the drop alone: a new one supersedes the run in flight (runRef), and
    // charName/accountName are read as of the drop they belong to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drop?.seq])
}
