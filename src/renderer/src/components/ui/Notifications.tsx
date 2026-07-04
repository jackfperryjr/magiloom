import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { convLinesAtom, presenceModeAtom } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'

export type NotifKind = 'mention' | 'whisper' | 'disconnect'

export interface NotifSettings {
  sound:      boolean
  desktop:    boolean
  mention:    boolean
  whisper:    boolean
  disconnect: boolean
}

export const DEFAULT_NOTIF: NotifSettings = {
  sound: true, desktop: true, mention: true, whisper: true, disconnect: true,
}

const TITLES: Record<NotifKind, string> = {
  mention: 'Mention', whisper: 'Whisper', disconnect: 'Disconnected',
}

// ── Sound — short synthesized ping (no audio assets needed) ────────────────────
let _audioCtx: AudioContext | null = null
function playPing(kind: NotifKind) {
  try {
    _audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const ctx = _audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = kind === 'disconnect' ? 300 : kind === 'whisper' ? 680 : 540
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    osc.start(now); osc.stop(now + 0.32)
  } catch { /* audio unavailable */ }
}

interface Toast { id: number; kind: NotifKind; text: string }

export function NotificationCenter({ charName, status }: { charName: string; status: ConnectionStatus }) {
  const conv     = useAtomValue(convLinesAtom)
  const presence = useAtomValue(presenceModeAtom)

  const [cfg,    setCfg]    = useState<NotifSettings>(DEFAULT_NOTIF)
  const [toasts, setToasts] = useState<Toast[]>([])

  const cfgRef      = useRef(cfg);      useEffect(() => { cfgRef.current = cfg }, [cfg])
  const presenceRef = useRef(presence); useEffect(() => { presenceRef.current = presence }, [presence])

  const charRe = useMemo(() => {
    const n = charName.trim()
    return n ? new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null
  }, [charName])

  // Load per-event notification settings; refresh when saved from the modal
  useEffect(() => {
    const load = () => window.dr.settings.getAll().then(s => {
      if (s.notifications) setCfg({ ...DEFAULT_NOTIF, ...s.notifications })
    })
    load()
    window.addEventListener('settings:saved', load)
    return () => window.removeEventListener('settings:saved', load)
  }, [])

  const fire = useCallback((kind: NotifKind, text: string) => {
    const c = cfgRef.current
    if (!c[kind]) return
    const dnd = presenceRef.current === 'dnd'

    const id = Date.now() + Math.random()
    setToasts(t => [...t.slice(-3), { id, kind, text }])
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)

    // Do Not Disturb silences pings + popups (the passive toast still shows)
    if (c.sound && !dnd) playPing(kind)
    if (c.desktop && !dnd && !document.hasFocus()) {
      try { new Notification(TITLES[kind], { body: text, silent: true }) } catch { /* not permitted */ }
    }
  }, [])

  // Conversation lines → whisper / mention. Skip the pre-existing backlog on mount.
  const lastConvId = useRef<number | null>(null)
  useEffect(() => {
    if (lastConvId.current === null) {
      lastConvId.current = conv.length ? conv[conv.length - 1].id : -1
      return
    }
    for (const l of conv) {
      if (l.id <= lastConvId.current) continue
      lastConvId.current = l.id
      const text = l.text
      if (/^You\b/.test(text.trim())) continue   // your own speech/whispers
      const isWhisper = l.styles?.some(s => s.preset === 'whisper') || /\bwhispers?\b/i.test(text)
      if (isWhisper) { fire('whisper', text); continue }
      if (charRe && charRe.test(text)) fire('mention', text)
    }
  }, [conv, charRe, fire])

  // Connection drop
  const prevStatus = useRef(status)
  useEffect(() => {
    if (prevStatus.current === 'connected' && (status === 'disconnected' || status === 'error')) {
      fire('disconnect', 'Connection to DragonRealms was lost.')
    }
    prevStatus.current = status
  }, [status, fire])

  return (
    <div className="toast-stack">
      {toasts.map(t => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}
        >
          <div className="toast-title">{TITLES[t.kind]}</div>
          <div className="toast-body">{t.text}</div>
        </div>
      ))}
    </div>
  )
}
