// Weather state machine.
//
// DR streams weather changes as plain narrative on the main stream (no stream
// tag, exactly like atmospherics — see [[project-dr-stream-routing]]). We match
// the verbatim transition messages to drive a small state machine, and seed the
// current state from the `weather`/`observe weather` command (RT-free) on connect
// and from a 60 s background poll.
//
// Reference: https://elanthipedia.play.net/Weather — the pattern tables below are
// transcribed from that page's full message lists (ambient progressions + the
// per-season "observed weather" replies), which is why they read as verbatim
// sentences rather than keyword guesses.

export type WeatherKind = 'clear' | 'rain' | 'snow'
export interface WeatherState {
  kind: WeatherKind
  // Intensity 0–4. 0 is only ever used with kind 'clear'. For rain/snow: 1 light,
  // 2 steady, 3 heavy, 4 severe downpour / storm / blizzard. Drives particle
  // density, speed and angle in the overlay.
  level: number
}

export const CLEAR: WeatherState = { kind: 'clear', level: 0 }
const rain = (level: number): WeatherState => ({ kind: 'rain', level })
const snow = (level: number): WeatherState => ({ kind: 'snow', level })

// The `weather` command prints this header, then the state sentence — usually on
// the following line, but the game will happily put both on one line. Everything
// below matches against a NORMALIZED line: header removed, whitespace collapsed,
// leading article dropped ("The rain stops…" → "rain stops…") so a single pattern
// covers "A light rain patters…" / "Light rain patters…" alike.
const HEADER = /^\s*you glance up at the sky[.,!]*\s*/i

export function isWeatherHeaderLine(text: string): boolean {
  return HEADER.test(text)
}

function normalize(text: string): string {
  return text.replace(HEADER, '').replace(/\s+/g, ' ').trim().replace(/^(?:an?|the) /i, '')
}

// Every pattern is anchored at the start of the normalized line and keyed on the
// message's distinctive verbs, so narrative that merely mentions rain/snow (or a
// player quoting a weather line) can't flip the overlay. Ordered most-specific
// first: exact ambient-transition sentences, then the looser `weather` report
// wordings. Each entry maps to the ABSOLUTE state it leaves you in, so a missed
// message can't desync the machine — the next one snaps it back.
const PATTERNS: { re: RegExp; state: WeatherState }[] = [
  // ── Rain: ambient progression ─────────────────────────────────────────────
  { re: /^rain increases in severity and is now a severe downpour/i,   state: rain(4) },
  { re: /^storm increases in strength to a ferocious squall/i,         state: rain(4) },
  { re: /^steady rains turn into a driving storm/i,                    state: rain(4) },
  { re: /^rain falls harder and is now a heavy downpour/i,             state: rain(3) },
  { re: /^rain slackens off to a heavy downpour/i,                     state: rain(3) },
  { re: /^rain begins to come down even more heavily/i,                state: rain(2) },
  { re: /^heavy rains lessen to a steady shower/i,                     state: rain(2) },
  { re: /^rain slacks? off somewhat/i,                                 state: rain(2) },
  { re: /^steady rains lessen to a light,? misty drizzle/i,            state: rain(1) },
  { re: /^light(?: \w+)? rain (?:begins|patters|falls)/i,              state: rain(1) },
  { re: /^gentle(?: \w+)? rain patters/i,                              state: rain(1) },
  { re: /^rain stops, leaving only an overcast sky/i,                   state: CLEAR },
  // ── Snow: ambient progression ─────────────────────────────────────────────
  { re: /^snow increases in severity and is now a blizzard/i,          state: snow(4) },
  { re: /^snowfall grows very heavy/i,                                 state: snow(3) },
  { re: /^snow begins to fall more heavily/i,                          state: snow(2) },
  { re: /^snow slackens somewhat/i,                                    state: snow(2) },
  { re: /^snow slacks? off to a moderate flurry/i,                     state: snow(2) },
  { re: /^snow lessens to a light flurry/i,                            state: snow(1) },
  { re: /^light snow begins to fall/i,                                 state: snow(1) },
  { re: /^snow stops, leaving only an overcast sky/i,                   state: CLEAR },
  // ── Snow: `weather` report wordings ───────────────────────────────────────
  { re: /^it(?:'?s| is) a blizzard/i,                                   state: snow(4) },
  { re: /^snow(?:fall)? is falling (?:very|extremely) heav/i,          state: snow(3) },
  { re: /^(?:snow(?:fall)? is falling heav|it(?:'?s| is) snowing heav|heavy snow)/i, state: snow(3) },
  { re: /^(?:snow(?:fall)? is falling steadil|it(?:'?s| is) snowing steadil|steady snow|moderate flurr)/i, state: snow(2) },
  { re: /^(?:snow(?:fall)? is falling|it(?:'?s| is) snowing|light snow|light flurr|flurr)/i, state: snow(1) },
  // ── Rain: `weather` report wordings ───────────────────────────────────────
  { re: /^(?:severe downpour|driving storm|ferocious squall)/i,        state: rain(4) },
  { re: /^it(?:'?s| is) (?:a )?(?:severe downpour|driving storm|ferocious squall)/i, state: rain(4) },
  { re: /^(?:it(?:'?s| is) raining (?:heav|hard|a downpour)|rain is (?:falling|coming down) heav|rain is pouring|it(?:'?s| is) pouring|heavy downpour)/i, state: rain(3) },
  { re: /^(?:it(?:'?s| is) raining steadil|rain is falling steadil|steady (?:rain|shower))/i, state: rain(2) },
  { re: /^(?:it(?:'?s| is) raining|it(?:'?s| is) drizzling|rain is falling|rain patters|light rain|misty drizzle|light,? misty drizzle)/i, state: rain(1) },
]

// A line the `weather` reply could be, but which none of the patterns grade, is
// resolved by keywords. These deliberately live OUTSIDE the always-on matcher:
// "a thick bank of clouds obscures the heavens" is both a clear-sky report AND an
// ambient cloud message that fires *while it's raining*, so treating it as CLEAR
// anywhere would blank a live rain overlay.
const SNOW_WORDS = /\b(snow|snowfall|snowing|flurry|flurries|blizzard|sleet|hail)\b/i
const RAIN_WORDS = /\b(rain|rains|raining|drizzl\w*|downpour|shower|showers|squall|pouring|storm|stormy)\b/i
// Marks a line as a sky DESCRIPTION at all (vs. some unrelated line that landed in
// the reply window). Covers the seasonal wordings plus the Muspar'i desert set.
const SKY_WORDS = /\b(sky|skies|cloud|clouds|cloudy|cloudless|star|stars|starry|sun|sunbeams?|sunlight|moon|moons|heavens|overcast|horizon|haze|hazy|dust|sand|grit|gritty|breeze|breezes|wind|muggy|humid|fog|mist|heat)\b/i

// Returns the new weather state a line implies, or null if the line isn't a
// weather transition or report. Callers fold non-null results into weatherAtom.
export function weatherFromLine(text: string): WeatherState | null {
  const n = normalize(text)
  if (!n) return null
  for (const { re, state } of PATTERNS) if (re.test(n)) return state
  return null
}

// Grade a line that is (or may be) the `weather` command's state sentence. Falls
// back to keywords so an un-transcribed wording still switches the overlay to the
// right MODE — never leaving a stale rain/snow field over the wrong sky. Snow wins
// when present; else any rain word ⇒ rain; a sky description with neither ⇒ clear.
// null means "this isn't the weather reply" — leave the current state alone.
export function weatherFromReportLine(text: string): WeatherState | null {
  const n = normalize(text)
  if (!n) return null
  const graded = weatherFromLine(text)
  if (graded) return graded
  if (SNOW_WORDS.test(n)) return snow(2)
  if (RAIN_WORDS.test(n)) return rain(2)
  if (SKY_WORDS.test(n)) return CLEAR
  return null
}

// Short human label for the current state (badge / tooltip).
export function weatherLabel(w: WeatherState): string {
  if (w.kind === 'clear') return 'Clear'
  if (w.kind === 'rain')  return ['', 'Light rain', 'Steady rain', 'Heavy rain', 'Downpour'][w.level] ?? 'Rain'
  return ['', 'Light snow', 'Snowing', 'Heavy snow', 'Blizzard'][w.level] ?? 'Snow'
}
