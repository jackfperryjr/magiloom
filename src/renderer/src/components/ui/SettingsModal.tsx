import { useState, useEffect } from 'react'
import { THEMES } from '../../lib/themes'
import { setShowTimestamps, setOutputBuffer } from '../game/GameOutput'
import { DEFAULT_NOTIF, type NotifSettings } from './Notifications'

interface SettingsModalProps {
  onClose: () => void
}

type TabId = 'appearance' | 'display' | 'notifications' | 'keybinds' | 'lich'

const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance',    label: 'Appearance' },
  { id: 'display',       label: 'Display' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'keybinds',      label: 'Function Keys' },
  { id: 'lich',          label: 'Lich' },
]

export function SettingsModal({ onClose }: SettingsModalProps) {
  const [lichPath,        setLichPath]        = useState('')
  const [fontSize,        setFontSize]        = useState(13)
  const [fontFamily,      setFontFamily]      = useState('Cascadia Code')
  const [theme,           setTheme]           = useState('meridian')
  const [timestamps,      setTimestamps]      = useState(false)
  const [density,         setDensity]         = useState<'cozy' | 'compact'>('cozy')
  const [outputBufferSize, setOutputBufferSize] = useState(5000)
  const [functionKeys,    setFunctionKeys]    = useState<Record<string, string>>({})
  const [notif,           setNotif]           = useState<NotifSettings>(DEFAULT_NOTIF)
  const [version,         setVersion]         = useState('')
  const [tab,             setTab]             = useState<TabId>('appearance')

  const FK_KEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']

  const setFk = (key: string, cmd: string) =>
    setFunctionKeys(prev => ({ ...prev, [key]: cmd }))

  useEffect(() => {
    window.dr.app.getVersion().then(setVersion)
    window.dr.settings.getAll().then(s => {
      setLichPath(s.lichPath || '')
      setFontSize(s.fontSize || 13)
      setFontFamily(s.fontFamily || 'Cascadia Code')
      setTheme(s.theme || 'meridian')
      setTimestamps(s.timestamps || false)
      setDensity(s.density === 'compact' ? 'compact' : 'cozy')
      setOutputBufferSize(s.outputBufferSize || 5000)
      setFunctionKeys(s.functionKeys || {})
      setNotif({ ...DEFAULT_NOTIF, ...(s.notifications ?? {}) })
    })
  }, [])

  const handleSave = async () => {
    await window.dr.settings.patch({
      lichPath, fontSize, fontFamily, theme, timestamps, density, outputBufferSize, functionKeys,
      notifications: notif,
    })
    window.dispatchEvent(new CustomEvent('settings:saved'))
    const { applyTheme } = await import('../../lib/themes')
    applyTheme(theme)
    document.documentElement.style.setProperty('--font-game', fontFamily)
    document.documentElement.style.setProperty('--font-size-game', fontSize + 'px')
    document.documentElement.dataset.density = density
    setShowTimestamps(timestamps)
    setOutputBuffer(outputBufferSize)
    onClose()
  }

  const versionLabel = !version || version === '0.0.0' ? 'dev' : `v${version}`

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-card settings-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Settings</span>
          <button className="modal-close" onClick={onClose}>×</button>
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
                        onClick={() => setTheme(t.id)}
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
              </>
            )}

            {tab === 'display' && (
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
                  <span className="settings-label">Timestamps</span>
                  <input
                    type="checkbox"
                    checked={timestamps}
                    onChange={e => setTimestamps(e.target.checked)}
                    style={{ width: 'auto' }}
                  />
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
              </div>
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

            {tab === 'lich' && (
              <div className="settings-section">
                <div className="settings-section-label">Lich</div>
                <label className="settings-row">
                  <span className="settings-label">Lich path</span>
                  <input
                    className="settings-input settings-input-mono"
                    type="text"
                    placeholder="C:\Ruby4Lich5\Lich5\lich.rbw"
                    value={lichPath}
                    onChange={e => setLichPath(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <span className="settings-version">{versionLabel}</span>
          <button className="login-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="login-btn" style={{ minWidth: 80 }} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
