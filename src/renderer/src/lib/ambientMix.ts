/**
 * Maps game state onto ambient-audio intensities.
 *
 * Split out of lib/ambientAudio.ts on purpose: the engine takes four numbers and
 * knows nothing about DragonRealms, and this knows about DragonRealms and makes no
 * sound. That keeps the mapping — the part with judgement calls in it — testable in
 * plain node, with no AudioContext anywhere near it.
 *
 * See lib/weather.ts for the weather state and lib/roomAmbient.ts for the room
 * ambience this reads.
 */

import type { WeatherState } from './weather'
import type { RoomAmbience } from './roomAmbient'
import { SILENT, type AmbientLevels } from './ambientAudio'

export interface AmbientMixInput {
  weather:  WeatherState | null
  ambience: RoomAmbience | null
  /** False while disconnected / on the login screen — everything goes quiet. */
  active:   boolean
}

/**
 * Weather severity is 0-9 (lib/weatherTable.ts). Map it so the lightest weather
 * that registers at all is still clearly audible — a drizzle at 0.05 is
 * indistinguishable from silence on laptop speakers, which reads as the feature
 * being broken rather than as light rain.
 */
function fromSeverity(severity: number, floor: number, ceiling: number): number {
  if (severity <= 0) return 0
  const t = Math.min(1, Math.max(0, severity / 9))
  return floor + (ceiling - floor) * t
}

export function ambientLevels({ weather, ambience, active }: AmbientMixInput): AmbientLevels {
  if (!active) return { ...SILENT }

  const out: AmbientLevels = { ...SILENT }

  // ── Room ambience ──────────────────────────────────────────────────────────
  // A room's own character is always at full strength: unlike weather it has no
  // intensity scale, and a forge you can barely hear is worse than no forge.
  if (ambience === 'embers')     out.fire  = 1
  if (ambience === 'underwater') out.water = 1

  // Underwater, the sky is not what you can hear. Suppressing weather here also
  // covers the case where the last weather report is still standing from before
  // the character went under.
  if (ambience === 'underwater') return out

  // ── Weather ────────────────────────────────────────────────────────────────
  if (weather && weather.kind !== 'clear') {
    const sev = weather.severity
    if (weather.kind === 'rain') {
      out.rain = fromSeverity(sev, 0.28, 1)
      // A real storm has wind in it. Below a squall it's just rain, so this only
      // opens up at the top of the scale.
      if (sev >= 6) out.wind = Math.max(out.wind, fromSeverity(sev - 5, 0.15, 0.6))
    } else if (weather.kind === 'snow') {
      // Snow is nearly silent — what you hear is the wind carrying it.
      out.wind = fromSeverity(sev, 0.14, 0.55)
    } else if (weather.kind === 'dust') {
      // Muspar'i sandstorms are the loudest wind in the game.
      out.wind = fromSeverity(sev, 0.3, 1)
    }
  }

  return out
}
