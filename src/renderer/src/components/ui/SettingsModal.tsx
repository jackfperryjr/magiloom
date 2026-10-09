import { useState, useEffect, useMemo, useRef } from 'react'
import { useSetAtom } from 'jotai'
import { applyTheme, type ThemeMode } from '../../lib/themes'
import { appearanceAtom } from '../../store/game'
import { setOutputBuffer } from '../game/GameOutput'
import { loadCharAppearance, saveCharAppearance, applyAppearance } from '../../lib/charSettings'
import { DEFAULT_NOTIF, DEFAULT_PUSH, makeNameRule, type NotifSettings, type NotifRule, type PushSettings } from './Notifications'
import { LichFilesEditor } from './LichFilesEditor'
import { LogFilesViewer } from './LogFilesViewer'
import { LichLogsViewer } from './LichLogsViewer'
import { useTierLimits } from './RetentionNotice'
import { CmdFilesEditor } from './CmdFilesEditor'
import type { Alias, Trigger } from '../../lib/automation'
import type { QuickAction } from '../../lib/quickActions'
import { parseGenieConfig, mergeAliases, mergeTriggers, mergeVars } from '../../lib/genieImport'
import { toggleClassState } from './ClassToggleStrip'
import { AppearanceTab } from './settings/AppearanceTab'
import { AmbientTab, DEFAULT_SOUND, DEFAULT_LOGIN_ART, type SoundPrefs, type LoginArtPrefs } from './settings/AmbientTab'
import { NotificationsTab } from './settings/NotificationsTab'
import { HotkeysTab } from './settings/HotkeysTab'
import { AliasesTab } from './settings/AliasesTab'
import { TriggersTab } from './settings/TriggersTab'
import { SettingRow } from './settings/Field'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  TABS, searchSettings, entryTitle, entryPath, type TabId, type SettingEntry,
} from '../../lib/settingsIndex'

interface SettingsModalProps {
  charName?: string
  onClose: () => void
}

// The tab list lives in lib/settingsIndex, beside the catalogue search runs over.

/**
 * The element a search result points at, inside the tab that is now showing.
 *
 * Found by the text the user can see rather than by ids threaded through every
 * tab: section heading first (two toggles are both called "Whispers"), then the
 * row. An exact name wins; failing that, a row containing every word of the label,
 * which is what finds "Log Jackreous's game output" from "Log game output". When
 * the row can't be found the heading is still the right place to land.
 */
function findSettingEl(root: HTMLElement, e: SettingEntry): HTMLElement | null {
  const text = (el: Element | null): string =>
    (el?.textContent ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  const section = [...root.querySelectorAll<HTMLElement>('.settings-section')]
    .find(sec => text(sec.querySelector('.settings-section-label')) === e.section.toLowerCase())
  if (!section) return null
  const heading = section.querySelector<HTMLElement>('.settings-section-label')
  if (!e.label) return heading
  const want  = e.label.toLowerCase()
  const words = want.split(' ')
  const rows  = [...section.querySelectorAll<HTMLElement>('.setting-row, .lf-embed-head')]
  const name  = (r: HTMLElement): string => text(r.querySelector('.setting-name, .settings-label'))
  return rows.find(r => name(r) === want)
      ?? rows.find(r => words.every(w => name(r).includes(w)))
      ?? heading
}

export function SettingsModal({ charName = '', onClose }: SettingsModalProps) {
  const isWeb = window.dr.app.platform === 'web'
  // Magiloom account sign-in/out now lives in the user menu (CharacterBar), not here.
  const tabs = TABS
  const [lichPath,        setLichPath]        = useState('')
  const [scriptDir,       setScriptDir]       = useState('')
  const [defaultScriptDir, setDefaultScriptDir] = useState('')
  const [fontSize,        setFontSize]        = useState(13)
  const [fontFamily,      setFontFamily]      = useState('Cascadia Code')
  const [theme,           setTheme]           = useState('magiloom')
  // Which face of a dual theme (Ashfall) to show. Carried through the modal so
  // previewing another theme and coming back doesn't lose the chosen face; the
  // control that flips it lives in the character bar, not here.
  const [themeMode,       setThemeMode]       = useState<ThemeMode>('dark')
  const setAppearance = useSetAtom(appearanceAtom)
  // Theme + mode active when the modal opened — restored if the user cancels
  const [original,        setOriginal]        = useState<{ theme: string; mode: ThemeMode }>({ theme: 'magiloom', mode: 'dark' })
  const [density,         setDensity]         = useState<'cozy' | 'compact'>('cozy')
  const [outputBufferSize, setOutputBufferSize] = useState(5000)
  const [keepScreenOn,    setKeepScreenOn]    = useState(true)
  const [ambientRoomTint, setAmbientRoomTint] = useState(true)
  const [ambientHeat,     setAmbientHeat]     = useState(true)
  const [ambientStrike,   setAmbientStrike]   = useState(true)
  const [ambientRoomEffects, setAmbientRoomEffects] = useState(true)
  const [ambientDeath,       setAmbientDeath]       = useState(true)
  const [sound,           setSound]           = useState<SoundPrefs>(DEFAULT_SOUND)
  const [loginArt,        setLoginArt]        = useState<LoginArtPrefs>(DEFAULT_LOGIN_ART)
  const [logging,         setLogging]         = useState(false)
  // Server-side Lich log retention. Global (Lich writes into one per-user home, so
  // there's no per-character disk to bound) and web-only — on desktop the logs sit
  // on the user's own machine, where the server's pruner has no say.
  const [lichLogDays,     setLichLogDays]     = useState(7)
  // Plan limits, so the retention control can't offer what the account can't have.
  const tierLimits = useTierLimits()
  const [exporting,       setExporting]       = useState(false)
  const [exportErr,       setExportErr]       = useState('')
  const [functionKeys,    setFunctionKeys]    = useState<Record<string, string>>({})
  const [quickActions,    setQuickActions]    = useState<QuickAction[]>([])
  const [aliases,         setAliases]         = useState<Alias[]>([])
  const [triggers,        setTriggers]        = useState<Trigger[]>([])
  const [classes,         setClasses]         = useState<Record<string, boolean>>({})
  const [vars,            setVars]            = useState<{ name: string; value: string }[]>([])
  const [importMsg,       setImportMsg]       = useState('')
  const [notif,           setNotif]           = useState<NotifSettings>(DEFAULT_NOTIF)
  const [push,            setPush]            = useState<PushSettings>(DEFAULT_PUSH)
  const [notifRules,      setNotifRules]      = useState<NotifRule[]>([])
  const [watchName,       setWatchName]       = useState('')
  const [version,         setVersion]         = useState('')
  const [tab,             setTab]             = useState<TabId>('appearance')
  // A phone can't carry a nav rail and a settings panel at once. Rather than squeeze
  // nine tabs into a horizontally-scrolling strip — where most of them are off-screen
  // and the one you're in is easy to lose — the modal becomes two screens: the tab
  // LIST, then the tab itself, with a back arrow. `atMenu` is which of the two is
  // showing, and is ignored on desktop (nav + panel are side by side there).
  const isMobile = useIsMobile()
  const [atMenu, setAtMenu] = useState(true)
  const openTab = (id: TabId) => { setTab(id); setAtMenu(false) }
  // Only the menu screen has no tab open; on desktop there is always one.
  const showMenu = isMobile && atMenu

  // ── Search ──
  // Typing replaces the tab with a list of matching settings; picking one opens its
  // tab and scrolls to it. `jump` is the picked entry, held until the tab it lives
  // in has rendered — the row doesn't exist to scroll to until then.
  const [query,  setQuery]  = useState('')
  const [active, setActive] = useState(0)
  const [jump,   setJump]   = useState<SettingEntry | null>(null)
  const searchRef  = useRef<HTMLInputElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const results   = useMemo(() => searchSettings(query, isWeb), [query, isWeb])
  const searching = query.trim() !== ''
  const hitTabs   = useMemo(() => new Set(results.map(r => r.tab)), [results])

  const goTo = (e: SettingEntry) => {
    setTab(e.tab); setAtMenu(false); setQuery(''); setJump(e)
  }

  useEffect(() => {
    if (!jump || searching) return
    const root = contentRef.current
    const el   = root && findSettingEl(root, jump)
    setJump(null)
    if (!root || !el) return
    // Scrolled by hand rather than with scrollIntoView, which also scrolls every
    // clipped ancestor it can — and the modal sits inside several.
    const r = el.getBoundingClientRect(), c = root.getBoundingClientRect()
    root.scrollTop += r.top - c.top - Math.max(0, (c.height - r.height) / 2)
    el.classList.remove('setting-flash')
    void el.offsetWidth   // restart the animation if this row was only just flashed
    el.classList.add('setting-flash')
    el.addEventListener('animationend', () => el.classList.remove('setting-flash'), { once: true })
  }, [jump, searching, tab])

  // "/" or Ctrl/Cmd+F puts the cursor in the search box. "/" is left alone while
  // typing in a field — it is a character in a path, a pattern and a command. And
  // neither is taken from a code editor, where Ctrl+F means find IN THE FILE.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const find  = (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f'
      const t     = e.target as HTMLElement | null
      if (t?.closest?.('.code-editor')) return
      const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))
      if (!find && !(e.key === '/' && !typing)) return
      if (!searchRef.current) return
      e.preventDefault()
      searchRef.current.focus()
      searchRef.current.select()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown')    { e.preventDefault(); setActive(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter')   { const hit = results[active]; if (hit) { e.preventDefault(); goTo(hit) } }
    else if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') }
  }

  const searchBox = (
    <div className="settings-search">
      <input
        ref={searchRef}
        className="settings-search-input"
        type="text"
        role="searchbox"
        aria-label="Search settings"
        placeholder="Search settings"
        spellCheck={false}
        // A phone would answer this by throwing its keyboard over the menu.
        autoFocus={!isMobile}
        value={query}
        onChange={e => { setQuery(e.target.value); setActive(0) }}
        onKeyDown={onSearchKey}
      />
      {query
        ? <button className="settings-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchRef.current?.focus() }}>×</button>
        : !isMobile && <kbd className="settings-search-key" aria-hidden="true">/</kbd>}
    </div>
  )

  const resultList = results.length === 0
    ? <div className="settings-results-empty">No settings match “{query.trim()}”.</div>
    : results.map((r, i) => (
        <button
          key={`${r.tab}/${r.section}/${r.label ?? ''}`}
          className={'settings-result' + (i === active ? ' active' : '')}
          onMouseEnter={() => setActive(i)}
          onClick={() => goTo(r)}
        >
          <span className="settings-result-title">{entryTitle(r)}</span>
          <span className="settings-result-path">{entryPath(r)}</span>
        </button>
      ))

  const setFk = (key: string, cmd: string) =>
    setFunctionKeys(prev => ({ ...prev, [key]: cmd }))

  const importGenie = async () => {
    const res = await window.dr.app.openTextFile([
      { name: 'Genie config', extensions: ['cfg', 'xml', 'txt'] },
      { name: 'All Files', extensions: ['*'] },
    ])
    if (!res) return
    if (res.error || !res.content) { setImportMsg(`Could not read file: ${res.error ?? 'file is empty'}`); return }
    const parsed = parseGenieConfig(res.content)
    const a = mergeAliases(aliases, parsed.aliases)
    const t = mergeTriggers(triggers, parsed.triggers)
    const v = mergeVars(Object.fromEntries(vars.map(x => [x.name, x.value])), parsed.vars)
    setAliases(a.merged)
    setTriggers(t.merged)
    setVars(Object.entries(v.merged).map(([name, value]) => ({ name, value })))
    const unsupported = Object.values(parsed.skipped).reduce((n, c) => n + c, 0)
    const kinds = Object.keys(parsed.skipped).sort().map(k => `#${k}`).join(', ')
    setImportMsg(
      `Imported ${a.added} alias(es), ${t.added} trigger(s), ${v.added} variable(s)` +
      (a.dupes + t.dupes ? `, skipped ${a.dupes + t.dupes} duplicate(s)` : '') +
      (unsupported ? `. ${unsupported} unsupported line(s) not imported (${kinds}).` : '.') +
      ' Review below, then Save to keep them.'
    )
  }

  useEffect(() => {
    window.dr.app.getVersion().then(setVersion)
    window.dr.script.defaultDir().then(setDefaultScriptDir)
    // Appearance is per-character (in settings.json); everything else is global.
    loadCharAppearance(charName).then(a => {
      setFontSize(a.fontSize)
      setFontFamily(a.fontFamily)
      setTheme(a.theme)
      setThemeMode(a.themeMode)
      setOriginal({ theme: a.theme, mode: a.themeMode })
      setDensity(a.density)
    })
    window.dr.settings.getAll().then(s => {
      setLichPath(s.lichPath || '')
      setScriptDir(s.scriptDir || '')
      setOutputBufferSize(s.outputBufferSize || 5000)
      setKeepScreenOn(s.keepScreenOn !== false)
      setAmbientRoomTint(s.ambientRoomTint !== false)
      setAmbientHeat(s.ambientHeat !== false)
      setAmbientStrike(s.ambientStrike !== false)
      setAmbientRoomEffects(s.ambientRoomEffects !== false)
      setAmbientDeath(s.ambientDeath !== false)
      setSound({
        on:          s.ambientSound !== false,
        volume:      typeof s.ambientSoundVolume === 'number' ? s.ambientSoundVolume : DEFAULT_SOUND.volume,
        pauseHidden: s.ambientSoundPauseHidden !== false,
        layers: {
          rain:  s.ambientSoundLayers?.rain  !== false,
          wind:  s.ambientSoundLayers?.wind  !== false,
          fire:  s.ambientSoundLayers?.fire  !== false,
          water: s.ambientSoundLayers?.water !== false,
        },
      })
      setLoginArt({
        on:       s.loginArt !== false,
        scene:    s.loginArtScene || 'calendar',
        holidays: s.loginArtHolidays !== false,
      })
      setNotif({ ...DEFAULT_NOTIF, ...(s.notifications ?? {}) })
      setPush({ ...DEFAULT_PUSH, ...(s.push ?? {}) })
      setNotifRules(s.notifRules ?? [])
      setLichLogDays(s.lichLogRetentionDays ?? 7)
    })
    // Hotkeys / quick actions / aliases / triggers are per-character (fall back to globals).
    window.dr.settings.getChar(charName).then(c => {
      setFunctionKeys(c.functionKeys || {})
      setQuickActions(c.quickActions || [])
      setAliases(c.aliases || [])
      setTriggers(c.triggers || [])
      setClasses(c.classes || {})
      setVars(Object.entries(c.vars || {}).map(([name, value]) => ({ name, value })))
      setLogging(!!c.logging)
    })
  }, [charName])

  const toggleClass = (name: string) => setClasses(m => toggleClassState(m, name))

  const patchRule = (id: string, p: Partial<NotifRule>) =>
    setNotifRules(list => list.map(x => x.id === id ? { ...x, ...p } : x))
  const addWatchName = () => {
    const n = watchName.trim()
    if (!n) return
    setNotifRules(list => [...list, makeNameRule(n)])
    setWatchName('')
  }

  const handleSave = async () => {
    // Per-character appearance + gameplay → settings.json; the rest is global.
    saveCharAppearance(charName, { theme, themeMode, fontSize, fontFamily, density })
    await window.dr.settings.patch({
      lichPath, scriptDir, outputBufferSize, keepScreenOn, ambientRoomTint, ambientHeat,
      ambientStrike, ambientRoomEffects, ambientDeath,
      ambientSound: sound.on, ambientSoundVolume: sound.volume,
      ambientSoundLayers: sound.layers, ambientSoundPauseHidden: sound.pauseHidden,
      loginArt: loginArt.on, loginArtScene: loginArt.scene, loginArtHolidays: loginArt.holidays,
      notifications: notif, push, notifRules,
      ...(isWeb ? { lichLogRetentionDays: lichLogDays } : {}),
    })
    const varsRecord = Object.fromEntries(
      vars.map(v => [v.name.trim(), v.value]).filter(([n]) => n) as [string, string][]
    )
    // Drop half-filled quick action rows — a button with no target does nothing,
    // and an unsaved blank row shouldn't survive as a dead button in the panel.
    const quick = quickActions.filter(a => a.target.trim())
    await window.dr.settings.patchChar(charName, { functionKeys, quickActions: quick, aliases, triggers, classes, vars: varsRecord, logging })
    window.dispatchEvent(new CustomEvent('settings:saved'))
    const appearance = { theme, themeMode, fontSize, fontFamily, density }
    applyAppearance(appearance)
    setAppearance(appearance)
    setOutputBuffer(outputBufferSize)
    onClose()
  }

  // Live-preview a theme the moment its tile is clicked. The mode rides along, so
  // clicking Ashfall shows the face you last had rather than always the dark one.
  const previewTheme = (id: string) => { setTheme(id); applyTheme(id, themeMode) }

  // Dismiss without saving — undo any live theme preview first
  const handleCancel = () => { applyTheme(original.theme, original.mode); onClose() }

  const versionLabel = !version || version === '0.0.0' ? 'dev' : `v${version}`
  const tabLabel = tabs.find(t => t.id === tab)?.label ?? 'Settings'

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && handleCancel()}>
      <div className="modal-card settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          {isMobile && !atMenu && (
            <button
              className="settings-back"
              onClick={() => setAtMenu(true)}
              aria-label="Back to settings"
            >
              ‹
            </button>
          )}
          <span className="modal-title">{showMenu ? 'Settings' : tabLabel}</span>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <div className="settings-layout">
          {/* The rail is the desktop navigation; on a phone the same list is the
              first screen instead (rendered below), so there is nothing to pin. */}
          {!isMobile && (
            <nav className="settings-nav">
              {searchBox}
              {tabs.map(t => (
                <button
                  key={t.id}
                  // While searching, the rail shows where the matches are: no tab is
                  // "current", and the ones with nothing in them step back.
                  className={'settings-nav-item' + (!searching && tab === t.id ? ' active' : '') + (searching && !hitTabs.has(t.id) ? ' no-hit' : '')}
                  onClick={() => { setQuery(''); setTab(t.id) }}
                >
                  {t.label}
                </button>
              ))}
            </nav>
          )}

          {showMenu && (
            <nav className="settings-menu">
              {searchBox}
              {searching ? resultList : tabs.map(t => (
                <button key={t.id} className="settings-menu-item" onClick={() => openTab(t.id)}>
                  <span className="settings-menu-label">{t.label}</span>
                  <span className="settings-menu-chevron" aria-hidden="true">›</span>
                </button>
              ))}
            </nav>
          )}

          {!showMenu && searching && (
            <div className="settings-results">{resultList}</div>
          )}

          {!showMenu && !searching && (
          <div className="modal-body settings-content" ref={contentRef}>
            {tab === 'appearance' && (
              <AppearanceTab
                theme={theme} previewTheme={previewTheme}
                density={density} setDensity={setDensity}
                fontFamily={fontFamily} setFontFamily={setFontFamily}
                fontSize={fontSize} setFontSize={setFontSize}
                outputBufferSize={outputBufferSize} setOutputBufferSize={setOutputBufferSize}
                isWeb={isWeb}
                keepScreenOn={keepScreenOn} setKeepScreenOn={setKeepScreenOn}
              />
            )}

            {tab === 'ambient' && (
              <AmbientTab
                ambientRoomTint={ambientRoomTint} setAmbientRoomTint={setAmbientRoomTint}
                ambientHeat={ambientHeat} setAmbientHeat={setAmbientHeat}
                ambientStrike={ambientStrike} setAmbientStrike={setAmbientStrike}
                ambientRoomEffects={ambientRoomEffects} setAmbientRoomEffects={setAmbientRoomEffects}
                ambientDeath={ambientDeath} setAmbientDeath={setAmbientDeath}
                sound={sound} setSound={setSound}
                loginArt={loginArt} setLoginArt={setLoginArt}
              />
            )}

            {tab === 'notifications' && (
              <NotificationsTab
                notif={notif} setNotif={setNotif}
                push={push} setPush={setPush}
                notifRules={notifRules} setNotifRules={setNotifRules}
                watchName={watchName} setWatchName={setWatchName}
                patchRule={patchRule} addWatchName={addWatchName}
              />
            )}

            {tab === 'hotkeys' && (
              <HotkeysTab
                quickActions={quickActions} setQuickActions={setQuickActions}
                functionKeys={functionKeys} setFk={setFk}
              />
            )}

            {tab === 'aliases' && (
              <AliasesTab
                aliases={aliases} setAliases={setAliases}
                vars={vars} setVars={setVars}
                classes={classes} toggleClass={toggleClass}
                importGenie={importGenie} importMsg={importMsg}
              />
            )}

            {tab === 'triggers' && (
              <TriggersTab
                triggers={triggers} setTriggers={setTriggers}
                classes={classes} toggleClass={toggleClass}
                importGenie={importGenie} importMsg={importMsg}
              />
            )}

            {tab === 'scripts' && (
              <div className="settings-section settings-section-wide">
                <div className="settings-section-label">Native Scripts</div>
                <SettingRow
                  stacked
                  label="Script folder"
                  hint={<>
                    Lantern runs Genie/Wizard-style <code>.cmd</code> scripts from this folder —
                    type <code>.name</code> in the command bar to run one (<code>.stop</code> halts all).
                    If no folder is set, Lantern uses <code>{defaultScriptDir}</code>.
                  </>}
                >
                  <input
                    className="settings-input settings-input-mono"
                    type="text"
                    aria-label="Script folder"
                    placeholder={defaultScriptDir}
                    value={scriptDir}
                    onChange={e => setScriptDir(e.target.value)}
                  />
                  <button
                    className="login-btn-secondary"
                    style={{ minWidth: 84 }}
                    onClick={async () => { const d = await window.dr.app.chooseFolder(); if (d) setScriptDir(d) }}
                  >
                    Browse…
                  </button>
                  {scriptDir && (
                    <button
                      className="login-btn-secondary"
                      style={{ minWidth: 72 }}
                      onClick={() => setScriptDir('')}
                      data-tooltip="Fall back to the default folder"
                    >
                      Default
                    </button>
                  )}
                </SettingRow>
                <CmdFilesEditor />
              </div>
            )}

            {tab === 'lich' && (
              <div className="settings-section settings-section-wide">
                <div className="settings-section-label">Lich</div>
                {/* The Lich path points at a LOCAL Lich install, which only the
                    desktop app has — the web client's Lich runs server-side, so
                    there is nothing for the user to locate. */}
                {!isWeb && (
                  <SettingRow
                    stacked
                    label="Lich path"
                    hint={<>
                      Point this at your <code>lich.rbw</code> (or <code>lich.rb</code>) to launch Lich at login.
                      Leave blank to connect directly without Lich.
                    </>}
                  >
                    <input
                      className="settings-input settings-input-mono"
                      type="text"
                      aria-label="Lich path"
                      placeholder="C:\Ruby4Lich5\Lich5\lich.rbw"
                      value={lichPath}
                      onChange={e => setLichPath(e.target.value)}
                    />
                    <button
                      className="login-btn-secondary"
                      style={{ minWidth: 84 }}
                      onClick={async () => {
                        const f = await window.dr.app.chooseFile([
                          { name: 'Lich', extensions: ['rbw', 'rb'] },
                          { name: 'All Files', extensions: ['*'] },
                        ])
                        if (f) setLichPath(f)
                      }}
                    >
                      Browse…
                    </button>
                  </SettingRow>
                )}
                {/* Lich keeps its OWN session logs, separate from the game-output
                    logs below, and never deletes one — so on the hosted server they
                    accumulate until the disk fills. Desktop keeps them on the user's
                    own machine, where this doesn't apply and nothing prunes them. */}
                {isWeb && (
                  <SettingRow
                    label="Keep Lich session logs for"
                    hint="Lich writes a log every time it reconnects. Older ones are removed
                          from the server automatically. Download anything you want to keep —
                          large accounts may be trimmed sooner to stay within their storage
                          allowance."
                  >
                    {/* Options above the plan stay VISIBLE but disabled. Hiding them
                        would hide the upgrade too — and it would look like the app
                        simply offers less than it does. */}
                    <select
                      className="settings-input"
                      value={lichLogDays}
                      onChange={e => setLichLogDays(Number(e.target.value))}
                    >
                      {[1, 3, 7, 14].map(d => {
                        const allowed = !tierLimits || d <= tierLimits.maxDays
                        return (
                          <option key={d} value={d} disabled={!allowed}>
                            {d} day{d === 1 ? '' : 's'}{allowed ? '' : ' — Premium'}
                          </option>
                        )
                      })}
                    </select>
                  </SettingRow>
                )}
                {/* Web only: on desktop these files are already on the user's own
                    machine, so a "download" would just copy a folder they can open. */}
                {isWeb && (
                  <SettingRow
                    label="Export your Lich data"
                    hint="A zip of everything that's yours — character profiles, your own
                          scripts, Lich's per-character data and its session logs. The shared
                          script library and engine aren't included; they're the same for
                          everyone and come from upstream."
                  >
                    <button
                      className="login-btn-secondary"
                      disabled={exporting}
                      onClick={async () => {
                        setExporting(true)
                        setExportErr('')
                        try { await window.dr.account?.exportData?.(true) }
                        catch (e) { setExportErr(String(e)) }
                        finally { setExporting(false) }
                      }}
                    >
                      {exporting ? 'Preparing…' : 'Download .zip'}
                    </button>
                  </SettingRow>
                )}
                {exportErr && <div className="lf-error">{exportErr}</div>}
                <LichFilesEditor charName={charName} />
                <LichLogsViewer />
              </div>
            )}

            {tab === 'logs' && (
              <div className="settings-section settings-section-wide">
                <div className="settings-section-label">Lantern Logs</div>
                <LogFilesViewer charName={charName} logging={logging} setLogging={setLogging} />
              </div>
            )}

          </div>
          )}
        </div>

        <div className="modal-footer">
          <span className="settings-version">{versionLabel}</span>
          <button className="login-btn-secondary" onClick={handleCancel}>Cancel</button>
          <button className="login-btn" style={{ minWidth: 80 }} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
