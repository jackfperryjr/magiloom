import { useEffect } from 'react'
import { useSetAtom } from 'jotai'
import { serverAvatarsAtom } from '../store/game'

// Background-fetch server-backed avatars for the given speaker names into
// serverAvatarsAtom. Each name is requested at most once per session (tracked in
// `requested`, independent of the atom) so speaking a name repeatedly never
// re-hits the network; the main process adds a TTL + negative cache on top.
// If the service is unconfigured we resolve `enabled` to false once and stop.

let enabled: boolean | null = null
const requested = new Set<string>()

export function useEnsureAvatars(names: string[]): void {
  const setServer = useSetAtom(serverAvatarsAtom)

  // Stable, deduped key list so the effect only re-runs when the set of names
  // actually changes.
  const keyList = Array.from(
    new Set(names.map(n => n.trim().toLowerCase()).filter(Boolean)),
  ).sort().join('|')

  useEffect(() => {
    if (enabled === false || !keyList) return
    const todo = keyList.split('|').filter(k => !requested.has(k))
    if (todo.length === 0) return

    let cancelled = false
    void (async () => {
      if (enabled === null) enabled = await window.dr.avatar.enabled()
      if (enabled === false || cancelled) return
      for (const key of todo) {
        if (requested.has(key)) continue
        requested.add(key)
        try {
          const dataUrl = await window.dr.avatar.get(key)
          if (cancelled) return
          setServer(prev => ({ ...prev, [key]: dataUrl }))
        } catch {
          requested.delete(key)  // allow a later retry
        }
      }
    })()
    return () => { cancelled = true }
  }, [keyList, setServer])
}
