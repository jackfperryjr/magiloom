import { useEffect, useRef } from 'react'
import { useSetAtom } from 'jotai'
import {
  messagingAvailable, contactsAtom, contactRequestsAtom, pendingOutAtom,
  ingestMessageAtom, resetMessagingAtom, removeContactLocalAtom,
} from '../store/messaging'

const key = (n: string): string => n.trim().toLowerCase()

// ── App-level messaging subscription ─────────────────────────────────────────────
// Mounted once (in GameLayout, like useGameConnection): loads the contact book for the
// connected character and keeps the messaging store live from the server's events, so
// unread badges and threads stay current whether or not the Messages panel is open.
// Inert unless messaging is available (web) and a character is connected.
export function useMessaging(charName: string, connected: boolean): void {
  const setContacts   = useSetAtom(contactsAtom)
  const setRequests   = useSetAtom(contactRequestsAtom)
  const setPendingOut = useSetAtom(pendingOutAtom)
  const ingest        = useSetAtom(ingestMessageAtom)
  const reset         = useSetAtom(resetMessagingAtom)
  const removeLocal   = useSetAtom(removeContactLocalAtom)

  // Load the contact book when connected as this character (and clear the previous
  // character's state first, so a character switch doesn't show stale contacts).
  useEffect(() => {
    if (!messagingAvailable) return
    reset()
    if (!connected || !charName) return
    let cancelled = false
    window.dr.contacts.list().then(book => {
      if (cancelled) return
      const presence = book.presence ?? {}
      setContacts(book.contacts.map(c => ({ name: c.name, online: !!presence[key(c.name)] })))
      setRequests(book.pendingIn.map(c => c.name))
      setPendingOut(book.pendingOut.map(c => c.name))
    }).catch(() => { /* not connected as a character yet, or transient — ignore */ })
    return () => { cancelled = true }
  }, [charName, connected, reset, setContacts, setRequests, setPendingOut])

  // Subscribe to server events for the lifetime of the hook. Handlers use functional
  // updates + normalised-name matching so they never go stale.
  useEffect(() => {
    if (!messagingAvailable) return
    const unsubs = [
      window.dr.msg.onReceived(m => ingest(m as MagiloomMessage)),
      window.dr.contacts.onPresence(({ name, online }) =>
        setContacts(prev => prev.map(c => key(c.name) === key(name) ? { ...c, online } : c))),
      window.dr.contacts.onRequest(({ name }) =>
        setRequests(prev => prev.some(n => key(n) === key(name)) ? prev : [...prev, name])),
      window.dr.contacts.onAdded(({ name, online }) => {
        setContacts(prev => prev.some(c => key(c.name) === key(name))
          ? prev.map(c => key(c.name) === key(name) ? { ...c, online } : c)
          : [...prev, { name, online }])
        setRequests(prev => prev.filter(n => key(n) !== key(name)))
        setPendingOut(prev => prev.filter(n => key(n) !== key(name)))
      }),
      // The other party removed us: mirror the server and purge them + our history.
      window.dr.contacts.onRemoved(({ name }) => removeLocal(name)),
    ]
    return () => unsubs.forEach(fn => fn())
  }, [ingest, setContacts, setRequests, setPendingOut, removeLocal])
}
