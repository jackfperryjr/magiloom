import { useState, useEffect } from 'react'
import { applyTheme } from '../../lib/themes'
import { setOutputBuffer } from '../game/GameOutput'
import { loadCharAppearance, saveCharAppearance, applyAppearance } from '../../lib/charSettings'
import { DEFAULT_NOTIF, DEFAULT_PUSH, makeNameRule, type NotifSettings, type NotifRule, type PushSettings } from './Notifications'
import { LichFilesEditor } from './LichFilesEditor'
import { CmdFilesEditor } from './CmdFilesEditor'
import type { Alias, Trigger } from '../../lib/automation'
import { parseGenieConfig, mergeAliases, mergeTriggers, mergeVars } from '../../lib/genieImport'
import { toggleClassState } from './ClassToggleStrip'
import { AppearanceTab } from './settings/AppearanceTab'
import { NotificationsTab } from './settings/NotificationsTab'
import { AliasesTab } from './settings/AliasesTab'
import { TriggersTab } from './settings/TriggersTab'

interface SettingsModalProps {
  charName?: string
  onClose: () => void
  /** Web only: called after signing out of the Magiloom account so the app can
   *  disconnect from DR and return to the login screen. */
  onSignedOut?: () => void
}

type TabId = 'appearance' | 'notifications' | 'keybinds' | 'aliases' | 'triggers' | 'scripts' | 'lich' | 'account'

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance',    label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keybinds',      label: 'Function Keys' },
  { id: 'aliases',       label: 'Aliases' },
  { id: 'triggers',      label: 'Triggers' },
  { id: 'scripts',       label: 'Scripts' },
  { id: 'lich',          label: 'Lich' },
]

export function SettingsModal({ charName = '', onClose, onSignedOut }: SettingsModalProps) {
  // Magiloom account (web only). The tab appears when signed in so the user can
  // sign out from here (which disconnects DR and returns to the login screen).
  const acctApi = window.dr.account
  const [acct, setAcct] = useState<MagiloomAccount | null>(null)
  useEffect(() => { if (acctApi?.isSignedIn()) void acctApi.current().then(a => setAcct(a)) }, [acctApi])
  // Show the Account tab on any WEB client (desktop or mobile) for consistency; the
  // Electron desktop app has no `account` API, so it never appears there (free/local).
  const tabs = acctApi ? [...TABS, { id: 'account' as TabId, label: 'Account' }] : TABS
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
  const [logging,         setLogging]         = useState(false)
  const [functionKeys,    setFunctionKeys]    = useState<Record<string, string>>({})
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

  const FK_KEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']

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
      setLogging(!!s.logging)
      setNotif({ ...DEFAULT_NOTIF, ...(s.notifications ?? {}) })
      setPush({ ...DEFAULT_PUSH, ...(s.push ?? {}) })
      setNotifRules(s.notifRules ?? [])
    })
    // Function keys / aliases / triggers are per-character (fall back to globals).
    window.dr.settings.getChar(charName).then(c => {
      setFunctionKeys(c.functionKeys || {})
      setAliases(c.aliases || [])
      setTriggers(c.triggers || [])
      setClasses(c.classes || {})
      setVars(Object.entries(c.vars || {}).map(([name, value]) => ({ name, value })))
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
      lichPath, scriptDir, outputBufferSize, logging, notifications: notif, push, notifRules,
    })
    const varsRecord = Object.fromEntries(
      vars.map(v => [v.name.trim(), v.value]).filter(([n]) => n) as [string, string][]
    )
    await window.dr.settings.patchChar(charName, { functionKeys, aliases, triggers, classes, vars: varsRecord })
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
                logging={logging} setLogging={setLogging}
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

            {tab === 'keybinds' && (
              <div className="settings-section">
                <div className="settings-section-label">Function Keys</div>
                <div className="fk-grid">
                  {FK_KEYS.map(key => (
                    <label key={key} className="fk-row">
                      <span className="fk-label">{key}</span>
                      <input
                        className="settings-input settings-input-mono"
                        type="text"
                        placeholder="command"
                        value={functionKeys[key] ?? ''}
                        onChange={e => setFk(key, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              </div>
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
              <div className="settings-section">
                <div className="settings-section-label">Native Scripts</div>
                <div className="settings-label">Script folder</div>
                <div className="settings-path-row">
                  <input
                    className="settings-input settings-input-mono"
                    type="text"
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
                      title="Fall back to the default folder"
                    >
                      Default
                    </button>
                  )}
                </div>
                <div className="settings-hint">
                  Magiloom runs Genie/Wizard-style <code>.cmd</code> scripts from this folder —
                  type <code>.name</code> in the command bar to run one (<code>.stop</code> halts all).
                  If no folder is set, Magiloom uses <code>{defaultScriptDir}</code>.
                </div>
                <CmdFilesEditor />
              </div>
            )}

            {tab === 'lich' && (
              <div className="settings-section">
                <div className="settings-section-label">Lich</div>
                <div className="settings-label">Lich path</div>
                <div className="settings-path-row">
                  <input
                    className="settings-input settings-input-mono"
                    type="text"
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
                </div>
                <div className="settings-hint">
                  Point this at your <code>lich.rbw</code> (or <code>lich.rb</code>) to launch Lich at login.
                  Leave blank to connect directly without Lich.
                </div>
                <LichFilesEditor charName={charName} />
              </div>
            )}

            {tab === 'account' && (
              <div className="settings-section">
                <div className="settings-section-label">Magiloom account</div>
                {acct ? (
                  <>
                    <label className="settings-row">
                      <span className="settings-label">Signed in as</span>
                      <span className="settings-value">{acct.email}</span>
                    </label>
                    <div className="settings-hint">
                      Your settings and Lich setups sync across devices while signed in.
                    </div>
                    <button
                      className="login-btn-secondary"
                      style={{ marginTop: 12, color: 'var(--color-warning)' }}
                      onClick={() => { onClose(); onSignedOut?.() }}
                    >
                      Sign out
                    </button>
                    <div className="settings-hint">
                      Signing out disconnects from DragonRealms and returns to the login screen.
                    </div>
                  </>
                ) : (
                  <div className="settings-hint">
                    Not signed in on this device. Use <strong>“Sign in to sync”</strong> on the login
                    screen to sync your settings and Lich setups across devices.
                  </div>
                )}
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
