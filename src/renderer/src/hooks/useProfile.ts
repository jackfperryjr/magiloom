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
  const inFlight = useRef<Set<string>>(new Set())
  const key = name.trim().toLowerCase()
  // Fetch keyed on whether the profile is actually cached, rather than a
  // permanent "already tried" set — so when a character switch clears
  // profilesAtom, re-opening the menu (even for a previously-viewed character)
  // fetches a fresh profile instead of showing a blank summary.
  const have = Boolean(profiles[key])

  useEffect(() => {
    if (!active || status !== 'connected' || !key || have || inFlight.current.has(key)) return
    inFlight.current.add(key)
    begin(name)
    window.dr.game.send(`profile ${name}`)
    const t = window.setTimeout(() => { end(); inFlight.current.delete(key) }, 900)
    return () => { window.clearTimeout(t); end(); inFlight.current.delete(key) }
  }, [active, status, key, name, have, begin, end])

  return profiles[key] ?? null
}
