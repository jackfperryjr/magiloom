import { useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import {
  profilesAtom, beginProfileCaptureAtom, endProfileCaptureAtom,
  connectionStatusAtom, type ProfileInfo,
} from '../store/game'

// Fetch a character's PROFILE the first time `active` becomes true for that name
// (per session), capturing the response silently. Returns the parsed profile,
// or null while it's still pending / unavailable. Shared by the character menu
// (self) and the conversation avatar popup (other players).
export function useProfile(name: string, active: boolean): ProfileInfo | null {
  const profiles = useAtomValue(profilesAtom)
  const status   = useAtomValue(connectionStatusAtom)
  const begin    = useSetAtom(beginProfileCaptureAtom)
  const end      = useSetAtom(endProfileCaptureAtom)
  const fetched  = useRef<Set<string>>(new Set())
  const key = name.trim().toLowerCase()

  useEffect(() => {
    if (!active || status !== 'connected' || !key || fetched.current.has(key)) return
    begin(name)
    window.dr.game.send(`profile ${name}`)
    // Mark fetched only once the capture window completes, so an early teardown
    // (which ends capture in cleanup) retries next time. end() is idempotent.
    const t = window.setTimeout(() => { end(); fetched.current.add(key) }, 900)
    return () => { window.clearTimeout(t); end() }
  }, [active, status, key, name, begin, end])

  return profiles[key] ?? null
}
