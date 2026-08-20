import { useEffect, useRef } from 'react'
import { useAtom } from 'jotai'
import { roomAtom, expAtom, handsAtom } from '../store/game'
import { saveSnapshot, loadSnapshot, type SessionSnapshot } from '../lib/sessionSnapshot'

// How long to sit on a change before writing. The game pushes room content in
// several events (name, description, exits, objects) that land within the same
// tick, so this coalesces them into one write instead of four.
const SAVE_DEBOUNCE_MS = 800

/**
 * Keep the last known room / exp / hands in storage, and put them back when a
 * resumed session comes up empty. See lib/sessionSnapshot.ts for why this exists
 * and what is deliberately left out of it.
 *
 * `resumed` must be true ONLY when this window attached to a session that was
 * already running (the web resume path). After a normal login the game sends
 * everything itself within a second, and restoring there would flash the room we
 * logged out of over the one we logged into.
 */
export function useSessionSnapshot(charName: string, resumed: boolean): void {
  const [room, setRoom]   = useAtom(roomAtom)
  const [exp, setExp]     = useAtom(expAtom)
  const [hands, setHands] = useAtom(handsAtom)

  // The restore has to run before the first save, or an empty resumed session
  // would overwrite the snapshot it is about to need. This ref gates that.
  const restored = useRef(false)

  useEffect(() => {
    if (restored.current || !charName) return
    restored.current = true
    if (!resumed) return
    const snap = loadSnapshot(charName)
    if (!snap) return
    // Fill holes only. Anything the game has already told us this session is
    // newer than the snapshot by definition, so it wins.
    let took = false
    if (!room.name && !room.description) { setRoom(snap.room); took = true }
    if (exp.skills.length === 0)         { setExp(snap.exp);   took = true }
    if (!hands.left && !hands.right)     { setHands(snap.hands) }
    // Re-sync the parts of a room that go stale fastest. What's on the ground and
    // who's standing in it can both have changed while we were reloading, and the
    // "you also see" line is the one thing LOOK does refresh — the room's name,
    // description and exits it won't, which is why they had to be restored.
    if (took) window.dr.game.send('look')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charName, resumed])

  // Latest state, so the debounce and the unload listener can both write it
  // without re-subscribing to every atom.
  const latest = useRef<SessionSnapshot | null>(null)

  useEffect(() => {
    latest.current = { char: charName, at: Date.now(), room, exp, hands }
    if (!charName || !restored.current) return
    const timer = window.setTimeout(() => {
      if (latest.current) saveSnapshot({ ...latest.current, at: Date.now() })
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [charName, room, exp, hands])

  // A reload can land inside the debounce window — applying an update is exactly
  // that — so flush on the way out. localStorage is synchronous, which is the
  // whole reason the snapshot lives there. `pagehide` covers the cases iOS/Safari
  // won't fire `beforeunload` for.
  useEffect(() => {
    const flush = (): void => { if (latest.current && restored.current) saveSnapshot({ ...latest.current, at: Date.now() }) }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [])
}
