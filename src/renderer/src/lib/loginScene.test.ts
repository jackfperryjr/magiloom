/**
 * Login-scene selection tests.
 *
 * The rules here are invisible when they work and embarrassing when they don't —
 * a daylight scene at 2am, or a random wildcard turning up on Christmas. Both are
 * asserted exhaustively across a whole year rather than spot-checked, because the
 * bugs are in the interaction between the tiers, not in any one of them.
 *
 * Run: npm run test:tools
 */

import { pickScene, holidayFor, isNight, seasonOf, nthWeekday, SCENES, SCENE, WILDCARD } from './loginScene'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)

const at = (y: number, m: number, d: number, hr = 13): Date => {
  const dt = new Date(y, m, d)
  dt.setHours(hr)
  return dt
}
const nameOf = (i: number): string => SCENES[i].name

// ── Holidays ───────────────────────────────────────────────────────────────────
{
  eq('Yule',            nameOf(pickScene(at(2026, 11, 25), 0.9).scene), 'Yule')
  eq('New Year eve',    nameOf(pickScene(at(2026, 11, 31), 0.9).scene), 'Fireworks')
  eq('New Year day',    nameOf(pickScene(at(2027, 0, 1), 0.9).scene),   'Fireworks')
  eq('Hallows',         nameOf(pickScene(at(2026, 9, 31), 0.9).scene),  'Hallows')
  eq('Fourth of July',  nameOf(pickScene(at(2026, 6, 4), 0.9).scene),   'Fireworks')
  eq('Thanksgiving',    nameOf(pickScene(at(2026, 10, 26), 0.9).scene), 'Harvest')

  // Thanksgiving is the one movable date, so pin the arithmetic down.
  eq('4th Thu Nov 2026', nthWeekday(2026, 10, 4, 4), 26)
  eq('4th Thu Nov 2027', nthWeekday(2027, 10, 4, 4), 25)

  // Each occasion dresses Loomy for itself; Fireworks serves two.
  eq('Yule hat',    pickScene(at(2026, 11, 25), 0.9).hat, 'santa')
  eq('Hallows hat', pickScene(at(2026, 9, 31), 0.9).hat,  'witch')
  eq('Harvest hat', pickScene(at(2026, 10, 26), 0.9).hat, 'pilgrim')
  eq('July 4 hat',  pickScene(at(2026, 6, 4), 0.9).hat,   'sam')
  eq('New Year hat', pickScene(at(2027, 0, 1), 0.9).hat,  'party')

  // A wildcard roll must not be able to displace a holiday.
  eq('wildcard cannot beat Yule', nameOf(pickScene(at(2026, 11, 25), 0.001).scene), 'Yule')

  // Holidays are exempt from the clock, or Yule would vanish at midday.
  eq('Yule at noon stays Yule', nameOf(pickScene(at(2026, 11, 25), 0.9, {}).scene), 'Yule')

  // ...and can be switched off entirely.
  eq('holidays off falls back to season',
    nameOf(pickScene(at(2026, 11, 25), 0.9, { holidays: false }).scene), 'Snowfall')
}

// ── Seasons ────────────────────────────────────────────────────────────────────
{
  eq('spring', nameOf(pickScene(at(2026, 3, 15), 0.9).scene), 'Blossom')
  eq('summer', nameOf(pickScene(at(2026, 6, 20), 0.9).scene), 'Clear Day')
  eq('autumn', nameOf(pickScene(at(2026, 9, 10), 0.9).scene), 'Grove')
  eq('winter', nameOf(pickScene(at(2026, 0, 15), 0.9).scene), 'Snowfall')
  eq('season boundary Mar 20', seasonOf(at(2026, 2, 20)), 'spring')
  eq('season boundary Mar 19', seasonOf(at(2026, 2, 19)), 'winter')
}

// ── Day / night substitution ───────────────────────────────────────────────────
{
  eq('night is night at 22', isNight(at(2026, 6, 20, 22)), true)
  eq('day is day at 13',     isNight(at(2026, 6, 20, 13)), false)

  eq('summer night becomes Clear Night',
    nameOf(pickScene(at(2026, 6, 20, 22), 0.9).scene), 'Clear Night')
  eq('spring night becomes Clear Night',
    nameOf(pickScene(at(2026, 3, 15, 23), 0.9).scene), 'Clear Night')
  eq('winter night keeps Snowfall',
    nameOf(pickScene(at(2026, 0, 15, 22), 0.9).scene), 'Snowfall')

  // Three Moons is the wildcard that can only run at night.
  const poolAt = (roll: number, hr: number): string => nameOf(pickScene(at(2026, 7, 10, hr), roll).scene)
  const moonRoll = (WILDCARD / 4) * 1.5     // lands on index 1 of the anytime pool
  eq('night wildcard can be Three Moons', poolAt(moonRoll, 22), 'Three Moons')
  eq('day wildcard swaps it for Clear Day', poolAt(moonRoll, 13), 'Clear Day')
}

// ── Pinning ────────────────────────────────────────────────────────────────────
{
  const p = pickScene(at(2026, 11, 25), 0.9, { pinned: 'deep' })
  eq('pinned overrides even a holiday', nameOf(p.scene), 'Deep Water')
  eq('pinned reports itself', p.rule, 'pinned')
  eq('unknown pin falls through', nameOf(pickScene(at(2026, 6, 20), 0.9, { pinned: 'nope' }).scene), 'Clear Day')
}

// ── Whole-year invariants ──────────────────────────────────────────────────────
{
  let clockViolations = 0, holidayViolations = 0, invalid = 0, holidayDays = 0
  for (let n = 0; n < 365; n++) {
    for (const hr of [1, 9, 13, 17, 21, 23]) {
      const d = new Date(2026, 0, 1 + n)
      d.setHours(hr)
      if (hr === 13 && holidayFor(d)) holidayDays++
      for (const roll of [0, 0.06, 0.12, 0.19, 0.3, 0.9]) {
        const r = pickScene(d, roll)
        const meta = SCENES[r.scene]
        if (!meta) { invalid++; continue }
        if (holidayFor(d) && r.rule !== 'holiday') holidayViolations++
        if (r.rule !== 'holiday') {
          if (isNight(d) && meta.light === 'day') clockViolations++
          if (!isNight(d) && meta.light === 'night') clockViolations++
        }
      }
    }
  }
  eq('every pick resolves to a real scene', invalid, 0)
  eq('no holiday is ever overridden', holidayViolations, 0)
  eq('no scene is ever shown at the wrong time of day', clockViolations, 0)
  check('holidays cover a sane slice of the year', holidayDays > 15 && holidayDays < 40, `got ${holidayDays}`)
}

// ── Scene table sanity ─────────────────────────────────────────────────────────
{
  SCENES.forEach((s, i) => eq(`SCENES[${i}] index matches position`, s.index, i))
  eq('every scene has a unique key', new Set(SCENES.map(s => s.key)).size, SCENES.length)
  eq('clearNight is the last scene', SCENES[SCENES.length - 1].index, SCENE.clearNight)
}

if (failures.length) {
  console.error(`loginScene: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`loginScene: ${passed} assertions passed`)
