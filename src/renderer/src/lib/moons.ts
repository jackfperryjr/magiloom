// The three moons of Elanthia.
//
// Position and phase are closed-form: each moon has a fixed orbital period, and
// what you see in the sky is that orbit plus the planet's own rotation. Because an
// Elanthian day is exactly 360 roisaen (see MINUTES_PER_DAY), one roisan of rotation
// IS one degree, so the two angles add directly:
//
//   skyAngle = (orbitalAngle + minutesIntoDay) mod 360      // up while <= 180
//
// This replaces the old model, which fitted a fixed "up" and "down" duration per
// moon and needed an anchor event to project from — seeded from a community feed
// that has since gone permission-denied, leaving the panel blank until the player
// happened to be standing outdoors when a moon rose. The orbital model needs no
// anchor, no network, and is correct the moment you connect.
//
// The two agree: the fitted durations imply cycles of 351 / 346 / 352 roisaen for
// Katamba / Xibar / Yavash, and the periods below produce 351.5 / 347.5 / 352.2.
//
// The orbital periods are game constants and the epoch is an anchor we can't derive,
// so — exactly as with the clock — a witnessed rise or set is folded back in as a
// per-moon correction. See `correctionFromMoonLine`.
//
// Refs: https://elanthipedia.play.net/Katamba /Xibar /Yavash
//       https://elanthipedia.play.net/Moon_Mage_Skill:_Astrology

import { MINUTES_PER_DAY, EPOCH_OFFSET_MIN } from './elanthianTime'

export type MoonName = 'Katamba' | 'Xibar' | 'Yavash'

export interface MoonMeta {
  name: MoonName
  orbitalPeriod: number   // roisaen for one full orbit
  color: string           // lit-surface tint
  glow: string            // halo colour
  blurb: string           // one-line flavour
}

// Katamba: largest, "black as soot"; Xibar: smallest/closest, silvery-blue ice;
// Yavash: most distant, ruby/crimson.
export const MOONS: MoonMeta[] = [
  { name: 'Katamba', orbitalPeriod: 14847, color: '#6f6a7a', glow: 'rgba(150,140,170,.5)', blurb: 'The great dark moon, black as soot.' },
  { name: 'Xibar',   orbitalPeriod: 9983,  color: '#8fb6e8', glow: 'rgba(140,185,235,.6)', blurb: 'The near moon of silver-blue ice.' },
  { name: 'Yavash',  orbitalPeriod: 16171, color: '#d06a6a', glow: 'rgba(210,90,95,.55)',  blurb: 'The far moon, ruby and crimson.' },
]
export const MOON_BY_NAME: Record<MoonName, MoonMeta> =
  Object.fromEntries(MOONS.map(m => [m.name, m])) as Record<MoonName, MoonMeta>

// Phase names are derived from the illuminated fraction rather than from the raw
// angle sector. Slicing the orbit into eight equal wedges puts the sector edges out
// of step with the illumination curve, which shows up as a moon labelled "waning
// crescent" while reporting 0% lit — the label and the disc disagreeing on screen.
function phaseName(illum: number, waxing: boolean): string {
  if (illum < 0.03) return 'new'
  if (illum > 0.97) return 'full'
  if (illum < 0.47) return waxing ? 'waxing crescent' : 'waning crescent'
  if (illum < 0.53) return waxing ? 'first quarter' : 'third quarter'
  return waxing ? 'waxing gibbous' : 'waning gibbous'
}

// A moon's illuminated phase: `illum` 0 (new) → 1 (full); `waxing` picks which limb
// is lit. `label` is a human name for the phase.
export interface MoonPhase { illum: number; waxing: boolean; label: string }

// A moon's live position: whether it's above the horizon, how far along its east→west
// arc it is (only meaningful while visible), the roisaen until its next rise or set,
// and its phase.
export interface MoonPosition {
  name: MoonName
  visible: boolean
  arc: number             // 0 = rising in the east → 1 = setting in the west
  msToEvent: number
  phase: MoonPhase
}

// Per-moon correction in roisaen, learned from witnessed rise/set lines.
export type MoonCorrections = Partial<Record<MoonName, number>>

const mod = (a: number, b: number): number => ((a % b) + b) % b

// The raw angles for a moon at a given Elanthian minute.
//
// Note the orbital term uses the UNCORRECTED minute count while the rotation term
// uses the epoch-shifted one. That asymmetry is deliberate: the orbit and the
// calendar are anchored independently, and collapsing them onto one epoch shifts
// every moon out of position.
function anglesAt(meta: MoonMeta, unixMin: number, correctionMin: number): {
  skyAngle: number; orbitalAngle: number; phaseAngle: number; up: boolean
} {
  const t = unixMin + correctionMin
  const orbitalAngle = Math.floor(360 * mod(t, meta.orbitalPeriod) / meta.orbitalPeriod)

  const shifted = t + EPOCH_OFFSET_MIN                 // epoch-aligned minutes
  const minutesIntoDay = mod(shifted, MINUTES_PER_DAY)
  const skyAngle = mod(orbitalAngle + minutesIntoDay, 360)

  // Phase is the moon's orbit measured against the sun's position through the year,
  // so it walks through all eight phases over a season rather than a day.
  const dayOfYear = mod(Math.floor(shifted / MINUTES_PER_DAY), 400)
  const phaseAngle = mod(orbitalAngle + Math.floor(360 * dayOfYear / 400), 360)

  return { skyAngle, orbitalAngle, phaseAngle, up: skyAngle <= 180 }
}

function phaseFrom(phaseAngle: number): MoonPhase {
  // Continuous illumination: 0 at angle 0 (new), 1 at 180 (full).
  const illum = (1 - Math.cos(phaseAngle * Math.PI / 180)) / 2
  const waxing = phaseAngle < 180
  return { illum, waxing, label: phaseName(illum, waxing) }
}

export function computeMoonPosition(
  name: MoonName,
  now = Date.now(),
  corrections: MoonCorrections = {},
): MoonPosition {
  const meta = MOON_BY_NAME[name]
  const correction = corrections[name] ?? 0
  const unixMin = Math.floor(now / 60_000)
  const a = anglesAt(meta, unixMin, correction)

  // Scan forward for the next horizon crossing. A full up or down span is a little
  // under 180 roisaen, so 200 always finds one.
  let minutesToNext = 200
  for (let i = 1; i <= 200; i++) {
    if (anglesAt(meta, unixMin + i, correction).up !== a.up) { minutesToNext = i; break }
  }

  return {
    name,
    visible: a.up,
    arc: a.up ? a.skyAngle / 180 : 0,
    msToEvent: minutesToNext * 60_000,
    phase: phaseFrom(a.phaseAngle),
  }
}

export function computeMoonPositions(now = Date.now(), corrections: MoonCorrections = {}): MoonPosition[] {
  return MOONS.map(m => computeMoonPosition(m.name, now, corrections))
}

// ── Self-correction from witnessed rise/set lines ────────────────────────────────
// The passive broadcasts anyone standing outdoors sees. Line matchers ported from
// the dr-scripts `moonwatch` lich script.
const MOON_RISE_RE = /^(Katamba|Xibar|Yavash) slowly rises/
const MOON_SET_RE  = /^(Katamba|Xibar|Yavash) sets\b/

// Given a witnessed rise or set, return the correction (in roisaen) that would make
// the model agree with what the player just saw, or null if the line isn't one — or
// if the model already agrees closely enough to leave alone.
//
// We look for the model's own nearest crossing of the same kind within half a cycle
// either way, and take the difference. The search window doubles as a sanity bound:
// a line the model can't place near at all is ignored rather than believed.
export function correctionFromMoonLine(
  text: string,
  now = Date.now(),
  corrections: MoonCorrections = {},
): { name: MoonName; correction: number } | null {
  const rise = text.match(MOON_RISE_RE)
  const set = rise ? null : text.match(MOON_SET_RE)
  const m = rise ?? set
  if (!m) return null

  const name = m[1] as MoonName
  const meta = MOON_BY_NAME[name]
  const wantUp = Boolean(rise)
  const correction = corrections[name] ?? 0
  const unixMin = Math.floor(now / 60_000)

  // Walk out from now, nearest first, for the model's matching transition.
  for (let d = 0; d <= 180; d++) {
    for (const delta of d === 0 ? [0] : [-d, d]) {
      const at = unixMin + delta
      const before = anglesAt(meta, at - 1, correction).up
      const after = anglesAt(meta, at, correction).up
      if (before === after) continue
      if (after !== wantUp) continue
      // The model puts this event `delta` roisaen from now; the player saw it now.
      // The crossing sits at a fixed point in the moon's own timeline, so sliding it
      // onto "now" means moving the offset WITH delta, not against it.
      if (delta === 0) return null            // already agrees
      return { name, correction: correction + delta }
    }
  }
  return null
}

// ── Phase disc geometry ──────────────────────────────────────────────────────────
// SVG path for the lit portion of a moon of radius r centred at (cx,cy). The lit
// limb is a semicircle on the waxing (right) / waning (left) side; the terminator
// is a half-ellipse whose width shrinks to 0 at half phase, bulging the opposite
// way for crescent vs gibbous.
export function litPath(cx: number, cy: number, r: number, illum: number, waxing: boolean): string {
  const rx = r * Math.abs(1 - 2 * illum)
  const gibbous = illum > 0.5
  const sweepLimb = waxing ? 1 : 0
  const sweepTerm = gibbous ? sweepLimb : 1 - sweepLimb
  return `M ${cx},${cy - r} A ${r},${r} 0 0 ${sweepLimb} ${cx},${cy + r} A ${rx},${r} 0 0 ${sweepTerm} ${cx},${cy - r} Z`
}
