import { useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { weatherAtom, roomAmbienceAtom, connectionStatusAtom } from '../store/game'
import { AmbientAudio, DEFAULT_AMBIENT_AUDIO, type AmbientAudioConfig } from '../lib/ambientAudio'
import { ambientLevels } from '../lib/ambientMix'

/**
 * Drives the procedural ambient sound bed from live game state — rain while it
 * rains, a fire in a forge, bubbles underwater.
 *
 * The audio counterpart of AmbientOverlay, and deliberately shaped the same way:
 * one hook mounted once, reading the same atoms the visuals read, so what you hear
 * and what you see can never disagree. Settings are re-read on the `settings:saved`
 * event, matching AmbientOverlay's useAmbientToggles.
 *
 * The engine is built lazily and torn down whenever it has nothing to do, so a
 * player with sound off never opens an AudioContext at all.
 */

interface SoundSettings extends AmbientAudioConfig {
  /** Go quiet when the window is hidden — matters most on a phone, where the tab
   *  stays alive in the background and would otherwise keep raining in a pocket. */
  pauseHidden: boolean
}

const DEFAULTS: SoundSettings = { ...DEFAULT_AMBIENT_AUDIO, pauseHidden: true }

function useSoundSettings(): SoundSettings {
  const [s, setS] = useState<SoundSettings>(DEFAULTS)
  useEffect(() => {
    const load = (): void => {
      void window.dr.settings.getAll().then(all => {
        const layers = all.ambientSoundLayers ?? {}
        setS({
          // Undefined means on, as with every other ambient layer.
          master: all.ambientSound === false ? 0
                : typeof all.ambientSoundVolume === 'number' ? clamp01(all.ambientSoundVolume)
                : DEFAULTS.master,
          enabled: {
            rain:  layers.rain  !== false,
            wind:  layers.wind  !== false,
            fire:  layers.fire  !== false,
            water: layers.water !== false,
          },
          pauseHidden: all.ambientSoundPauseHidden !== false,
        })
      })
    }
    load()
    window.addEventListener('settings:saved', load)
    return () => window.removeEventListener('settings:saved', load)
  }, [])
  return s
}

function clamp01(n: number): number {
  return n > 1 ? 1 : n < 0 || !Number.isFinite(n) ? 0 : n
}

export function useAmbientAudio(): void {
  const weather  = useAtomValue(weatherAtom)
  const ambience = useAtomValue(roomAmbienceAtom)
  const status   = useAtomValue(connectionStatusAtom)
  const settings = useSoundSettings()

  const engine = useRef<AmbientAudio | null>(null)
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)

  useEffect(() => {
    const onVis = (): void => setHidden(document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Tear the audio device down on unmount rather than leaving a context running
  // behind a closed game view.
  useEffect(() => () => { engine.current?.dispose(); engine.current = null }, [])

  useEffect(() => {
    const silent = settings.master <= 0 || (settings.pauseHidden && hidden)
    const levels = ambientLevels({
      weather,
      ambience,
      active: status === 'connected' && !silent,
    })
    const wanted = Object.values(levels).some(v => v > 0)

    // Never open a context just to be told everything is zero — that would mean a
    // player who turned sound off still pays for an audio device.
    if (!engine.current && !wanted) return
    if (!engine.current) engine.current = new AmbientAudio()
    engine.current.setConfig({ master: silent ? 0 : settings.master, enabled: settings.enabled })
    engine.current.setLevels(levels)
  }, [weather, ambience, status, settings, hidden])
}
