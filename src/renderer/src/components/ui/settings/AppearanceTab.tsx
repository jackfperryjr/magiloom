import type { Dispatch, SetStateAction } from 'react'
import { THEMES } from '../../../lib/themes'
import { SettingRow } from './Field'

// Settings → Appearance: theme picker, layout density, display (font).
// Game-output logging used to live here as a global toggle; it's per character now
// and moved to Settings → Lich → Logs, next to the log files themselves.
export function AppearanceTab({
  theme, previewTheme, density, setDensity, fontFamily, setFontFamily,
  fontSize, setFontSize,
}: {
  theme:               string
  previewTheme:        (id: string) => void
  density:             'cozy' | 'compact'
  setDensity:          Dispatch<SetStateAction<'cozy' | 'compact'>>
  fontFamily:          string
  setFontFamily:       Dispatch<SetStateAction<string>>
  fontSize:            number
  setFontSize:         Dispatch<SetStateAction<number>>
}) {
  return (
    <>
      {/* Wide: the swatch grid wants the full width to show more than two per row. */}
      <div className="settings-section settings-section-wide">
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
        <SettingRow label="Density" hint="How much breathing room panels and rows get.">
          <select
            className="settings-input"
            value={density}
            onChange={e => setDensity(e.target.value as 'cozy' | 'compact')}
          >
            <option value="cozy">Cozy</option>
            <option value="compact">Compact</option>
          </select>
        </SettingRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Display</div>
        <SettingRow label="Font family" hint="Used for game output and anything else monospaced.">
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
        </SettingRow>
        <SettingRow label="Font size">
          <input
            type="range" min={10} max={18} value={fontSize}
            aria-label="Font size"
            onChange={e => setFontSize(Number(e.target.value))}
            style={{ width: 120 }}
          />
          <span className="setting-readout">{fontSize}px</span>
        </SettingRow>
      </div>
    </>
  )
}
