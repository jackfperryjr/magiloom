import type { Dispatch, SetStateAction } from 'react'
import { THEMES } from '../../../lib/themes'

// Settings → Appearance: theme picker, layout density, display (font/buffer/logging).
export function AppearanceTab({
  theme, previewTheme, density, setDensity, fontFamily, setFontFamily,
  fontSize, setFontSize, outputBufferSize, setOutputBufferSize, logging, setLogging,
}: {
  theme:               string
  previewTheme:        (id: string) => void
  density:             'cozy' | 'compact'
  setDensity:          Dispatch<SetStateAction<'cozy' | 'compact'>>
  fontFamily:          string
  setFontFamily:       Dispatch<SetStateAction<string>>
  fontSize:            number
  setFontSize:         Dispatch<SetStateAction<number>>
  outputBufferSize:    number
  setOutputBufferSize: Dispatch<SetStateAction<number>>
  logging:             boolean
  setLogging:          Dispatch<SetStateAction<boolean>>
}) {
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-label">Theme</div>
        <div className="theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              data-theme-id={t.id}
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
  )
}
