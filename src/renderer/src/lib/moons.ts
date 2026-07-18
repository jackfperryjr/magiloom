// The three moons of Elanthia.
//
// Positions/phases are NOT cleanly deterministic (phase durations vary with the
// moons' mutual gravitation — see [[project-ambient-weather]]), and OBSERVE SKY
// incurs roundtime for everyone, so we do NOT poll. Instead the Sky panel shows
// the LAST observed snapshot, refreshed on demand by the user (Observe button) and
// updated passively by any moon rise/set/phase ambient messages we can catch.
//
// Refs: https://elanthipedia.play.net/Katamba /Xibar /Yavash /Observe_command

export type MoonName = 'Katamba' | 'Xibar' | 'Yavash'

export interface MoonMeta {
  name: MoonName
  color: string        // lit-surface tint
  glow: string         // halo colour
  blurb: string        // one-line flavour
}

// Katamba: largest, "black as soot"; Xibar: smallest/closest, silvery-blue ice;
// Yavash: most distant, ruby/crimson.
export const MOONS: MoonMeta[] = [
  { name: 'Katamba', color: '#6f6a7a', glow: 'rgba(150,140,170,.5)', blurb: 'The great dark moon, black as soot.' },
  { name: 'Xibar',   color: '#8fb6e8', glow: 'rgba(140,185,235,.6)', blurb: 'The near moon of silver-blue ice.' },
  { name: 'Yavash',  color: '#d06a6a', glow: 'rgba(210,90,95,.55)',  blurb: 'The far moon, ruby and crimson.' },
]
export const MOON_BY_NAME: Record<MoonName, MoonMeta> =
  Object.fromEntries(MOONS.map(m => [m.name, m])) as Record<MoonName, MoonMeta>

// A moon's illuminated phase: `illum` 0 (new) → 1 (full); `waxing` picks which limb
// is lit. `label` is a human name for the phase.
export interface MoonPhase { illum: number; waxing: boolean; label: string }

// Rough height of the moon in the sky, for the panel's altitude cue.
export type MoonAltitude = 'rising' | 'high' | 'setting' | 'below'

export interface MoonState {
  name: MoonName
  phase?: MoonPhase
  altitude?: MoonAltitude
  visible?: boolean
  raw?: string          // the verbatim observed line, always shown as ground truth
  observedAt?: number   // epoch-ms of the observation
}

// ── Phase vocabulary (best-effort; finalize against real OBSERVE SKY output) ──────
// Maps the fraction/qualifier words to an illuminated fraction. Combined with a
// waxing/waning word to place the terminator. Ordered so more specific words win.
const FRACTIONS: { re: RegExp; illum: number; label: string }[] = [
  { re: /\bfull\b|\ball of\b/i,                 illum: 1,    label: 'Full' },
  { re: /\bgibbous\b/i,                          illum: 0.75, label: 'Gibbous' },
  { re: /\bhalf\b/i,                             illum: 0.5,  label: 'Half' },
  { re: /\b(?:quarter|crescent)\b/i,             illum: 0.28, label: 'Crescent' },
  { re: /\b(?:sliver|thin|thinnest|barely)\b/i,  illum: 0.12, label: 'Sliver' },
  // NB: not "dark" — "dark moon Katamba" is Katamba's epithet, not a phase.
  { re: /\bnew moon\b|\bunlit\b|\bfully dark\b/i, illum: 0,    label: 'New' },
]

export function parsePhase(text: string): MoonPhase | undefined {
  const waxing = /\bwax/i.test(text) ? true : /\bwan/i.test(text) ? false : undefined
  const frac = FRACTIONS.find(f => f.re.test(text))
  if (!frac && waxing === undefined) return undefined
  const illum = frac?.illum ?? 0.5
  const w = waxing ?? true
  const label = illum >= 0.99 ? 'Full'
    : illum <= 0.01 ? 'New'
    : `${w ? 'Waxing' : 'Waning'} ${frac?.label ?? ''}`.trim()
  return { illum, waxing: w, label }
}

function parseAltitude(text: string): MoonAltitude | undefined {
  if (/\bris(?:es|ing)\b|climbs above|above the horizon/i.test(text)) return 'rising'
  if (/\bsets?\b|setting|sink|near the horizon|low in/i.test(text)) return 'setting'
  if (/\blooks down\b|overhead|high above|zenith|from above/i.test(text)) return 'high'
  if (/\bbelow the horizon\b|not (?:visible|risen)|has set/i.test(text)) return 'below'
  return undefined
}

// Parse a SINGLE main line: if it names a moon AND carries phase/altitude wording
// (an OBSERVE SKY line, or a passive rise/set message), return that moon's snapshot;
// otherwise null (a bare mention isn't an observation). Used opportunistically in
// dispatch so both OBSERVE output and ambient moon messages refresh the panel.
export function parseMoonLine(text: string, now = Date.now()): MoonState | null {
  for (const name of ['Katamba', 'Xibar', 'Yavash'] as MoonName[]) {
    if (!new RegExp(`\\b${name}\\b`, 'i').test(text)) continue
    const phase = parsePhase(text)
    const alt = parseAltitude(text)
    if (!phase && !alt) return null
    return { name, phase, altitude: alt, visible: alt ? alt !== 'below' : true, raw: text.trim(), observedAt: now }
  }
  return null
}

// Parse an OBSERVE SKY response into per-moon snapshots. One line typically names
// one moon, e.g. "Waxing still, half of the blue moon Xibar looks down from above."
// Best-effort: keys on the moon NAME appearing in a line; keeps the raw line so the
// panel always shows the game's own words even when the structured parse is unsure.
export function parseObserveSky(lines: string[], now = Date.now()): MoonState[] {
  const out: MoonState[] = []
  for (const name of ['Katamba', 'Xibar', 'Yavash'] as MoonName[]) {
    const line = lines.find(l => new RegExp(`\\b${name}\\b`, 'i').test(l))
    if (!line) continue
    const alt = parseAltitude(line)
    out.push({
      name,
      phase: parsePhase(line),
      altitude: alt,
      visible: alt ? alt !== 'below' : true,
      raw: line.trim(),
      observedAt: now,
    })
  }
  return out
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
