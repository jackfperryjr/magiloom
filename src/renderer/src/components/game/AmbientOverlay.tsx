import { memo, useMemo, useState, useEffect, useRef } from 'react'
import { useAtomValue } from 'jotai'
import { skyAtom, weatherAtom, roomLocaleAtom, roomAmbienceAtom, combatHeatAtom, indicatorsAtom } from '../../store/game'
import type { SkyState } from '../../lib/elanthianTime'
import { weatherLabel, type WeatherState } from '../../lib/weather'
import { LOCALE_TINT } from '../../lib/roomLocale'
import type { RoomAmbience } from '../../lib/roomAmbient'
import { useFadeMount, useDwell } from '../../hooks/useAmbient'

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

// Renders the particle field, easing it in on appearance and out on clear. When the
// weather clears the last field stays mounted (at opacity 0) for one transition and
// is then unmounted — see useFadeMount, which owns that dance for every layer here.
// `render` is the weather actually on screen.
//
// Weather deliberately does NOT dwell (see useDwell): it is an event, not a place,
// and a storm that takes five seconds to appear reads as a bug.
const WeatherParticles = memo(function WeatherParticles() {
  const w = useAtomValue(weatherAtom)
  const { shown: render, hidden } = useFadeMount(w.kind === 'clear' ? null : w, FADE_MS)

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

// ── Room ambience (embers / underwater) ─────────────────────────────────────────
// Motes that RISE rather than fall: forge sparks and bubbles share the same motion,
// differing only in speed, size and colour (see .ambient-embers / .ambient-bubbles).
// Both are room-driven, so unlike weather they wait out the dwell below.
//
// Sized well under the weather fields — these run in small interior rooms where a
// hundred particles would bury the text, and the effect wants to read as "there is a
// fire here", not as precipitation.
// Counts are set for how many are IN the panel at once, not how many exist: a mote
// travels most of a viewport height, so at any moment a good share of the field is
// off-panel. Rendering the first pass at 26 embers put about five on screen, which
// read as stray specks rather than as a fire.
const MOTES = {
  embers:  { count: 44, dur: 4.2, size: [1.6, 3.6], sway: 6 },
  bubbles: { count: 26, dur: 6.5, size: [2.5, 6.5], sway: 9 },
} as const

interface Mote { left: number; delay: number; dur: number; size: number; sway: number; alpha: number; hold: number }

function buildMotes(kind: 'embers' | 'bubbles'): Mote[] {
  const m = MOTES[kind]
  const out: Mote[] = []
  for (let i = 0; i < m.count; i++) {
    out.push({
      left:  Math.random() * 100,
      delay: -Math.random() * m.dur,                        // negative → mid-flight at mount
      dur:   m.dur * (0.7 + Math.random() * 0.6),
      size:  m.size[0] + Math.random() * (m.size[1] - m.size[0]),
      // Symmetric sideways drift over the climb, so the column wanders instead of
      // rising in parallel lines.
      sway:  (Math.random() - 0.5) * 2 * m.sway,
      alpha: 0.4 + Math.random() * 0.6,
      // Where this mote sits when reduced-motion holds the field still. Without a
      // per-mote value they would all stop at the same height and read as a line.
      hold:  Math.random() * 95,
    })
  }
  return out
}

// How long a room-driven effect must be the current room's before it's allowed on
// screen. These change on every step, and a corridor of rooms that classify
// differently would strobe. Baking the classification (see lib/roomAmbient) removed
// most of that, but a forge you merely walk THROUGH still shouldn't light the panel
// up for one step. Started at 5s and came down: with the flicker already fixed in
// the data, the dwell only has to outlast a single step, and 5s made walking TO a
// forge feel like the effect was broken.
const AMBIENCE_DWELL_MS = 3000
const AMBIENCE_FADE_MS  = 1400

const ROOM_EFFECT: Record<RoomAmbience, 'embers' | 'bubbles'> = {
  embers:     'embers',
  underwater: 'bubbles',
}

const RoomEffect = memo(function RoomEffect() {
  const live = useAtomValue(roomAmbienceAtom)
  const settled = useDwell(live, AMBIENCE_DWELL_MS)
  const { shown, hidden } = useFadeMount(settled, AMBIENCE_FADE_MS)
  const kind = shown ? ROOM_EFFECT[shown] : null
  const motes = useMemo(() => (kind ? buildMotes(kind) : []), [kind])
  if (!kind) return null

  return (
    <div className={`ambient-motes ambient-${kind}${hidden ? ' is-hidden' : ''}`} aria-hidden>
      {/* Underwater gets a caustic wash behind the bubbles — the bubbles alone read as
          a fizzy drink, the slow moving light is what makes it read as being under it. */}
      {kind === 'bubbles' && <div className="ambient-caustics" />}
      {motes.map((p, i) => (
        <span
          key={i}
          className="ambient-mote"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size}px`,
            opacity: p.alpha,
            ['--fall' as string]: `${p.dur}s`,
            ['--delay' as string]: `${p.delay}s`,
            ['--drift' as string]: `${p.sway}vw`,
            ['--rise-hold' as string]: `${p.hold}vh`,
          }}
        />
      ))}
    </div>
  )
})

// ── Fog / overcast ──────────────────────────────────────────────────────────────
// The one gap in the existing weather ladder. Severity 0–4 are SKY conditions and
// renderLevel() maps all of them to 0, so "it is completely overcast" and "a thick
// bank of grey clouds fills the sky from horizon to horizon" currently look exactly
// like a bright clear day. 3 and 4 are the two that describe a sky heavy enough to
// see, so they get a slow drifting haze — no particles, just two offset gradient
// bands crossing at different speeds.
//
// Only outdoors-ish weather drives this, and only when it is NOT already
// precipitating: rain and snow bring their own overcast look via skyColor below.
const FOG_FADE_MS = 2200

function FogLayer() {
  const w = useAtomValue(weatherAtom)
  const level = w.kind === 'clear' && w.severity >= 3 ? w.severity - 2 : null   // 1 | 2
  const { shown, hidden } = useFadeMount(level, FOG_FADE_MS)
  if (shown === null) return null
  return (
    <div
      className={`ambient-fog${hidden ? ' is-hidden' : ''}`}
      style={{ ['--fog-strength' as string]: shown === 2 ? '1' : '.55' }}
      aria-hidden
    />
  )
}

// ── Death ───────────────────────────────────────────────────────────────────────
// Being dead drains the colour out of the panel. `backdrop-filter` is what makes this
// work: the wash sits ABOVE the text and desaturates what shows through it, which no
// amount of tinting from an overlay could do (a translucent grey veil dims text but
// leaves it coloured). Where backdrop-filter is unavailable the CSS falls back to a
// flat grey veil — see .ambient-death.
//
// Death does not dwell. It is the one transition that has to land the instant it
// happens.
const DEATH_FADE_MS = 1200

function DeathWash() {
  const indicators = useAtomValue(indicatorsAtom)
  const { shown, hidden } = useFadeMount(indicators.dead ? true : null, DEATH_FADE_MS)
  if (!shown) return null
  return <div className={`ambient-death${hidden ? ' is-hidden' : ''}`} aria-hidden />
}

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
  const { shown, hidden } = useFadeMount(heat > 0 ? heat : null, HEAT_OUT_MS)
  const level = shown ?? 0
  // Whether the last change was a spike or the decay, so the transition duration can
  // match the direction. Tracked against the previously PAINTED level rather than a
  // ref of `heat`, which would already be updated by the time the element mounts.
  const prev = useRef(0)
  const rising = level > prev.current
  prev.current = level

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

// Read the ambient visual toggles from global settings (default ON), re-reading on
// save. Mirrors the settings:saved live-reload pattern used elsewhere.
function useAmbientToggles() {
  const [t, setT] = useState({ room: true, heat: true, effects: true, death: true })
  useEffect(() => {
    const load = () => window.dr.settings.getAll().then(s => setT({
      room:    s.ambientRoomTint !== false,
      heat:    s.ambientHeat !== false,
      effects: s.ambientRoomEffects !== false,
      death:   s.ambientDeath !== false,
    }))
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
      <FogLayer />
      <WeatherParticles />
      {toggles.effects && <RoomEffect />}
      {toggles.heat && <CombatHeat />}
      {/* Above every other layer: death drains what they painted, rather than
          competing with them. */}
      {toggles.death && <DeathWash />}
      <AmbientLabel />
    </div>
  )
}
