// Weather state machine.
//
// DR streams weather changes as plain narrative on the main stream (no stream
// tag, exactly like atmospherics — see [[project-dr-stream-routing]]). We match
// the verbatim transition messages to drive a small state machine, and seed the
// current state from the `weather`/`observe weather` command (RT-free) on connect.
// Unlike atmospherics these lines stay in the main output — a weather change is
// meaningful narrative worth reading; we only *also* update the ambient display.
//
// Reference: https://elanthipedia.play.net/Weather

export type WeatherKind = 'clear' | 'rain' | 'snow'
export interface WeatherState {
  kind: WeatherKind
  // Intensity 0–4. 0 is only ever used with kind 'clear'. For rain/snow: 1 light,
  // 2 steady/heavy-ish, 3 heavy, 4 downpour / blizzard. Drives particle density,
  // speed and angle in the overlay.
  level: number
}

export const CLEAR: WeatherState = { kind: 'clear', level: 0 }

// Ambient transition messages → the absolute state they leave you in. Absolute
// (not relative) so a missed message can't desync the machine for long: the next
// message it does catch snaps it back to the right level.
const TRANSITIONS: { re: RegExp; state: WeatherState }[] = [
  // Rain
  { re: /Light rain begins to fall from the sky\./i,                 state: { kind: 'rain', level: 1 } },
  { re: /steady rains lessen to a light, misty drizzle\./i,          state: { kind: 'rain', level: 1 } },
  { re: /rain begins to come down even more heavily\./i,             state: { kind: 'rain', level: 2 } },
  { re: /heavy rains lessen to a steady shower\./i,                  state: { kind: 'rain', level: 2 } },
  { re: /rain falls harder and is now a heavy downpour\./i,          state: { kind: 'rain', level: 3 } },
  { re: /rain increases in severity and is now a severe downpour\./i,state: { kind: 'rain', level: 4 } },
  { re: /The rain stops, leaving only an overcast sky\./i,           state: CLEAR },
  // Snow
  { re: /Light snow begins to fall from the sky\./i,                 state: { kind: 'snow', level: 1 } },
  { re: /snow lessens to a light flurry\./i,                         state: { kind: 'snow', level: 1 } },
  { re: /snow begins to fall more heavily\./i,                       state: { kind: 'snow', level: 2 } },
  { re: /snow slackens somewhat\./i,                                 state: { kind: 'snow', level: 2 } },
  { re: /snowfall grows very heavy\./i,                              state: { kind: 'snow', level: 3 } },
  { re: /snow increases in severity and is now a blizzard\./i,       state: { kind: 'snow', level: 4 } },
  { re: /The snow stops, leaving only an overcast sky of grey\./i,   state: CLEAR },
]

// `weather` (a.k.a. OBSERVE WEATHER) command report → current state. The command
// prints "You glance up at the sky." then a state sentence, e.g. "Snow is falling
// heavily." / "It's a blizzard!". Patterns are ANCHORED to the start of the line
// and keyed on the report's distinctive verbs ("… is falling …") so they don't
// false-match arbitrary narrative that merely contains "rain"/"snow"/"clear".
// Confirmed in-game: "It's a blizzard!", "Snow is falling heavily." The rest are
// best-effort and should be verified / extended as they're observed. Most-specific
// first (severity before the plain form).
const REPORTS: { re: RegExp; state: WeatherState }[] = [
  // Snow
  { re: /^\s*it's a blizzard/i,                                        state: { kind: 'snow', level: 4 } },
  { re: /^\s*(?:snow|snowfall) is falling (?:very heav|extremely heav)/i, state: { kind: 'snow', level: 3 } },
  { re: /^\s*(?:snow|snowfall) is falling heav|^\s*(?:it's )?heavy snow|^\s*it's snowing heav/i, state: { kind: 'snow', level: 3 } },
  { re: /^\s*(?:snow|snowfall) is falling steadil/i,                   state: { kind: 'snow', level: 2 } },
  { re: /^\s*(?:snow|snowfall) is falling|^\s*it's snowing|^\s*(?:it's )?light snow|^\s*(?:it's )?flurr/i, state: { kind: 'snow', level: 1 } },
  // Rain
  { re: /^\s*(?:it's a |a )?severe downpour/i,                         state: { kind: 'rain', level: 4 } },
  { re: /^\s*rain is falling heav|^\s*(?:it's a )?heavy downpour|^\s*it's pouring/i, state: { kind: 'rain', level: 3 } },
  { re: /^\s*rain is falling steadil|^\s*it's a steady (?:rain|shower)/i, state: { kind: 'rain', level: 2 } },
  { re: /^\s*rain is falling|^\s*it's raining|^\s*it's drizzl|^\s*(?:it's a )?(?:light|misty) (?:rain|drizzle)/i, state: { kind: 'rain', level: 1 } },
  // Clear / no precipitation (incl. overcast — clouds but nothing falling)
  { re: /^\s*(?:the )?sky is (?:clear|cloudless)|^\s*it's clear|^\s*the weather is (?:fair|clear)|^\s*there is no precipitation/i, state: CLEAR },
  { re: /thick bank of clouds|clouds? (?:obscure|obscures|cover|covers) the (?:heavens|sky)|(?:sky is |it's )overcast/i, state: CLEAR },
]

// Returns the new weather state a line implies, or null if the line isn't a
// weather transition or report. Callers fold non-null results into weatherAtom.
export function weatherFromLine(text: string): WeatherState | null {
  for (const { re, state } of TRANSITIONS) if (re.test(text)) return state
  for (const { re, state } of REPORTS)     if (re.test(text)) return state
  return null
}

// Short human label for the current state (badge / tooltip).
export function weatherLabel(w: WeatherState): string {
  if (w.kind === 'clear') return 'Clear'
  if (w.kind === 'rain')  return ['', 'Light rain', 'Steady rain', 'Heavy rain', 'Downpour'][w.level] ?? 'Rain'
  return ['', 'Light snow', 'Snowing', 'Heavy snow', 'Blizzard'][w.level] ?? 'Snow'
}
