// Weather state machine.
//
// DR streams weather changes as plain narrative on the main stream (no stream
// tag, exactly like atmospherics — see [[project-dr-stream-routing]]). We grade
// those lines against the full message corpus in weatherTable.ts, and seed the
// current state from the `weather` command (RT-free) on connect and from a
// background poll.
//
// Matching runs in three layers, most precise first:
//
//   1. The corpus — an exact lookup of 251 known sentences, disambiguated by the
//      season and region we're in. This is what gives us the game's own 0-9
//      severity, the improving/worsening trend, and star visibility.
//   2. The regex ladder below, for wordings the corpus doesn't carry verbatim.
//   3. Keywords, so an untranscribed line still switches the overlay to the right
//      MODE rather than leaving a stale rain field over a clear sky.
//
// Reference: https://elanthipedia.play.net/Weather

import { WEATHER_TABLE } from './weatherTable'
import type { Season } from './elanthianTime'

export type WeatherKind = 'clear' | 'rain' | 'snow' | 'dust'
export type WeatherRegion = 'standard' | 'muspari'
export type WeatherTrend = 'improving' | 'worsening'
export type StarVisibility = 'none' | 'diminished' | 'normal'

// One row of the generated corpus.
// [text, region, season, severity, kind, line-kind, direction, time, stars]
export type WeatherRow = [
  string,
  WeatherRegion,
  Season | 'any',
  number,
  WeatherKind,
  'state' | 'transition',
  WeatherTrend | null,
  'day' | 'night' | 'any',
  StarVisibility | null,
]

export interface WeatherState {
  kind: WeatherKind
  // Intensity 0–4, the render scale the ambient overlay draws from. 0 is only ever
  // used with kind 'clear'. Derived from `severity`.
  level: number
  // The game's own 0–9 scale: 0–4 are sky conditions (clear → overcast), 5–9 are
  // precipitation. Muspar'i escalates into blowing sand from 3.
  severity: number
  // Which way the last transition moved, when we saw one. Drives the trend arrow;
  // a plain state report leaves whatever the last transition said.
  trend?: WeatherTrend
  // How much of the starfield is showing, when the line says. Star visibility is a
  // real mechanic for Moon Mages, not just flavour.
  stars?: StarVisibility
  region: WeatherRegion
}

export const CLEAR: WeatherState = { kind: 'clear', level: 0, severity: 0, region: 'standard' }

// Severity (0–9) → the overlay's 0–4 render intensity. Sky conditions draw nothing;
// precipitation ramps from light to severe. Muspar'i sand starts lower on the scale
// because its 3 and 4 are already blowing grit rather than mere cloud.
function renderLevel(severity: number, kind: WeatherKind): number {
  if (kind === 'clear') return 0
  if (kind === 'dust') return Math.max(1, Math.min(4, severity - 2))
  return Math.max(1, Math.min(4, severity - 4))
}

function state(
  kind: WeatherKind,
  severity: number,
  region: WeatherRegion,
  extra: { trend?: WeatherTrend; stars?: StarVisibility } = {},
): WeatherState {
  const s: WeatherState = { kind, level: renderLevel(severity, kind), severity, region }
  if (extra.trend) s.trend = extra.trend
  if (extra.stars) s.stars = extra.stars
  return s
}

// The `weather` command prints this header, then the state sentence — usually on
// the following line, but the game will happily put both on one line.
const HEADER = /^\s*you glance up at the sky[.,!]*\s*/i

export function isWeatherHeaderLine(text: string): boolean {
  return HEADER.test(text)
}

// Normalization must stay in lockstep with the key generation for weatherTable.ts:
// header removed, curly apostrophes folded, whitespace collapsed, leading article
// dropped, trailing sentence punctuation trimmed.
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(HEADER, '')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:an?|the) /, '')
    .replace(/[.!]+$/, '')
}

// Corpus index, built once. A sentence can appear under several taggings (the same
// prose means different severities in different seasons), so each key holds every
// row that carries it and the caller's season/region picks between them.
const INDEX = new Map<string, WeatherRow[]>()
for (const row of WEATHER_TABLE) {
  const list = INDEX.get(row[0])
  if (list) list.push(row)
  else INDEX.set(row[0], [row])
}

// Pick the row that best fits where we are. Season and region agreement are what
// matter; an 'any' row is a valid but weaker match than an exact one.
function bestRow(rows: WeatherRow[], season: Season | undefined, region: WeatherRegion): WeatherRow {
  let best = rows[0]
  let bestScore = -1
  for (const row of rows) {
    let score = 0
    if (row[1] === region) score += 4
    if (season && row[2] === season) score += 2
    else if (row[2] === 'any') score += 1
    if (score > bestScore) { bestScore = score; best = row }
  }
  return best
}

// Grade a line against the corpus. Returns null if it isn't one of the known
// sentences.
export function weatherFromCorpus(
  text: string,
  season?: Season,
  region: WeatherRegion = 'standard',
): WeatherState | null {
  const rows = INDEX.get(normalize(text))
  if (!rows) return null
  const [, rowRegion, , severity, kind, , direction, , stars] = bestRow(rows, season, region)
  return state(kind, severity, rowRegion, {
    trend: direction ?? undefined,
    stars: stars ?? undefined,
  })
}

// ── Layer 2: the regex ladder ────────────────────────────────────────────────────
// Wordings the corpus doesn't carry verbatim. Each entry maps to the ABSOLUTE state
// it leaves you in, so a missed message can't desync the machine — the next one
// snaps it back. Severities here follow the same 0–9 scale.
const PATTERNS: { re: RegExp; kind: WeatherKind; severity: number }[] = [
  // Rain
  { re: /^rain increases in severity and is now a severe downpour/i, kind: 'rain', severity: 8 },
  { re: /^storm increases in strength to a ferocious squall/i,       kind: 'rain', severity: 8 },
  { re: /^steady rains turn into a driving storm/i,                  kind: 'rain', severity: 7 },
  { re: /^rain falls harder and is now a heavy downpour/i,           kind: 'rain', severity: 7 },
  { re: /^rain slackens off to a heavy downpour/i,                   kind: 'rain', severity: 7 },
  { re: /^rain begins to come down even more heavily/i,              kind: 'rain', severity: 6 },
  { re: /^heavy rains lessen to a steady shower/i,                   kind: 'rain', severity: 6 },
  { re: /^rain slacks? off somewhat/i,                               kind: 'rain', severity: 6 },
  { re: /^steady rains lessen to a light,? misty drizzle/i,          kind: 'rain', severity: 5 },
  { re: /^light(?: \w+)? rain (?:begins|patters|falls)/i,            kind: 'rain', severity: 5 },
  { re: /^gentle(?: \w+)? rain patters/i,                            kind: 'rain', severity: 5 },
  // Snow
  { re: /^snow increases in severity and is now a blizzard/i,        kind: 'snow', severity: 8 },
  { re: /^snowfall grows very heavy/i,                               kind: 'snow', severity: 7 },
  { re: /^snow begins to fall more heavily/i,                        kind: 'snow', severity: 6 },
  { re: /^snow slackens somewhat/i,                                  kind: 'snow', severity: 6 },
  { re: /^snow slacks? off to a moderate flurry/i,                   kind: 'snow', severity: 6 },
  { re: /^snow lessens to a light flurry/i,                          kind: 'snow', severity: 5 },
  { re: /^light snow begins to fall/i,                               kind: 'snow', severity: 5 },
  // Report wordings — snow
  { re: /^it(?:'?s| is) a blizzard/i,                                kind: 'snow', severity: 8 },
  { re: /^snow(?:fall)? is falling (?:very|extremely) heav/i,        kind: 'snow', severity: 7 },
  { re: /^(?:snow(?:fall)? is falling heav|it(?:'?s| is) snowing heav|heavy snow)/i, kind: 'snow', severity: 7 },
  { re: /^(?:snow(?:fall)? is falling steadil|it(?:'?s| is) snowing steadil|steady snow|moderate flurr)/i, kind: 'snow', severity: 6 },
  { re: /^(?:snow(?:fall)? is falling|it(?:'?s| is) snowing|light snow|light flurr|flurr)/i, kind: 'snow', severity: 5 },
  // Report wordings — rain
  { re: /^(?:severe downpour|driving storm|ferocious squall)/i,      kind: 'rain', severity: 8 },
  { re: /^it(?:'?s| is) (?:a )?(?:severe downpour|driving storm|ferocious squall)/i, kind: 'rain', severity: 8 },
  { re: /^(?:it(?:'?s| is) raining (?:heav|hard|a downpour)|rain is (?:falling|coming down) heav|rain is pouring|it(?:'?s| is) pouring|heavy downpour)/i, kind: 'rain', severity: 7 },
  { re: /^(?:it(?:'?s| is) raining steadil|rain is falling steadil|steady (?:rain|shower))/i, kind: 'rain', severity: 6 },
  { re: /^(?:it(?:'?s| is) raining|it(?:'?s| is) drizzling|rain is falling|rain patters|light rain|misty drizzle|light,? misty drizzle)/i, kind: 'rain', severity: 5 },
  // Clearing
  { re: /^rain stops, leaving only an overcast sky/i,                kind: 'clear', severity: 4 },
  { re: /^snow stops, leaving only an overcast sky/i,                kind: 'clear', severity: 4 },
]

// ── Layer 3: keywords ────────────────────────────────────────────────────────────
// These deliberately live OUTSIDE the always-on matcher: "a thick bank of clouds
// obscures the heavens" is both a clear-sky report AND an ambient cloud message that
// fires *while it's raining*, so treating it as CLEAR anywhere would blank a live
// rain overlay.
const SNOW_WORDS = /\b(snow|snowfall|snowing|flurry|flurries|blizzard|sleet|hail)\b/i
const RAIN_WORDS = /\b(rain|rains|raining|drizzl\w*|downpour|shower|showers|squall|pouring|storm|stormy)\b/i
const DUST_WORDS = /\b(sand|sandstorm|dust|grit|gritty)\b/i
// Marks a line as a sky DESCRIPTION at all (vs. some unrelated line that landed in
// the reply window). Covers the seasonal wordings plus the Muspar'i desert set.
const SKY_WORDS = /\b(sky|skies|cloud|clouds|cloudy|cloudless|star|stars|starry|sun|sunbeams?|sunlight|moon|moons|heavens|overcast|horizon|haze|hazy|dust|sand|grit|gritty|breeze|breezes|wind|muggy|humid|fog|mist|heat)\b/i

// Returns the new weather state a line implies, or null if the line isn't a weather
// transition or report. Callers fold non-null results into weatherAtom.
export function weatherFromLine(
  text: string,
  season?: Season,
  region: WeatherRegion = 'standard',
): WeatherState | null {
  const fromCorpus = weatherFromCorpus(text, season, region)
  if (fromCorpus) return fromCorpus

  const n = normalize(text)
  if (!n) return null
  for (const { re, kind, severity } of PATTERNS) {
    if (re.test(n)) return state(kind, severity, region)
  }
  return null
}

// Grade a line that is (or may be) the `weather` command's state sentence. Falls
// back to keywords so an un-transcribed wording still switches the overlay to the
// right MODE. Snow wins when present; else rain; else blowing sand; a sky
// description with none of those ⇒ clear. null means "this isn't the weather reply"
// — leave the current state alone.
export function weatherFromReportLine(
  text: string,
  season?: Season,
  region: WeatherRegion = 'standard',
): WeatherState | null {
  const graded = weatherFromLine(text, season, region)
  if (graded) return graded

  const n = normalize(text)
  if (!n) return null
  if (SNOW_WORDS.test(n)) return state('snow', 6, region)
  if (RAIN_WORDS.test(n)) return state('rain', 6, region)
  if (DUST_WORDS.test(n) && region === 'muspari') return state('dust', 5, region)
  if (SKY_WORDS.test(n)) return state('clear', 1, region)
  return null
}

// Rooms in the Muspar'i desert print their own weather set, and the same severity
// means blowing sand there rather than rain. We latch the region off any line that
// only the desert set uses, so it survives into the next reading.
const MUSPARI_TELL = /\b(?:veils? of sand|swirling sand|gritty sand|bits of grit|sand-laden|abrasive)\b/i
export function regionFromLine(text: string): WeatherRegion | null {
  return MUSPARI_TELL.test(text) ? 'muspari' : null
}

// Short human label for the current state (badge / tooltip).
const RAIN_LABELS = ['', 'Light rain', 'Steady rain', 'Heavy rain', 'Downpour']
const SNOW_LABELS = ['', 'Light snow', 'Snowing', 'Heavy snow', 'Blizzard']
const DUST_LABELS = ['', 'Hazy sand', 'Blowing sand', 'Driving sand', 'Sandstorm']
const CLEAR_LABELS = ['Clear', 'Clear', 'A few clouds', 'Cloudy', 'Overcast']

export function weatherLabel(w: WeatherState): string {
  if (w.kind === 'clear') return CLEAR_LABELS[Math.min(4, w.severity)] ?? 'Clear'
  if (w.kind === 'rain')  return RAIN_LABELS[w.level] ?? 'Rain'
  if (w.kind === 'dust')  return DUST_LABELS[w.level] ?? 'Blowing sand'
  return SNOW_LABELS[w.level] ?? 'Snow'
}

// "Clearing" / "Worsening" for the trend indicator, or '' when we haven't seen a
// transition to judge from.
export function trendLabel(w: WeatherState): string {
  if (w.trend === 'improving') return 'Clearing'
  if (w.trend === 'worsening') return 'Worsening'
  return ''
}
