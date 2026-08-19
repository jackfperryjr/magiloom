/**
 * Ambient-audio mixing tests.
 *
 * The engine itself needs a real AudioContext and can't be tested here, so this
 * covers the part that actually holds the decisions: which layers a given piece of
 * game state should open, and how loudly.
 *
 * The cases that matter most are the suppressions — underwater silencing the sky,
 * and everything going quiet while disconnected. A stuck layer is the failure a
 * player would notice, because it keeps making noise after the reason for it is
 * gone.
 *
 * Run: npm run test:tools
 */

import { ambientLevels } from './ambientMix'
import { AMBIENT_SOUND_IDS } from './ambientAudio'
import type { WeatherState } from './weather'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)

const weather = (kind: WeatherState['kind'], severity: number): WeatherState =>
  ({ kind, severity, level: Math.min(4, Math.ceil(severity / 2.25)), region: 'standard' }) as WeatherState

const CLEAR = weather('clear', 0)

// ── Disconnected ───────────────────────────────────────────────────────────────
{
  const l = ambientLevels({ weather: weather('rain', 9), ambience: 'embers', active: false })
  for (const id of AMBIENT_SOUND_IDS) eq(`inactive silences ${id}`, l[id], 0)
}

// ── Rain scales with severity ──────────────────────────────────────────────────
{
  const light = ambientLevels({ weather: weather('rain', 1), ambience: null, active: true })
  const heavy = ambientLevels({ weather: weather('rain', 9), ambience: null, active: true })
  check('light rain is audible', light.rain >= 0.25, `got ${light.rain}`)
  check('heavy rain is louder than light', heavy.rain > light.rain)
  eq('heavy rain tops out at 1', heavy.rain, 1)
  eq('light rain brings no wind', light.wind, 0)
  check('a storm brings wind', heavy.wind > 0, `got ${heavy.wind}`)
  eq('rain never opens the fire layer', heavy.fire, 0)
  eq('rain never opens the water layer', heavy.water, 0)
}

// ── Snow and dust are wind, not rain ───────────────────────────────────────────
{
  const snow = ambientLevels({ weather: weather('snow', 6), ambience: null, active: true })
  eq('snow makes no rain sound', snow.rain, 0)
  check('snow makes wind', snow.wind > 0, `got ${snow.wind}`)

  const dust = ambientLevels({ weather: weather('dust', 9), ambience: null, active: true })
  eq('a full sandstorm is the loudest wind', dust.wind, 1)
  check('sand is windier than snow at equal severity',
    ambientLevels({ weather: weather('dust', 6), ambience: null, active: true }).wind > snow.wind)
}

// ── Clear skies are silent ─────────────────────────────────────────────────────
{
  const l = ambientLevels({ weather: CLEAR, ambience: null, active: true })
  for (const id of AMBIENT_SOUND_IDS) eq(`clear weather silences ${id}`, l[id], 0)
  const none = ambientLevels({ weather: null, ambience: null, active: true })
  for (const id of AMBIENT_SOUND_IDS) eq(`unknown weather silences ${id}`, none[id], 0)
}

// ── Room ambience ──────────────────────────────────────────────────────────────
{
  const forge = ambientLevels({ weather: CLEAR, ambience: 'embers', active: true })
  eq('a forge burns at full strength', forge.fire, 1)

  // Weather and a forge coexist: standing at an outdoor smithy in the rain should
  // give you both.
  const wetForge = ambientLevels({ weather: weather('rain', 7), ambience: 'embers', active: true })
  eq('a forge in the rain still burns', wetForge.fire, 1)
  check('a forge in the rain still rains', wetForge.rain > 0)
}

// ── Underwater suppresses the sky ──────────────────────────────────────────────
{
  const l = ambientLevels({ weather: weather('rain', 9), ambience: 'underwater', active: true })
  eq('underwater runs the water layer', l.water, 1)
  eq('underwater silences rain', l.rain, 0)
  eq('underwater silences wind', l.wind, 0)
  eq('underwater silences fire', l.fire, 0)
}

// ── Every level is a usable gain ───────────────────────────────────────────────
{
  const kinds: WeatherState['kind'][] = ['clear', 'rain', 'snow', 'dust']
  for (const kind of kinds) {
    for (let sev = 0; sev <= 9; sev++) {
      for (const amb of [null, 'embers', 'underwater'] as const) {
        const l = ambientLevels({ weather: weather(kind, sev), ambience: amb, active: true })
        for (const id of AMBIENT_SOUND_IDS) {
          check(`${kind}/${sev}/${amb}/${id} in range`,
            Number.isFinite(l[id]) && l[id] >= 0 && l[id] <= 1, `got ${l[id]}`)
        }
      }
    }
  }
}

if (failures.length) {
  console.error(`ambientMix: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`ambientMix: ${passed} assertions passed`)
