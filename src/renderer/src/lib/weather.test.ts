/**
 * Weather grading tests.
 *
 * The corpus table is the whole point of this module, so the tests are mostly about
 * the table staying wired to the matcher rather than about any one sentence:
 *
 *   1. Every row in the table is reachable. A normalization change on either side
 *      (generator or matcher) silently orphans rows, and the symptom is just
 *      "weather stopped updating" — so assert the round-trip for all 251.
 *   2. Season disambiguation actually happens. The same sentence carries different
 *      severities in different seasons; grading it without a season must not be
 *      allowed to quietly pick the wrong one.
 *   3. Transitions report a direction and states don't invent one.
 *   4. The layered fallbacks still catch what the corpus doesn't, and non-weather
 *      prose is never mistaken for a reading.
 *
 * Run: npm run test:tools
 */

import {
  weatherFromLine, weatherFromReportLine, weatherFromCorpus, regionFromLine,
  isWeatherHeaderLine, weatherLabel, trendLabel, CLEAR,
} from './weather'
import { WEATHER_TABLE } from './weatherTable'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── 1. Every row is reachable through the matcher ────────────────────────────
{
  let orphans = 0
  let firstOrphan = ''
  let wrongSeverity = 0
  let firstWrong = ''
  for (const [text, region, season, severity, kind] of WEATHER_TABLE) {
    // Feed the row's own key back in, under its own season and region.
    const s = weatherFromCorpus(text, season === 'any' ? undefined : season, region)
    if (!s) {
      orphans++
      if (!firstOrphan) firstOrphan = text
      continue
    }
    if (s.severity !== severity || s.kind !== kind) {
      wrongSeverity++
      if (!firstWrong) firstWrong = `"${text}" got ${s.kind}/${s.severity}, wanted ${kind}/${severity}`
    }
  }
  eq('every corpus row is reachable', orphans, 0)
  check('no orphan rows', orphans === 0, firstOrphan)
  eq('every row grades back to its own severity and kind', wrongSeverity, 0)
  check('no misgraded rows', wrongSeverity === 0, firstWrong)
  check('the corpus is the size we generated', WEATHER_TABLE.length === 251, String(WEATHER_TABLE.length))
}

// ── 2. Season disambiguation ─────────────────────────────────────────────────
{
  // "It's raining steadily." is severity 6 in spring and 7 in summer — the case that
  // makes a season-blind matcher wrong.
  const spring = weatherFromLine("It's raining steadily.", 'spring')
  const summer = weatherFromLine("It's raining steadily.", 'summer')
  check('the seasonal rain line grades in spring', spring !== null)
  check('the seasonal rain line grades in summer', summer !== null)
  eq('spring reads it as severity 6', spring?.severity, 6)
  eq('summer reads it as severity 7', summer?.severity, 7)
  eq('both are rain', `${spring?.kind}/${summer?.kind}`, 'rain/rain')
  // The render intensity follows severity, so the overlay is denser in summer.
  check('the summer reading draws heavier', (summer?.level ?? 0) > (spring?.level ?? 0),
    `${spring?.level} vs ${summer?.level}`)
}

// ── 3. Direction and stars ───────────────────────────────────────────────────
{
  const worse = weatherFromLine('The rain begins to come down more heavily.', 'spring')
  const better = weatherFromLine('The rain slacks off somewhat.', 'spring')
  eq('a worsening transition reports worsening', worse?.trend, 'worsening')
  eq('an improving transition reports improving', better?.trend, 'improving')
  eq('they land on the same severity from opposite sides', worse?.severity, better?.severity)
  eq('the trend has a label', trendLabel(worse!), 'Worsening')
  eq('the improving trend has a label', trendLabel(better!), 'Clearing')

  // A plain state report carries no direction of its own.
  const state = weatherFromLine("It's raining steadily.", 'spring')
  eq('a state report invents no trend', state?.trend, undefined)
  eq('a state with no trend has no trend label', trendLabel(state!), '')

  // Star visibility rides along where the prose says.
  const starry = weatherFromLine('The night winter sky is a crisp, clear, starry black.', 'winter')
  eq('a starry line reports normal stars', starry?.stars, 'normal')
  const starless = weatherFromLine('The night winter sky is a hollow, vacant black.', 'winter')
  eq('a starless line reports no stars', starless?.stars, 'none')
}

// ── 4. Region ────────────────────────────────────────────────────────────────
{
  eq('desert prose latches the Muspari region',
    regionFromLine('A low haze of swirling sand obstructs most of the night sky.'), 'muspari')
  eq('temperate prose does not', regionFromLine("It's raining steadily."), null)

  const sand = weatherFromLine('The wind howls, completely obscuring the horizon in a veil of sand and dust.', undefined, 'muspari')
  check('the sandstorm line grades', sand !== null)
  eq('it reads as blowing sand', sand?.kind, 'dust')
  eq('it draws at full intensity', sand?.level, 4)
  eq('it labels as a sandstorm', weatherLabel(sand!), 'Sandstorm')
}

// ── 5. Fallback layers and non-weather prose ─────────────────────────────────
{
  // Layer 2: a wording the corpus does not carry verbatim.
  const ladder = weatherFromLine('It is snowing heavily.')
  check('the regex ladder still catches untabled wordings', ladder !== null)
  eq('and grades them as snow', ladder?.kind, 'snow')

  // Layer 3: only via the report path, so ambient cloud prose can't blank live rain.
  const keyword = weatherFromReportLine('Sheets of sleet hammer down from a bruised sky.')
  eq('an unknown precipitation wording still picks the right mode', keyword?.kind, 'snow')
  check('the same line is not graded by the always-on matcher',
    weatherFromLine('Sheets of sleet hammer down from a bruised sky.') === null)

  // Non-weather prose is never a reading, on either path.
  for (const line of ['A goblin ambushes you!', 'You feel fully rested.', '>', '']) {
    check(`"${line}" is not weather`, weatherFromLine(line) === null)
    check(`"${line}" is not a weather report`, weatherFromReportLine(line) === null)
  }

  eq('the weather header is recognized', isWeatherHeaderLine('You glance up at the sky.'), true)
  eq('other lines are not the header', isWeatherHeaderLine('You glance at your hands.'), false)
  // The header sometimes carries the state sentence on the same line.
  const sameLine = weatherFromLine('You glance up at the sky. The sky is completely clear.')
  check('a header-plus-state line still grades', sameLine !== null)
  eq('and reads as clear', sameLine?.kind, 'clear')

  eq('clear has no particles', CLEAR.level, 0)
  eq('clear labels as clear', weatherLabel(CLEAR), 'Clear')
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ weather: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ weather: ${passed} passed`)
