import { useState, useEffect } from 'react'
import { THEMES, applyTheme } from '../../lib/themes'
import { setOutputBuffer } from '../game/GameOutput'
import { loadCharAppearance, saveCharAppearance, applyAppearance } from '../../lib/charSettings'
import { DEFAULT_NOTIF, DEFAULT_PUSH, makeNameRule, type NotifSettings, type NotifRule, type PushSettings } from './Notifications'
import { LichFilesEditor } from './LichFilesEditor'
import type { Alias, Trigger } from '../../lib/automation'
import { parseGenieConfig, mergeAliases, mergeTriggers, mergeVars } from '../../lib/genieImport'
import { ClassToggleStrip, distinctClasses, toggleClassState } from './ClassToggleStrip'

interface SettingsModalProps {
  charName?: string
  onClose: () => void
}

type TabId = 'appearance' | 'notifications' | 'keybinds' | 'aliases' | 'triggers' | 'scripts' | 'lich'

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance',    label: 'Appearance' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keybinds',      label: 'Function Keys' },
  { id: 'aliases',       label: 'Aliases' },
  { id: 'triggers',      label: 'Triggers' },
  { id: 'scripts',       label: 'Scripts' },
  { id: 'lich',          label: 'Lich' },
]

function uid() { return Math.random().toString(36).slice(2, 9) }

export function SettingsModal({ charName = '', onClose }: SettingsModalProps) {
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
            {TABS.map(t => (
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
              <>
                <div className="settings-section">
                  <div className="settings-section-label">Theme</div>
                  <div className="theme-grid">
                    {THEMES.map(t => (
                      <button
                        key={t.id}
                        className={'theme-swatch' + (theme === t.id ? ' active' : '')}
                        style={{
                          background:  t.vars['--bg-panel'],
                          borderColor: theme === t.id ? t.vars['--accent'] : t.vars['--border'],
                          boxShadow:   theme === t.id ? `0 0 10px ${t.vars['--accent-glow']}` : 'none',
                        }}
                        onClick={() => previewTheme(t.id)}
                      >
                        <div style={{ display: 'flex', gap: 2, marginBottom: 5 }}>
                          {['--health-color','--mana-color','--stamina-color','--accent','--color-roomname'].map(k => (
                            <div key={k} style={{ flex:1, height:4, borderRadius:2, background: t.vars[k] }} />
                          ))}
                        </div>
                        <span className="theme-swatch-name" style={{ color: t.vars['--color-roomname'] }}>
                          {t.name}
                        </span>
                        <span className="theme-swatch-preview" style={{ color: t.vars['--text-dim'] }}>
                          <span style={{ color: t.vars['--color-speech'] }}>say </span>
                          <span style={{ color: t.vars['--color-warning'] }}>!</span>
                          <span style={{ color: t.vars['--color-bonus'] }}> ✓</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-label">Layout</div>
                  <label className="settings-row">
                    <span className="settings-label">Density</span>
                    <select
                      className="settings-input"
                      value={density}
                      onChange={e => setDensity(e.target.value as 'cozy' | 'compact')}
                    >
                      <option value="cozy">Cozy</option>
                      <option value="compact">Compact</option>
                    </select>
                  </label>
                </div>

                <div className="settings-section">
                  <div className="settings-section-label">Display</div>
                <label className="settings-row">
                  <span className="settings-label">Font family</span>
                  <select
                    className="settings-input"
                    value={fontFamily}
                    onChange={e => setFontFamily(e.target.value)}
                  >
                    <option>Cascadia Code</option>
                    <option>Fira Code</option>
                    <option>Consolas</option>
                    <option>Courier New</option>
                    <option>monospace</option>
                  </select>
                </label>
                <label className="settings-row">
                  <span className="settings-label">Font size</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input
                      type="range" min={10} max={18} value={fontSize}
                      onChange={e => setFontSize(Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 30 }}>
                      {fontSize}px
                    </span>
                  </div>
                </label>
                <label className="settings-row">
                  <span className="settings-label">Output buffer</span>
                  <select
                    className="settings-input"
                    value={outputBufferSize}
                    onChange={e => setOutputBufferSize(Number(e.target.value))}
                  >
                    <option value={1000}>1,000 lines</option>
                    <option value={2500}>2,500 lines</option>
                    <option value={5000}>5,000 lines</option>
                    <option value={10000}>10,000 lines</option>
                  </select>
                </label>
                <label className="settings-row">
                  <span className="settings-label">Log game output to file</span>
                  <input type="checkbox" checked={logging} style={{ width: 'auto' }}
                    onChange={e => setLogging(e.target.checked)} />
                </label>
                <div className="settings-hint">
                  Saves the visible game text to a per-character, per-day file under the app's
                  data folder (<code>logs/</code>). Off by default.
                </div>
                </div>
              </>
            )}

            {tab === 'notifications' && (
              <>
                <div className="settings-section">
                  <div className="settings-section-label">Alerts</div>
                  <label className="settings-row">
                    <span className="settings-label">Play sound</span>
                    <input type="checkbox" checked={notif.sound} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, sound: e.target.checked }))} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-label">Desktop popups</span>
                    <input type="checkbox" checked={notif.desktop} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, desktop: e.target.checked }))} />
                  </label>
                  <div className="settings-hint">
                    Desktop popups only appear when the window isn't focused. Do Not Disturb silences sound and popups.
                  </div>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">Notify me about</div>
                  <label className="settings-row">
                    <span className="settings-label">Mentions</span>
                    <input type="checkbox" checked={notif.mention} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, mention: e.target.checked }))} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-label">Whispers</span>
                    <input type="checkbox" checked={notif.whisper} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, whisper: e.target.checked }))} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-label">Disconnects</span>
                    <input type="checkbox" checked={notif.disconnect} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, disconnect: e.target.checked }))} />
                  </label>
                </div>
                <div className="settings-section">
                  <div className="settings-section-label">Speak aloud (text-to-speech)</div>
                  <label className="settings-row">
                    <span className="settings-label">Speak mentions</span>
                    <input type="checkbox" checked={!!notif.ttsMention} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, ttsMention: e.target.checked }))} />
                  </label>
                  <label className="settings-row">
                    <span className="settings-label">Speak whispers</span>
                    <input type="checkbox" checked={!!notif.ttsWhisper} style={{ width: 'auto' }}
                      onChange={e => setNotif(n => ({ ...n, ttsWhisper: e.target.checked }))} />
                  </label>
                  <div className="settings-hint">Reads the line aloud using your system voice. Custom alerts have their own “Speak” option below.</div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-label">Push notifications</div>
                  <label className="settings-row">
                    <span className="settings-label">Notify me when the app is closed</span>
                    <input type="checkbox" checked={push.enabled} style={{ width: 'auto' }}
                      onChange={e => setPush(p => ({ ...p, enabled: e.target.checked }))} />
                  </label>
                  <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
                    <span className="settings-label">Mentions of my name</span>
                    <input type="checkbox" checked={push.mention} disabled={!push.enabled} style={{ width: 'auto' }}
                      onChange={e => setPush(p => ({ ...p, mention: e.target.checked }))} />
                  </label>
                  <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
                    <span className="settings-label">Whispers</span>
                    <input type="checkbox" checked={push.whisper} disabled={!push.enabled} style={{ width: 'auto' }}
                      onChange={e => setPush(p => ({ ...p, whisper: e.target.checked }))} />
                  </label>
                  <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
                    <span className="settings-label">Room speech (says)</span>
                    <input type="checkbox" checked={push.speech} disabled={!push.enabled} style={{ width: 'auto' }}
                      onChange={e => setPush(p => ({ ...p, speech: e.target.checked }))} />
                  </label>
                  <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
                    <span className="settings-label">Thoughts (ESP)</span>
                    <input type="checkbox" checked={push.thought} disabled={!push.enabled} style={{ width: 'auto' }}
                      onChange={e => setPush(p => ({ ...p, thought: e.target.checked }))} />
                  </label>
                  <div className="settings-hint">
                    Sent by the Magiloom server to your phone or desktop even when the app is closed — like a messaging app.
                    Web app only; on mobile, use <strong>Add to Home Screen</strong> and allow notifications first. Room speech can be noisy in a crowded room.
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-label">Custom alerts</div>
                  <div className="settings-hint" style={{ marginTop: 0 }}>
                    Watch for any incoming text — a character name, a phrase, or a <code>.*</code> regex — and fire the channels you check on each row.
                  </div>
                  <div className="alert-quickadd">
                    <input
                      className="settings-input"
                      placeholder="Add an alert — text to watch (e.g. a name)…"
                      value={watchName}
                      spellCheck={false}
                      onChange={e => setWatchName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWatchName() } }}
                    />
                    <button className="login-btn-secondary rule-import-btn" onClick={addWatchName}>+ Add</button>
                  </div>

                  <div className="rule-list">
                    {notifRules.length === 0 && (
                      <p className="hl-empty-msg">No alerts yet. Type text to watch above and press + Add.</p>
                    )}
                    {notifRules.map(r => (
                      <div key={r.id} className={'rule-row' + (r.enabled ? '' : ' rule-row-off')}>
                        <input
                          type="checkbox"
                          checked={r.enabled}
                          data-tooltip="Enabled"
                          onChange={e => patchRule(r.id, { enabled: e.target.checked })}
                        />
                        <input
                          className="settings-input settings-input-mono"
                          placeholder={r.isRegex ? 'has died' : 'text to match'}
                          value={r.pattern}
                          spellCheck={false}
                          onChange={e => patchRule(r.id, { pattern: e.target.value, label: r.label || e.target.value })}
                        />
                        <label className="rule-regex" data-tooltip="Regular expression">
                          <input
                            type="checkbox"
                            checked={r.isRegex}
                            onChange={e => patchRule(r.id, { isRegex: e.target.checked })}
                          />
                          .*
                        </label>
                        <label className="alert-ch" data-tooltip="App toast">
                          <input type="checkbox" checked={r.toast}
                            onChange={e => patchRule(r.id, { toast: e.target.checked })} />
                          Toast
                        </label>
                        <label className="alert-ch" data-tooltip="Desktop popup (when window unfocused)">
                          <input type="checkbox" checked={r.desktop}
                            onChange={e => patchRule(r.id, { desktop: e.target.checked })} />
                          Popup
                        </label>
                        <label className="alert-ch" data-tooltip="Sound">
                          <input type="checkbox" checked={r.sound}
                            onChange={e => patchRule(r.id, { sound: e.target.checked })} />
                          Sound
                        </label>
                        <label className="alert-ch" data-tooltip="Speak the matched line aloud">
                          <input type="checkbox" checked={!!r.tts}
                            onChange={e => patchRule(r.id, { tts: e.target.checked })} />
                          Speak
                        </label>
                        <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
                          onClick={() => setNotifRules(list => list.filter(x => x.id !== r.id))}>×</button>
                      </div>
                    ))}
                  </div>
                  <div className="settings-hint">
                    Popups only show when the window isn't focused; Do Not Disturb silences
                    sound, popups, and speech. Alerts are shared across all characters.
                  </div>
                </div>
              </>
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
              <>
              <div className="settings-section">
                <div className="rule-header">
                  <span className="settings-section-label">Aliases</span>
                  <button className="login-btn-secondary rule-import-btn" onClick={importGenie}>Import…</button>
                </div>
                {importMsg && <div className="settings-hint rule-import-msg">{importMsg}</div>}
                <ClassToggleStrip names={distinctClasses(aliases)} states={classes} onToggle={toggleClass} />
                <div className="rule-list">
                  {aliases.length === 0 && (
                    <p className="hl-empty-msg">No aliases yet. Add one below.</p>
                  )}
                  {aliases.map(a => (
                    <div key={a.id} className={'rule-row' + (a.enabled ? '' : ' rule-row-off')}>
                      <input
                        type="checkbox"
                        checked={a.enabled}
                        title="Enabled"
                        onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, enabled: e.target.checked } : x))}
                      />
                      <input
                        className="settings-input settings-input-mono rule-key"
                        placeholder="kk"
                        value={a.pattern}
                        spellCheck={false}
                        onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, pattern: e.target.value } : x))}
                      />
                      <span className="rule-arrow">→</span>
                      <input
                        className="settings-input settings-input-mono"
                        placeholder="kill %1"
                        value={a.command}
                        spellCheck={false}
                        onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, command: e.target.value } : x))}
                      />
                      <input
                        className="settings-input settings-input-mono rule-class"
                        placeholder="class"
                        title="Class (optional) — toggle groups on/off"
                        value={a.class ?? ''}
                        spellCheck={false}
                        onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, class: e.target.value.trim() || undefined } : x))}
                      />
                      <button className="hl-btn-icon hl-btn-delete" title="Delete"
                        onClick={() => setAliases(list => list.filter(x => x.id !== a.id))}>×</button>
                    </div>
                  ))}
                  <button className="hl-add-btn"
                    onClick={() => setAliases(list => [...list, { id: uid(), pattern: '', command: '', enabled: true }])}>
                    + Add alias
                  </button>
                </div>
                <div className="settings-hint">
                  Type the alias as the first word of a command. Use <code>%1</code>…<code>%9</code> for the
                  words after it and <code>%0</code> for all of them (e.g. <code>kk</code> → <code>kill %1</code>).
                  An alias may expand to a script (<code>.hunt %1</code>).
                </div>
              </div>

              <div className="settings-section">
                <div className="settings-section-label">Variables</div>
                <div className="rule-list">
                  {vars.length === 0 && (
                    <p className="hl-empty-msg">No variables yet. Add one below, or set them live with <code>#var name value</code>.</p>
                  )}
                  {vars.map((v, i) => (
                    <div key={i} className="rule-row">
                      <span className="rule-arrow">%</span>
                      <input
                        className="settings-input settings-input-mono rule-key"
                        placeholder="target"
                        value={v.name}
                        spellCheck={false}
                        onChange={e => setVars(list => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
                      />
                      <span className="rule-arrow">=</span>
                      <input
                        className="settings-input settings-input-mono"
                        placeholder="orc"
                        value={v.value}
                        spellCheck={false}
                        onChange={e => setVars(list => list.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
                      />
                      <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
                        onClick={() => setVars(list => list.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                  <button className="hl-add-btn"
                    onClick={() => setVars(list => [...list, { name: '', value: '' }])}>
                    + Add variable
                  </button>
                </div>
                <div className="settings-hint">
                  Reference a variable as <code>%name</code> in any command, alias, or trigger
                  (e.g. <code>attack %target</code>). Set them live with <code>#var target orc</code>,
                  view with <code>#var</code>, remove with <code>#unvar target</code>.
                </div>
              </div>
              </>
            )}

            {tab === 'triggers' && (
              <div className="settings-section">
                <div className="rule-header">
                  <span className="settings-section-label">Triggers</span>
                  <button className="login-btn-secondary rule-import-btn" onClick={importGenie}>Import…</button>
                </div>
                {importMsg && <div className="settings-hint rule-import-msg">{importMsg}</div>}
                <ClassToggleStrip names={distinctClasses(triggers)} states={classes} onToggle={toggleClass} />
                <div className="rule-list">
                  {triggers.length === 0 && (
                    <p className="hl-empty-msg">No triggers yet. Add one below.</p>
                  )}
                  {triggers.map(t => (
                    <div key={t.id} className={'rule-row' + (t.enabled ? '' : ' rule-row-off')}>
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        title="Enabled"
                        onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, enabled: e.target.checked } : x))}
                      />
                      <input
                        className="settings-input settings-input-mono"
                        placeholder={t.isRegex ? 'stunned (.+)' : 'text to match'}
                        value={t.pattern}
                        spellCheck={false}
                        onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, pattern: e.target.value } : x))}
                      />
                      <label className="rule-regex" title="Regular expression">
                        <input
                          type="checkbox"
                          checked={t.isRegex}
                          onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, isRegex: e.target.checked } : x))}
                        />
                        .*
                      </label>
                      <span className="rule-arrow">→</span>
                      <input
                        className="settings-input settings-input-mono"
                        placeholder="stand"
                        value={t.command}
                        spellCheck={false}
                        onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, command: e.target.value } : x))}
                      />
                      <input
                        className="settings-input settings-input-mono rule-class"
                        placeholder="class"
                        title="Class (optional) — toggle groups on/off"
                        value={t.class ?? ''}
                        spellCheck={false}
                        onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, class: e.target.value.trim() || undefined } : x))}
                      />
                      <button className="hl-btn-icon hl-btn-delete" title="Delete"
                        onClick={() => setTriggers(list => list.filter(x => x.id !== t.id))}>×</button>
                    </div>
                  ))}
                  <button className="hl-add-btn"
                    onClick={() => setTriggers(list => [...list, { id: uid(), pattern: '', isRegex: false, command: '', enabled: true }])}>
                    + Add trigger
                  </button>
                </div>
                <div className="settings-hint">
                  When a line of game text matches, the command fires automatically. Enable
                  <code> .*</code> for a regular expression; then <code>%0</code> is the whole match and
                  <code> %1</code>…<code>%9</code> are capture groups. A trigger may also run a script (<code>.foo</code>).
                  Tag rules with a <b>class</b> to toggle whole groups on/off — from the pills above,
                  or in-game with <code>#class name on|off</code>.
                </div>
              </div>
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
