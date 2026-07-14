import { useState, useEffect, useRef, useMemo, forwardRef, useImperativeHandle } from 'react'
import { useAtomValue, useAtom } from 'jotai'
import {
  handsAtom, indicatorsAtom, roundtimeSecondsAtom, vitalsAtom,
  verbsAtom, verbsWithInfoAtom, verbInfoAtom, beginVerbInfoCapture,
  presenceModeAtom, avatarsAtom, avatarCropsAtom, serverAvatarsAtom, linkModeAtom, broadcastReceiveAtom,
} from '../../store/game'
import type { PresenceMode, ProfileInfo } from '../../store/game'
import type { AvatarCrop } from '../../lib/avatar'
import { CircleAvatar } from '../ui/CircleAvatar'
import { downscaleToFit } from '../../lib/image'
import { useProfile } from '../../hooks/useProfile'
import { useEnsureAvatars } from '../../hooks/useAvatars'
import { useIsMobile } from '../../hooks/useIsMobile'
export type { ConnectionStatus } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'
import {
  IconCog, IconPaintBrush, IconPhoto, IconPower, IconBolt, IconBroadcast,
  IconWinMinimize, IconWinMaximize, IconWinRestore, IconWinClose,
} from '../ui/Icons'
import { Tooltip } from '../ui/Tooltip'
import { BroadcastModal } from '../ui/BroadcastModal'
import { startDictation, sttAvailable, type DictationHandle } from '../../lib/stt'
import { IconMic } from '../ui/Icons'
import { PostureIcon, CONDITIONS, currentPosture } from './StatusIcons'

// ── Command autocomplete ──────────────────────────────────────────────────────
// Curated common DragonRealms verbs/commands. Can be augmented at runtime via the
// game's `VERB LIST` output (see setVerbs).
const COMMON_VERBS = [
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest',
  'up', 'down', 'out', 'go',
  'look', 'look in', 'search', 'glance', 'read', 'appraise', 'inventory',
  'get', 'put', 'drop', 'stow', 'wear', 'remove', 'wield', 'sheathe', 'ready',
  'open', 'close', 'turn', 'push', 'pull', 'lift', 'lower',
  'attack', 'stance', 'retreat', 'advance', 'aim', 'ambush', 'target',
  'stand', 'sit', 'kneel', 'lie down', 'hide', 'unhide', 'sneak',
  'prepare', 'cast', 'incant', 'invoke', 'channel',
  'health', 'exp', 'experience', 'spells', 'skills', 'info',
  'forage', 'skin', 'gather', 'tend', 'pray',
  'say', 'whisper', 'ask', 'tell', 'shout', 'yell', 'think', 'roleplay',
  'deposit', 'withdraw', 'buy', 'sell', 'order', 'appraise',
]

// Speech-to-text is shelved: the Web Speech API is blocked in Electron (no Google
// key → `network` error). All the mic wiring below stays intact; flip this to true
// once a real STT backend (Vosk offline model or a cloud API) is added.
const MIC_ENABLED = false

interface Suggestion { text: string; tag: string }

function buildSuggestions(
  value: string, history: string[], functionKeys: Record<string, string>, verbs: string[]
): Suggestion[] {
  const q = value.toLowerCase().trimStart()
  if (!q) return []
  const seen = new Set<string>()
  const out: Suggestion[] = []
  const add = (raw: string, tag: string) => {
    const text = raw.trim()
    if (!text) return
    const key = text.toLowerCase()
    if (key === q || !key.startsWith(q) || seen.has(key)) return
    seen.add(key)
    out.push({ text, tag })
  }
  history.forEach(h => add(h, 'history'))
  Object.entries(functionKeys).forEach(([fk, cmd]) => add(cmd, fk))
  verbs.forEach(v => add(v, 'verb'))
  return out.slice(0, 8)
}

// ── CommandInput ──────────────────────────────────────────────────────────────
export function CommandInput({ onSend, onEcho, functionKeys = {}, status, leading }: {
  onSend: (cmd: string) => void
  onEcho: (cmd: string) => void
  functionKeys?: Record<string, string>
  status?: ConnectionStatus
  leading?: React.ReactNode   // mobile: the character avatar/menu, docked in the bar
}) {
  const inputRef   = useRef<HTMLInputElement>(null)
  const historyRef = useRef<string[]>([])
  const histIdxRef = useRef(-1)
  const [value, setValue] = useState('')
  const [open,  setOpen]  = useState(false)
  const [sel,   setSel]   = useState(0)
  // Click-to-toggle dictation. recRef holds the live recognizer; onRef is the
  // intended on/off state (so we can auto-restart when the recognizer times out on
  // silence, keeping it "on" until the user clicks off).
  const [listening, setListening] = useState(false)
  const [micMsg,    setMicMsg]    = useState('')
  const recRef = useRef<DictationHandle | null>(null)
  const onRef  = useRef(false)
  const micOn  = sttAvailable()
  const gameVerbs    = useAtomValue(verbsAtom)
  const verbsWithInfo = useAtomValue(verbsWithInfoAtom)
  const verbInfo     = useAtomValue(verbInfoAtom)
  const rt           = useAtomValue(roundtimeSecondsAtom)  // roundtime badge in the input

  useEffect(() => { inputRef.current?.focus() }, [])

  const allVerbs = useMemo(
    () => (gameVerbs.length ? Array.from(new Set([...COMMON_VERBS, ...gameVerbs])).sort() : COMMON_VERBS),
    [gameVerbs]
  )
  const suggestions = useMemo(
    () => buildSuggestions(value, historyRef.current, functionKeys, allVerbs),
    [value, functionKeys, allVerbs]
  )
  const showSug = open && suggestions.length > 0

  useEffect(() => { if (sel >= suggestions.length) setSel(0) }, [suggestions.length, sel])

  // Fetch VERB INFO (debounced) for the highlighted suggestion when it's a known
  // single-word verb we haven't fetched yet — used for the detail popover.
  const verbSet   = useMemo(() => new Set(allVerbs.map(v => v.toLowerCase())), [allVerbs])
  const infoKnown = useMemo(() => Object.keys(verbsWithInfo).length > 0, [verbsWithInfo])
  const activeName = showSug ? suggestions[sel]?.text.toLowerCase() : undefined
  const activeInfo = activeName ? verbInfo[activeName] : undefined
  useEffect(() => {
    if (!activeName || activeName.includes(' ') || !verbSet.has(activeName)) return
    if (infoKnown && !verbsWithInfo[activeName]) return   // sweep knows it has no detail
    if (verbInfo[activeName] !== undefined) return         // already fetched
    const t = window.setTimeout(() => { beginVerbInfoCapture(activeName); onSend(`verb info ${activeName}`) }, 300)
    return () => window.clearTimeout(t)
  }, [activeName, verbSet, infoKnown, verbsWithInfo, verbInfo, onSend])

  const submit = () => {
    const val = value.trim()
    if (!val) return
    onEcho(val)
    onSend(val)
    historyRef.current = [val, ...historyRef.current.slice(0, 99)]
    histIdxRef.current = -1
    setValue('')
    setOpen(false)
  }

  const accept = (text: string) => {
    setValue(text)
    setOpen(false)
    inputRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showSug) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => (s + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setSel(s => (s - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Tab')       { e.preventDefault(); accept(suggestions[sel]?.text ?? value); return }
      if (e.key === 'Escape')    { e.preventDefault(); setOpen(false); return }
      if (e.key === 'Enter')     { submit(); return }
      return
    }
    if (e.key === 'Enter') { submit(); return }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = Math.min(histIdxRef.current + 1, historyRef.current.length - 1)
      histIdxRef.current = next
      setValue(historyRef.current[next] ?? '')
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = Math.max(histIdxRef.current - 1, -1)
      histIdxRef.current = next
      setValue(next === -1 ? '' : historyRef.current[next] ?? '')
    }
  }

  // Click the mic to toggle dictation on/off. While on it listens continuously and
  // fills the input with what it hears; you review and press Enter to send.
  const startMic = () => {
    setMicMsg('')
    onRef.current = true
    recRef.current = startDictation({
      continuous: true,
      onText: (t) => { setValue(t); setOpen(false) },
      onError: (err) => {
        onRef.current = false; setListening(false); recRef.current = null
        setMicMsg(
          err === 'not-allowed' || err === 'service-not-allowed' ? 'Microphone permission denied'
          : err === 'network' || err === 'unavailable' ? 'Speech recognition unavailable in this build'
          : err === 'no-speech' ? '' : 'Dictation error',
        )
      },
      // The recognizer stops itself after long silence — restart (briefly delayed to
      // avoid a hot loop) while still toggled on.
      onEnd: () => { recRef.current = null; if (onRef.current) setTimeout(startMic, 300); else { setListening(false); inputRef.current?.focus() } },
    })
    if (recRef.current) setListening(true)
  }
  const toggleMic = () => {
    if (!micOn) { setMicMsg('Speech recognition unavailable in this build'); return }
    if (onRef.current) { onRef.current = false; recRef.current?.stop() }
    else startMic()
  }

  return (
    <div className="command-input-wrap">
      {leading}
      {showSug && (
        <div className="cmd-popup">
          {activeInfo && activeInfo.length > 0 && (
            <div className="cmd-verbinfo">
              <div className="cmd-verbinfo-title">{activeName}</div>
              {activeInfo.map((e, i) => (
                <div key={i} className="cmd-verbinfo-row">
                  {e.syntax && <div className="cmd-verbinfo-syntax">{e.syntax}</div>}
                  {e.desc && <div className="cmd-verbinfo-desc">{e.desc}</div>}
                </div>
              ))}
            </div>
          )}
          <div className="cmd-suggest">
            {suggestions.map((s, i) => (
              <div
                key={s.text}
                className={'cmd-suggest-item' + (i === sel ? ' active' : '')}
                onMouseDown={e => { e.preventDefault(); accept(s.text) }}
                onMouseEnter={() => setSel(i)}
              >
                <span className="cmd-suggest-text">{s.text}</span>
                <span className="cmd-suggest-tag">{s.tag}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <span className="command-prompt">&gt;</span>
      <input
        ref={inputRef}
        className="command-input"
        type="text"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={e => { setValue(e.target.value); setOpen(true); histIdxRef.current = -1 }}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        placeholder="Send Commands"
      />
      {rt > 0 && <span className="command-rt" data-tooltip="Roundtime">RT {rt}s</span>}
      {MIC_ENABLED && (
        <button
          type="button"
          className={'command-mic ' + (listening ? 'mic-on' : 'mic-off')}
          data-tooltip={listening ? 'Listening — click to turn off' : micMsg || 'Click to speak commands'}
          onClick={toggleMic}
        >
          <IconMic size={18} />
        </button>
      )}
      <StatusPanel status={status ?? 'disconnected'} />
    </div>
  )
}

// ── Hand display ─────────────────────────────────────────────────────────────
function HandDisplay() {
  const hands = useAtomValue(handsAtom)
  const empty = <span style={{ color: 'var(--text-dim)', fontStyle: 'italic' }}>empty</span>
  return (
    <div className="hand-display">
      <span className="hand-label">L:</span>
      <span className="hand-item">{hands.left ? hands.left : empty}</span>
      <span className="hand-sep">|</span>
      <span className="hand-label">R:</span>
      <span className="hand-item">{hands.right ? hands.right : empty}</span>
    </div>
  )
}

// ── Status panel (posture + condition icons, beside the command line) ─────────
// A posture stick-figure that changes with your body position, plus one icon per
// danger/state condition — dimmed when clear, lit (red, or green for Hidden) when
// active. Icons carry tooltips instead of text badges.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Posture + condition icons, embedded on the right of the command input (like the
// roundtime badge). Inline icon group — no card of its own.
export function StatusPanel({ status }: { status: ConnectionStatus }) {
  const indicators = useAtomValue(indicatorsAtom)
  const [showConds, setShowConds] = useState(false)
  if (status !== 'connected') return null
  const posture = currentPosture(indicators)
  const hasDanger = CONDITIONS.some(c => c.danger && indicators[c.id])
  return (
    <div className="status-icons">
      {/* Posture stick-figure — click to pop up the full condition list. On mobile
          this is the only status shown inline (conditions collapse into the popup). */}
      <button
        className="status-icon status-posture"
        data-tooltip={cap(posture) + ' · click for status'}
        onClick={() => setShowConds(v => !v)}
      >
        <PostureIcon posture={posture} />
        {hasDanger && <span className="status-posture-alert" />}
      </button>
      <span className="status-conds-inline">
        <span className="status-panel-sep" />
        {CONDITIONS.map(c => {
          const on = !!indicators[c.id]
          return (
            <span
              key={c.id}
              className={`status-icon status-cond-${c.id}` + (on ? (c.danger ? ' active-danger' : ' active-good') : '')}
              data-tooltip={on ? c.label : `Not ${c.label}`}
            >
              {c.icon}
            </span>
          )
        })}
      </span>
      {showConds && <>
        <div className="status-pop-backdrop" onClick={() => setShowConds(false)} />
        <div className="status-pop">
          <span className="status-pop-posture"><PostureIcon posture={posture} /> {cap(posture)}</span>
          <div className="status-pop-grid">
            {CONDITIONS.map(c => {
              const on = !!indicators[c.id]
              return (
                <div key={c.id} className={'status-pop-row' + (on ? (c.danger ? ' active-danger' : ' active-good') : '')}>
                  <span className="status-pop-icon">{c.icon}</span>
                  <span className="status-pop-label">{on ? c.label : `Not ${c.label}`}</span>
                </div>
              )
            })}
          </div>
        </div>
      </>}
    </div>
  )
}

// ── Vitals (compact bars) ─────────────────────────────────────────────────────
const VITALS: { key: 'health' | 'mana' | 'stamina' | 'spirit'; label: string; color: string }[] = [
  { key: 'health',  label: 'HP', color: 'var(--health-color)' },
  { key: 'mana',    label: 'MP', color: 'var(--mana-color)' },
  { key: 'stamina', label: 'ST', color: 'var(--stamina-color)' },
  { key: 'spirit',  label: 'SP', color: 'var(--spirit-color)' },
]

function VitalsGroup() {
  const vitals = useAtomValue(vitalsAtom)
  return (
    <div className="hud-vitals">
      {VITALS.map(v => {
        const st  = vitals[v.key]
        const pct = st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 0
        return (
          <div className="vital-mini" key={v.key} data-tooltip={`${v.label} ${Math.round(pct)}%`}>
            <span className="vital-mini-label" style={{ color: v.color }}>{v.label}</span>
            <div className="vital-mini-track">
              <div className={`vital-mini-fill vital-${v.key}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="vital-mini-num">{Math.round(pct)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── HUD bar — one thin strip directly above the command line ──────────────────
// Vitals on the left; posture/condition pills + hands on the right. Roundtime now
// lives in the command line instead (see CommandInput).
// ── HUD bar — one thin strip directly above the command line ──────────────────
// Vitals fill the width; hands are pinned to a fixed slot on the right. Posture and
// conditions now live in the StatusPanel beside the command line; roundtime in it.
export function HudBar({ status }: { status: ConnectionStatus }) {
  if (status !== 'connected') return null
  return (
    <div className="hud-bar">
      <VitalsGroup />
      <HandDisplay />
    </div>
  )
}

// ── Character bar (bottom-left identity + user menu) ──────────────────────────
// Downscale the picked image to a small square data URL so settings stay light.
// Read a picked File into a data URL (raw — cropping happens live in the modal).
function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload  = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

// Interactive avatar cropper: pan (drag) + zoom (slider/wheel) a source image
// within a circular frame; export() bakes the framed region to a 256px square.
export interface AvatarCropHandle { export: () => { url: string; crop: AvatarCrop } }
const PREVIEW = 240  // matches .avatar-cropper-frame / .avatar-modal-preview img

const AvatarCropper = forwardRef<AvatarCropHandle, { src: string }>(({ src }, ref) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const [nat,  setNat]  = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)                 // multiplier over the cover-fit scale
  const [off,  setOff]  = useState({ x: 0, y: 0 })    // pan, in preview px
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const base  = nat ? Math.max(PREVIEW / nat.w, PREVIEW / nat.h) : 1
  const scale = base * zoom
  const dispW = nat ? nat.w * scale : PREVIEW
  const dispH = nat ? nat.h * scale : PREVIEW

  // Keep the image covering the circle — no gaps at the edges.
  const clamp = (o: { x: number; y: number }) => {
    const maxX = Math.max(0, (dispW - PREVIEW) / 2)
    const maxY = Math.max(0, (dispH - PREVIEW) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) }
  }
  useEffect(() => { setOff(o => clamp(o)) }, [zoom, nat])  // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setOff(clamp({ x: drag.current.ox + (e.clientX - drag.current.px), y: drag.current.oy + (e.clientY - drag.current.py) }))
  }
  const onUp = (e: React.PointerEvent) => {
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }
  const onWheel = (e: React.WheelEvent) => {
    setZoom(z => Math.min(3, Math.max(1, z - e.deltaY * 0.0015)))
  }

  // Keep the full (downscaled) image; return the pan/zoom as size-independent
  // fractions so any circle can reproduce this exact framing.
  useImperativeHandle(ref, () => ({
    export: () => {
      const maxX = Math.max(0, (dispW - PREVIEW) / 2)
      const maxY = Math.max(0, (dispH - PREVIEW) / 2)
      return { url: src, crop: { zoom, px: maxX ? off.x / maxX : 0, py: maxY ? off.y / maxY : 0 } }
    },
  }), [dispW, dispH, off, zoom, src])

  return (
    <div className="avatar-cropper">
      <div className="avatar-cropper-frame" onPointerDown={onDown} onPointerMove={onMove}
           onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <img
          ref={imgRef} src={src} alt="" draggable={false}
          onLoad={e => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setZoom(1); setOff({ x: 0, y: 0 }) }}
          style={{ width: dispW, height: dispH, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))` }}
        />
      </div>
      <input className="avatar-cropper-zoom" type="range" min={1} max={3} step={0.01}
             value={zoom} onChange={e => setZoom(Number(e.target.value))} aria-label="Zoom" />
      <div className="avatar-cropper-hint">Drag to reposition · scroll or slider to zoom</div>
    </div>
  )
})
AvatarCropper.displayName = 'AvatarCropper'

const IDLE_MS = 5 * 60 * 1000  // auto-idle after 5 min of no input

const PRESENCE_LABEL: Record<PresenceMode, string> = {
  online: 'Online',
  idle:   'Idle',
  dnd:    'Do Not Disturb',
}

// Resolve the dot color + label from connection status, the user's chosen
// presence, and auto-idle. Presence only applies while connected.
function presenceFor(status: ConnectionStatus, mode: PresenceMode, autoIdle: boolean): { dot: string; label: string } {
  if (status === 'connecting') return { dot: 'connecting', label: 'Connecting…' }
  if (status !== 'connected')  return { dot: 'offline',    label: 'Offline' }
  if (mode === 'dnd')                 return { dot: 'dnd',  label: PRESENCE_LABEL.dnd }
  if (mode === 'idle' || autoIdle)    return { dot: 'idle', label: PRESENCE_LABEL.idle }
  return { dot: 'online', label: PRESENCE_LABEL.online }
}

// Flip to idle after IDLE_MS with no keyboard/pointer activity.
function useAutoIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = 0
    const reset = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), IDLE_MS)
    }
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel']
    events.forEach(e => window.addEventListener(e, reset))
    reset()
    return () => { window.clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [])
  return idle
}

function CharacterMenu({
  status, presenceMode, onSetPresence, onEditAvatar, avatar, crop, initial, charName, profile,
  onDisconnect, onConnect, watching, onLeaveWatch, onClose, showActions, onBroadcast, onHighlights, onSettings,
}: {
  status:        ConnectionStatus
  presenceMode:  PresenceMode
  onSetPresence: (m: PresenceMode) => void
  onEditAvatar:  () => void
  avatar:        string | null
  crop?:         AvatarCrop
  initial:       string
  charName:      string
  profile:       ProfileInfo | null
  onDisconnect:  () => void
  onConnect:     () => void
  watching?:     boolean
  onLeaveWatch?: () => void
  onClose:       () => void
  showActions:   boolean        // mobile: quick actions live here instead of the bar
  onBroadcast:   () => void
  onHighlights:  () => void
  onSettings:    () => void
}) {
  const run = (fn: () => void) => () => { onClose(); fn() }
  return (
    <>
      <div className="char-menu-backdrop" onClick={onClose} />
      <div className="char-menu">
        <div className="char-menu-head">
          <Tooltip text="Change avatar">
            <button className="char-menu-avatar" onClick={run(onEditAvatar)}>
              {avatar
                ? <CircleAvatar className="char-menu-avatar-img" src={avatar} crop={crop} alt="" />
                : <span className="char-menu-avatar-initial">{initial}</span>}
              <span className="char-menu-avatar-edit"><IconPhoto size={20} /></span>
            </button>
          </Tooltip>
          <div className="char-menu-profile">
            <div className="char-menu-name">{profile?.name || charName || 'Unknown'}</div>
            <div className="char-menu-field"><span className="char-menu-k">Spouse</span><span className="char-menu-v">{profile?.spouse ?? '—'}</span></div>
            <div className="char-menu-field"><span className="char-menu-k">Roleplay</span><span className="char-menu-v">{profile?.roleplay ?? '—'}</span></div>
            <div className="char-menu-field"><span className="char-menu-k">PvP</span><span className="char-menu-v">{profile?.pvp ?? '—'}</span></div>
          </div>
        </div>
        <div className="char-menu-sep" />
        {showActions && (
          <>
            <button className="char-menu-item" onClick={run(onBroadcast)}><IconBroadcast size={15} /> Broadcast</button>
            <button className="char-menu-item" onClick={run(onHighlights)}><IconPaintBrush size={15} /> Highlights</button>
            <button className="char-menu-item" onClick={run(onSettings)}><IconCog size={15} /> Settings</button>
            <div className="char-menu-sep" />
          </>
        )}
        {status === 'connected' && (
          <>
            {(['online', 'idle', 'dnd'] as PresenceMode[]).map(m => (
              <button key={m} className="char-menu-item" onClick={() => onSetPresence(m)}>
                <span className={`char-menu-dot status-${m}`} />
                {PRESENCE_LABEL[m]}
                {presenceMode === m && <span className="char-menu-check">✓</span>}
              </button>
            ))}
            <div className="char-menu-sep" />
          </>
        )}
        {status === 'connected' ? (
          <button className="char-menu-item char-menu-item-danger" onClick={run(onDisconnect)}>
            <IconPower size={15} /> Disconnect
          </button>
        ) : (
          <button className="char-menu-item char-menu-item-connect" onClick={run(onConnect)}>
            <IconBolt size={15} /> Connect
          </button>
        )}
        {watching && onLeaveWatch && (
          // Watch mode: leave the view without ending the session (it keeps running
          // for its owner). Sits just under Disconnect.
          <button className="char-menu-item" onClick={run(onLeaveWatch)}>
            <IconPower size={15} /> Leave session
          </button>
        )}
      </div>
    </>
  )
}

export function CharacterBar({
  charName, accountName, status, watching = false, onLeaveWatch, onHighlights, onSettings, onDisconnect, onConnect,
}: {
  charName:     string
  accountName:  string
  status:       ConnectionStatus
  watching?:    boolean
  onLeaveWatch?: () => void
  onHighlights: () => void
  onSettings:   () => void
  onDisconnect: () => void
  onConnect:    () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const isMobile = useIsMobile()
  const linkMode = useAtomValue(linkModeAtom)
  const receive  = useAtomValue(broadcastReceiveAtom)
  const [showAvatar, setShowAvatar] = useState(false)
  // Pending avatar edit in the modal: null = no change; { url } stages a new image
  // (url === null means "remove"). Committed only on Save.
  const [avatarDraft, setAvatarDraft] = useState<{ url: string | null } | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)   // raw picked image, being cropped
  const cropperRef = useRef<AvatarCropHandle>(null)
  const [presenceMode, setPresenceMode] = useAtom(presenceModeAtom)
  const autoIdle = useAutoIdle()
  const fileRef = useRef<HTMLInputElement>(null)

  // Character PROFILE summary (Name / Spouse / stances) shown in the menu —
  // fetched the first time the menu opens for this character.
  const profile = useProfile(charName, menuOpen)

  // Avatars live in settings.json (userData) keyed by character name, so they
  // persist across runs. The shared atom (loaded once at layout mount) is the
  // single source of truth so the conversation panel reflects saves live.
  const [avatars, setAvatars] = useAtom(avatarsAtom)
  const [avatarCrops, setAvatarCrops] = useAtom(avatarCropsAtom)
  const serverAvatars = useAtomValue(serverAvatarsAtom)
  const avatarKey = charName.toLowerCase()
  // Fetch our own character's shared avatar so it shows even with no local upload
  // (e.g. the web client, whose per-device settings bucket starts empty).
  useEnsureAvatars(charName ? [charName] : [])
  const localAvatar = avatars[avatarKey] ?? null
  // Display precedence: local upload, then the shared (Supabase) image. The saved
  // crop only applies to a local upload; a server image is shown cover-fit.
  const avatar = localAvatar ?? serverAvatars[avatarKey] ?? null
  const avatarCrop = localAvatar ? avatarCrops[avatarKey] : undefined

  // Shared-avatar publishing is opt-in and only surfaced once the service is
  // configured (MAGILOOM_AVATAR_URL set); otherwise avatars stay purely local.
  const [svcEnabled, setSvcEnabled] = useState(false)
  const [share, setShare] = useState(false)
  useEffect(() => {
    window.dr.avatar.enabled().then(setSvcEnabled)
    window.dr.settings.getAll().then(s => setShare(!!s.avatarShare))
  }, [])

  // Keep the shared copy in sync on login: if this character has a local avatar and
  // sharing is on, (re)publish it so OTHER players (and our other characters) resolve
  // it in conversation. Publishing otherwise only happened on an explicit save/toggle,
  // so an avatar set before sharing — or on another device's settings bucket — would
  // never reach the bucket and stayed invisible to everyone else. Once per image.
  const publishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!svcEnabled || !share || !charName || !localAvatar) return
    const stamp = `${avatarKey}:${localAvatar.length}`
    if (publishedRef.current === stamp) return
    publishedRef.current = stamp
    window.dr.avatar.publish(charName, localAvatar).catch(() => {})
  }, [svcEnabled, share, charName, localAvatar, avatarKey])

  const presence = presenceFor(status, presenceMode, autoIdle)
  const initial  = charName.trim().charAt(0).toUpperCase() || '?'

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !charName) return
    // Downscale to fit the avatar bucket cap (200KB) while keeping the whole
    // image + aspect ratio; the circle crop is applied on top, not baked in.
    try { setCropSrc(await downscaleToFit(await readImageFile(file))) } catch { /* ignore bad image */ }
  }

  const closeAvatar = () => { setAvatarDraft(null); setCropSrc(null); setShowAvatar(false) }

  const onSaveAvatar = async () => {
    if (!charName || (!avatarDraft && !cropSrc)) { closeAvatar(); return }
    // A picked image saves the full original + its crop box; otherwise the
    // staged draft (a removal, or the existing image) with no new crop.
    const result = cropSrc ? cropperRef.current?.export() : undefined
    const url  = result ? result.url : (avatarDraft?.url ?? null)
    const crop = result?.crop

    const nextAvatars = { ...avatars }
    const nextCrops   = { ...avatarCrops }
    if (url) {
      nextAvatars[avatarKey] = url
      if (crop) nextCrops[avatarKey] = crop; else delete nextCrops[avatarKey]
    } else {
      delete nextAvatars[avatarKey]; delete nextCrops[avatarKey]
    }
    await window.dr.settings.patch({ avatars: nextAvatars, avatarCrops: nextCrops })
    setAvatars(nextAvatars); setAvatarCrops(nextCrops)
    // Mirror the change to the shared service when publishing is enabled. A
    // removal always unpublishes; new images only publish with consent. (The
    // crop is local for now; other viewers see the image center-cropped.)
    if (svcEnabled) {
      if (url && share) window.dr.avatar.publish(charName, url).catch(() => {})
      else if (!url)    window.dr.avatar.remove(charName).catch(() => {})
    }
    closeAvatar()
  }

  // Toggling consent publishes/unpublishes the current avatar immediately.
  const onToggleShare = async () => {
    const next = !share
    setShare(next)
    await window.dr.settings.patch({ avatarShare: next })
    if (!charName) return
    if (next && avatar) window.dr.avatar.publish(charName, avatar).catch(() => {})
    else if (!next)     window.dr.avatar.remove(charName).catch(() => {})
  }

  // What the modal shows: the staged draft if editing, else the saved avatar
  const previewUrl = avatarDraft ? avatarDraft.url : avatar

  return (
    <div className="character-bar">
      <input
        ref={fileRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={onPickFile}
      />
      <button className="char-identity" onClick={() => setMenuOpen(o => !o)}>
        <span className="char-avatar">
          {avatar
            ? <CircleAvatar className="char-avatar-img" src={avatar} crop={avatarCrop} alt="" />
            : <span className="char-avatar-initial">{initial}</span>}
          <span className={`char-status-dot status-${presence.dot}`} />
        </span>
        <span className="char-identity-text">
          <span className="char-name">{charName || 'Unknown'}</span>
          <span className={'char-sub' + (accountName ? ' has-account' : '')}>
            <span className="char-sub-track">
              <span className="char-presence">{presence.label}</span>
              {accountName && <span className="char-account">{accountName}</span>}
            </span>
          </span>
        </span>
      </button>
      <div className="char-actions">
        <Tooltip text={
          linkMode ? 'Broadcast · Link on'
          : receive ? 'Broadcast · Receiving'
          : 'Broadcast · Off'
        }>
          <button
            className={'char-action-btn char-action-broadcast '
              + (linkMode || receive ? 'bc-on' : 'bc-off')
              + (linkMode ? ' live' : '')}
            onClick={() => setShowBroadcast(true)}
          >
            <IconBroadcast size={22} />
          </button>
        </Tooltip>
        <Tooltip text="Highlight Options">
          <button className="char-action-btn char-action-brush" onClick={onHighlights}><IconPaintBrush size={16} /></button>
        </Tooltip>
        <Tooltip text="User Settings">
          <button className="char-action-btn char-action-gear" onClick={onSettings}><IconCog size={22} /></button>
        </Tooltip>
      </div>
      {menuOpen && (
        <CharacterMenu
          status={status}
          presenceMode={presenceMode}
          onSetPresence={setPresenceMode}
          onEditAvatar={() => setShowAvatar(true)}
          avatar={avatar}
          crop={avatarCrop}
          initial={initial}
          charName={charName}
          profile={profile}
          onDisconnect={onDisconnect}
          onConnect={onConnect}
          watching={watching}
          onLeaveWatch={onLeaveWatch}
          onClose={() => setMenuOpen(false)}
          showActions={isMobile}
          onBroadcast={() => setShowBroadcast(true)}
          onHighlights={onHighlights}
          onSettings={onSettings}
        />
      )}
      {showAvatar && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeAvatar()}>
          <div className="avatar-modal">
            <div className="avatar-modal-header">
              <span className="modal-title">{charName || 'Avatar'}</span>
              <button className="modal-close" onClick={closeAvatar}>×</button>
            </div>
            {cropSrc
              ? <AvatarCropper ref={cropperRef} src={cropSrc} />
              : previewUrl
                ? (
                  <div className="avatar-modal-facewrap">
                    <CircleAvatar className="avatar-modal-face" src={previewUrl}
                                  crop={previewUrl === avatar ? avatarCrop : undefined} />
                  </div>
                )
                : <div className="avatar-modal-preview"><span className="avatar-modal-initial">{initial}</span></div>}
            <div className="avatar-modal-actions">
              <button className="login-btn-secondary" onClick={() => fileRef.current?.click()}>
                {previewUrl || cropSrc ? 'Replace' : 'Upload'}
              </button>
              {(previewUrl || cropSrc) && (
                <button className="login-btn-secondary" onClick={() => { setCropSrc(null); setAvatarDraft({ url: null }) }}>Remove</button>
              )}
              <button className="login-btn" onClick={onSaveAvatar} disabled={!avatarDraft && !cropSrc}>Save</button>
            </div>
            {svcEnabled && (
              <label className="avatar-modal-share">
                <input type="checkbox" checked={share} onChange={onToggleShare} />
                <span>Share so other MAGILOOM users see this avatar</span>
              </label>
            )}
          </div>
        </div>
      )}
      {showBroadcast && <BroadcastModal charName={charName} onClose={() => setShowBroadcast(false)} />}
    </div>
  )
}

// ── Window controls (custom min/max/close) ────────────────────────────────────
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const platform = window.dr.app.platform

  useEffect(() => {
    if (platform === 'darwin') return
    window.dr.window.isMaximized().then(setMaximized)
    return window.dr.window.onMaximizeChange(setMaximized)
  }, [platform])

  if (platform === 'darwin') return null

  return (
    <div className="window-controls">
      <Tooltip text="Minimize">
        <button className="wc-btn" onClick={() => window.dr.window.minimize()}>
          <IconWinMinimize />
        </button>
      </Tooltip>
      <Tooltip text={maximized ? 'Restore' : 'Maximize'}>
        <button className="wc-btn" onClick={() => window.dr.window.toggleMaximize()}>
          {maximized ? <IconWinRestore /> : <IconWinMaximize />}
        </button>
      </Tooltip>
      <Tooltip text="Close">
        <button className="wc-btn wc-close" onClick={() => window.dr.window.close()}>
          <IconWinClose />
        </button>
      </Tooltip>
    </div>
  )
}

// ── StatusBar (slim draggable title bar) ──────────────────────────────────────
export function StatusBar({ updateSlot }: { updateSlot?: React.ReactNode }) {
  return (
    <div className="status-bar">
      <img src="./icon.png" className="app-icon" alt="" aria-hidden />
      <div className="status-bar-spacer" />
      <Tooltip text="Guide">
        <button
          className="titlebar-help"
          onClick={() => window.dr.app.openExternal('https://github.com/jackfperryjr/magiloom/blob/main/GUIDE.md')}
        >
          <svg className="titlebar-help-icon" viewBox="0 0 20 20" aria-hidden="true">
            <mask id="titlebar-help-cutout">
              <circle cx="10" cy="10" r="10" fill="#fff" />
              <text x="10" y="15" textAnchor="middle" fontFamily="system-ui, sans-serif"
                fontSize="14" fontWeight="700" fill="#000">?</text>
            </mask>
            <rect width="20" height="20" fill="currentColor" mask="url(#titlebar-help-cutout)" />
          </svg>
        </button>
      </Tooltip>
      {updateSlot}
      {window.dr.app.platform !== 'darwin' && <div className="titlebar-sep" />}
      <WindowControls />
    </div>
  )
}

