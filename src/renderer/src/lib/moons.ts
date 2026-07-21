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

// ── Rise/set position model (ported from Lich moonwatch) ─────────────────────────
// Unlike PHASE (above), a moon's rise/set timing IS deterministic: it's up for a
// fixed span after rising, then down until it rises again. The spans below are the
// community-fit averages from elanthia-online/dr-scripts `moonwatch.lic` (minutes →
// ms). Given one known event we can project the whole timeline with no polling — and
// every character standing outdoors witnesses the passive rise/set lines that
// re-anchor it (see `moonEventFromLine`), so this needs no Moon Mage/Trader command.
const UP_MS:   Record<MoonName, number> = { Xibar: 172 * 60_000, Katamba: 174 * 60_000, Yavash: 175 * 60_000 }
const DOWN_MS: Record<MoonName, number> = { Xibar: 174 * 60_000, Katamba: 177 * 60_000, Yavash: 177 * 60_000 }

// The last known rise/set event for a moon — the anchor the timeline is projected from.
export interface MoonAnchor { event: 'rise' | 'set'; at: number }  // `at` is epoch-ms

// A moon's live position derived from its anchor: whether it's above the horizon, how
// far along its east→west arc it is (only meaningful while visible), and the ms until
// its next event (set if up, rise if down).
export interface MoonPosition { name: MoonName; visible: boolean; arc: number; msToEvent: number }

export function computeMoonPosition(name: MoonName, anchor: MoonAnchor, now = Date.now()): MoonPosition {
  const up = UP_MS[name], down = DOWN_MS[name], cycle = up + down
  // Reduce the anchor to "ms since the most recent rise" (a set event means it rose
  // `up` ago), then fold onto the cycle. t < up ⇒ currently visible.
  const sinceRise = anchor.event === 'rise' ? now - anchor.at : now - (anchor.at - up)
  const t = ((sinceRise % cycle) + cycle) % cycle
  return t < up
    ? { name, visible: true,  arc: t / up, msToEvent: up - t }
    : { name, visible: false, arc: 0,      msToEvent: cycle - t }
}

// The community rise/set feed moonwatch reads (world-readable Firebase): keys k/x/y,
// each { e: 1=rise | 0=set, t: unix-seconds }. Its `s` (sun) entry is ignored — our
// own Elanthian clock drives day/night. Fetched once on connect to seed the anchors
// before the character has witnessed any live rise/set line.
export interface MoonFeed { k?: MoonFeedEntry; x?: MoonFeedEntry; y?: MoonFeedEntry }
interface MoonFeedEntry { e?: number; t?: number }
export const MOON_FEED_URL = 'https://dr-scripts.firebaseio.com/moon_data_v2.json'
const FEED_KEY: Record<MoonName, 'k' | 'x' | 'y'> = { Katamba: 'k', Xibar: 'x', Yavash: 'y' }

export function anchorsFromFeed(feed: MoonFeed | null | undefined): Partial<Record<MoonName, MoonAnchor>> {
  const out: Partial<Record<MoonName, MoonAnchor>> = {}
  if (!feed) return out
  for (const { name } of MOONS) {
    const e = feed[FEED_KEY[name]]
    if (e && typeof e.t === 'number') out[name] = { event: e.e === 1 ? 'rise' : 'set', at: e.t * 1000 }
  }
  return out
}

// The passive rise/set broadcasts anyone outdoors sees — the live re-anchor signal.
// Line matchers ported verbatim from moonwatch.lic.
const MOON_RISE_RE = /^(Katamba|Xibar|Yavash) slowly rises/
const MOON_SET_RE  = /^(Katamba|Xibar|Yavash) sets\b/
export function moonEventFromLine(text: string, now = Date.now()): { name: MoonName; anchor: MoonAnchor } | null {
  const r = text.match(MOON_RISE_RE); if (r) return { name: r[1] as MoonName, anchor: { event: 'rise', at: now } }
  const s = text.match(MOON_SET_RE);  if (s) return { name: s[1] as MoonName, anchor: { event: 'set',  at: now } }
  return null
}
