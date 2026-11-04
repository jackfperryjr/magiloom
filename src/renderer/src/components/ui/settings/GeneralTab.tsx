import type { Dispatch, SetStateAction } from 'react'
import { SCENES } from '../../../lib/loginScene'
import { SettingRow, Toggle } from './Field'

// Settings → General: behaviour that isn't about looks, sound, input or Lich.
// The home for anything that doesn't have an obvious tab of its own.

/** Animated art behind the sign-in card. See components/ui/LoginArt.tsx. */
export interface LoginArtPrefs {
  on:       boolean
  /** A scene key from lib/loginScene.ts, or 'calendar' to follow the date. */
  scene:    string
  holidays: boolean
}

export const DEFAULT_LOGIN_ART: LoginArtPrefs = { on: true, scene: 'calendar', holidays: true }

export function GeneralTab({
  isWeb, autoReconnect, setAutoReconnect, outputBufferSize, setOutputBufferSize,
  keepScreenOn, setKeepScreenOn, loginArt, setLoginArt,
}: {
  isWeb:               boolean
  autoReconnect:       boolean
  setAutoReconnect:    Dispatch<SetStateAction<boolean>>
  outputBufferSize:    number
  setOutputBufferSize: Dispatch<SetStateAction<number>>
  keepScreenOn:        boolean
  setKeepScreenOn:     Dispatch<SetStateAction<boolean>>
  loginArt:            LoginArtPrefs
  setLoginArt:         Dispatch<SetStateAction<LoginArtPrefs>>
}): React.JSX.Element {
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-label">Connection</div>
        <SettingRow
          label="Reconnect automatically"
          hint="When the connection drops unexpectedly, sign the character back in
                (up to three tries). Turn this off if a script disconnects you on
                purpose to get out of danger."
        >
          <Toggle checked={autoReconnect} onChange={setAutoReconnect} label="Reconnect automatically" />
        </SettingRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Game window</div>
        <SettingRow
          label="Output buffer"
          hint="How many lines of scrollback to keep. Larger uses more memory."
        >
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
        </SettingRow>
      </div>

      {/* Keep-awake only applies to the PWA/browser; the desktop app manages power
          differently, so the toggle is web-only. See src/web/wakeLock.ts. */}
      {isWeb && (
        <div className="settings-section">
          <div className="settings-section-label">Mobile</div>
          <SettingRow
            label="Keep screen awake"
            hint="Holds the display on while connected to the game, so your phone or tablet
                  won't dim or lock mid-session. Only active while a character is connected."
          >
            <Toggle checked={keepScreenOn} onChange={setKeepScreenOn} label="Keep screen awake" />
          </SettingRow>
        </div>
      )}

      {/* Login art (components/ui/LoginArt.tsx). Painted scenes, picked from the
          real-world calendar — the login screen has no game session, so it can't
          know Elanthia's season. */}
      <div className="settings-section">
        <div className="settings-section-label">Login screen</div>
        <SettingRow
          label="Login art"
          hint="A painted scene behind the sign-in card — one a day, picked by the season,
                the holiday and whether it's dark out. It won't change while you're
                looking at it, and it ships with the app rather than being fetched."
        >
          <Toggle checked={loginArt.on} onChange={v => setLoginArt(s => ({ ...s, on: v }))} label="Login art" />
        </SettingRow>

        <SettingRow
          label="Scene"
          hint="Pin one you like, or let the season, the holiday and the hour decide."
          disabled={!loginArt.on}
        >
          <select
            className="settings-input"
            value={loginArt.scene}
            aria-label="Login scene"
            disabled={!loginArt.on}
            onChange={e => setLoginArt(s => ({ ...s, scene: e.target.value }))}
          >
            <option value="calendar">Follow the calendar</option>
            {SCENES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </SettingRow>

        <SettingRow
          label="Holiday scenes"
          hint="Show Yule, Hallows, Harvest and the fireworks on the days they fall. Off
                means seasons only."
          disabled={!loginArt.on || loginArt.scene !== 'calendar'}
        >
          <Toggle
            checked={loginArt.holidays}
            disabled={!loginArt.on || loginArt.scene !== 'calendar'}
            label="Holiday scenes"
            onChange={v => setLoginArt(s => ({ ...s, holidays: v }))}
          />
        </SettingRow>
      </div>
    </>
  )
}
