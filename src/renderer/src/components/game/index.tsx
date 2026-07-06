import { useState, useEffect, useRef, useMemo } from 'react'
import { useAtomValue, useAtom } from 'jotai'
import {
  handsAtom, indicatorsAtom, roundtimeSecondsAtom, vitalsAtom,
  verbsAtom, verbsWithInfoAtom, verbInfoAtom, beginVerbInfoCapture,
  presenceModeAtom, avatarsAtom,
} from '../../store/game'
import type { PresenceMode, ProfileInfo } from '../../store/game'
import { useProfile } from '../../hooks/useProfile'
export type { ConnectionStatus } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'
import {
  IconCog, IconPaintBrush, IconPhoto, IconPower, IconBolt,
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
  const gameVerbs    = useAtomValue(verbsAtom)
  const verbsWithInfo = useAtomValue(verbsWithInfoAtom)
  const verbInfo     = useAtomValue(verbInfoAtom)

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

  return (
    <div className="command-input-wrap">
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

// ── Vitals (compact bars in the top bar) ──────────────────────────────────────
const VITALS: { key: 'health' | 'mana' | 'stamina' | 'spirit'; label: string; color: string }[] = [
  { key: 'health',  label: 'HP', color: 'var(--health-color)' },
  { key: 'mana',    label: 'MP', color: 'var(--mana-color)' },
  { key: 'stamina', label: 'ST', color: 'var(--stamina-color)' },
  { key: 'spirit',  label: 'SP', color: 'var(--spirit-color)' },
]

// Thin vitals strip shown under the game top bar
export function VitalsBar() {
  const vitals = useAtomValue(vitalsAtom)
  return (
    <div className="vitals-bar">
      {VITALS.map(v => {
        const st  = vitals[v.key]
        const pct = st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 0
        return (
          <div className="vital-mini" key={v.key} title={`${v.label} ${Math.round(pct)}%`}>
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

// ── Roundtime badge ───────────────────────────────────────────────────────────
function RoundtimeBadge() {
  const rt = useAtomValue(roundtimeSecondsAtom)
  if (rt <= 0) return null
  return <div className="roundtime-badge">RT: {rt}s</div>
}

// ── Game top bar (vitals + status + roundtime + hands) ────────────────────────
export function GameTopBar({ status }: { status: ConnectionStatus }) {
  return (
    <div className="game-topbar">
      {status === 'connected' && <StatusIndicators />}
      <div className="game-topbar-spacer" />
      {status === 'connected' && <RoundtimeBadge />}
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
        // 256px keeps the ~180px modal preview crisp while staying light in settings
        const size = 256
        const canvas = document.createElement('canvas')
        canvas.width = size; canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) { reject(new Error('no ctx')); return }
        ctx.imageSmoothingQuality = 'high'
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
  status, presenceMode, onSetPresence, onEditAvatar, avatar, initial, charName, profile, onDisconnect, onConnect, onClose,
}: {
  status:        ConnectionStatus
  presenceMode:  PresenceMode
  onSetPresence: (m: PresenceMode) => void
  onEditAvatar:  () => void
  avatar:        string | null
  initial:       string
  charName:      string
  profile:       ProfileInfo | null
  onDisconnect:  () => void
  onConnect:     () => void
  onClose:       () => void
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
                ? <img className="char-menu-avatar-img" src={avatar} alt="" />
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
      </div>
    </>
  )
}

export function CharacterBar({
  charName, accountName, status, onHighlights, onSettings, onDisconnect, onConnect,
}: {
  charName:     string
  accountName:  string
  status:       ConnectionStatus
  onHighlights: () => void
  onSettings:   () => void
  onDisconnect: () => void
  onConnect:    () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showAvatar, setShowAvatar] = useState(false)
  // Pending avatar edit in the modal: null = no change; { url } stages a new image
  // (url === null means "remove"). Committed only on Save.
  const [avatarDraft, setAvatarDraft] = useState<{ url: string | null } | null>(null)
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
  const avatarKey = charName.toLowerCase()
  const avatar = avatars[avatarKey] ?? null

  // Shared-avatar publishing is opt-in and only surfaced once the service is
  // configured (MAGILOOM_AVATAR_URL set); otherwise avatars stay purely local.
  const [svcEnabled, setSvcEnabled] = useState(false)
  const [share, setShare] = useState(false)
  useEffect(() => {
    window.dr.avatar.enabled().then(setSvcEnabled)
    window.dr.settings.getAll().then(s => setShare(!!s.avatarShare))
  }, [])

  const presence = presenceFor(status, presenceMode, autoIdle)
  const initial  = charName.trim().charAt(0).toUpperCase() || '?'

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !charName) return
    try {
      const dataUrl = await fileToAvatar(file)
      setAvatarDraft({ url: dataUrl })   // stage — commit on Save
    } catch { /* ignore bad image */ }
  }

  const closeAvatar = () => { setAvatarDraft(null); setShowAvatar(false) }

  const onSaveAvatar = async () => {
    if (!avatarDraft || !charName) { closeAvatar(); return }
    const next = { ...avatars }
    if (avatarDraft.url) next[avatarKey] = avatarDraft.url
    else delete next[avatarKey]
    await window.dr.settings.patch({ avatars: next })
    setAvatars(next)
    // Mirror the change to the shared service when publishing is enabled. A
    // removal always unpublishes; new images only publish with consent.
    if (svcEnabled) {
      if (avatarDraft.url && share) window.dr.avatar.publish(charName, avatarDraft.url).catch(() => {})
      else if (!avatarDraft.url)    window.dr.avatar.remove(charName).catch(() => {})
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
            ? <img className="char-avatar-img" src={avatar} alt="" />
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
          presenceMode={presenceMode}
          onSetPresence={setPresenceMode}
          onEditAvatar={() => setShowAvatar(true)}
          avatar={avatar}
          initial={initial}
          charName={charName}
          profile={profile}
          onDisconnect={onDisconnect}
          onConnect={onConnect}
          onClose={() => setMenuOpen(false)}
        />
      )}
      {showAvatar && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeAvatar()}>
          <div className="avatar-modal">
            <div className="avatar-modal-header">
              <span className="modal-title">{charName || 'Avatar'}</span>
              <button className="modal-close" onClick={closeAvatar}>×</button>
            </div>
            <div className="avatar-modal-preview">
              {previewUrl
                ? <img src={previewUrl} alt="" />
                : <span className="avatar-modal-initial">{initial}</span>}
            </div>
            <div className="avatar-modal-actions">
              <button className="login-btn-secondary" onClick={() => fileRef.current?.click()}>
                {previewUrl ? 'Replace' : 'Upload'}
              </button>
              {previewUrl && (
                <button className="login-btn-secondary" onClick={() => setAvatarDraft({ url: null })}>Remove</button>
              )}
              <button className="login-btn" onClick={onSaveAvatar} disabled={!avatarDraft}>Save</button>
            </div>
            {svcEnabled && (
              <label className="avatar-modal-share">
                <input type="checkbox" checked={share} onChange={onToggleShare} />
                <span>Share so other MAGILOOM players see this avatar</span>
              </label>
            )}
          </div>
        </div>
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
      <span className="app-title">MAGILOOM</span>
      <div className="status-bar-spacer" />
      <Tooltip text="Player guide">
        <button
          className="titlebar-help"
          onClick={() => window.dr.app.openExternal('https://github.com/jackfperryjr/magiloom/blob/main/GUIDE.md')}
        >?</button>
      </Tooltip>
      {updateSlot}
      {window.dr.app.platform !== 'darwin' && <div className="titlebar-sep" />}
      <WindowControls />
    </div>
  )
}

