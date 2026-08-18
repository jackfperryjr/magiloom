import type { Dispatch, SetStateAction } from 'react'
import { THEMES } from '../../../lib/themes'

// Settings → Appearance: theme picker, layout density, display (font/buffer).
// Game-output logging used to live here as a global toggle; it's per character now
// and moved to Settings → Lich → Logs, next to the log files themselves.
export function AppearanceTab({
  theme, previewTheme, density, setDensity, fontFamily, setFontFamily,
  fontSize, setFontSize, outputBufferSize, setOutputBufferSize,
  isWeb, keepScreenOn, setKeepScreenOn,
  ambientRoomTint, setAmbientRoomTint, ambientHeat, setAmbientHeat,
  ambientRoomEffects, setAmbientRoomEffects, ambientDeath, setAmbientDeath,
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
  isWeb:               boolean
  keepScreenOn:        boolean
  setKeepScreenOn:     Dispatch<SetStateAction<boolean>>
  ambientRoomTint:     boolean
  setAmbientRoomTint:  Dispatch<SetStateAction<boolean>>
  ambientHeat:            boolean
  setAmbientHeat:         Dispatch<SetStateAction<boolean>>
  ambientRoomEffects:     boolean
  setAmbientRoomEffects:  Dispatch<SetStateAction<boolean>>
  ambientDeath:           boolean
  setAmbientDeath:        Dispatch<SetStateAction<boolean>>
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
      </div>

      {/* Ambient visual layers painted over the game panel (AmbientOverlay). Both
          default on; independent of the always-on day/night + weather layers. */}
      <div className="settings-section">
        <div className="settings-section-label">Ambient</div>
        <label className="settings-row">
          <span className="settings-label">Room tint</span>
          <input type="checkbox" checked={ambientRoomTint} style={{ width: 'auto' }}
            onChange={e => setAmbientRoomTint(e.target.checked)} />
        </label>
        <div className="settings-hint">
          Tints the panel edges by locale — cool in caves, green in forests, warm in
          taverns — to give each room a sense of place.
        </div>
        <label className="settings-row">
          <span className="settings-label">Combat heat</span>
          <input type="checkbox" checked={ambientHeat} style={{ width: 'auto' }}
            onChange={e => setAmbientHeat(e.target.checked)} />
        </label>
        <div className="settings-hint">
          Flares a red glow around the panel during combat, flashing brighter when you
          take a hit, then fading as the fight settles.
        </div>
        <label className="settings-row">
          <span className="settings-label">Room effects</span>
          <input type="checkbox" checked={ambientRoomEffects} style={{ width: 'auto' }}
            onChange={e => setAmbientRoomEffects(e.target.checked)} />
        </label>
        <div className="settings-hint">
          Drifts embers up the panel at a forge or a lava field, and bubbles when
          you're underwater. Only a handful of rooms in Elanthia have one.
        </div>
        <label className="settings-row">
          <span className="settings-label">Death</span>
          <input type="checkbox" checked={ambientDeath} style={{ width: 'auto' }}
            onChange={e => setAmbientDeath(e.target.checked)} />
        </label>
        <div className="settings-hint">
          Drains the colour out of the game panel while you're dead, and restores it
          when you're raised.
        </div>
      </div>

      {/* Keep-awake only applies to the PWA/browser; the desktop app manages power
          differently, so the toggle is web-only. See src/web/wakeLock.ts. */}
      {isWeb && (
        <div className="settings-section">
          <div className="settings-section-label">Mobile</div>
          <label className="settings-row">
            <span className="settings-label">Keep screen awake</span>
            <input type="checkbox" checked={keepScreenOn} style={{ width: 'auto' }}
              onChange={e => setKeepScreenOn(e.target.checked)} />
          </label>
          <div className="settings-hint">
            Holds the display on while connected to the game, so your phone or tablet
            won't dim or lock mid-session. Only active while a character is connected.
          </div>
        </div>
      )}
    </>
  )
}
