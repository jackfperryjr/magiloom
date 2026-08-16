/**
 * Elanthian clock, calendar and moon tests.
 *
 * The clock and the moons are now closed-form off the wall clock, which buys us
 * correctness on connect but removes the safety net of a live anchor: a wrong
 * constant produces a plausible-looking wrong answer rather than an obvious blank.
 * These assert the properties that would catch that:
 *
 *   1. The units compose. Roisaen roll into anlaen roll into days roll into months
 *      and years, with no drift at the boundaries and no negative-modulo holes.
 *   2. The sun is symmetric about midday and swings the right way with the season —
 *      the old table was skewed a quarter-anlas late and nobody noticed.
 *   3. The moons' up/down cycles match the durations the community `moonwatch`
 *      script fitted independently, which is the one external check we have on the
 *      orbital periods.
 *   4. Both self-corrections actually converge: feeding the model a TIME report or a
 *      witnessed moonrise that disagrees with it moves it into agreement.
 *
 * Run: npm run test:tools
 */

import {
  computeSky, correctionFromTimeLine, resetTimeCalibration, formatDate,
  MONTHS, WEEKS, YEAR_NAMES, ANLAEN, MINUTES_PER_DAY,
} from './elanthianTime'
import { computeMoonPosition, correctionFromMoonLine, MOONS, type MoonName } from './moons'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const MIN = 60_000
const DAY = MINUTES_PER_DAY * MIN          // 6 real hours

// ── 1. Units compose ─────────────────────────────────────────────────────────
{
  const t0 = 1_700_000_000_000

  // Walk a full Elanthian day a roisan at a time and confirm every field is in range
  // and the anlas/roisan pair is exactly the minute count.
  let bad = ''
  for (let m = 0; m < MINUTES_PER_DAY; m++) {
    const s = computeSky(t0 + m * MIN)
    if (s.minutesIntoDay !== (Math.floor(t0 / MIN) + 80_895 + m) % MINUTES_PER_DAY) { bad = `minutesIntoDay at +${m}`; break }
    if (s.anlasIndex * 30 + s.roisan !== s.minutesIntoDay) { bad = `anlas/roisan split at +${m}`; break }
    if (s.anlasIndex < 0 || s.anlasIndex > 11) { bad = `anlasIndex ${s.anlasIndex} at +${m}`; break }
    if (s.roisan < 0 || s.roisan > 29) { bad = `roisan ${s.roisan} at +${m}`; break }
    if (s.dayOfMonth < 1 || s.dayOfMonth > 40) { bad = `dayOfMonth ${s.dayOfMonth} at +${m}`; break }
    if (s.anlasName !== ANLAEN[s.anlasIndex]) { bad = `anlasName at +${m}`; break }
  }
  check('every roisan of a day is in range and self-consistent', bad === '', bad)

  // Day boundaries: exactly 360 roisaen apart, and the date ticks over with them.
  const a = computeSky(t0)
  const b = computeSky(t0 + DAY)
  eq('one day later is the same time of day', b.minutesIntoDay, a.minutesIntoDay)
  eq('one day later is the next day of the year', b.dayOfYear, (a.dayOfYear + 1) % 400)

  // A year is 400 days and returns to the same calendar position, one year on.
  const y = computeSky(t0 + 400 * DAY)
  eq('a year later is the same day of the year', y.dayOfYear, a.dayOfYear)
  eq('a year later is the next year', y.year, a.year + 1)
  eq('the year name advances on a 7-cycle', y.yearName, YEAR_NAMES[(a.year + 1) % 7])

  // Month/week derivation over a whole year: each month is 40 days, each week 4.
  const seen = new Set<string>()
  let monthBad = ''
  for (let d = 0; d < 400; d++) {
    const s = computeSky(t0 + d * DAY)
    seen.add(s.monthName)
    const expectedMonth = MONTHS[Math.floor(s.dayOfYear / 40)]
    if (s.monthName !== expectedMonth) { monthBad = `day ${d}: ${s.monthName} != ${expectedMonth}`; break }
    if (s.weekName !== WEEKS[Math.floor((s.dayOfYear % 40) / 4)]) { monthBad = `week name at day ${d}`; break }
  }
  check('every day of a year lands in the right month and week', monthBad === '', monthBad)
  eq('a year covers all ten months', seen.size, 10)

  // Negative-modulo hole: a timestamp before the Unix epoch must not produce
  // negative fields (the old anchor arithmetic could).
  const pre = computeSky(-5 * DAY)
  check('pre-epoch timestamps stay in range',
    pre.dayOfYear >= 0 && pre.minutesIntoDay >= 0 && pre.dayOfMonth >= 1,
    JSON.stringify({ doy: pre.dayOfYear, mid: pre.minutesIntoDay, dom: pre.dayOfMonth }))

  check('the date formats as day, month, year', /^\d{1,2} .+, \d+$/.test(formatDate(a)), formatDate(a))
}

// ── 2. The sun ───────────────────────────────────────────────────────────────
{
  // Sample one day per day-of-year by stepping a whole Elanthian day at a time.
  const t0 = 1_700_000_000_000
  let base = computeSky(t0)
  // Walk to day-of-year 0 so the samples below are indexed by season.
  const start = t0 + ((400 - base.dayOfYear) % 400) * DAY
  base = computeSky(start)
  eq('walked to the start of the year', base.dayOfYear, 0)

  const sun = (doy: number) => computeSky(start + doy * DAY)

  // Symmetric about solar noon at minute 180: sunrise and sunset step apart together.
  let asym = ''
  for (let d = 0; d < 400; d += 7) {
    const s = sun(d)
    if (s.sunrise + s.sunset !== 360) { asym = `day ${d}: ${s.sunrise}+${s.sunset}`; break }
    if (s.sunset - s.sunrise !== s.dayLength) { asym = `day ${d} dayLength`; break }
    if (s.dayLength < 118 || s.dayLength > 242) { asym = `day ${d} dayLength ${s.dayLength}`; break }
  }
  check('the sun is symmetric about midday all year', asym === '', asym)

  // Midwinter (day 0) is the shortest day; midsummer (day 200) the longest.
  check('midwinter is the shortest day', sun(0).dayLength < sun(100).dayLength, `${sun(0).dayLength} vs ${sun(100).dayLength}`)
  check('midsummer is the longest day', sun(200).dayLength > sun(100).dayLength, `${sun(200).dayLength} vs ${sun(100).dayLength}`)
  eq('midwinter season is winter', sun(0).season, 'winter')
  eq('midsummer season is summer', sun(200).season, 'summer')

  // Daylight ramps rather than snapping, and is zero outside the sun's span.
  const day = sun(200)
  const at = (min: number) => computeSky(start + 200 * DAY + (min - day.minutesIntoDay) * MIN)
  check('it is dark before sunrise', at(day.sunrise - 5).daylight === 0)
  check('it is fully light at midday', at(180).daylight === 1)
  check('it is dark after sunset', at(day.sunset + 5).daylight === 0)
  check('dawn is partial light', at(day.sunrise + 15).daylight > 0 && at(day.sunrise + 15).daylight < 1)
  eq('midday reads as midday', at(180).segment, 'midday')
}

// ── 3. Moon cycles match the independently fitted durations ──────────────────
{
  // What dr-scripts `moonwatch` fitted, as [up, down] roisaen. Our orbital model
  // should reproduce the CYCLE (up + down); the split between up and down is fit
  // noise in the original and is not asserted.
  const FITTED: Record<MoonName, [number, number]> = {
    Xibar: [172, 174], Katamba: [174, 177], Yavash: [175, 177],
  }

  const t0 = 1_700_000_000_000
  for (const { name } of MOONS) {
    // Measure real run lengths by walking a minute at a time over 20 days.
    const runs: { up: boolean; len: number }[] = []
    let prev = computeMoonPosition(name, t0).visible
    let len = 1
    for (let m = 1; m <= 20 * 360; m++) {
      const up = computeMoonPosition(name, t0 + m * MIN).visible
      if (up === prev) len++
      else { runs.push({ up: prev, len }); prev = up; len = 1 }
    }
    const mid = runs.slice(1, -1)                       // drop the clipped ends
    const ups = mid.filter(r => r.up).map(r => r.len)
    const downs = mid.filter(r => !r.up).map(r => r.len)
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length
    const cycle = avg(ups) + avg(downs)
    const [fu, fd] = FITTED[name]
    check(`${name} cycle matches moonwatch's fitted ${fu + fd} roisaen`,
      Math.abs(cycle - (fu + fd)) <= 2, `computed ${cycle.toFixed(1)}`)
    check(`${name} is up for roughly half its cycle`,
      Math.abs(avg(ups) - cycle / 2) < 3, `up ${avg(ups).toFixed(1)} of ${cycle.toFixed(1)}`)
  }

  // All three moons are placed immediately, with no anchor and no network — the
  // regression that started all this.
  const now = Date.now()
  const positions = MOONS.map(m => computeMoonPosition(m.name, now))
  eq('all three moons report a position straight away', positions.length, 3)
  check('every moon has a phase and a countdown',
    positions.every(p => p.msToEvent > 0 && p.phase.illum >= 0 && p.phase.illum <= 1 && p.phase.label !== ''))
  check('a visible moon sits somewhere on its arc',
    positions.filter(p => p.visible).every(p => p.arc >= 0 && p.arc <= 1))

  // Phase walks the full cycle over a season rather than sitting still.
  const labels = new Set<string>()
  for (let d = 0; d < 120; d++) labels.add(computeMoonPosition('Katamba', t0 + d * DAY).phase.label)
  check('Katamba passes through several phases over a season', labels.size >= 5, `${labels.size} distinct`)

  // The phase NAME and the illuminated fraction must agree: naming the sector off the
  // raw angle put "waning crescent" on a disc reporting 0% lit.
  let mismatch = ''
  for (const { name } of MOONS) {
    for (let d = 0; d < 400 && !mismatch; d++) {
      const { phase } = computeMoonPosition(name, t0 + d * DAY)
      const { illum, label } = phase
      const want =
        illum < 0.03 ? 'new'
        : illum > 0.97 ? 'full'
        : illum < 0.47 ? 'crescent'
        : illum < 0.53 ? 'quarter'
        : 'gibbous'
      if (!label.includes(want)) mismatch = `${name} day ${d}: "${label}" at ${(illum * 100).toFixed(0)}% lit`
    }
  }
  check('every phase name matches its illuminated fraction', mismatch === '', mismatch)
}

// ── 4. Both self-corrections converge ────────────────────────────────────────
{
  // A TIME report that disagrees with the model should produce a correction that,
  // once applied, makes the model agree.
  resetTimeCalibration()
  const now = 1_700_000_000_000
  const model = computeSky(now)

  // Build an anlas line describing a time 47 roisaen ahead of what the model thinks.
  const target = (model.minutesIntoDay + 47) % MINUTES_PER_DAY
  const idx = Math.floor(target / 30)
  const roisaen = target % 30
  const line = `You're fairly sure that it is ${roisaen} roisaen after the Anlas of ${ANLAEN[idx]}.`

  const correction = correctionFromTimeLine(line, now, 0)
  check('a disagreeing TIME report yields a correction', correction !== null, String(correction))
  if (correction !== null) {
    const fixed = computeSky(now, correction)
    eq('the corrected clock matches the report', fixed.minutesIntoDay, target)
  }

  // A report that agrees should not churn the offset.
  resetTimeCalibration()
  const agreeIdx = Math.floor(model.minutesIntoDay / 30)
  const agreeLine = `You're fairly sure that it is ${model.minutesIntoDay % 30} roisaen after the Anlas of ${ANLAEN[agreeIdx]}.`
  eq('an agreeing TIME report is a no-op', correctionFromTimeLine(agreeLine, now, 0), null)

  // A line that isn't a TIME report at all is ignored.
  resetTimeCalibration()
  eq('unrelated prose is not a calibration', correctionFromTimeLine('A goblin ambushes you!', now, 0), null)

  // Moons: find a moment the model says Katamba is NOT rising, claim it rose, and
  // check the correction lines the model up with the claim.
  const base = 1_700_000_000_000
  let riseAt = 0
  for (let m = 1; m < 400; m++) {
    const before = computeMoonPosition('Katamba', base + (m - 1) * MIN).visible
    const after = computeMoonPosition('Katamba', base + m * MIN).visible
    if (!before && after) { riseAt = base + m * MIN; break }
  }
  check('found a modelled Katamba rise to test against', riseAt > 0)

  // Claim the rise happened 20 roisaen later than modelled.
  const claimed = riseAt + 20 * MIN
  const mc = correctionFromMoonLine('Katamba slowly rises above the horizon.', claimed, {})
  check('a disagreeing moonrise yields a correction', mc !== null, JSON.stringify(mc))
  if (mc) {
    eq('the correction names the right moon', mc.name, 'Katamba')
    const before = computeMoonPosition('Katamba', claimed - MIN, { Katamba: mc.correction }).visible
    const after = computeMoonPosition('Katamba', claimed, { Katamba: mc.correction }).visible
    check('the corrected model has Katamba rising exactly when claimed', !before && after,
      `before=${before} after=${after} correction=${mc.correction}`)
  }

  // A moonrise the model already agrees with leaves it alone.
  eq('an agreeing moonrise is a no-op',
    correctionFromMoonLine('Katamba slowly rises above the horizon.', riseAt, {}), null)
  eq('unrelated prose is not a moon event',
    correctionFromMoonLine('You see a moon-shaped pastry.', riseAt, {}), null)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ elanthianSky: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ elanthianSky: ${passed} passed`)
