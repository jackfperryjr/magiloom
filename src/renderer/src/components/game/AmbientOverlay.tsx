import { memo, useMemo, useState, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { skyAtom, weatherAtom } from '../../store/game'
import type { SkyState } from '../../lib/elanthianTime'
import { weatherLabel, type WeatherState } from '../../lib/weather'

// Subtle immersive weather + day/night layer painted over the game panel.
// Purely decorative (pointer-events: none). It renders ONLY .ambient-* elements
// as absolutely-positioned children of .game-output-wrap — it deliberately does
// NOT restyle .game-output (the scroll container). Split into three independently
// subscribing pieces so the per-second sky tick never re-renders the animated
// particle field. See lib/weather.ts / lib/elanthianTime.ts.

// ── Particle field (rain / snow) ────────────────────────────────────────────────
// Density, fall speed and slant scale with intensity. Kept modest for perf; the
// list is memoized on kind+level so it's only rebuilt when the weather changes.
const COUNT = { rain: [0, 26, 48, 72, 108], snow: [0, 18, 34, 55, 90] }
const DUR   = { rain: [0, 1.1, 0.9, 0.72, 0.55], snow: [0, 10, 8, 6.5, 5] }     // seconds to cross
const ANGLE = { rain: [0, 5, 9, 15, 22] }                                       // rain: whole-field slant (deg)
const DRIFT = { snow: [0, 10, 13, 16, 19] }                                     // snow: max per-flake sideways drift (vh)
const LEN   = { rain: [0, 9, 12, 15, 19] }                                      // streak length px
const SNOW_GLYPHS = ['❄', '❅', '❆']                                             // varied flake shapes
const FADE_MS = 1100                                                            // matches the CSS opacity transition

interface Particle { left: number; delay: number; dur: number; size: number; glyph?: string; spin?: number; drift?: number }

function buildParticles(kind: 'rain' | 'snow', level: number): Particle[] {
  const n = COUNT[kind][level] ?? 0
  const base = DUR[kind][level] ?? 1
  const snow = kind === 'snow'
  const maxDrift = DRIFT.snow[level] ?? 13
  const out: Particle[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      left: Math.random() * 100,
      delay: -Math.random() * base,                       // negative → mid-flight at mount
      dur: base * (0.75 + Math.random() * 0.5),
      // Snowflakes are glyphs sized by font-size (bigger, and bigger with intensity);
      // raindrops are thin streaks whose length grows with intensity.
      size: snow ? 7 + level * 1.5 + Math.random() * 7 : (LEN.rain[level] ?? 12) * (0.8 + Math.random() * 0.4),
      glyph: snow ? SNOW_GLYPHS[(Math.random() * SNOW_GLYPHS.length) | 0] : undefined,
      spin: snow ? 6 + Math.random() * 10 : undefined,    // seconds per slow wobble
      // Per-flake straight-line drift → each flake falls at its own slight angle,
      // mostly vertical. Symmetric so some lean left, some right, some fall straight.
      drift: snow ? (Math.random() - 0.5) * maxDrift : undefined,
    })
  }
  return out
}

// Renders the particle field, easing it in on appearance and out on clear. When
// the weather clears we keep the last field mounted (with `is-hidden` → opacity 0)
// for one transition, then unmount. `render` is the weather actually on screen.
const WeatherParticles = memo(function WeatherParticles() {
  const w = useAtomValue(weatherAtom)
  const [render, setRender] = useState<WeatherState | null>(w.kind === 'clear' ? null : w)
  const [hidden, setHidden] = useState(true)             // start hidden so the first paint fades in

  useEffect(() => {
    if (w.kind !== 'clear') {
      setRender(w)
      // Two frames so the browser paints the is-hidden (opacity 0) state before we
      // flip it, giving a real transition instead of an instant show.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setHidden(false)))
      return () => cancelAnimationFrame(id)
    }
    setHidden(true)                                       // fade out, then unmount
    const t = window.setTimeout(() => setRender(null), FADE_MS)
    return () => window.clearTimeout(t)
  }, [w])

  const particles = useMemo(
    () => (render ? buildParticles(render.kind as 'rain' | 'snow', render.level) : []),
    [render?.kind, render?.level],
  )
  if (!render) return null

  const kind = render.kind as 'rain' | 'snow'
  // Rain slants as a whole field (so the streaks tilt with the motion). Snow stays
  // upright and gets per-flake drift instead, so it falls mostly straight down.
  const rainAngle = kind === 'rain' ? (ANGLE.rain[render.level] ?? 0) : 0
  return (
    <div
      className={`ambient-weather ambient-${kind}${hidden ? ' is-hidden' : ''}`}
      style={rainAngle ? { transform: `rotate(${rainAngle}deg)` } : undefined}
      aria-hidden
    >
      {particles.map((p, i) => (
        <span
          key={i}
          className="ambient-particle"
          style={{
            left: `${p.left}%`,
            ['--fall' as string]: `${p.dur}s`,
            ['--delay' as string]: `${p.delay}s`,
            ...(p.glyph
              ? { ['--spin' as string]: `${p.spin}s`, ['--drift' as string]: `${p.drift}vh`, fontSize: `${p.size}px` }
              : { height: `${p.size}px` }),
          }}
        >
          {p.glyph}
        </span>
      ))}
    </div>
  )
})

// ── Day/night sky tint ──────────────────────────────────────────────────────────
// A subtle top-down gradient whose colour tracks the Elanthian daypart and goes
// overcast-grey while it's precipitating. Low-alpha so text contrast holds (it sits
// above the text as a faint veil, strongest at the top and fading out before the
// reading area — see .ambient-sky). Re-renders each second with the clock.
function skyColor(sky: SkyState, w: WeatherState): string {
  const d = sky.daylight
  const twilight = sky.phase === 'dawn' || sky.phase === 'dusk'
  let r: number, g: number, b: number, a: number
  // These alphas are the TOP of the gradient (it fades to transparent by ~60% down —
  // see .ambient-sky), so they read as a sky band up top while the reading area stays
  // clean. Pitched high enough to be visible even on low-contrast themes (near-black
  // bloodstone, light parchment, blue ff4), where a flat low-alpha wash disappeared.
  if (twilight) { r = 255; g = 150; b = 78;  a = 0.20 }
  else if (d <= 0) { r = 26; g = 28; b = 74; a = 0.30 }                 // night
  else { r = 255; g = 244; b = 214; a = 0.03 + (1 - d) * 0.08 }         // day → dusk edge
  if (w.kind !== 'clear') {
    const k = Math.min(1, 0.35 + w.level * 0.15)
    r = Math.round(r + (150 - r) * k); g = Math.round(g + (155 - g) * k); b = Math.round(b + (165 - b) * k)
    a = Math.max(a, 0.10 + w.level * 0.045)
  }
  return `rgba(${r},${g},${b},${a})`
}

function SkyTint() {
  const sky = useAtomValue(skyAtom)
  const w   = useAtomValue(weatherAtom)
  if (!sky && w.kind === 'clear') return null
  const bg = sky ? skyColor(sky, w) : `rgba(150,155,165,${0.06 + w.level * 0.025})`
  // The colour feeds a gradient (in .ambient-sky) via this custom property, which also
  // lets it ease smoothly between dayparts (see the @property registration there).
  return <div className="ambient-sky" style={{ ['--ambient-sky-color' as string]: bg }} aria-hidden />
}

// ── Corner label ────────────────────────────────────────────────────────────────
const PHASE_LABEL: Record<SkyState['phase'], string> = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' }
const SEASON_LABEL: Record<SkyState['season'], string> = { winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn' }

function AmbientLabel() {
  const sky = useAtomValue(skyAtom)
  const w   = useAtomValue(weatherAtom)
  const parts: string[] = []
  if (sky) parts.push(SEASON_LABEL[sky.season], PHASE_LABEL[sky.phase])
  if (w.kind !== 'clear') parts.push(weatherLabel(w))
  if (parts.length === 0) return null
  return <div className="ambient-label" aria-hidden>{parts.join(' · ')}</div>
}

export function AmbientOverlay() {
  // Everything lives inside .ambient-layer, an inset:0 overflow:hidden clip box, so
  // the oversized/rotated weather field can't give .game-output-wrap scrollable
  // overflow (which would let GameOutput's auto-scroll drag the output up — see
  // ambient.css). This is the single element the overlay adds to the wrap.
  return (
    <div className="ambient-layer" aria-hidden>
      <SkyTint />
      <WeatherParticles />
      <AmbientLabel />
    </div>
  )
}
