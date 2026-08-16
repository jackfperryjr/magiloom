import { memo, useMemo, useState, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { skyAtom, weatherAtom, roomLocaleAtom, combatHeatAtom } from '../../store/game'
import type { SkyState } from '../../lib/elanthianTime'
import { weatherLabel, type WeatherState } from '../../lib/weather'
import { LOCALE_TINT } from '../../lib/roomLocale'

// Subtle immersive weather + day/night layer painted over the game panel.
// Purely decorative (pointer-events: none). It renders ONLY .ambient-* elements
// as absolutely-positioned children of .game-output-wrap — it deliberately does
// NOT restyle .game-output (the scroll container). Split into three independently
// subscribing pieces so the per-second sky tick never re-renders the animated
// particle field. See lib/weather.ts / lib/elanthianTime.ts.

// ── Particle field (rain / snow) ────────────────────────────────────────────────
// Density, fall speed and slant scale with intensity. Kept modest for perf; the
// list is memoized on kind+level so it's only rebuilt when the weather changes.
const COUNT = { rain: [0, 55, 85, 120, 160], snow: [0, 18, 34, 55, 90], dust: [0, 40, 70, 110, 150] }
const DUR   = { rain: [0, 1.1, 0.9, 0.72, 0.55], snow: [0, 10, 8, 6.5, 5], dust: [0, 1.4, 1.1, 0.85, 0.6] }
const ANGLE = { rain: [0, 5, 9, 15, 22], dust: [0, 38, 48, 58, 68] }             // whole-field slant (deg)
const DRIFT = { snow: [0, 10, 13, 16, 19] }                                     // snow: max per-flake sideways drift (vh)
const LEN   = { rain: [0, 14, 18, 23, 29], dust: [0, 9, 12, 16, 20] }           // streak length px (at mid depth)
const SNOW_GLYPHS = ['❄', '❅', '❆']                                             // varied flake shapes
const FADE_MS = 1100                                                            // matches the CSS opacity transition

interface Particle {
  left: number; delay: number; dur: number; size: number
  glyph?: string; spin?: number; drift?: number
  width?: number; alpha?: number                         // rain only — see `depth` below
}

function buildParticles(kind: 'rain' | 'snow' | 'dust', level: number): Particle[] {
  const n = COUNT[kind][level] ?? 0
  const base = DUR[kind][level] ?? 1
  const snow = kind === 'snow'
  // Blowing sand reuses the streak path (rain's geometry) with a far harder slant;
  // only snow takes the glyph path.
  const streakLen = kind === 'snow' ? 0 : (LEN[kind][level] ?? 12)
  const maxDrift = DRIFT.snow[level] ?? 13
  const out: Particle[] = []
  for (let i = 0; i < n; i++) {
    // Rain gets a per-drop DEPTH (0 far → 1 near). Near drops are thicker, longer,
    // brighter and fall faster; far ones stay faint and slow. A uniform field of
    // identical hairlines reads as noise and disappears into the text — the depth
    // spread gives a handful of drops enough weight to be legible while the rest
    // fill in the sense of a downpour.
    const depth = snow ? 0 : Math.random()
    out.push({
      left: Math.random() * 100,
      delay: -Math.random() * base,                       // negative → mid-flight at mount
      dur: snow ? base * (0.75 + Math.random() * 0.5)
                : base * (1.2 - depth * 0.45),            // nearer → faster
      // Snowflakes are glyphs sized by font-size (bigger, and bigger with intensity);
      // raindrops are streaks whose length grows with intensity and nearness.
      size: snow ? 7 + level * 1.5 + Math.random() * 7
                 : streakLen * (0.7 + depth * 0.7),
      glyph: snow ? SNOW_GLYPHS[(Math.random() * SNOW_GLYPHS.length) | 0] : undefined,
      spin: snow ? 6 + Math.random() * 10 : undefined,    // seconds per slow wobble
      // Per-flake straight-line drift → each flake falls at its own slight angle,
      // mostly vertical. Symmetric so some lean left, some right, some fall straight.
      drift: snow ? (Math.random() - 0.5) * maxDrift : undefined,
      width: snow ? undefined : 1.1 + depth * 1.7,        // px
      alpha: snow ? undefined : 0.45 + depth * 0.55,
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
    () => (render ? buildParticles(render.kind as 'rain' | 'snow' | 'dust', render.level) : []),
    [render?.kind, render?.level],
  )
  if (!render) return null

  const kind = render.kind as 'rain' | 'snow' | 'dust'
  // Rain slants as a whole field (so the streaks tilt with the motion). Snow stays
  // upright and gets per-flake drift instead, so it falls mostly straight down.
  const rainAngle = kind === 'snow' ? 0 : (ANGLE[kind][render.level] ?? 0)
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
              : { height: `${p.size}px`, width: `${p.width}px`, opacity: p.alpha }),
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
  const bg = skyColor(sky, w)
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
  const parts: string[] = [SEASON_LABEL[sky.season], PHASE_LABEL[sky.phase]]
  if (w.kind !== 'clear') parts.push(weatherLabel(w))
  return <div className="ambient-label" aria-hidden>{parts.join(' · ')}</div>
}

// ── Room-locale tint ─────────────────────────────────────────────────────────────
// A soft edge vignette in the current room's locale colour (cave blue, forest green,
// tavern amber, …). Painted UNDER the sky tint (lower z-index) so time-of-day still
// wins outdoors; sits behind the reading area only at the panel's edges. `default`
// locale → nothing. The colour rides a registered custom property so it eases when
// you walk between locales (see .ambient-room).
function RoomTint() {
  const locale = useAtomValue(roomLocaleAtom)
  const tint = locale === 'default' ? undefined : LOCALE_TINT[locale]
  // Keep the element mounted with a transparent colour when there's no tint, so the
  // ease-out still plays on stepping into an untinted room (rather than a hard cut).
  return (
    <div
      className="ambient-room"
      style={{ ['--ambient-room-color' as string]: tint ?? 'transparent' }}
      aria-hidden
    />
  )
}

// ── Combat heat ──────────────────────────────────────────────────────────────────
// A red edge vignette whose opacity tracks combatHeatAtom (0→1), painted ABOVE the
// other ambient layers so a fight's red rim reads over any locale tint. Pulses while
// hot.
//
// It EASES in and out rather than snapping, which needs care in both directions:
//   • In — mounting the element with its final opacity already applied gives the CSS
//     transition no start value, so it cuts. We mount at opacity 0 and ramp to the
//     target two frames later (same trick as WeatherParticles), staying fast so a
//     hit still reads as a flash.
//   • Out — combatHeatAtom floors out at 0 from ~0.02, and the opacity floor below
//     means the vignette is still at ~0.36 when it gets there. So we keep the last
//     level mounted, fade it to 0, and only then unmount.
// Opacity is inline (it's a continuous value), so the fade states have to be inline
// too — an .is-hidden class couldn't override it.
const HEAT_IN_MS   = 220    // hit flash: ramps in fast
const HEAT_OUT_MS  = 900    // decay + fade-out: slow enough that the 1 s heat tick
                            // eases continuously instead of stepping
function CombatHeat() {
  const heat = useAtomValue(combatHeatAtom)
  // `level` is what's painted — kept at the last non-zero heat through the fade-out.
  // `rising` records whether that change was a spike or the decay, so the duration
  // matches the direction; it's derived from the previous painted level (not a ref of
  // `heat`, which would already be updated by the time the element first mounts).
  const [{ level, rising }, setPaint] = useState({ level: 0, rising: true })
  const [hidden, setHidden] = useState(true)   // at opacity 0, for the fade in/out

  useEffect(() => {
    if (heat > 0) {
      setPaint(p => ({ level: heat, rising: heat > p.level }))
      // Two frames so the browser paints opacity 0 before we ramp — otherwise the
      // first paint is already at the target and there's nothing to animate.
      const id = requestAnimationFrame(() => requestAnimationFrame(() => setHidden(false)))
      return () => cancelAnimationFrame(id)
    }
    setHidden(true)                            // fade out, then unmount
    const t = window.setTimeout(() => setPaint({ level: 0, rising: true }), HEAT_OUT_MS)
    return () => window.clearTimeout(t)
  }, [heat])

  if (level <= 0) return null
  // Opacity from heat, floored high enough that the thin bright border stays clearly
  // legible whenever there's any combat heat, ramping to full on a hit's flash.
  const opacity = hidden ? 0 : Math.min(1, 0.35 + level * 0.65)
  return (
    <div
      className={'ambient-heat' + (!hidden && level > 0.55 ? ' is-hot' : '')}
      style={{ opacity, transitionDuration: `${hidden || !rising ? HEAT_OUT_MS : HEAT_IN_MS}ms` }}
      aria-hidden
    />
  )
}

// Read the two ambient visual toggles from global settings (default ON), re-reading
// on save. Mirrors the settings:saved live-reload pattern used elsewhere.
function useAmbientToggles() {
  const [t, setT] = useState({ room: true, heat: true })
  useEffect(() => {
    const load = () => window.dr.settings.getAll().then(s =>
      setT({ room: s.ambientRoomTint !== false, heat: s.ambientHeat !== false }))
    load()
    window.addEventListener('settings:saved', load)
    return () => window.removeEventListener('settings:saved', load)
  }, [])
  return t
}

export function AmbientOverlay() {
  // Everything lives inside .ambient-layer, an inset:0 overflow:hidden clip box, so
  // the oversized/rotated weather field can't give .game-output-wrap scrollable
  // overflow (which would let GameOutput's auto-scroll drag the output up — see
  // ambient.css). This is the single element the overlay adds to the wrap.
  const toggles = useAmbientToggles()
  return (
    <div className="ambient-layer" aria-hidden>
      {toggles.room && <RoomTint />}
      <SkyTint />
      <WeatherParticles />
      {toggles.heat && <CombatHeat />}
      <AmbientLabel />
    </div>
  )
}
