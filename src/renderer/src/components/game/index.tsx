import { useState, useEffect, useRef, useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { handsAtom, indicatorsAtom, roundtimeAtom, verbsAtom } from '../../store/game'
export type { ConnectionStatus } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'
import {
  IconCog, IconPaintBrush, IconChevron, IconPhoto, IconPower, IconBolt,
  IconWinMinimize, IconWinMaximize, IconWinRestore, IconWinClose,
} from '../ui/Icons'
import { Tooltip } from '../ui/Tooltip'

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
export function CommandInput({ onSend, onEcho, functionKeys = {} }: {
  onSend: (cmd: string) => void
  onEcho: (cmd: string) => void
  functionKeys?: Record<string, string>
}) {
  const inputRef   = useRef<HTMLInputElement>(null)
  const historyRef = useRef<string[]>([])
  const histIdxRef = useRef(-1)
  const [value, setValue] = useState('')
  const [open,  setOpen]  = useState(false)
  const [sel,   setSel]   = useState(0)
  const gameVerbs = useAtomValue(verbsAtom)

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

  return (
    <div className="command-input-wrap">
      {showSug && (
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

// ── Posture / status indicators ──────────────────────────────────────────────
const POSTURE_IDS = new Set(['standing', 'kneeling', 'sitting', 'prone', 'lying'])
const DANGER_IDS  = new Set(['dead', 'stunned', 'bleeding', 'poisoned', 'diseased', 'webbed'])

// Show posture first, then everything else; skip flags that add no signal.
const HIDDEN_IDS = new Set(['joined'])

function StatusIndicators() {
  const indicators = useAtomValue(indicatorsAtom)
  const active = Object.entries(indicators)
    .filter(([id, on]) => on && !HIDDEN_IDS.has(id))
    .map(([id]) => id)
    .sort((a, b) => (POSTURE_IDS.has(b) ? 1 : 0) - (POSTURE_IDS.has(a) ? 1 : 0))

  if (active.length === 0) return null
  return (
    <div className="status-pills">
      {active.map(id => (
        <span
          key={id}
          className={'status-pill' +
            (DANGER_IDS.has(id) ? ' status-pill-danger' : POSTURE_IDS.has(id) ? ' status-pill-posture' : '')}
        >
          {id}
        </span>
      ))}
    </div>
  )
}

// ── Roundtime bar ─────────────────────────────────────────────────────────────
function RoundtimeBar() {
  const expires = useAtomValue(roundtimeAtom)
  const durationRef = useRef(0)
  const [, setFrame] = useState(0)

  // Drive a depleting bar with rAF while RT is active; it self-stops at expiry.
  useEffect(() => {
    if (expires - Date.now() <= 0) return
    durationRef.current = expires - Date.now()
    let raf = 0
    const loop = () => {
      setFrame(f => f + 1)
      if (Date.now() < expires) raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [expires])

  const remaining = Math.max(0, expires - Date.now())
  if (remaining <= 0) return null
  const pct = durationRef.current > 0 ? Math.min(100, (remaining / durationRef.current) * 100) : 0

  return (
    <div className="rt-bar" title="Roundtime">
      <div className="rt-bar-fill" style={{ width: `${pct}%` }} />
      <span className="rt-bar-label">RT {Math.ceil(remaining / 1000)}s</span>
    </div>
  )
}

// ── Game top bar (lich log toggle + status + roundtime + hands) ───────────────
type LichStatus = 'stopped' | 'starting' | 'ready' | 'error'

export function GameTopBar({
  status, lichStatus, lichLog, showLichLog, onToggleLichLog,
}: {
  status:          ConnectionStatus
  lichStatus:      LichStatus
  lichLog:         string[]
  showLichLog:     boolean
  onToggleLichLog: () => void
}) {
  const showLichToggle = status === 'connected' || lichLog.length > 0
  return (
    <div className="game-topbar">
      {showLichToggle && (
        <Tooltip text={showLichLog ? 'Hide Lich log' : `Show Lich log (${lichLog.length} lines)`}>
          <button className="lich-log-toggle-btn" onClick={onToggleLichLog}>
            <IconChevron size={11} open={showLichLog} />
            <span className={`lich-status-dot lich-status-dot-${lichStatus}`} />
            <span>lich log</span>
            {lichLog.length > 0 && <span className="lich-log-count">{lichLog.length}</span>}
          </button>
        </Tooltip>
      )}
      {status === 'connected' && <StatusIndicators />}
      <div className="game-topbar-spacer" />
      {status === 'connected' && <RoundtimeBar />}
      {status === 'connected' && <HandDisplay />}
    </div>
  )
}

// ── Character bar (bottom-left identity + user menu) ──────────────────────────
// Downscale the picked image to a small square data URL so settings stay light.
function fileToAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const size = 96
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('no ctx')); return }
        // Cover-fit the source into the square canvas
        const scale = Math.max(size / img.width, size / img.height)
        const w = img.width * scale, h = img.height * scale
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

function presenceFor(status: ConnectionStatus): { dot: string; label: string } {
  switch (status) {
    case 'connected':  return { dot: 'online',     label: 'Online' }
    case 'connecting': return { dot: 'connecting', label: 'Connecting…' }
    default:           return { dot: 'offline',     label: 'Offline' }
  }
}

function CharacterMenu({
  status, onDisconnect, onConnect, onClose,
}: {
  status:       ConnectionStatus
  onDisconnect: () => void
  onConnect:    () => void
  onClose:      () => void
}) {
  const run = (fn: () => void) => () => { onClose(); fn() }
  return (
    <>
      <div className="char-menu-backdrop" onClick={onClose} />
      <div className="char-menu">
        {status === 'connected' ? (
          <button className="char-menu-item char-menu-item-danger" onClick={run(onDisconnect)}>
            <IconPower size={15} /> Disconnect
          </button>
        ) : (
          <button className="char-menu-item char-menu-item-connect" onClick={run(onConnect)}>
            <IconBolt size={15} /> Connect
          </button>
        )}
      </div>
    </>
  )
}

export function CharacterBar({
  charName, status, onHighlights, onSettings, onDisconnect, onConnect,
}: {
  charName:     string
  status:       ConnectionStatus
  onHighlights: () => void
  onSettings:   () => void
  onDisconnect: () => void
  onConnect:    () => void
}) {
  const [avatar,  setAvatar]  = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Avatars live in settings.json (userData) keyed by character name, so they
  // persist across runs in both dev and production regardless of window origin.
  const avatarKey = charName.toLowerCase()
  useEffect(() => {
    if (!charName) { setAvatar(null); return }
    let cancelled = false
    window.dr.settings.getAll().then(s => {
      if (!cancelled) setAvatar(s.avatars?.[avatarKey] ?? null)
    })
    return () => { cancelled = true }
  }, [charName, avatarKey])

  const presence = presenceFor(status)
  const initial  = charName.trim().charAt(0).toUpperCase() || '?'

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !charName) return
    try {
      const dataUrl = await fileToAvatar(file)
      const s = await window.dr.settings.getAll()
      const avatars = { ...(s.avatars ?? {}), [avatarKey]: dataUrl }
      await window.dr.settings.patch({ avatars })
      setAvatar(dataUrl)
    } catch { /* ignore bad image */ }
  }

  return (
    <div className="character-bar">
      <Tooltip text="Change avatar">
        <button className="char-avatar" onClick={() => fileRef.current?.click()}>
          {avatar
            ? <img className="char-avatar-img" src={avatar} alt="" />
            : <span className="char-avatar-initial">{initial}</span>}
          <span className="char-avatar-edit"><IconPhoto size={15} /></span>
          <span className={`char-status-dot status-${presence.dot}`} />
        </button>
      </Tooltip>
      <input
        ref={fileRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={onPickFile}
      />
      <button className="char-identity" onClick={() => setMenuOpen(o => !o)}>
        <span className="char-name">{charName || 'Unknown'}</span>
        <span className="char-presence">{presence.label}</span>
      </button>
      <div className="char-actions">
        <Tooltip text="Highlights">
          <button className="char-action-btn char-action-brush" onClick={onHighlights}><IconPaintBrush size={16} /></button>
        </Tooltip>
        <Tooltip text="Settings">
          <button className="char-action-btn char-action-gear" onClick={onSettings}><IconCog size={22} /></button>
        </Tooltip>
      </div>
      {menuOpen && (
        <CharacterMenu
          status={status}
          onDisconnect={onDisconnect}
          onConnect={onConnect}
          onClose={() => setMenuOpen(false)}
        />
      )}
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
      <span className="app-title">Meridian</span>
      <div className="status-bar-spacer" />
      {updateSlot}
      <WindowControls />
    </div>
  )
}

// Keep these for potential use
export function VitalsBar() { return null }
export function RoomPanel() { return null }
