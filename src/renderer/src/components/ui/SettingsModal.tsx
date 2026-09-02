import { useState, useEffect } from 'react'
import { applyTheme } from '../../lib/themes'
import { setOutputBuffer } from '../game/GameOutput'
import { loadCharAppearance, saveCharAppearance, applyAppearance } from '../../lib/charSettings'
import { DEFAULT_NOTIF, DEFAULT_PUSH, makeNameRule, type NotifSettings, type NotifRule, type PushSettings } from './Notifications'
import { LichFilesEditor } from './LichFilesEditor'
import { LogFilesViewer } from './LogFilesViewer'
import { LichLogsViewer } from './LichLogsViewer'
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

interface SettingsModalProps {
  charName?: string
  onClose: () => void
}

type TabId = 'appearance' | 'ambient' | 'notifications' | 'hotkeys' | 'aliases' | 'triggers' | 'scripts' | 'lich' | 'logs'

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance',    label: 'Appearance' },
  { id: 'ambient',       label: 'Ambient' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'hotkeys',       label: 'Hotkeys' },
  { id: 'aliases',       label: 'Aliases' },
  { id: 'triggers',      label: 'Triggers' },
  { id: 'scripts',       label: 'Scripts' },
  { id: 'lich',          label: 'Lich' },
  // Lantern's own game-output logs. Separate from the Lich tab because they are a
  // different set of files with a different owner — Lich writes its own, and mixing
  // the two under one heading is what made it unclear which was eating the disk.
  { id: 'logs',          label: 'Lantern Logs' },
]

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
  // Theme active when the modal opened — restored if the user cancels
  const [originalTheme,   setOriginalTheme]   = useState('magiloom')
  const [density,         setDensity]         = useState<'cozy' | 'compact'>('cozy')
  const [outputBufferSize, setOutputBufferSize] = useState(5000)
  const [keepScreenOn,    setKeepScreenOn]    = useState(true)
  const [ambientRoomTint, setAmbientRoomTint] = useState(true)
  const [ambientHeat,     setAmbientHeat]     = useState(true)
  const [ambientRoomEffects, setAmbientRoomEffects] = useState(true)
  const [ambientDeath,       setAmbientDeath]       = useState(true)
  const [sound,           setSound]           = useState<SoundPrefs>(DEFAULT_SOUND)
  const [loginArt,        setLoginArt]        = useState<LoginArtPrefs>(DEFAULT_LOGIN_ART)
  const [logging,         setLogging]         = useState(false)
  // Server-side Lich log retention. Global (Lich writes into one per-user home, so
  // there's no per-character disk to bound) and web-only — on desktop the logs sit
  // on the user's own machine, where the server's pruner has no say.
  const [lichLogDays,     setLichLogDays]     = useState(7)
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
      setOriginalTheme(a.theme)
      setDensity(a.density)
    })
    window.dr.settings.getAll().then(s => {
      setLichPath(s.lichPath || '')
      setScriptDir(s.scriptDir || '')
      setOutputBufferSize(s.outputBufferSize || 5000)
      setKeepScreenOn(s.keepScreenOn !== false)
      setAmbientRoomTint(s.ambientRoomTint !== false)
      setAmbientHeat(s.ambientHeat !== false)
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
    saveCharAppearance(charName, { theme, fontSize, fontFamily, density })
    await window.dr.settings.patch({
      lichPath, scriptDir, outputBufferSize, keepScreenOn, ambientRoomTint, ambientHeat,
      ambientRoomEffects, ambientDeath,
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
    applyAppearance({ theme, fontSize, fontFamily, density })
    setOutputBuffer(outputBufferSize)
    onClose()
  }

  // Live-preview a theme the moment its tile is clicked
  const previewTheme = (id: string) => { setTheme(id); applyTheme(id) }

  // Dismiss without saving — undo any live theme preview first
  const handleCancel = () => { applyTheme(originalTheme); onClose() }

  const versionLabel = !version || version === '0.0.0' ? 'dev' : `v${version}`

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && handleCancel()}>
      <div className="modal-card settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={handleCancel}>×</button>
        </div>

        <div className="settings-layout">
          <nav className="settings-nav">
            {tabs.map(t => (
              <button
                key={t.id}
                className={'settings-nav-item' + (tab === t.id ? ' active' : '')}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>

          <div className="modal-body settings-content">
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
                    <select
                      className="settings-input"
                      value={lichLogDays}
                      onChange={e => setLichLogDays(Number(e.target.value))}
                    >
                      <option value={3}>3 days</option>
                      <option value={7}>7 days</option>
                      <option value={14}>14 days</option>
                    </select>
                  </SettingRow>
                )}
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
