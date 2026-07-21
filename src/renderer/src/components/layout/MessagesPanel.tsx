import { useState, useRef, useEffect, useCallback } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import {
  contactsAtom, contactRequestsAtom, pendingOutAtom, threadsAtom, unreadAtom,
  openThreadAtom, ingestMessageAtom, removeContactLocalAtom, type Contact,
} from '../../store/messaging'
import { selfNameAtom, avatarsAtom, serverAvatarsAtom } from '../../store/game'
import { resolveAvatarSrc } from '../../lib/avatar'
import { useEnsureAvatars } from '../../hooks/useAvatars'
import { Tooltip } from '../ui/Tooltip'
import { IconTrash } from '../ui/Icons'

// Avatar (with a presence dot overlaid at its corner) — the same image source the
// Conversation panel uses: local self-upload → server-backed image → letter fallback.
function ContactAvatar({ name, online, size = 30 }: { name: string; online?: boolean; size?: number }) {
  const avatars = useAtomValue(avatarsAtom)
  const server  = useAtomValue(serverAvatarsAtom)
  const self    = useAtomValue(selfNameAtom)
  const src = resolveAvatarSrc(name, avatars, server, self)
  return (
    <span className="msg-avatar-wrap" style={{ width: size, height: size }}>
      <img className="msg-avatar" src={src} alt="" style={{ width: size, height: size }} />
      {online !== undefined && <span className={'msg-presence ' + (online ? 'on' : 'off')} />}
    </span>
  )
}

const key = (n: string): string => n.trim().toLowerCase()

// Character names are capitalized (first letter up), as the game expects — matches
// the Body panel's patient input. Applied as you type, so the display name stored in
// requests/roster/threads is proper-cased regardless of how it was entered.
const capitalize = (s: string): string => s ? s[0].toUpperCase() + s.slice(1) : s

const fmtTime = (ts: number): string => {
  const d = new Date(ts)
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`
}

// ── List view: add-contact, pending requests, and the contact roster ─────────────
function ContactList({ onOpen }: { onOpen: (name: string) => void }) {
  const contacts = useAtomValue(contactsAtom)
  const requests = useAtomValue(contactRequestsAtom)
  const pending  = useAtomValue(pendingOutAtom)
  const unread   = useAtomValue(unreadAtom)
  const setPendingOut = useSetAtom(pendingOutAtom)
  const setRequests   = useSetAtom(contactRequestsAtom)

  // Background-fetch server avatars for everyone shown (same as the Conversation panel).
  useEnsureAvatars([...contacts.map(c => c.name), ...requests, ...pending])

  const [add, setAdd]     = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy]   = useState(false)

  const submitAdd = async () => {
    const name = capitalize(add.trim())
    if (!name || busy) return
    setBusy(true); setError('')
    try {
      const r = await window.dr.contacts.add(name)
      if (r.ok) {
        setAdd('')
        // A mutual request auto-accepts (onAdded will fire); otherwise it's outgoing.
        if (!r.autoAccepted) setPendingOut(prev => prev.some(n => key(n) === key(name)) ? prev : [...prev, name])
      } else setError(r.error || 'Could not send request.')
    } catch { setError('Not connected.') }
    finally { setBusy(false) }
  }

  const accept = async (name: string) => {
    setRequests(prev => prev.filter(n => key(n) !== key(name)))   // optimistic; onAdded confirms
    try { await window.dr.contacts.accept(name) } catch { /* ignore */ }
  }
  const deny = async (name: string) => {
    setRequests(prev => prev.filter(n => key(n) !== key(name)))
    try { await window.dr.contacts.deny(name) } catch { /* ignore */ }
  }

  // Online first, then alphabetical.
  const sorted = [...contacts].sort((a, b) =>
    (Number(b.online) - Number(a.online)) || a.name.localeCompare(b.name))

  return (
    <div className="msg-list">
      <div className="msg-add">
        <input
          className="msg-add-input"
          placeholder="Add a contact by name…"
          value={add}
          onChange={e => { setAdd(capitalize(e.target.value)); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') submitAdd() }}
        />
        <button className="msg-add-btn" onClick={submitAdd} disabled={!add.trim() || busy}>Add</button>
      </div>
      {error && <div className="msg-add-error">{error}</div>}

      {requests.length > 0 && (
        <div className="msg-requests">
          <div className="msg-section-label">Requests</div>
          {requests.map(name => (
            <div key={name} className="msg-request-row">
              <ContactAvatar name={name} size={26} />
              <span className="msg-contact-name">{name}</span>
              <div className="msg-request-actions">
                <button className="msg-req-accept" onClick={() => accept(name)}>Accept</button>
                <button className="msg-req-deny" onClick={() => deny(name)}>Deny</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sorted.length === 0 && requests.length === 0 && (
        <div className="panel-empty">No contacts yet — add someone by their character name.</div>
      )}

      {sorted.map((c: Contact) => {
        const n = unread[key(c.name)] ?? 0
        return (
          <button key={key(c.name)} className="msg-contact-row" onClick={() => onOpen(c.name)}>
            <ContactAvatar name={c.name} online={c.online} />
            <span className="msg-contact-name">{c.name}</span>
            {n > 0 && <span className="msg-unread">{n > 99 ? '99+' : n}</span>}
          </button>
        )
      })}

      {pending.length > 0 && (
        <div className="msg-pending">
          <div className="msg-section-label">Pending</div>
          {pending.map(name => (
            <div key={name} className="msg-pending-row">
              <span className="msg-contact-name">{name}</span>
              <span className="msg-pending-tag">requested</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Thread view: history + composer for one contact ──────────────────────────────
function Thread({ peer, onBack }: { peer: string; onBack: () => void }) {
  const self     = useAtomValue(selfNameAtom)
  const contacts = useAtomValue(contactsAtom)
  const [threads, setThreads] = useAtom(threadsAtom)
  const setUnread   = useSetAtom(unreadAtom)
  const ingest      = useSetAtom(ingestMessageAtom)
  const removeLocal = useSetAtom(removeContactLocalAtom)
  const pk = key(peer)
  const messages = threads[pk] ?? []
  const online = contacts.find(c => key(c.name) === pk)?.online ?? false
  useEnsureAvatars([peer])

  // Group consecutive messages by sender so the avatar shows once per run (like the
  // Conversation panel), with a plain-bubble stack for each side.
  const groups: { mine: boolean; msgs: MagiloomMessage[] }[] = []
  for (const m of messages) {
    const mine = key(m.from) === key(self)
    const prev = groups[groups.length - 1]
    if (prev && prev.mine === mine) prev.msgs.push(m)
    else groups.push({ mine, msgs: [m] })
  }

  const [text, setText]     = useState('')
  const [error, setError]   = useState('')
  const [confirming, setConfirming] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)

  // Load full history once when the thread opens, and mark it read.
  useEffect(() => {
    let cancelled = false
    window.dr.msg.history(peer).then(hist => {
      if (cancelled) return
      setThreads(prev => ({ ...prev, [pk]: hist }))
    }).catch(() => { /* keep whatever's already in the store */ })
    setUnread(prev => { if (!prev[pk]) return prev; const { [pk]: _, ...rest } = prev; return rest })
    window.dr.msg.markRead(peer).catch(() => {})
    return () => { cancelled = true }
  }, [peer, pk, setThreads, setUnread])

  // Keep it read + pinned to the newest message as messages arrive while open.
  useEffect(() => {
    const el = bodyRef.current
    if (el) el.scrollTop = el.scrollHeight
    setUnread(prev => { if (!prev[pk]) return prev; const { [pk]: _, ...rest } = prev; return rest })
  }, [messages.length, pk, setUnread])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    setText(''); setError('')
    try {
      const r = await window.dr.msg.send(peer, body)
      if (r.ok && r.message) ingest(r.message)        // optimistic; the echo dedupes by id
      else if (!r.ok) { setError(r.error || 'Could not send.'); setText(body) }
    } catch { setError('Not connected.'); setText(body) }
  }

  const remove = async () => {
    removeLocal(peer)   // optimistic: drop them + our message history, and close the thread
    try { await window.dr.contacts.remove(peer) } catch { /* ignore */ }
  }

  return (
    <div className="msg-thread">
      <div className="msg-thread-head">
        {confirming ? (
          <>
            <span className="msg-confirm-text">Remove {peer} &amp; delete this chat?</span>
            <button className="msg-confirm-yes" onClick={remove}>Remove</button>
            <button className="msg-confirm-no" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <>
            <button className="msg-back" onClick={onBack} aria-label="Back to contacts">‹</button>
            <ContactAvatar name={peer} online={online} size={28} />
            <span className="msg-thread-name">{peer}</span>
            <Tooltip text="Remove contact">
              <button className="msg-remove" onClick={() => setConfirming(true)} aria-label="Remove contact"><IconTrash size={15} /></button>
            </Tooltip>
          </>
        )}
      </div>

      <div className="msg-thread-body" ref={bodyRef}>
        {messages.length === 0
          ? <div className="panel-empty">No messages yet — say hello.</div>
          : groups.map(g => (
              <div key={g.msgs[0].id} className={'msg-group ' + (g.mine ? 'mine' : 'theirs')}>
                {!g.mine && <ContactAvatar name={peer} size={28} />}
                <div className="msg-group-bubbles">
                  {g.msgs.map(m => (
                    <div key={m.id} className="msg-bubble">
                      <span className="msg-bubble-text">{m.body}</span>
                      <span className="msg-bubble-time">{fmtTime(m.ts)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
      </div>

      {error && <div className="msg-add-error">{error}</div>}
      <div className="msg-composer">
        <input
          className="msg-composer-input"
          placeholder={`Message ${peer}…`}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') send() }}
        />
        <button className="msg-send-btn" onClick={send} disabled={!text.trim()}>Send</button>
      </div>
    </div>
  )
}

export function MessagesPanel() {
  const [open, setOpen] = useAtom(openThreadAtom)
  const onOpen = useCallback((name: string) => setOpen(name), [setOpen])
  const onBack = useCallback(() => setOpen(null), [setOpen])

  return (
    <div className="msg-panel">
      {open
        ? <Thread peer={open} onBack={onBack} />
        : <ContactList onOpen={onOpen} />}
    </div>
  )
}
