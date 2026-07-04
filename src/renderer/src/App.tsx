import { useState, useEffect, useRef, useCallback } from 'react'
import { Provider, useSetAtom, useAtomValue } from 'jotai'
import { useGameConnection }  from './hooks/useGameConnection'
import { GameOutput, setHighlights, setSendFn, setShowTimestamps, setOutputBuffer, setPlayerName } from './components/game/GameOutput'
import { CommandInput, StatusBar, WindowControls, GameTopBar, CharacterBar, VitalsBar } from './components/game'
import { LoginFlow }          from './components/ui/LoginFlow'
import { SettingsModal }      from './components/ui/SettingsModal'
import { HighlightsModal }    from './components/ui/HighlightsModal'
import { NotificationCenter }  from './components/ui/Notifications'
import { PanelSidebar }       from './components/layout/PanelSidebar'
import type { PanelId }       from './components/layout/PanelSidebar'
import {
  RoomPanel, SpellsPanel,
  ExperiencePanel, ConversationPanel, InventoryPanel,
  CombatPanel, AtmoPanel, DeathsPanel,
} from './components/layout/PanelContent'
import {
  echoCommandAtom, beginSilentExpAtom, lichMsgAtom, tickAtom,
  combatLinesAtom, atmoLinesAtom, convLinesAtom, deathsAtom, inventoryLinesAtom,
  verbRawAtom, beginVerbCapture, endVerbCapture,
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

// ── Lich log side panel ───────────────────────────────────────────────────────
type LichStatus = 'stopped' | 'starting' | 'ready' | 'error'

function LichLogPanel({ lines, status }: { lines: string[]; status: LichStatus }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'nearest' }) }, [lines])
  return (
    <div className="lich-panel">
      <div className="lich-panel-status">
        <span className={`lich-status-dot lich-status-dot-${status}`} />
        <span>{status}</span>
        {lines.length > 0 && <span className="lich-log-count">{lines.length}</span>}
      </div>
      {lines.length === 0
        ? <div className="lich-panel-empty">No Lich output yet.</div>
        : lines.map((l, i) => (
            <div key={i} className={`lich-log-line${l.startsWith('[error]') ? ' lich-log-error' : ''}`}>{l}</div>
          ))}
      <div ref={bottomRef} />
    </div>
  )
}

// ── Game layout ───────────────────────────────────────────────────────────────
function GameLayout({ charName, onOpenSettings, onRequestConnect, updateSlot }: { charName: string; onOpenSettings: () => void; onRequestConnect: () => void; updateSlot: React.ReactNode }) {
  const { status, disconnect, send } = useGameConnection()
  // Register send fn for clickable links
  useEffect(() => { setSendFn(send) }, [send])
  // Register player name so the output can flag @mentions of this character
  useEffect(() => { setPlayerName(charName) }, [charName])

  // Verb autocomplete: load cached verbs, or silently sweep `VERB LIST a..z` once.
  const setVerbs   = useSetAtom(verbRawAtom)
  const verbsVal   = useAtomValue(verbRawAtom)
  const verbsRef   = useRef<string[]>([])
  const verbSwept  = useRef(false)
  useEffect(() => { verbsRef.current = verbsVal }, [verbsVal])
  useEffect(() => {
    if (status !== 'connected' || verbSwept.current) return
    verbSwept.current = true
    window.dr.settings.getAll().then(s => {
      // Reuse the cache only if it's the newer raw format (marks "(info)" verbs);
      // an older stripped cache re-sweeps to upgrade.
      const cached = s.verbs ?? []
      if (cached.length > 0 && cached.some(v => /\(info\)/i.test(v))) { setVerbs(cached); return }
      beginVerbCapture()
      const letters = 'abcdefghijklmnopqrstuvwxyz'.split('')
      const settle  = 1200  // let the session settle before spamming commands
      letters.forEach((l, i) => window.setTimeout(() => send(`verb list ${l}`), settle + i * 150))
      window.setTimeout(() => {
        endVerbCapture()
        // Only cache a healthy sweep; a stunted one retries on the next connect.
        if (verbsRef.current.length > 50) window.dr.settings.patch({ verbs: verbsRef.current })
      }, settle + letters.length * 150 + 2500)
    })
  }, [status, send, setVerbs])
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
      case 'lich':         return () => setLichLog([])
      default:             return undefined
    }
  }

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


  const [lichStatus,     setLichStatus]     = useState<LichStatus>('stopped')
  const [lichLog,        setLichLog]        = useState<string[]>([])
  const lichMsgs = useAtomValue(lichMsgAtom)
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
      document.documentElement.dataset.density = s.density === 'compact' ? 'compact' : 'cozy'
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
      window.dr.lich.onStatus((s: string) => setLichStatus(s as LichStatus)),
      window.dr.lich.onError(() => setLichStatus('error')),
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

  // Lich log is rendered as an optional side panel; inject it here so it can
  // read this layout's live lich state while other panels use the shared renderer.
  const renderPanelWithLich = useCallback((id: PanelId) => {
    if (id === 'lich') return <LichLogPanel lines={lichLog} status={lichStatus} />
    return renderPanel(id)
  }, [lichLog, lichStatus])

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
      <StatusBar updateSlot={updateSlot} />
      <div className="main-area" ref={mainAreaRef}>
        <div className="game-col">
          <GameTopBar status={status} />
          {status === 'connected' && <VitalsBar />}
          <main className="game-output-wrap" onClick={() => {
            if (window.getSelection()?.toString()) return
            document.querySelector<HTMLInputElement>('.command-input')?.focus()
          }}>
            <GameOutput />
          </main>
          <footer className="bottom-bar">
            <CharacterBar
              charName={charName}
              status={status}
              onHighlights={() => setShowHighlights(true)}
              onSettings={onOpenSettings}
              onDisconnect={disconnect}
              onConnect={onRequestConnect}
            />
            <CommandInput onSend={send} onEcho={echoCommand} functionKeys={functionKeys} />
          </footer>
        </div>
        <ColResize onDrag={handleColDrag} />
        <PanelSidebar renderPanel={renderPanelWithLich} getClearFn={getClearFn} sidebarWidth={sidebarWidth} />
      </div>
      {showHighlights && <HighlightsModal onClose={handleHighlightsClose} />}
      <NotificationCenter charName={charName} status={status} />
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
  const [showReconnect, setShowReconnect] = useState(false)
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

  const enterGame = (name: string) => { setCharName(name); setInGame(true); setShowReconnect(false) }

  return (
    <>
      {!inGame && <div className="app-titlebar-shell">{updateSlot}<WindowControls /></div>}
      {!inGame
        ? <LoginFlow onEnterGame={enterGame} onOpenSettings={() => setShowSettings(true)} />
        : <GameLayout charName={charName} onOpenSettings={() => setShowSettings(true)} onRequestConnect={() => setShowReconnect(true)} updateSlot={updateSlot} />
      }
      {inGame && showReconnect && (
        <div className="reconnect-overlay">
          <button className="reconnect-close" onClick={() => setShowReconnect(false)} aria-label="Cancel">✕</button>
          <LoginFlow onEnterGame={enterGame} onOpenSettings={() => setShowSettings(true)} />
        </div>
      )}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  )
}

export default function App() {
  return <Provider><AppInner /></Provider>
}
