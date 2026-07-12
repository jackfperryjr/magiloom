import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useAtomValue } from 'jotai'
import { convLinesAtom, outputLinesAtom, presenceModeAtom } from '../../store/game'
import type { ConnectionStatus, OutputLine } from '../../store/game'
import { speak } from '../../lib/tts'

export type NotifKind = 'mention' | 'whisper' | 'disconnect'

export interface NotifSettings {
  sound:      boolean
  desktop:    boolean
  mention:    boolean
  whisper:    boolean
  disconnect: boolean
  ttsMention?: boolean   // speak mentions aloud
  ttsWhisper?: boolean   // speak whispers aloud
}

export const DEFAULT_NOTIF: NotifSettings = {
  sound: true, desktop: true, mention: true, whisper: true, disconnect: true,
  ttsMention: false, ttsWhisper: false,
}

// Opt-in Web Push for conversation/mentions. Evaluated server-side (magiserver's
// trigger-engine) so it fires even when the PWA is closed — the in-app toasts
// above can't, since a closed page runs no JS. Off by default; web app only.
export interface PushSettings {
  enabled: boolean   // master
  mention: boolean   // your character's name spoken
  whisper: boolean
  speech:  boolean   // room "says"
  thought: boolean
}

export const DEFAULT_PUSH: PushSettings = {
  enabled: false, mention: false, whisper: false, speech: false, thought: false,
}

// A user-defined "watch" alert. Matches incoming game text (substring, or /regex/
// when isRegex) and fires the channels checked on the rule. Stored globally in
// settings.json `notifRules`; edited in the Settings → Notifications tab.
export interface NotifRule {
  id:      string
  label:   string    // toast title; also the friendly name in Settings
  pattern: string
  isRegex: boolean
  toast:   boolean
  desktop: boolean
  sound:   boolean
  tts?:    boolean   // speak the matched line aloud
  enabled: boolean
}

export function makeNameRule(name: string): NotifRule {
  const n = name.trim()
  return { id: Math.random().toString(36).slice(2, 9), label: n, pattern: n, isRegex: false, toast: true, desktop: true, sound: true, tts: false, enabled: true }
}

const TITLES: Record<NotifKind, string> = {
  mention: 'Mention', whisper: 'Whisper', disconnect: 'Disconnected',
}

// ── Sound — short synthesized ping (no audio assets needed) ────────────────────
let _audioCtx: AudioContext | null = null
function playPing(freq: number) {
  try {
    _audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const ctx = _audioCtx
    if (ctx.state === 'suspended') ctx.resume()
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.012)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3)
    osc.start(now); osc.stop(now + 0.32)
  } catch { /* audio unavailable */ }
}

const KIND_FREQ: Record<NotifKind, number> = { disconnect: 300, whisper: 680, mention: 540 }

interface Toast { id: number; kind: string; title: string; text: string }

// Compile a rule's pattern into a matcher. Substring is case-insensitive; a
// malformed regex is skipped (never matches) rather than throwing.
function ruleMatcher(rule: NotifRule): ((s: string) => boolean) | null {
  const p = rule.pattern.trim()
  if (!p) return null
  if (rule.isRegex) {
    try { const re = new RegExp(p, 'i'); return s => re.test(s) } catch { return null }
  }
  const needle = p.toLowerCase()
  return s => s.toLowerCase().includes(needle)
}

const RULE_COOLDOWN_MS = 2000

export function NotificationCenter({ charName, status }: { charName: string; status: ConnectionStatus }) {
  const conv     = useAtomValue(convLinesAtom)
  const output   = useAtomValue(outputLinesAtom)
  const presence = useAtomValue(presenceModeAtom)

  const [cfg,    setCfg]    = useState<NotifSettings>(DEFAULT_NOTIF)
  const [rules,  setRules]  = useState<NotifRule[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])

  const cfgRef      = useRef(cfg);      useEffect(() => { cfgRef.current = cfg }, [cfg])
  const presenceRef = useRef(presence); useEffect(() => { presenceRef.current = presence }, [presence])

  const charRe = useMemo(() => {
    const n = charName.trim()
    return n ? new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null
  }, [charName])

  // Compiled custom-alert matchers, rebuilt when the rule set changes.
  const matchers = useMemo(
    () => rules.filter(r => r.enabled).map(r => ({ rule: r, test: ruleMatcher(r) })).filter(m => m.test),
    [rules],
  )
  const matchersRef = useRef(matchers); useEffect(() => { matchersRef.current = matchers }, [matchers])
  const ruleCooldown = useRef<Map<string, number>>(new Map())

  // Load per-event settings + custom alert rules; refresh when saved from the modal
  useEffect(() => {
    const load = () => window.dr.settings.getAll().then(s => {
      if (s.notifications) setCfg({ ...DEFAULT_NOTIF, ...s.notifications })
      setRules(s.notifRules ?? [])
    })
    load()
    window.addEventListener('settings:saved', load)
    return () => window.removeEventListener('settings:saved', load)
  }, [])

  // Low-level emit: passive toast always shows; Do Not Disturb silences sound + popups.
  const emit = useCallback((kind: string, title: string, text: string, sound: boolean, desktop: boolean, freq: number, tts = false) => {
    const dnd = presenceRef.current === 'dnd'
    const id = Date.now() + Math.random()
    setToasts(t => [...t.slice(-3), { id, kind, title, text }])
    window.setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 6000)
    if (sound && !dnd) playPing(freq)
    if (tts && !dnd) speak(text)
    if (desktop && !dnd && !document.hasFocus()) {
      try { new Notification(title, { body: text, silent: true }) } catch { /* not permitted */ }
    }
  }, [])

  // Built-in events (mention / whisper / disconnect) — gated by the per-event
  // checkboxes and the global sound/desktop toggles.
  const fire = useCallback((kind: NotifKind, text: string) => {
    const c = cfgRef.current
    if (!c[kind]) return
    const tts = kind === 'whisper' ? !!c.ttsWhisper : kind === 'mention' ? !!c.ttsMention : false
    emit(kind, TITLES[kind], text, c.sound, c.desktop, KIND_FREQ[kind], tts)
  }, [emit])

  // Custom watch alerts — each rule carries its own toast/desktop/sound/speak channels.
  const scanRules = useCallback((text: string) => {
    const now = Date.now()
    for (const { rule, test } of matchersRef.current) {
      if (!test!(text)) continue
      const last = ruleCooldown.current.get(rule.id) ?? 0
      if (now - last < RULE_COOLDOWN_MS) continue
      ruleCooldown.current.set(rule.id, now)
      emit('custom', rule.label || rule.pattern, text, rule.sound, rule.desktop, 460, !!rule.tts)
    }
  }, [emit])

  // Conversation lines → whisper / mention (+ custom rules). Skip backlog on mount.
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
      scanRules(text)
      const isWhisper = l.styles?.some(s => s.preset === 'whisper') || /\bwhispers?\b/i.test(text)
      if (isWhisper) { fire('whisper', text); continue }
      if (charRe && charRe.test(text)) fire('mention', text)
    }
  }, [conv, charRe, fire, scanRules])

  // Main game output → custom rules (arrivals, deaths, etc. land here, not in
  // conversation). Skip the pre-existing backlog on mount.
  const lastOutId = useRef<number | null>(null)
  useEffect(() => {
    if (lastOutId.current === null) {
      lastOutId.current = output.length ? output[output.length - 1].id : -1
      return
    }
    for (const l of output) {
      if (l.id <= lastOutId.current) continue
      lastOutId.current = l.id
      if (!isScannable(l)) continue
      scanRules(l.text)
    }
  }, [output, scanRules])

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
          <div className="toast-title">{t.title}</div>
          <div className="toast-body">{t.text}</div>
        </div>
      ))}
    </div>
  )
}

// Only match real (server-sent) game text — skip separators, dividers, LOOK
// portrait blocks, empty lines, and the player's own echoed commands / script
// output, so custom alerts don't fire on layout scaffolding or your own typing.
function isScannable(l: OutputLine): boolean {
  if (l.separator || l.divider || l.look || !l.text.trim()) return false
  return !l.styles?.some(s => s.preset === 'echo' || s.preset === 'echo-script')
}
