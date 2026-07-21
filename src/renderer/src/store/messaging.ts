import { atom } from 'jotai'
import { selfNameAtom } from './game'

// ── Magiloom messaging state (character-to-character) ────────────────────────────
// Global, app-level state so unread badges update while the Messages panel is closed
// and threads persist across opening/closing it. Populated by useMessaging (which
// loads the contact book and subscribes to the server's msg/contact events) and read
// by MessagesPanel + the panel rail. This is a Magiloom side-channel, entirely
// separate from in-game speech (the Conversation panel).

// Messaging only works where the renderer has a live magiserver connection — the web
// client today. On desktop (which talks to the game directly) the dr.contacts/dr.msg
// handlers are absent, so the panel and the subscription hook gate on this. Phase C
// (a magiserver client in the desktop main) flips it to true there too.
export const messagingAvailable =
  typeof window !== 'undefined' && window.dr?.app?.platform === 'web'

export interface Contact { name: string; online: boolean }

const key = (n: string): string => n.trim().toLowerCase()

// Accepted contacts, with live presence.
export const contactsAtom = atom<Contact[]>([])
// Incoming friend requests awaiting this character's accept (display names).
export const contactRequestsAtom = atom<string[]>([])
// Requests this character has sent, awaiting the other's accept (shown as "requested").
export const pendingOutAtom = atom<string[]>([])
// Message threads: normalised peer name → messages (chronological).
export const threadsAtom = atom<Record<string, MagiloomMessage[]>>({})
// Unread incoming counts: normalised peer name → count.
export const unreadAtom = atom<Record<string, number>>({})
// The peer whose thread is open in the panel (display name), or null for the list view.
export const openThreadAtom = atom<string | null>(null)

// Total unread across all threads — drives the rail badge.
export const totalUnreadAtom = atom(get =>
  Object.values(get(unreadAtom)).reduce((a, b) => a + b, 0))

// Purge one contact locally: drop them from the roster/requests/pending, delete the
// thread + unread, and close the thread if it's open. Used both when THIS character
// removes someone (the server doesn't echo removal back to the remover) and when a
// `contacts:removed` event says the other party removed us. Mirrors the server, which
// deletes the message history on removal for both sides.
export const removeContactLocalAtom = atom(null, (get, set, name: string) => {
  const k = key(name)
  set(contactsAtom, get(contactsAtom).filter(c => key(c.name) !== k))
  set(contactRequestsAtom, get(contactRequestsAtom).filter(n => key(n) !== k))
  set(pendingOutAtom, get(pendingOutAtom).filter(n => key(n) !== k))
  const threads = { ...get(threadsAtom) }; delete threads[k]; set(threadsAtom, threads)
  const unread  = { ...get(unreadAtom) };  delete unread[k];  set(unreadAtom, unread)
  if (key(get(openThreadAtom) ?? '') === k) set(openThreadAtom, null)
})

// Clear everything (character switch / sign-out). useMessaging calls this before a load.
export const resetMessagingAtom = atom(null, (_get, set) => {
  set(contactsAtom, [])
  set(contactRequestsAtom, [])
  set(pendingOutAtom, [])
  set(threadsAtom, {})
  set(unreadAtom, {})
  set(openThreadAtom, null)
})

// Ingest one message (from a live `msg:received` event, or optimistically from the
// send() result). Idempotent by id, so the sender's own echo can't double-post. Bumps
// unread only for an INCOMING message whose thread isn't currently open, and makes sure
// the peer shows up as a contact (they had to be one to reach us).
export const ingestMessageAtom = atom(null, (get, set, m: MagiloomMessage) => {
  const self = get(selfNameAtom)
  const peer = key(m.from) === key(self) ? m.to : m.from
  const pk = key(peer)

  const threads = get(threadsAtom)
  const cur = threads[pk] ?? []
  if (cur.some(x => x.id === m.id)) return
  set(threadsAtom, { ...threads, [pk]: [...cur, m] })

  const incoming = key(m.from) !== key(self)
  if (incoming && key(get(openThreadAtom) ?? '') !== pk) {
    const u = get(unreadAtom)
    set(unreadAtom, { ...u, [pk]: (u[pk] ?? 0) + 1 })
  }

  const contacts = get(contactsAtom)
  if (!contacts.some(c => key(c.name) === pk)) {
    set(contactsAtom, [...contacts, { name: peer, online: incoming }])
  } else if (incoming) {
    set(contactsAtom, contacts.map(c => key(c.name) === pk ? { ...c, online: true } : c))
  }
})
