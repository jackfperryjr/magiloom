import { useState, useEffect, useRef, useCallback } from 'react'
import { Provider, useSetAtom, useAtomValue } from 'jotai'
import { useGameConnection }  from './hooks/useGameConnection'
import { useIsMobile }         from './hooks/useIsMobile'
import { useAutomapper }       from './hooks/useAutomapper'
import { useAmbientAudio }     from './hooks/useAmbientAudio'
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
  ExperiencePanel, ConversationPanel, ThoughtsPanel, InventoryPanel,
  CombatPanel, AtmoPanel, DeathsPanel, ConnectionsPanel,
} from './components/layout/PanelContent'
import { MessagesPanel } from './components/layout/MessagesPanel'
import { useMessaging } from './hooks/useMessaging'
import { useSessionSnapshot } from './hooks/useSessionSnapshot'
import { MapPanel } from './components/map/MapPanel'
import { CalendarPanel } from './components/layout/CalendarPanel'
import { BodyPanel, BodyOverlay } from './components/game/BodyPanel'
import { ItemManager }           from './components/game/ItemManager'
import { MapOverlay } from './components/map/MapOverlay'
import {
  echoCommandAtom, beginSilentExpAtom, appendSystemLineAtom, tickAtom,
  beginSilentSkySeedAtom, endSilentSkySeedAtom,
  combatLinesAtom, atmoLinesAtom, convLinesAtom, thoughtLinesAtom, deathsAtom, inventoryLinesAtom,
  verbRawAtom, beginVerbCapture, endVerbCapture,
  avatarsAtom, avatarCropsAtom, appearanceAtom, selfNameAtom, resetSessionAtom,
  injuryModeAtom, bodyTextModeAtom,
  classStatesAtom, disabledClassesAtom, setGagSubRules,
  logonLinesAtom, appendLogonAtom,
  lichScriptsAtom, beginLichListAtom,
} from './store/game'
import { quickActionCommand, quickActionLabel, type QuickAction } from './lib/quickActions'
import { DEFAULT_HIGHLIGHTS, type Highlight } from './lib/themes'
import { loadCharAppearance, applyAppearance } from './lib/charSettings'
import { IconExclamationTriangle, IconArrowDownTray } from './components/ui/Icons'
import { Tooltip } from './components/ui/Tooltip'
import { GlobalTooltip } from './components/ui/GlobalTooltip'
import './styles/global.css'

document.body.dataset.platform = window.dr.app.platform

// Raw Lich process chatter, untagged. Main/server now prefixes everything Lich prints
// with '[lich]', but a client can be talking to an older server build, so keep matching
// the lines themselves: the detachable-client listen/attach/disconnect notices, the
// launch command line, and the session descriptor Lich writes (path + its JSON body).
const RAW_LICH_CHATTER =
  /^(?:--- Lich:|Launching Lich\b|writing session descriptor\b|\{"name":)/

function renderPanel(id: PanelId) {
  switch (id) {
    case 'room':         return <RoomPanel />
    case 'sky':          return <CalendarPanel />
    case 'spells':       return <SpellsPanel />
    case 'experience':   return <ExperiencePanel />
    case 'combat':       return <CombatPanel />
    case 'atmo':         return <AtmoPanel />
    case 'conversation': return <ConversationPanel />
    case 'thoughts':     return <ThoughtsPanel />
    case 'messages':     return <MessagesPanel />
    case 'inventory':    return <InventoryPanel />
    case 'deaths':       return <DeathsPanel />
    case 'connections':  return <ConnectionsPanel />
    default:             return null
  }
}

// ── Scripts side panel ────────────────────────────────────────────────────────
// Two sections, both about *doing* rather than browsing: the quick buttons the
// player configured (Settings → Hotkeys), and everything currently active —
// native .cmd scripts and, when Lich is attached, Lich's own. The .cmd library
// listing lives in Settings → Scripts; this panel deliberately doesn't repeat it.
interface ScriptStatus { id: number; name: string; state: string }

// The engine's `pause` command parks a script in a 'paused' state, but a timed
// pause is just part of running — only a genuine wait (matchwait/waitfor) is
// worth flagging distinctly. Map 'paused' → 'running' for the panel.
const scriptStateLabel = (state: string): string => (state === 'paused' ? 'running' : state)

// How often to ask Lich what's running. Lich has no push channel for this, so a
// poll is the only option; `;list` is instant and round-trip free of roundtime,
// and its reply is swallowed (see beginLichListAtom), so this is invisible.
const LICH_LIST_POLL_MS = 10_000

const FK_ORDER = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']

function ScriptsPanel({ send, echo, connected, charName }: {
  send:      (cmd: string) => void
  echo:      (cmd: string) => void
  connected: boolean
  charName:  string
}) {
  const [quick,   setQuick]   = useState<QuickAction[]>([])
  const [running, setRunning] = useState<ScriptStatus[]>([])
  const [fkeys,   setFkeys]   = useState<Record<string, string>>({})
  const lich          = useAtomValue(lichScriptsAtom)
  const beginLichList = useSetAtom(beginLichListAtom)

  const pollLich = useCallback(() => {
    if (!connected) return
    beginLichList(true)
    send(';list')
  }, [connected, beginLichList, send])

  // Quick buttons and function keys are both per-character, and both editable
  // mid-session in Settings → Hotkeys.
  useEffect(() => {
    const load = () => window.dr.settings.getChar(charName).then(c => {
      setQuick(c.quickActions || [])
      setFkeys(c.functionKeys || {})
    })
    load()
    window.addEventListener('settings:saved', load)
    return () => window.removeEventListener('settings:saved', load)
  }, [charName])

  useEffect(() => {
    window.dr.script.running().then(setRunning)
    return window.dr.script.onStatus((s: ScriptStatus) => {
      setRunning(prev => {
        const rest = prev.filter(p => p.id !== s.id)
        return s.state === 'stopped' ? rest : [...rest, s]
      })
    })
  }, [])

  useEffect(() => {
    if (!connected) return
    pollLich()
    const id = window.setInterval(pollLich, LICH_LIST_POLL_MS)
    return () => window.clearInterval(id)
  }, [connected, pollLich])

  const runQuick = (a: QuickAction) => {
    const cmd = quickActionCommand(a)
    if (!cmd) return
    echo(cmd)
    send(cmd)
  }

  const fkeyList = FK_ORDER
    .map(key => ({ key, cmd: fkeys[key]?.trim() ?? '' }))
    .filter(f => f.cmd)

  // Lich confirms a kill in its own time, and the next scheduled poll can be ten
  // seconds out — long enough for the row to look stuck. Re-ask shortly after.
  const killLich = (cmd: string) => {
    echo(cmd)
    send(cmd)
    window.setTimeout(pollLich, 600)
  }

  const activeCount = running.length + lich.length
  const stopAll = () => {
    window.dr.script.stop()
    if (lich.length > 0) killLich(';kill all')
  }

  return (
    <div className="lich-panel script-panel">
      {(quick.length > 0 || fkeyList.length > 0) && (
        <div className="quick-grid">
          {quick.map(a => (
            <button
              key={a.id}
              className={'quick-btn quick-btn-' + a.kind}
              onClick={() => runQuick(a)}
              data-tooltip={quickActionCommand(a)}
            >
              {quickActionLabel(a)}
            </button>
          ))}
          {fkeyList.map(f => (
            <button
              key={f.key}
              className="quick-btn quick-btn-fkey"
              onClick={() => { echo(f.cmd); send(f.cmd) }}
              data-tooltip={f.cmd}
            >
              <span className="quick-fkey">{f.key}</span>{f.cmd}
            </button>
          ))}
        </div>
      )}

      <div className="lich-panel-status">
        <span>{activeCount === 0 ? 'Nothing running' : `${activeCount} active`}</span>
        {activeCount > 0 && <button className="script-stopall" onClick={stopAll}>Stop all</button>}
        <button className="script-refresh" onClick={pollLich} data-tooltip="Ask Lich what's running">⟳</button>
      </div>

      {running.map(r => (
        <div key={`cmd:${r.id}`} className="script-row script-row-running">
          <span className="script-badge script-badge-cmd">.cmd</span>
          <span className="script-name">{r.name}</span>
          <span className="script-state">{scriptStateLabel(r.state)}</span>
          <button className="script-stop-btn" onClick={() => window.dr.script.stop(r.id)} data-tooltip="Stop">■</button>
        </div>
      ))}

      {lich.map(s => (
        <div key={`lich:${s.name}`} className="script-row script-row-running">
          <span className="script-badge script-badge-lich">lich</span>
          <span className="script-name">{s.name}</span>
          <span className="script-state">{s.paused ? 'paused' : 'running'}</span>
          <button
            className="script-stop-btn"
            onClick={() => killLich(`;kill ${s.name}`)}
            data-tooltip={`;kill ${s.name}`}
          >■</button>
        </div>
      ))}

      {activeCount === 0 && quick.length === 0 && fkeyList.length === 0 && (
        <div className="lich-panel-empty">
          Nothing running. Add quick buttons in Settings → Hotkeys.
        </div>
      )}
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
function GameLayout({ charName, accountName, watching, resumed, onLeaveWatch, onOpenSettings, onRequestConnect, onSwitchCharacter, updateSlot }: { charName: string; accountName: string; watching: boolean; resumed: boolean; onLeaveWatch: () => void; onOpenSettings: () => void; onRequestConnect: () => void; onSwitchCharacter: () => void; updateSlot: React.ReactNode }) {
  // Automapper: records rooms into the shared world map (movement is captured
  // universally via dr.game.onSent inside the hook).
  const automap = useAutomapper()
  // Procedural ambient sound, driven by the same weather/room state AmbientOverlay
  // paints. Opens no AudioContext at all until something actually wants to sound.
  useAmbientAudio()
  const isMobile = useIsMobile()
  const { status, disconnect, send } = useGameConnection(charName)
  // Carry room/exp/hands across a reload. The game announces those once, on
  // change, so a session resumed mid-hunt would otherwise show nothing until the
  // character next moves. See lib/sessionSnapshot.ts.
  useSessionSnapshot(charName, resumed)
  // App-level messaging subscription (web): keeps contacts/threads/unread live whether
  // or not the Messages panel is open. Inert on desktop until it grows a msg transport.
  useMessaging(charName, status === 'connected')
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
  const setThoughts  = useSetAtom(thoughtLinesAtom)
  const setDeaths    = useSetAtom(deathsAtom)
  const setLogon     = useSetAtom(logonLinesAtom)
  const setInventory = useSetAtom(inventoryLinesAtom)
  const setAvatars   = useSetAtom(avatarsAtom)
  const setAvatarCrops = useSetAtom(avatarCropsAtom)
  const setAppearance  = useSetAtom(appearanceAtom)
  const setInjuryMode  = useSetAtom(injuryModeAtom)
  const setBodyTextMode = useSetAtom(bodyTextModeAtom)
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
      case 'thoughts':     return () => setThoughts([])
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

  // Silent exp seed: one EXP a few seconds after connecting, so the panel starts
  // the session filled in rather than blank until the player asks. beginSilentExp
  // marks the batch so the report text is suppressed from the game output.
  //
  // Seeded at 8 s to stay clear of the verb sweep, the one other thing capturing
  // main-stream lines just after login.
  //
  // Then every five minutes. Skills don't need it — they push themselves live —
  // but rested exp, circle and overall mindstate exist solely in the report text,
  // so without a refresh they hold whatever the last EXP said, which before this
  // meant "whenever a Lich script happened to send one". DR declares an
  // `exp rexp` component that would make rested exp a live push and then only
  // ever sends it EMPTY; announcing dialog support at login (see
  // game-connection.ts) didn't change that. Until something does, the poll is the
  // only Lich-free way these three stay current. An EXP costs no roundtime and
  // its report is suppressed from the output.
  useEffect(() => {
    if (status !== 'connected') return
    const poll = (): void => { beginSilentExp(); send('exp') }
    const seed = window.setTimeout(poll, 8_000)
    const id   = window.setInterval(poll, 5 * 60_000)
    return () => { window.clearTimeout(seed); window.clearInterval(id) }
  }, [status, send, beginSilentExp])

  // Ambient seed: on connect, silently fetch `weather` (current precipitation) and
  // `time` (calibrates the deterministic day/night clock) once. Both are RT-free;
  // their report lines are suppressed from the main output during the seed window.
  const skySeeded = useRef(false)
  useEffect(() => {
    if (status !== 'connected') { skySeeded.current = false; endSilentSkySeed(); return }
    if (skySeeded.current) return
    skySeeded.current = true
    // Two commands, so two replies to swallow. The store closes the silent window
    // as each reply is recognized — there is deliberately no timer to close it (see
    // beginSilentSkySeedAtom): a timeout raced the round trip on web and lost
    // outright on a backgrounded phone, which is how the seed started leaking.
    const seed = window.setTimeout(() => { beginSilentSkySeed(2); send('weather'); send('time') }, 1500)
    return () => window.clearTimeout(seed)
  }, [status, send, beginSilentSkySeed, endSilentSkySeed])

  // Poll `weather` every minute so the overlay self-heals if an ambient transition
  // message was missed (e.g. it was already snowing when you stepped outdoors). RT-
  // free; the report is fetched silently and suppressed from the main output.
  useEffect(() => {
    if (status !== 'connected') return
    const id = window.setInterval(() => { beginSilentSkySeed(1); send('weather') }, 60_000)
    return () => window.clearInterval(id)
  }, [status, send, beginSilentSkySeed])


  const [showHighlights, setShowHighlights] = useState(false)
  const [showMap,        setShowMap]        = useState(false)
  const [showBody,       setShowBody]       = useState(false)
  const [showItems,      setShowItems]      = useState(false)
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
      if (lastChar) loadCharAppearance(lastChar).then(a => { applyAppearance(a); setAppearance(a) })
      if (s.outputBufferSize) setOutputBuffer(s.outputBufferSize)
      if (s.avatars)          setAvatars(s.avatars)
      if (s.avatarCrops)      setAvatarCrops(s.avatarCrops)
      // Body panel view prefs — seeded before connect so the injury request that
      // fires on connect asks for the view the player last chose.
      if (typeof s.injuryMode === 'number' && s.injuryMode >= 0 && s.injuryMode <= 5) setInjuryMode(s.injuryMode)
      if (typeof s.bodyTextMode === 'boolean') setBodyTextMode(s.bodyTextMode)
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
    loadCharAppearance(charName).then(a => { if (!cancelled) { applyAppearance(a); setAppearance(a) } })
    return () => { cancelled = true }
  }, [charName, setAppearance])

  // Route the main-process Lich/client diagnostic log (SGE auth, Lich manager,
  // connection, script errors) into the main game panel as dim system notices —
  // the dedicated Lich log side panel has been retired.
  useEffect(() => {
    const unsub = window.dr.lich.onLog((line: string) => {
      const l = line.trimEnd()
      // Connection-plumbing chatter ([sge] auth steps, [game] connect/disconnect,
      // [lich] proxy status and raw Lich process output) is noise in the game panel —
      // drop it. Genuinely useful notices ([error], [script], …) still flow through.
      if (l && !/^\[(?:sge|game|lich|lichlog|stderr)\]/.test(l) && !RAW_LICH_CHATTER.test(l))
        appendSystemLine(l)
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
    if (id === 'body') return <BodyPanel onExpand={() => setShowBody(true)} />
    if (id === 'inventory') return <InventoryPanel onManage={() => setShowItems(true)} />
    // Scripts needs the live command path (quick buttons, `;list`, `;kill`), which
    // only exists inside the layout — same reason as the map/body panels above.
    if (id === 'scripts') return (
      <ScriptsPanel send={send} echo={echoCommand} connected={status === 'connected'} charName={charName} />
    )
    return renderPanel(id)
  }, [automap, send, echoCommand, status, charName])

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
    // Colour drains out of the whole client while it isn't attached to the game,
    // so a dead session reads as dead at a glance instead of looking like a live
    // one that stopped talking. It fades back in as the connection comes up,
    // which also covers the connecting state on the way in.
    <div className={status === 'connected' ? 'app-shell' : 'app-shell app-shell-idle'}>
      <StatusBar updateSlot={updateSlot} charName={charName} />
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
              onSwitchCharacter={onSwitchCharacter}
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
      {showBody && <BodyOverlay onClose={() => setShowBody(false)} />}
      {showItems && <ItemManager onClose={() => setShowItems(false)} />}
      <NotificationCenter charName={charName} status={status} />
      <GlobalTooltip />
    </div>
  )
}

// ── Title-bar icons (offline + launch-time update) ───────────────────────────
// The red triangle means "no internet connection" (driven by navigator.onLine).
// An update found by the desktop's initial LAUNCH check shows here as a clickable
// download icon (the classic desktop spot). Updates found later while running —
// a background poll, or any web-build check — go to the panel rail instead (see
// PanelSidebar). Offline wins if both are true (can't update while offline).
function UpdateIcon({ offline, updateReady }: { offline: boolean; updateReady: boolean }) {
  if (offline) return (
    <Tooltip text="No internet connection">
      <button className="update-icon-btn update-error" disabled aria-label="Offline">
        <IconExclamationTriangle size={15} />
      </button>
    </Tooltip>
  )
  if (updateReady) return (
    <Tooltip text="Update available — click to apply">
      <button className="update-icon-btn update-available" aria-label="Update available — click to apply"
              onClick={() => window.dr.updater.install()}>
        <IconArrowDownTray size={15} />
      </button>
    </Tooltip>
  )
  return null
}

// Brief web-only splash shown at startup while AppInner waits to learn whether the
// server still holds this client's live DR session (see the resume effect below).
function ResumeSplash() {
  return (
    <div className="resume-splash">
      <div className="resume-splash-spinner" aria-hidden="true" />
      <div className="resume-splash-text">Resuming…</div>
    </div>
  )
}

function AppInner() {
  const [inGame,        setInGame]        = useState(false)
  const [watching,      setWatching]      = useState(false)   // viewing another device's session
  const [showReconnect, setShowReconnect] = useState(false)
  // When set, the reconnect overlay opens straight onto this DR account's character
  // list (a "Switch character" shortcut) instead of the account picker. null = the
  // normal full login flow.
  const [switchAccount, setSwitchAccount] = useState<string | null>(null)
  const [charName,      setCharName]      = useState('')
  const [accountName,   setAccountName]   = useState('')
  const [showSettings,  setShowSettings]  = useState(false)
  const [offline,       setOffline]       = useState(!navigator.onLine)
  // A launch-check update (desktop) surfaces in the title bar; a while-running update
  // (poll / web) is filtered to the panel rail (see PanelSidebar).
  const [launchUpdate,  setLaunchUpdate]  = useState(false)
  // Web only: after a reload (e.g. applying an update) the server may still hold this
  // client's live session, so start by waiting to resume rather than flashing login.
  // Resume a still-running server session on web load — but not when sign-in is
  // required and we're not signed in: the server rejects that WS, so there's nothing
  // to resume and we'd just wait out the timeout before showing the mandatory gate.
  const [resuming,      setResuming]      = useState(
    window.dr.app.platform === 'web' &&
    !(window.dr.account?.required?.() && !window.dr.account?.isSignedIn?.())
  )

  useEffect(() => {
    // Connectivity indicator: the red triangle shows only when actually offline.
    const update = () => setOffline(!navigator.onLine)
    window.addEventListener('online',  update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => window.dr.updater.onReady(info => { if (info?.fromLaunch) setLaunchUpdate(true) }), [])

  const updateSlot = <UpdateIcon offline={offline} updateReady={launchUpdate} />

  // True only when we attached to a session that was already running (the resume
  // path below), which is the one case where the game will never re-announce the
  // room/exp/hands it pushed before we reloaded. Gates the snapshot restore.
  const [resumedSession, setResumedSession] = useState(false)
  const enterGame = (name: string, account: string, watch = false, resumed = false) => { setCharName(name); setAccountName(account); setWatching(watch); setResumedSession(resumed); setInGame(true); setShowReconnect(false); setSwitchAccount(null) }
  const closeReconnect = () => { setShowReconnect(false); setSwitchAccount(null) }
  // Open the reconnect overlay: "connect" starts the full login flow; "switch"
  // jumps straight to the current account's character list.
  const openConnect = () => { setSwitchAccount(null); setShowReconnect(true) }
  const openSwitchCharacter = () => { setSwitchAccount(accountName || ''); setShowReconnect(true) }
  // Leave a watched session: detach (reconnect to our own bucket) and return to the
  // login screen WITHOUT disconnecting DR — the session keeps running for its owner.
  const leaveWatch = () => { window.dr.account?.unwatch(); setWatching(false); setInGame(false) }

  // Resume decision (web). The freshly-loaded page reconnects with its persisted
  // connId; the server re-attaches to a still-live session for that conn. We ASK the
  // server directly (request/response) whether it holds a live game connection and —
  // critically — which character it's ACTUALLY connected as, rather than racing a
  // fixed timer against connect/disconnect events. The WS transport queues these
  // invokes until the socket opens, so they resolve once a (possibly cold-starting)
  // server answers.
  //
  // The character comes from the SERVER (game:get-char), never from the client's saved
  // lastCharacter: a reload can't be told which of several characters this conn is
  // running, and account-shared settings drift across devices, so lastCharacter can
  // name a DIFFERENT character than the live session — which is exactly what dropped a
  // resume into the wrong character. Saved settings are only a fallback for when the
  // server reports no name (older server, or the name isn't parsed yet).
  useEffect(() => {
    if (!resuming) return
    let settled = false
    const settle = (enter?: { name: string; account: string }) => {
      if (settled) return
      settled = true
      // Anything that settles WITH a character came from a live server session:
      // nothing reconnected, so the snapshot is the only way those panels refill.
      if (enter) enterGame(enter.name, enter.account, false, true)
      setResuming(false)
    }
    void (async () => {
      try {
        const status = await window.dr.game.getStatus()
        if (status !== 'connected') { settle(); return }   // no live session → login
        // Live session — get the character it's actually connected as. Briefly retry
        // if the name hasn't been parsed yet (rare: resuming mid-connect).
        let serverChar = ''
        for (let i = 0; i < 4 && !serverChar; i++) {
          serverChar = ((await window.dr.game.getChar()) ?? '').trim()
          if (!serverChar) await new Promise(r => setTimeout(r, 400))
        }
        const s = await window.dr.settings.getAll()
        const name = serverChar || (s.accounts?.find(a => a.name === s.lastAccount)?.lastCharacter ?? '')
        // Resolve the owning account (for labels + the switch-character shortcut) from
        // the resolved character; fall back to the last-used account.
        const account = name
          ? (s.accounts?.find(a => a.lastCharacter?.toLowerCase() === name.toLowerCase())?.name ?? s.lastAccount ?? '')
          : (s.lastAccount ?? '')
        settle({ name, account })
      } catch {
        settle()   // socket closed / server unreachable → fall through to login
      }
    })()
    // Fallback: if the server never answers (unreachable / stuck cold start), stop
    // waiting and show login rather than hanging on the splash. Generous, since a
    // freshly-deployed server can take several seconds to accept the socket.
    const timer = window.setTimeout(() => settle(), 10000)
    return () => { window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (resuming) return <ResumeSplash />

  return (
    <>
      {!inGame && <div className="app-titlebar-shell">{updateSlot}<WindowControls /></div>}
      {!inGame
        ? <LoginFlow onEnterGame={enterGame} onOpenSettings={() => setShowSettings(true)} />
        : <GameLayout charName={charName} accountName={accountName} watching={watching} resumed={resumedSession} onLeaveWatch={leaveWatch} onOpenSettings={() => setShowSettings(true)} onRequestConnect={openConnect} onSwitchCharacter={openSwitchCharacter} updateSlot={updateSlot} />
      }
      {inGame && showReconnect && (
        <div className="reconnect-overlay">
          <button className="reconnect-close" onClick={closeReconnect} aria-label="Cancel">✕</button>
          <LoginFlow onEnterGame={enterGame} onOpenSettings={() => setShowSettings(true)} switchAccount={switchAccount} />
        </div>
      )}
      {showSettings && (
        <SettingsModal
          charName={charName}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  )
}

export default function App() {
  return <Provider><AppInner /></Provider>
}
