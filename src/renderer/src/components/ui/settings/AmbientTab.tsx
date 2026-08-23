import type { Dispatch, SetStateAction } from 'react'
import { SCENES } from '../../../lib/loginScene'
import { SettingRow, Toggle } from './Field'

/**
 * Settings → Ambient: everything that makes the game panel feel like a place.
 *
 * Split out of the Appearance tab once these grew past a single section — the
 * visual layers (AmbientOverlay) and the procedural sound bed (lib/ambientAudio.ts)
 * are one idea and belong together, and Appearance is about type and theme.
 *
 * The day/night sky tint and the weather field are deliberately not toggleable:
 * they're the baseline everything else layers onto.
 */

/** Ambient sound preferences, kept as one object rather than eight loose props. */
export interface SoundPrefs {
  on:          boolean
  volume:      number     // 0..1
  layers:      { rain: boolean; wind: boolean; fire: boolean; water: boolean }
  pauseHidden: boolean
}

export const DEFAULT_SOUND: SoundPrefs = {
  on: true, volume: 0.5, pauseHidden: true,
  layers: { rain: true, wind: true, fire: true, water: true },
}

/** Animated art behind the sign-in card. See components/ui/LoginArt.tsx. */
export interface LoginArtPrefs {
  on:       boolean
  /** A scene key from lib/loginScene.ts, or 'calendar' to follow the date. */
  scene:    string
  holidays: boolean
}

export const DEFAULT_LOGIN_ART: LoginArtPrefs = { on: true, scene: 'calendar', holidays: true }

const SOUND_LAYERS: { id: keyof SoundPrefs['layers']; label: string; hint: string }[] = [
  { id: 'rain',  label: 'Rain',  hint: 'Rainfall, getting heavier as the storm does.' },
  { id: 'wind',  label: 'Wind',  hint: 'Gusts during snow, and the sandstorms out in the Muspar’i desert.' },
  { id: 'fire',  label: 'Fire',  hint: 'Crackling coals in a forge or beside a lava field.' },
  { id: 'water', label: 'Water', hint: 'Muffled water and rising bubbles while you’re underwater.' },
]

export function AmbientTab({
  ambientRoomTint, setAmbientRoomTint, ambientHeat, setAmbientHeat,
  ambientRoomEffects, setAmbientRoomEffects, ambientDeath, setAmbientDeath,
  sound, setSound, loginArt, setLoginArt,
}: {
  ambientRoomTint:        boolean
  setAmbientRoomTint:     Dispatch<SetStateAction<boolean>>
  ambientHeat:            boolean
  setAmbientHeat:         Dispatch<SetStateAction<boolean>>
  ambientRoomEffects:     boolean
  setAmbientRoomEffects:  Dispatch<SetStateAction<boolean>>
  ambientDeath:           boolean
  setAmbientDeath:        Dispatch<SetStateAction<boolean>>
  sound:                  SoundPrefs
  setSound:               Dispatch<SetStateAction<SoundPrefs>>
  loginArt:               LoginArtPrefs
  setLoginArt:            Dispatch<SetStateAction<LoginArtPrefs>>
}) {
  return (
    <>
      {/* Ambient visual layers painted over the game panel (AmbientOverlay). All
          default on; independent of the always-on day/night + weather layers. */}
      <div className="settings-section">
        <div className="settings-section-label">Visuals</div>
        <SettingRow
          label="Room tint"
          hint="Tints the panel edges by locale — cool in caves, green in forests, warm in
                taverns — to give each room a sense of place."
        >
          <Toggle checked={ambientRoomTint} onChange={setAmbientRoomTint} label="Room tint" />
        </SettingRow>
        <SettingRow
          label="Combat heat"
          hint="Flares a red glow around the panel during combat, flashing brighter when you
                take a hit, then fading as the fight settles."
        >
          <Toggle checked={ambientHeat} onChange={setAmbientHeat} label="Combat heat" />
        </SettingRow>
        <SettingRow
          label="Room effects"
          hint="Drifts embers up the panel at a forge or a lava field, and bubbles when
                you're underwater. Only a handful of rooms in Elanthia have one."
        >
          <Toggle checked={ambientRoomEffects} onChange={setAmbientRoomEffects} label="Room effects" />
        </SettingRow>
        <SettingRow
          label="Death"
          hint="Drains the colour out of the game panel while you're dead, and restores it
                when you're raised."
        >
          <Toggle checked={ambientDeath} onChange={setAmbientDeath} label="Death" />
        </SettingRow>
      </div>

      {/* Ambient sound (lib/ambientAudio.ts). Synthesized, so there is nothing to
          download and intensity follows weather severity directly. Each layer is
          separately mutable because the one people want gone varies — rain is the
          usual culprit, since it sits in the same range as speech. */}
      <div className="settings-section">
        <div className="settings-section-label">Sound</div>
        <SettingRow
          label="Ambient sound"
          hint="A quiet bed of sound under the game that follows what's happening around
                you — rain while it rains, a fire at a forge, bubbles underwater. Nothing
                is downloaded; it's generated as you play."
        >
          <Toggle checked={sound.on} onChange={v => setSound(s => ({ ...s, on: v }))} label="Ambient sound" />
        </SettingRow>

        <SettingRow label="Volume" disabled={!sound.on}>
          <input
            type="range" min={0} max={100} value={Math.round(sound.volume * 100)}
            aria-label="Ambient volume"
            disabled={!sound.on}
            onChange={e => setSound(s => ({ ...s, volume: Number(e.target.value) / 100 }))}
            style={{ width: 120 }}
          />
          <span className="setting-readout">{Math.round(sound.volume * 100)}%</span>
        </SettingRow>

        {SOUND_LAYERS.map(l => (
          <SettingRow key={l.id} label={l.label} hint={l.hint} disabled={!sound.on}>
            <Toggle
              checked={sound.layers[l.id]}
              disabled={!sound.on}
              label={l.label}
              onChange={v => setSound(s => ({ ...s, layers: { ...s.layers, [l.id]: v } }))}
            />
          </SettingRow>
        ))}

        <SettingRow
          label="Silence in the background"
          hint="Stops the sound while this window is hidden, so a session left open in a
                background tab doesn't keep raining at you."
          disabled={!sound.on}
        >
          <Toggle
            checked={sound.pauseHidden}
            disabled={!sound.on}
            label="Silence in the background"
            onChange={v => setSound(s => ({ ...s, pauseHidden: v }))}
          />
        </SettingRow>
      </div>

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
