/**
 * Procedural ambient audio — rain, wind, fire and water synthesized in WebAudio.
 *
 * There are no sound files. Every layer is noise shaped by filters, plus scheduled
 * transients (fire crackles, water bubbles). That is not only an asset-size dodge:
 *   • **Intensity is continuous.** Weather arrives as a 0-9 severity, and a
 *     synthesized layer takes that straight as a gain/filter/density knob. Samples
 *     would need a recording per step plus crossfades between them.
 *   • **Loops are seamless by construction.** A looped recording of rain has a seam
 *     you start to hear within a minute; noise has no period to line up.
 *   • It works offline, ships no bytes, and there is nothing to license.
 *
 * The engine knows nothing about the game: it takes four intensities in 0..1 and a
 * config. Mapping game state onto those is hooks/useAmbientAudio.ts.
 *
 * Everything is built lazily — no AudioContext exists until something actually
 * wants to make a sound, so a player with ambient audio off pays nothing.
 */

export type AmbientSoundId = 'rain' | 'wind' | 'fire' | 'water'

export const AMBIENT_SOUND_IDS: AmbientSoundId[] = ['rain', 'wind', 'fire', 'water']

/** Target intensity per layer, 0 = silent, 1 = full. */
export type AmbientLevels = Record<AmbientSoundId, number>

export interface AmbientAudioConfig {
  /** Master volume 0..1. 0 stops the engine entirely. */
  master:  number
  /** Per-layer mute. A disabled layer is held at zero gain, not torn down. */
  enabled: Record<AmbientSoundId, boolean>
}

export const SILENT: AmbientLevels = { rain: 0, wind: 0, fire: 0, water: 0 }

export const DEFAULT_AMBIENT_AUDIO: AmbientAudioConfig = {
  master:  0.5,
  enabled: { rain: true, wind: true, fire: true, water: true },
}

// Per-layer ceiling at intensity 1 and master 1. These are deliberately low — this
// is a bed under the game, not a soundtrack, and rain in particular sits in the
// same frequency range as speech, so it masks a voice call at surprisingly low
// levels.
const CEILING: Record<AmbientSoundId, number> = { rain: 0.30, wind: 0.26, fire: 0.24, water: 0.20 }

// Weather changes should fade, not switch. Long enough that a severity step reads
// as the rain picking up rather than a jump.
const RAMP_S = 1.4

// One shared noise buffer, looped, feeding every layer's filter chain. Four seconds
// is long enough that the loop point is inaudible in noise.
const NOISE_SECONDS = 4

// How often the transient scheduler wakes to place crackles/bubbles, and how far
// ahead it schedules. Scheduling ahead of the audio clock is what keeps transients
// rhythmically clean when the main thread stutters.
const TICK_MS      = 120
const LOOKAHEAD_S  = 0.25

type Ctor = typeof AudioContext

function audioContextCtor(): Ctor | null {
  if (typeof window === 'undefined') return null
  return window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext
      ?? null
}

interface Layer {
  /** Layer output; everything in the layer sums into this before the master. */
  gain: GainNode
  /** Nodes whose params track intensity (filter sweeps and the like). */
  tune?: (intensity: number, at: number) => void
}

export class AmbientAudio {
  private ctx:    AudioContext | null = null
  private master: GainNode | null = null
  private noise:  AudioBuffer | null = null
  private source: AudioBufferSourceNode | null = null
  private layers = {} as Record<AmbientSoundId, Layer>

  private levels: AmbientLevels     = { ...SILENT }
  private config: AmbientAudioConfig = DEFAULT_AMBIENT_AUDIO

  private timer:     ReturnType<typeof setInterval> | null = null
  private nextFire  = 0    // audio-clock time the next crackle is due
  private nextDrop  = 0    // ...and the next bubble
  private gestureUnbind: (() => void) | null = null

  // ── Public API ─────────────────────────────────────────────────────────────

  setConfig(config: AmbientAudioConfig): void {
    this.config = config
    if (config.master <= 0) { this.suspend(); return }
    this.apply()
  }

  setLevels(levels: AmbientLevels): void {
    this.levels = levels
    this.apply()
  }

  /** Release the audio device. Safe to call repeatedly; setLevels rebuilds. */
  dispose(): void {
    this.stopTimer()
    this.gestureUnbind?.(); this.gestureUnbind = null
    try { this.source?.stop() } catch { /* already stopped */ }
    this.source = null
    this.layers = {} as Record<AmbientSoundId, Layer>
    this.master = null
    const ctx = this.ctx
    this.ctx = null
    void ctx?.close().catch(() => { /* closing a dead context is fine */ })
  }

  // ── Engine ─────────────────────────────────────────────────────────────────

  /** Every wanted layer exists, gains match the targets, the timer matches need. */
  private apply(): void {
    const wanted = AMBIENT_SOUND_IDS.filter(id => this.target(id) > 0)
    // Nothing wants to play and nothing is built yet — stay silent AND cheap.
    if (!wanted.length && !this.ctx) return

    const ctx = this.ensure()
    if (!ctx || !this.master) return

    const at = ctx.currentTime
    for (const id of AMBIENT_SOUND_IDS) {
      const target = this.target(id)
      // Only build a layer once it is actually asked for; a layer already built
      // stays built and simply rides down to zero, so weather can come and go
      // without re-allocating the graph.
      if (target <= 0 && !this.layers[id]) continue
      const layer = this.layers[id] ?? (this.layers[id] = this.build(id, ctx))
      ramp(layer.gain.gain, target, at)
      layer.tune?.(this.levels[id], at)
    }
    ramp(this.master.gain, 1, at)

    // The transient scheduler is only needed for the two layers that use it.
    if (this.target('fire') > 0 || this.target('water') > 0) this.startTimer()
    else this.stopTimer()

    if (ctx.state === 'suspended') void this.resume()
  }

  private target(id: AmbientSoundId): number {
    if (!this.config.enabled[id]) return 0
    const level = clamp01(this.levels[id])
    return level * CEILING[id] * clamp01(this.config.master)
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx
    const Ctor = audioContextCtor()
    if (!Ctor) return null
    try {
      const ctx = new Ctor()
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.gain.value = 0
      this.master.connect(ctx.destination)

      this.noise = whiteNoise(ctx, NOISE_SECONDS)
      const src = ctx.createBufferSource()
      src.buffer = this.noise
      src.loop = true
      src.start()
      this.source = src
      return ctx
    } catch {
      // No audio device, or the context limit is exhausted. Ambient sound is
      // decorative — never let it take the client down with it.
      this.ctx = null
      return null
    }
  }

  /**
   * Browsers refuse to start audio until the page has seen a user gesture. By the
   * time anyone is in-game they have clicked plenty, but a resumed web session can
   * reach this code before any click — so fall back to arming a one-shot listener
   * rather than silently failing.
   */
  private async resume(): Promise<void> {
    const ctx = this.ctx
    if (!ctx) return
    try {
      await ctx.resume()
      if (ctx.state === 'running') return
    } catch { /* fall through to the gesture path */ }
    if (this.gestureUnbind) return
    const onGesture = (): void => { void this.ctx?.resume(); this.gestureUnbind?.(); this.gestureUnbind = null }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown']
    events.forEach(e => window.addEventListener(e, onGesture, { once: true }))
    this.gestureUnbind = () => events.forEach(e => window.removeEventListener(e, onGesture))
  }

  private suspend(): void {
    if (!this.ctx || !this.master) return
    ramp(this.master.gain, 0, this.ctx.currentTime)
    this.stopTimer()
  }

  // ── Layers ─────────────────────────────────────────────────────────────────

  private build(id: AmbientSoundId, ctx: AudioContext): Layer {
    const gain = ctx.createGain()
    gain.gain.value = 0
    gain.connect(this.master!)
    switch (id) {
      case 'rain':  return this.buildRain(ctx, gain)
      case 'wind':  return this.buildWind(ctx, gain)
      case 'fire':  return this.buildFire(ctx, gain)
      case 'water': return this.buildWater(ctx, gain)
    }
  }

  /**
   * Rain is three bands of the same noise: a low rumble, a mid body, and a high
   * sizzle that only really arrives in heavy rain. Sweeping the body filter up with
   * intensity is what turns drizzle into a downpour — a plain volume change just
   * sounds like the same drizzle, louder.
   */
  private buildRain(ctx: AudioContext, gain: GainNode): Layer {
    const low  = ctx.createBiquadFilter(); low.type = 'lowpass';  low.frequency.value = 420
    const body = ctx.createBiquadFilter(); body.type = 'bandpass'; body.frequency.value = 1100; body.Q.value = 0.5
    const hiss = ctx.createBiquadFilter(); hiss.type = 'highpass'; hiss.frequency.value = 3800

    const gLow  = ctx.createGain(); gLow.gain.value  = 0.55
    const gBody = ctx.createGain(); gBody.gain.value = 1
    const gHiss = ctx.createGain(); gHiss.gain.value = 0

    this.source!.connect(low);  low.connect(gLow);   gLow.connect(gain)
    this.source!.connect(body); body.connect(gBody); gBody.connect(gain)
    this.source!.connect(hiss); hiss.connect(gHiss); gHiss.connect(gain)

    return {
      gain,
      tune: (i, at) => {
        ramp(body.frequency, 700 + i * 1500, at)
        // Squared, so sizzle is a heavy-rain characteristic rather than a constant.
        ramp(gHiss.gain, i * i * 0.5, at)
        ramp(gLow.gain, 0.35 + i * 0.4, at)
      },
    }
  }

  /**
   * Wind (snowfall, and the Muspar'i dust storms) is lowpassed noise with a slow
   * LFO on both cutoff and gain. The gusting is the whole effect — steady filtered
   * noise reads as hiss, not weather.
   */
  private buildWind(ctx: AudioContext, gain: GainNode): Layer {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 4
    const body = ctx.createGain(); body.gain.value = 1

    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.07
    const lfoFreq = ctx.createGain(); lfoFreq.gain.value = 260   // cutoff sweep depth (Hz)
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.35  // gust depth
    lfo.connect(lfoFreq); lfoFreq.connect(lp.frequency)
    lfo.connect(lfoGain); lfoGain.connect(body.gain)
    lfo.start()

    // A second, slower LFO so gusts don't arrive on an audible metronome.
    const slow = ctx.createOscillator(); slow.type = 'sine'; slow.frequency.value = 0.023
    const slowDepth = ctx.createGain(); slowDepth.gain.value = 150
    slow.connect(slowDepth); slowDepth.connect(lp.frequency)
    slow.start()

    this.source!.connect(lp); lp.connect(body); body.connect(gain)

    return {
      gain,
      tune: (i, at) => {
        ramp(lp.frequency, 380 + i * 900, at)
        ramp(lfoFreq.gain, 180 + i * 320, at)
      },
    }
  }

  /**
   * The roar under a fire. Crackles alone read as static — it's the low, slowly
   * breathing body that makes the pops sound like burning wood rather than
   * interference. Two cascaded lowpasses give a steeper rolloff than one, keeping
   * it well below the game text's own frequency range.
   */
  private buildFire(ctx: AudioContext, gain: GainNode): Layer {
    const lp  = ctx.createBiquadFilter(); lp.type  = 'lowpass'; lp.frequency.value  = 340
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 340
    const body = ctx.createGain(); body.gain.value = 0.75

    // Slow swell, so the fire breathes instead of sitting at one level.
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.11
    const depth = ctx.createGain(); depth.gain.value = 0.22
    lfo.connect(depth); depth.connect(body.gain)
    lfo.start()

    this.source!.connect(lp); lp.connect(lp2); lp2.connect(body); body.connect(gain)
    return { gain, tune: (i, at) => { ramp(lp.frequency, 240 + i * 220, at) } }
  }

  /** Muffled low rumble; the bubbles on top are scheduled transients. */
  private buildWater(ctx: AudioContext, gain: GainNode): Layer {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 260
    const body = ctx.createGain(); body.gain.value = 0.9
    this.source!.connect(lp); lp.connect(lp2); lp2.connect(body); body.connect(gain)
    return { gain, tune: (i, at) => { ramp(lp.frequency, 180 + i * 220, at) } }
  }

  // ── Transients ─────────────────────────────────────────────────────────────

  private startTimer(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.schedule(), TICK_MS)
  }

  private stopTimer(): void {
    if (this.timer === null) return
    clearInterval(this.timer); this.timer = null
  }

  /**
   * Place crackles and bubbles slightly ahead of the audio clock. Both use a
   * randomised gap rather than a fixed rate so they never fall into a pattern —
   * evenly-spaced pops read as a machine, not a fire.
   */
  private schedule(): void {
    const ctx = this.ctx
    if (!ctx) return
    const until = ctx.currentTime + LOOKAHEAD_S

    const fire = this.levels.fire
    if (this.config.enabled.fire && fire > 0 && this.layers.fire) {
      if (this.nextFire < ctx.currentTime) this.nextFire = ctx.currentTime
      while (this.nextFire < until) {
        this.crackle(this.nextFire, fire)
        this.nextFire += 0.035 + Math.random() * (0.5 - 0.36 * fire)
      }
    }

    const water = this.levels.water
    if (this.config.enabled.water && water > 0 && this.layers.water) {
      if (this.nextDrop < ctx.currentTime) this.nextDrop = ctx.currentTime
      while (this.nextDrop < until) {
        this.bubble(this.nextDrop, water)
        this.nextDrop += 0.12 + Math.random() * (1.5 - 0.9 * water)
      }
    }
  }

  /** A short filtered noise burst — the pop of a spitting ember. */
  private crackle(at: number, intensity: number): void {
    const ctx = this.ctx, out = this.layers.fire?.gain
    if (!ctx || !out || !this.noise) return
    const dur = 0.008 + Math.random() * 0.045
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 700 + Math.random() * 2800
    bp.Q.value = 2 + Math.random() * 7
    const g = ctx.createGain()
    const peak = (0.10 + Math.random() * 0.55) * intensity
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.003)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    src.connect(bp); bp.connect(g); g.connect(out)
    src.start(at, Math.random() * (NOISE_SECONDS - 0.1))
    src.stop(at + dur + 0.02)
  }

  /** A rising sine blip — the classic bubble. Small bubbles rise faster. */
  private bubble(at: number, intensity: number): void {
    const ctx = this.ctx, out = this.layers.water?.gain
    if (!ctx || !out) return
    const dur = 0.05 + Math.random() * 0.13
    const f0  = 140 + Math.random() * 420
    const osc = ctx.createOscillator(); osc.type = 'sine'
    osc.frequency.setValueAtTime(f0, at)
    osc.frequency.exponentialRampToValueAtTime(f0 * (1.8 + Math.random() * 1.6), at + dur)
    const g = ctx.createGain()
    const peak = (0.05 + Math.random() * 0.16) * intensity
    g.gain.setValueAtTime(0.0001, at)
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + 0.012)
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
    osc.connect(g); g.connect(out)
    osc.start(at); osc.stop(at + dur + 0.02)
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(n: number): number {
  return n > 1 ? 1 : n < 0 || !Number.isFinite(n) ? 0 : n
}

/**
 * Ramp a param without clicks. `setTargetAtTime` would be smoother still, but it
 * never actually reaches the target, which matters when the target is zero and the
 * layer is meant to go properly silent.
 */
function ramp(param: AudioParam, to: number, at: number): void {
  try {
    param.cancelScheduledValues(at)
    param.setValueAtTime(param.value, at)
    param.linearRampToValueAtTime(to, at + RAMP_S)
  } catch { /* a detached param — the layer is gone */ }
}

function whiteNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  return buf
}
