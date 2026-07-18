import { useState, useEffect, useRef, useCallback } from 'react'
import { Provider, useSetAtom, useAtomValue } from 'jotai'
import { useGameConnection }  from './hooks/useGameConnection'
import { useIsMobile }         from './hooks/useIsMobile'
import { useAutomapper }       from './hooks/useAutomapper'
import { GameOutput, setHighlights, setSendFn, setOutputBuffer, setPlayerName, setDisabledClasses } from './components/game/GameOutput'
import { CommandInput, StatusBar, WindowControls, HudBar, CharacterBar } from './components/game'
import { AmbientOverlay } from './components/game/AmbientOverlay'
import { LoginFlow }          from './components/ui/LoginFlow'
import { SettingsModal }      from './components/ui/SettingsModal'
import { HighlightsModal }    from './components/ui/HighlightsModal'
import { NotificationCenter }  from './components/ui/Notifications'
import { PanelSidebar }       from './components/layout/PanelSidebar'
import type { PanelId }       from './components/layout/PanelSidebar'
import {
  RoomPanel, SpellsPanel,
  ExperiencePanel, ConversationPanel, InventoryPanel,
  CombatPanel, AtmoPanel, DeathsPanel, ConnectionsPanel,
} from './components/layout/PanelContent'
import { MapPanel } from './components/map/MapPanel'
import { SkyPanel } from './components/layout/SkyPanel'
import { MapOverlay } from './components/map/MapOverlay'
import {
  echoCommandAtom, beginSilentExpAtom, appendSystemLineAtom, tickAtom,
  beginSilentSkySeedAtom, endSilentSkySeedAtom,
  combatLinesAtom, atmoLinesAtom, convLinesAtom, deathsAtom, inventoryLinesAtom,
  verbRawAtom, beginVerbCapture, endVerbCapture,
  avatarsAtom, avatarCropsAtom, selfNameAtom, resetSessionAtom,
  classStatesAtom, disabledClassesAtom, setGagSubRules,
  logonLinesAtom, appendLogonAtom,
} from './store/game'
import { DEFAULT_HIGHLIGHTS, type Highlight } from './lib/themes'
import { loadCharAppearance, applyAppearance } from './lib/charSettings'
import { IconExclamationTriangle } from './components/ui/Icons'
import { Tooltip } from './components/ui/Tooltip'
import { GlobalTooltip } from './components/ui/GlobalTooltip'
import './styles/global.css'

document.body.dataset.platform = window.dr.app.platform

const EXP_POLL_ENABLED = false

function renderPanel(id: PanelId) {
  switch (id) {
    case 'room':         return <RoomPanel />
    case 'sky':          return <SkyPanel />
    case 'spells':       return <SpellsPanel />
    case 'experience':   return <ExperiencePanel />
    case 'combat':       return <CombatPanel />
    case 'atmo':         return <AtmoPanel />
    case 'conversation': return <ConversationPanel />
    case 'inventory':    return <InventoryPanel />
    case 'deaths':       return <DeathsPanel />
    case 'connections':  return <ConnectionsPanel />
    case 'scripts':      return <ScriptsPanel />
    default:             return null
  }
}

// ── Native .cmd scripts side panel ────────────────────────────────────────────
interface ScriptStatus { id: number; name: string; state: string }

// The engine's `pause` command parks a script in a 'paused' state, but a timed
// pause is just part of running — only a genuine wait (matchwait/waitfor) is
// worth flagging distinctly. Map 'paused' → 'running' for the panel.
const scriptStateLabel = (state: string): string => (state === 'paused' ? 'running' : state)

function ScriptsPanel() {
  const [available, setAvailable] = useState<string[]>([])
  const [running,   setRunning]   = useState<ScriptStatus[]>([])

  const refresh = useCallback(() => { window.dr.script.list().then(setAvailable) }, [])

  useEffect(() => {
    refresh()
    window.dr.script.running().then(setRunning)
    const onSaved = () => refresh()          // script folder may have changed
    window.addEventListener('settings:saved', onSaved)
    window.addEventListener('scripts:changed', onSaved)   // a script was created/deleted in the editor
    const unsub = window.dr.script.onStatus((s: ScriptStatus) => {
      setRunning(prev => {
        const rest = prev.filter(p => p.id !== s.id)
        return s.state === 'stopped' ? rest : [...rest, s]
      })
    })
    return () => {
      window.removeEventListener('settings:saved', onSaved)
      window.removeEventListener('scripts:changed', onSaved)
      unsub()
    }
  }, [refresh])

  return (
    <div className="lich-panel script-panel">
      <div className="lich-panel-status">
        <span>{available.length} script{available.length === 1 ? '' : 's'}</span>
        {running.length > 0 && (
          <button className="script-stopall" onClick={() => window.dr.script.stop()}>Stop all</button>
        )}
        <button className="script-refresh" onClick={refresh} title="Rescan folder">⟳</button>
      </div>

      {running.length > 0 && (
        <div className="script-running-list">
          {running.map(r => (
            <div key={r.id} className="script-row script-row-running">
              <span className="script-name">{r.name}</span>
              <span className="script-state">{scriptStateLabel(r.state)}</span>
              <button className="script-stop-btn" onClick={() => window.dr.script.stop(r.id)} title="Stop">■</button>
            </div>
          ))}
        </div>
      )}

      {available.length === 0
        ? <div className="lich-panel-empty">No .cmd scripts found. Set a folder in Settings → Scripts.</div>
        : available.map(name => (
            <div key={name} className="script-row">
              <span className="script-name">{name}</span>
              <button className="script-run-btn" onClick={() => window.dr.script.run(name)} title="Run">▶</button>
            </div>
          ))}
    </div>
  )
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


// ── Game layout ───────────────────────────────────────────────────────────────
function GameLayout({ charName, accountName, watching, onLeaveWatch, onOpenSettings, onRequestConnect, updateSlot }: { charName: string; accountName: string; watching: boolean; onLeaveWatch: () => void; onOpenSettings: () => void; onRequestConnect: () => void; updateSlot: React.ReactNode }) {
  // Automapper: records rooms into the shared world map (movement is captured
  // universally via dr.game.onSent inside the hook).
  const automap = useAutomapper()
  const isMobile = useIsMobile()
  const { status, disconnect, send } = useGameConnection(charName)
  // Give the walker the game send fn (walk steps flow through the same path the
  // mapper observes, so click-walking also confirms/records arcs).
  useEffect(() => { automap.provideSend(send) }, [automap, send])
  // Wipe all per-character live state when the active character changes (a
  // character switch via the reconnect overlay keeps GameLayout mounted, so
  // nothing else clears the previous character's panels/room/vitals/profile).
  // Runs before the setSelfName effect below so selfName ends on the new name,
  // and skips the first mount so it never wipes the initial login's data.
  const resetSession = useSetAtom(resetSessionAtom)
  const prevCharRef  = useRef<string | null>(null)
  useEffect(() => {
    const prev = prevCharRef.current
    prevCharRef.current = charName
    if (prev !== null && prev !== charName) resetSession()
  }, [charName, resetSession])
  // Register send fn for clickable links
  useEffect(() => { setSendFn(send) }, [send])
  // Register player name so the output can flag @mentions of this character
  const setSelfName = useSetAtom(selfNameAtom)
  useEffect(() => { setPlayerName(charName); setSelfName(charName) }, [charName, setSelfName])

  // Log this character's own connect/disconnect into the Connections panel feed.
  const appendLogon = useSetAtom(appendLogonAtom)
  const prevConnRef = useRef(status)
  useEffect(() => {
    const prev = prevConnRef.current
    prevConnRef.current = status
    if (status === 'connected' && prev !== 'connected') appendLogon({ kind: 'on', text: `${charName || 'You'} connected` })
    else if ((status === 'disconnected' || status === 'error') && prev === 'connected') appendLogon({ kind: 'off', text: `${charName || 'You'} disconnected` })
  }, [status, charName, appendLogon])

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
  const beginSilentSkySeed = useSetAtom(beginSilentSkySeedAtom)
  const endSilentSkySeed   = useSetAtom(endSilentSkySeedAtom)
  const setTick          = useSetAtom(tickAtom)

  const setCombat    = useSetAtom(combatLinesAtom)
  const setAtmo      = useSetAtom(atmoLinesAtom)
  const setConv      = useSetAtom(convLinesAtom)
  const setDeaths    = useSetAtom(deathsAtom)
  const setLogon     = useSetAtom(logonLinesAtom)
  const setInventory = useSetAtom(inventoryLinesAtom)
  const setAvatars   = useSetAtom(avatarsAtom)
  const setAvatarCrops = useSetAtom(avatarCropsAtom)
  const setClassStates = useSetAtom(classStatesAtom)
  const disabledClasses = useAtomValue(disabledClassesAtom)

  // Push a character's highlight set to the renderer (colors) AND the store's
  // gag/sub engine (the action gag/sub subset), so both stay in sync on every
  // load/save. Class gating for gag/sub is applied live in dispatch.
  const applyHighlightRules = useCallback((hls: Highlight[]) => {
    setHighlights(hls as never[])
    setGagSubRules(
      hls.filter(h => h.action === 'gag' || h.action === 'sub').map(h => ({
        pattern: h.pattern, isRegex: h.isRegex, action: h.action as 'gag' | 'sub',
        replace: h.replace, enabled: h.enabled, class: h.class,
      })),
    )
  }, [])

  const getClearFn = (id: PanelId): (() => void) | undefined => {
    switch (id) {
      case 'combat':       return () => setCombat([])
      case 'atmo':         return () => setAtmo([])
      case 'conversation': return () => setConv([])
      case 'deaths':       return () => setDeaths([])
      case 'connections':  return () => setLogon([])
      case 'inventory':    return () => setInventory([])
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

  // Ambient seed: on connect, silently fetch `weather` (current precipitation) and
  // `time` (calibrates the deterministic day/night clock) once. Both are RT-free;
  // their report lines are suppressed from the main output during the seed window.
  const skySeeded = useRef(false)
  useEffect(() => {
    if (status !== 'connected') { skySeeded.current = false; return }
    if (skySeeded.current) return
    skySeeded.current = true
    const timers = [
      window.setTimeout(() => { beginSilentSkySeed(); send('weather'); send('time') }, 1500),
      window.setTimeout(() => endSilentSkySeed(), 4500),
    ]
    return () => timers.forEach(window.clearTimeout)
  }, [status, send, beginSilentSkySeed, endSilentSkySeed])

  // Poll `weather` every minute so the overlay self-heals if an ambient transition
  // message was missed (e.g. it was already snowing when you stepped outdoors). RT-
  // free; the report is fetched silently and suppressed from the main output.
  useEffect(() => {
    if (status !== 'connected') return
    const id = window.setInterval(() => {
      beginSilentSkySeed()
      send('weather')
      window.setTimeout(() => endSilentSkySeed(), 2000)
    }, 60_000)
    return () => window.clearInterval(id)
  }, [status, send, beginSilentSkySeed, endSilentSkySeed])


  const [showHighlights, setShowHighlights] = useState(false)
  const [showMap,        setShowMap]        = useState(false)
  const [sidebarWidth,   setSidebarWidth]   = useState<number | null>(null)
  const [functionKeys,   setFunctionKeys]   = useState<Record<string, string>>({})
  const appendSystemLine = useSetAtom(appendSystemLineAtom)
  const mainAreaRef = useRef<HTMLDivElement>(null)

  // Load global settings (avatars / buffer) on mount. Function keys and
  // highlights are per-character (loaded in the charName effect below); appearance
  // is per-character too and applied further down.
  useEffect(() => {
    window.dr.settings.getAll().then(s => {
      // Theme the login screen with the last-used character's appearance so it
      // matches what the player last saw (before any character is active).
      const lastChar = s.accounts?.find(a => a.name === s.lastAccount)?.lastCharacter
      if (lastChar) loadCharAppearance(lastChar).then(a => applyAppearance(a))
      if (s.outputBufferSize) setOutputBuffer(s.outputBufferSize)
      if (s.avatars)          setAvatars(s.avatars)
      if (s.avatarCrops)      setAvatarCrops(s.avatarCrops)
      // Seed the global default highlight set once; per-character loading reads it
      // as the fallback for characters that haven't customised their highlights.
      if (!s.highlights || s.highlights.length === 0) {
        window.dr.settings.patch({ highlights: DEFAULT_HIGHLIGHTS as unknown[] })
      }
    })
    window.dr.lich.detectPath().then(() => {})
  }, [])

  // Per-character function keys + highlights (fall back to globals). Reloads on
  // character switch so each character keeps its own set.
  useEffect(() => {
    window.dr.settings.getChar(charName).then(c => {
      setFunctionKeys(c.functionKeys || {})
      applyHighlightRules((c.highlights && c.highlights.length > 0 ? c.highlights : DEFAULT_HIGHLIGHTS) as Highlight[])
      setClassStates(c.classes || {})
    })
  }, [charName, setClassStates, applyHighlightRules])

  // Mirror the disabled-class set into GameOutput's matcher (highlights) whenever
  // it changes — the aliases/triggers matchers read it via useGameConnection.
  useEffect(() => { setDisabledClasses(disabledClasses) }, [disabledClasses])

  // Apply this character's appearance (theme / font / density / timestamps),
  // reloading whenever the active character changes. A character with nothing
  // saved falls back to app defaults.
  useEffect(() => {
    if (!charName) return
    let cancelled = false
    loadCharAppearance(charName).then(a => { if (!cancelled) applyAppearance(a) })
    return () => { cancelled = true }
  }, [charName])

  // Route the main-process Lich/client diagnostic log (SGE auth, Lich manager,
  // connection, script errors) into the main game panel as dim system notices —
  // the dedicated Lich log side panel has been retired.
  useEffect(() => {
    const unsub = window.dr.lich.onLog((line: string) => {
      const l = line.trimEnd()
      // Connection-plumbing chatter ([sge] auth steps, [game] connect/disconnect,
      // [lich] proxy status) is noise in the game panel — drop it. Genuinely useful
      // notices ([error], [script], …) still flow through.
      if (l && !/^\[(?:sge|game|lich)\]/.test(l)) appendSystemLine(l)
    })
    return () => unsub()
  }, [appendSystemLine])

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

  // Reload this character's function keys whenever settings are saved mid-session
  useEffect(() => {
    const onSaved = () => {
      window.dr.settings.getChar(charName).then(c => {
        setFunctionKeys(c.functionKeys || {})
        setClassStates(c.classes || {})
      })
    }
    window.addEventListener('settings:saved', onSaved)
    return () => window.removeEventListener('settings:saved', onSaved)
  }, [charName])

  const handleHighlightsClose = () => {
    setShowHighlights(false)
    window.dr.settings.getChar(charName).then(c => {
      applyHighlightRules((c.highlights ?? []) as Highlight[])
      setClassStates(c.classes || {})
    })
  }

  // The map panel is injected here (not in the module-level renderPanel) so it can
  // receive layout-local handlers: click-to-walk and the pop-out toggle.
  const renderPanelWithLich = useCallback((id: PanelId) => {
    if (id === 'map') return <MapPanel onNodeClick={automap.walkTo} onStopWalk={automap.stopWalk} onExpand={() => setShowMap(true)} />
    return renderPanel(id)
  }, [automap])

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
          <main className="game-output-wrap" onClick={() => {
            if (window.getSelection()?.toString()) return
            document.querySelector<HTMLInputElement>('.command-input')?.focus()
          }}>
            <GameOutput />
            <AmbientOverlay />
          </main>
          <footer className="bottom-bar">
            <HudBar status={status} />
          </footer>
        </div>
        <ColResize onDrag={handleColDrag} />
        <PanelSidebar renderPanel={renderPanelWithLich} getClearFn={getClearFn} sidebarWidth={sidebarWidth} charName={charName} />
      </div>
      {/* Full-width bottom row: character bar (left) + command line (fills, status icons on its right). */}
      <div className={'command-row' + (isMobile ? ' command-row-mobile' : '')}>
        {(() => {
          const bar = (
            <CharacterBar
              charName={charName}
              accountName={accountName}
              status={status}
              watching={watching}
              onLeaveWatch={onLeaveWatch}
              onHighlights={() => setShowHighlights(true)}
              onSettings={onOpenSettings}
              onDisconnect={disconnect}
              onConnect={onRequestConnect}
            />
          )
          // Mobile: dock the avatar/menu inside the command input as one bar.
          // Desktop: character bar and command input sit side by side.
          return isMobile
            ? <CommandInput onSend={send} onEcho={echoCommand} functionKeys={functionKeys} status={status} leading={bar} />
            : <>{bar}<CommandInput onSend={send} onEcho={echoCommand} functionKeys={functionKeys} status={status} /></>
        })()}
      </div>
      {showHighlights && <HighlightsModal onClose={handleHighlightsClose} charName={charName} />}
      {showMap && <MapOverlay onClose={() => setShowMap(false)} onWalkTo={automap.walkTo} onStopWalk={automap.stopWalk} />}
      <NotificationCenter charName={charName} status={status} />
      <GlobalTooltip />
    </div>
  )
}

// ── Offline icon (title bar) ──────────────────────────────────────────────────
// The red triangle means "no internet connection" (driven by navigator.onLine).
// "Update available" now lives at the bottom of the panel rail on every platform
// (see PanelSidebar), so the title bar only carries the offline indicator.
function UpdateIcon({ offline }: { offline: boolean }) {
  if (!offline) return null
  return (
    <Tooltip text="No internet connection">
      <button className="update-icon-btn update-error" disabled aria-label="Offline">
        <IconExclamationTriangle size={15} />
      </button>
    </Tooltip>
  )
}

function AppInner() {
  const [inGame,        setInGame]        = useState(false)
  const [watching,      setWatching]      = useState(false)   // viewing another device's session
  const [showReconnect, setShowReconnect] = useState(false)
  const [charName,      setCharName]      = useState('')
  const [accountName,   setAccountName]   = useState('')
  const [showSettings,  setShowSettings]  = useState(false)
  const [offline,       setOffline]       = useState(!navigator.onLine)

  useEffect(() => {
    // Connectivity indicator: the red triangle shows only when actually offline.
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online',  update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  const updateSlot = <UpdateIcon offline={offline} />

  const enterGame = (name: string, account: string, watch = false) => { setCharName(name); setAccountName(account); setWatching(watch); setInGame(true); setShowReconnect(false) }
  // Leave a watched session: detach (reconnect to our own bucket) and return to the
  // login screen WITHOUT disconnecting DR — the session keeps running for its owner.
  const leaveWatch = () => { window.dr.account?.unwatch(); setWatching(false); setInGame(false) }

  return (
    <>
      {!inGame && <div className="app-titlebar-shell">{updateSlot}<WindowControls /></div>}
      {!inGame
        ? <LoginFlow onEnterGame={enterGame} onOpenSettings={() => setShowSettings(true)} />
        : <GameLayout charName={charName} accountName={accountName} watching={watching} onLeaveWatch={leaveWatch} onOpenSettings={() => setShowSettings(true)} onRequestConnect={() => setShowReconnect(true)} updateSlot={updateSlot} />
      }
      {inGame && showReconnect && (
        <div className="reconnect-overlay">
          <button className="reconnect-close" onClick={() => setShowReconnect(false)} aria-label="Cancel">✕</button>
          <LoginFlow onEnterGame={enterGame} onOpenSettings={() => setShowSettings(true)} />
        </div>
      )}
      {showSettings && (
        <SettingsModal
          charName={charName}
          onClose={() => setShowSettings(false)}
          onSignedOut={async () => {
            // Order matters: end the DR session on the signed-in bucket FIRST, then
            // sign out (which reconnects the socket anonymously), then show login.
            try { await window.dr.game.disconnect() } catch { /* ignore */ }
            window.dr.account?.signOut()
            setInGame(false)
          }}
        />
      )}
    </>
  )
}

export default function App() {
  return <Provider><AppInner /></Provider>
}
