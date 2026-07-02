import { useState, useEffect, useRef, useCallback } from 'react'
import { Provider, useSetAtom, useAtomValue } from 'jotai'
import { useGameConnection }  from './hooks/useGameConnection'
import { GameOutput, setHighlights, setSendFn, setShowTimestamps, setOutputBuffer } from './components/game/GameOutput'
import { CommandInput, StatusBar, WindowControls } from './components/game'
import { LoginFlow }          from './components/ui/LoginFlow'
import { SettingsModal }      from './components/ui/SettingsModal'
import { HighlightsModal }    from './components/ui/HighlightsModal'
import { PanelSidebar }       from './components/layout/PanelSidebar'
import type { PanelId }       from './components/layout/PanelSidebar'
import {
  RoomPanel, VitalsPanel, SpellsPanel,
  ExperiencePanel, ConversationPanel, InventoryPanel,
  CombatPanel, AtmoPanel, DeathsPanel,
} from './components/layout/PanelContent'
import {
  echoCommandAtom, beginSilentExpAtom, lichMsgAtom, tickAtom,
  combatLinesAtom, atmoLinesAtom, convLinesAtom, deathsAtom, inventoryLinesAtom,
} from './store/game'
import { applyTheme, DEFAULT_HIGHLIGHTS } from './lib/themes'
import { IconArrowDownTray, IconArrowPath, IconExclamationTriangle } from './components/ui/Icons'
import { Tooltip } from './components/ui/Tooltip'
import './styles/global.css'

document.body.dataset.platform = window.dr.app.platform

const EXP_POLL_ENABLED = false

function renderPanel(id: PanelId) {
  switch (id) {
    case 'room':         return <RoomPanel />
    case 'vitals':       return <VitalsPanel />
    case 'spells':       return <SpellsPanel />
    case 'experience':   return <ExperiencePanel />
    case 'combat':       return <CombatPanel />
    case 'atmo':         return <AtmoPanel />
    case 'conversation': return <ConversationPanel />
    case 'inventory':    return <InventoryPanel />
    case 'deaths':       return <DeathsPanel />
    default:             return null
  }
}

// ── Horizontal resize between game col and sidebar ────────────────────────────
function ColResize({ onDrag }: { onDrag: (dx: number) => void }) {
  const lastX   = useRef(0)
  const onDragRef = useRef(onDrag)
  useEffect(() => { onDragRef.current = onDrag }, [onDrag])

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    lastX.current = e.clientX
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'

    const move = (ev: MouseEvent) => {
      onDragRef.current(ev.clientX - lastX.current)
      lastX.current = ev.clientX
    }
    const up = () => {
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup',   up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup',   up)
  }

  return <div className="col-resize-handle" onMouseDown={onMouseDown} />
}

// ── Lich log drawer ───────────────────────────────────────────────────────────
function LichLogDrawer({ lines, onClose }: { lines: string[]; onClose: () => void }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [lines])
  return (
    <div className="lich-drawer">
      <div className="lich-drawer-header">
        <span>Lich Log</span>
        <button className="lich-drawer-close" onClick={onClose}>✕</button>
      </div>
      <div className="lich-drawer-body">
        {lines.map((l, i) => (
          <div key={i} className={`lich-log-line${l.startsWith('[error]') ? ' lich-log-error' : ''}`}>{l}</div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── Game layout ───────────────────────────────────────────────────────────────
function GameLayout({ charName, onReturnToLogin, onOpenSettings, updateSlot }: { charName: string; onReturnToLogin: () => void; onOpenSettings: () => void; updateSlot: React.ReactNode }) {
  const { status, disconnect, send } = useGameConnection()
  // Register send fn for clickable links
  useEffect(() => { setSendFn(send) }, [send])
  const echoCommand      = useSetAtom(echoCommandAtom)
  const beginSilentExp   = useSetAtom(beginSilentExpAtom)
  const setTick          = useSetAtom(tickAtom)

  const setCombat    = useSetAtom(combatLinesAtom)
  const setAtmo      = useSetAtom(atmoLinesAtom)
  const setConv      = useSetAtom(convLinesAtom)
  const setDeaths    = useSetAtom(deathsAtom)
  const setInventory = useSetAtom(inventoryLinesAtom)

  const getClearFn = (id: PanelId): (() => void) | undefined => {
    switch (id) {
      case 'combat':       return () => setCombat([])
      case 'atmo':         return () => setAtmo([])
      case 'conversation': return () => setConv([])
      case 'deaths':       return () => setDeaths([])
      case 'inventory':    return () => setInventory([])
      default:             return undefined
    }
  }

  useEffect(() => {
    if (status !== 'disconnected') return
    const timer = window.setTimeout(onReturnToLogin, 1000)
    return () => window.clearTimeout(timer)
  }, [status, onReturnToLogin])

  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [setTick])

  // Silently refresh exp every 30 s to clear any skills that decayed since
  // their last live component push. beginSilentExp marks the upcoming batch
  // so its main-stream report text is suppressed from the game output panel.
  // Paused: exp panel now updates correctly from live component pushes alone.
  useEffect(() => {
    if (!EXP_POLL_ENABLED || status !== 'connected') return
    const id = window.setInterval(() => { beginSilentExp(); send('exp') }, 30_000)
    return () => window.clearInterval(id)
  }, [status, send, beginSilentExp])


  const [lichStatus,     setLichStatus]     = useState<'stopped'|'starting'|'ready'|'error'>('stopped')
  const [lichLog,        setLichLog]        = useState<string[]>([])
  const lichMsgs = useAtomValue(lichMsgAtom)
  const [showLog,        setShowLog]        = useState(false)
  const [showHighlights, setShowHighlights] = useState(false)
  const [sidebarWidth,   setSidebarWidth]   = useState<number | null>(null)
  const [functionKeys,   setFunctionKeys]   = useState<Record<string, string>>({})
  const mainAreaRef = useRef<HTMLDivElement>(null)

  // Merge in-game Lich script messages into the log drawer
  useEffect(() => {
    if (lichMsgs.length > 0) {
      const last = lichMsgs[lichMsgs.length - 1]
      setLichLog(prev => {
        if (prev.length > 0 && prev[prev.length - 1] === last) return prev
        return [...prev.slice(-199), last]
      })
    }
  }, [lichMsgs])

  // Load settings + apply theme/font/highlights on mount
  useEffect(() => {
    window.dr.settings.getAll().then(s => {
      if (s.fontSize)   document.documentElement.style.setProperty('--font-size-game', `${s.fontSize}px`)
      if (s.fontFamily) document.documentElement.style.setProperty('--font-game', `'${s.fontFamily}', monospace`)
      if (s.theme)            applyTheme(s.theme)
      if (s.timestamps)       setShowTimestamps(s.timestamps)
      if (s.outputBufferSize) setOutputBuffer(s.outputBufferSize)
      if (s.functionKeys)     setFunctionKeys(s.functionKeys)
      if (s.highlights && s.highlights.length > 0) {
        setHighlights(s.highlights as never[])
      } else {
        setHighlights(DEFAULT_HIGHLIGHTS as never[])
        window.dr.settings.patch({ highlights: DEFAULT_HIGHLIGHTS as unknown[] })
      }
    })
    window.dr.lich.detectPath().then(() => {})
  }, [])

  useEffect(() => {
    const unsubs = [
      window.dr.lich.onStatus((s: string) => setLichStatus(s as 'stopped'|'starting'|'ready'|'error')),
      window.dr.lich.onError(() => { setLichStatus('error'); setShowLog(true) }),
      window.dr.lich.onLog((line: string) => setLichLog(prev => [...prev.slice(-199), line.trimEnd()]))
    ]
    return () => unsubs.forEach(fn => fn())
  }, [])

  // Function key hotkeys — re-register whenever bindings change
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!/^F\d{1,2}$/.test(e.key)) return
      const cmd = functionKeys[e.key]?.trim()
      if (!cmd) return
      e.preventDefault()
      echoCommand(cmd)
      send(cmd)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [functionKeys, send, echoCommand])

  // Reload function keys whenever settings are saved mid-session
  useEffect(() => {
    const onSaved = () => {
      window.dr.settings.getAll().then(s => {
        if (s.functionKeys) setFunctionKeys(s.functionKeys)
      })
    }
    window.addEventListener('settings:saved', onSaved)
    return () => window.removeEventListener('settings:saved', onSaved)
  }, [])

  const handleHighlightsClose = () => {
    setShowHighlights(false)
    window.dr.settings.getAll().then(s => {
      if (s.highlights) setHighlights(s.highlights as never[])
    })
  }

  const handleStartLich = async () => {
    const s = await window.dr.settings.getAll()
    if (!s.lichPath) { onOpenSettings(); return }
    const lastChar = s.accounts.find(a => a.name === s.lastAccount)?.lastCharacter
    if (!lastChar) { alert('Could not determine character name.'); return }
    setLichLog([])
    window.dr.lich.launchSidecar(lastChar)
  }

  const handleColDrag = useCallback((dx: number) => {
    const el = mainAreaRef.current
    if (!el) return
    const total = el.clientWidth
    setSidebarWidth(w => {
      const current = w ?? Math.round(total / 3)
      return Math.max(160, Math.min(total - 300, current - dx))
    })
  }, [])

  return (
    <div className="app-shell">
      {status === 'disconnected' && <div className="app-titlebar-shell">{updateSlot}<WindowControls /></div>}
      <StatusBar
        status={status}
        charName={charName}
        onDisconnect={disconnect}
        onStartLich={handleStartLich}
        lichStatus={lichStatus}
        lichLog={lichLog}
        showLichLog={showLog}
        onToggleLichLog={() => setShowLog(v => !v)}
        onSettings={onOpenSettings}
        onHighlights={() => setShowHighlights(true)}
        updateSlot={updateSlot}
      />
      {showLog && <LichLogDrawer lines={lichLog} onClose={() => setShowLog(false)} />}
      <div className="main-area" ref={mainAreaRef}>
        <div className="game-col">
          <main className="game-output-wrap" onClick={() => {
            if (window.getSelection()?.toString()) return
            document.querySelector<HTMLInputElement>('.command-input')?.focus()
          }}>
            <GameOutput />
          </main>
          <footer className="bottom-bar">
            <CommandInput onSend={send} onEcho={echoCommand} />
          </footer>
        </div>
        <ColResize onDrag={handleColDrag} />
        <PanelSidebar renderPanel={renderPanel} getClearFn={getClearFn} sidebarWidth={sidebarWidth} />
      </div>
      {showHighlights && <HighlightsModal onClose={handleHighlightsClose} />}
      {status === 'disconnected' && (
        <div className="disconnect-overlay">
          <div className="disconnect-box">
            <div className="disconnect-title">Disconnected</div>
            <p className="disconnect-msg">Connection lost. Returning to login...</p>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Update icon (title bar) ───────────────────────────────────────────────────
function UpdateIcon({ version, ready, error }: { version: string; ready: boolean; error: string }) {
  if (!ready && !error) return null
  if (error) return (
    <Tooltip text={`Update failed: ${error}`}>
      <button className="update-icon-btn update-error" disabled>
        <IconExclamationTriangle size={15} />
      </button>
    </Tooltip>
  )
  if (ready) return (
    <Tooltip text={`v${version} ready — click to restart and install`}>
      <button
        className="update-icon-btn update-ready"
        onClick={() => window.dr.updater.install()}
      >
        <IconArrowDownTray size={15} />
      </button>
    </Tooltip>
  )
  return (
    <Tooltip text={`Downloading v${version}…`}>
      <button className="update-icon-btn update-downloading" disabled>
        <IconArrowPath size={15} className="update-spin" />
      </button>
    </Tooltip>
  )
}

function AppInner() {
  const [inGame,        setInGame]        = useState(false)
  const [charName,      setCharName]      = useState('')
  const [showSettings,  setShowSettings]  = useState(false)
  const [updateVersion, setUpdateVersion] = useState('')
  const [updateReady,   setUpdateReady]   = useState(false)
  const [updateError,   setUpdateError]   = useState('')

  useEffect(() => {
    const unsubs = [
      window.dr.updater.onAvailable((v: string) => { setUpdateVersion(v); setUpdateError('') }),
      window.dr.updater.onReady(()              => setUpdateReady(true)),
      window.dr.updater.onError((msg: string)   => setUpdateError(msg))
    ]
    return () => unsubs.forEach(fn => fn())
  }, [])

  const updateSlot = <UpdateIcon version={updateVersion} ready={updateReady} error={updateError} />

  return (
    <>
      {!inGame && <div className="app-titlebar-shell">{updateSlot}<WindowControls /></div>}
      {!inGame
        ? <LoginFlow onEnterGame={name => { setCharName(name); setInGame(true) }} onOpenSettings={() => setShowSettings(true)} />
        : <GameLayout charName={charName} onReturnToLogin={() => { setCharName(''); setInGame(false) }} onOpenSettings={() => setShowSettings(true)} updateSlot={updateSlot} />
      }
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}

export default function App() {
  return <Provider><AppInner /></Provider>
}
