import { useEffect, useRef } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { holdingsAtom, holdingsCaptureAtom } from '../store/holdings'

/**
 * Files each captured INVENTORY LIST / VAULT report under the character being
 * played, and keeps the local copy of the account inventory current.
 *
 * The game account comes from the session when it is known. After a web reload it
 * may not be — the session survives, the login form's state doesn't — so it falls
 * back to the login path last used for this character. With neither, the report is
 * filed without an account and moves under the right one the first time it is known
 * (see HoldingsStore.put).
 */
export function useHoldingsSync(charName: string, accountName: string): void {
  const capture = useAtomValue(holdingsCaptureAtom)
  const setDoc  = useSetAtom(holdingsAtom)
  const filed   = useRef(0)

  // Load once, then follow changes — on the web these include reports filed by
  // other characters signed in to the same account elsewhere.
  useEffect(() => {
    let alive = true
    window.dr.holdings.get().then(d => { if (alive) setDoc(d) }).catch(() => { /* viewer shows empty */ })
    const off = window.dr.holdings.onChanged(d => setDoc(d))
    return () => { alive = false; off() }
  }, [setDoc])

  useEffect(() => {
    if (!capture || capture.seq === filed.current || !charName.trim()) return
    filed.current = capture.seq
    void (async () => {
      let account = accountName.trim()
      if (!account) {
        try {
          const name = charName.trim().toLowerCase()
          const paths = (await window.dr.settings.getAll()).loginPaths ?? []
          account = paths
            .filter(p => p.charName.trim().toLowerCase() === name)
            .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))[0]?.account ?? ''
        } catch { /* file it without an account */ }
      }
      try {
        setDoc(await window.dr.holdings.put({ account, character: charName, kind: capture.kind, items: capture.items }))
      } catch (err) {
        // Losing one report is not worth interrupting play for; the next run refiles it.
        console.warn('[holdings] could not save the report:', err)
      }
    })()
  }, [capture, charName, accountName, setDoc])
}
