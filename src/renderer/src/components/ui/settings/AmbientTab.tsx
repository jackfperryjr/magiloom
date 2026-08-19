import type { Dispatch, SetStateAction } from 'react'
import { SCENES } from '../../../lib/loginScene'

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

      {/* Ambient sound (lib/ambientAudio.ts). Synthesized, so there is nothing to
          download and intensity follows weather severity directly. Each layer is
          separately mutable because the one people want gone varies — rain is the
          usual culprit, since it sits in the same range as speech. */}
      <div className="settings-section">
        <div className="settings-section-label">Sound</div>
        <label className="settings-row">
          <span className="settings-label">Ambient sound</span>
          <input type="checkbox" checked={sound.on} style={{ width: 'auto' }}
            onChange={e => setSound(s => ({ ...s, on: e.target.checked }))} />
        </label>
        <div className="settings-hint">
          A quiet bed of sound under the game that follows what's happening around
          you — rain while it rains, a fire at a forge, bubbles underwater. Nothing
          is downloaded; it's generated as you play.
        </div>

        <label className="settings-row">
          <span className="settings-label">Volume</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="range" min={0} max={100} value={Math.round(sound.volume * 100)}
              disabled={!sound.on}
              onChange={e => setSound(s => ({ ...s, volume: Number(e.target.value) / 100 }))}
              style={{ width: 100 }}
            />
            <span style={{ fontSize: 11, color: 'var(--text-dim)', minWidth: 30 }}>
              {Math.round(sound.volume * 100)}%
            </span>
          </div>
        </label>

        {SOUND_LAYERS.map(l => (
          <div key={l.id}>
            <label className="settings-row">
              <span className="settings-label">{l.label}</span>
              <input type="checkbox" checked={sound.layers[l.id]} style={{ width: 'auto' }}
                disabled={!sound.on}
                onChange={e => setSound(s => ({ ...s, layers: { ...s.layers, [l.id]: e.target.checked } }))} />
            </label>
            <div className="settings-hint">{l.hint}</div>
          </div>
        ))}

        <label className="settings-row">
          <span className="settings-label">Silence in the background</span>
          <input type="checkbox" checked={sound.pauseHidden} style={{ width: 'auto' }}
            disabled={!sound.on}
            onChange={e => setSound(s => ({ ...s, pauseHidden: e.target.checked }))} />
        </label>
        <div className="settings-hint">
          Stops the sound while this window is hidden, so a session left open in a
          background tab doesn't keep raining at you.
        </div>
      </div>

      {/* Login art (lib/loginScenes.ts). Drawn, not downloaded, and picked from the
          real-world calendar — the login screen has no game session, so it can't
          know Elanthia's season. */}
      <div className="settings-section">
        <div className="settings-section-label">Login screen</div>
        <label className="settings-row">
          <span className="settings-label">Login art</span>
          <input type="checkbox" checked={loginArt.on} style={{ width: 'auto' }}
            onChange={e => setLoginArt(s => ({ ...s, on: e.target.checked }))} />
        </label>
        <div className="settings-hint">
          Animated scenes behind the sign-in card, chosen by the date and time of
          day. Nothing is downloaded; each one is drawn as you watch.
        </div>

        <label className="settings-row">
          <span className="settings-label">Scene</span>
          <select
            className="settings-input"
            value={loginArt.scene}
            disabled={!loginArt.on}
            onChange={e => setLoginArt(s => ({ ...s, scene: e.target.value }))}
          >
            <option value="calendar">Follow the calendar</option>
            {SCENES.map(s => <option key={s.key} value={s.key}>{s.name}</option>)}
          </select>
        </label>
        <div className="settings-hint">
          Pin one you like, or let the season, the holiday and the hour decide.
        </div>

        <label className="settings-row">
          <span className="settings-label">Holiday scenes</span>
          <input type="checkbox" checked={loginArt.holidays} style={{ width: 'auto' }}
            disabled={!loginArt.on || loginArt.scene !== 'calendar'}
            onChange={e => setLoginArt(s => ({ ...s, holidays: e.target.checked }))} />
        </label>
        <div className="settings-hint">
          Show Yule, Hallows, Harvest and the fireworks on the days they fall. Off
          means seasons only.
        </div>
      </div>
    </>
  )
}
