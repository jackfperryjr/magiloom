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

import { pickScene, holidayFor, isNight, seasonOf, nthWeekday, dailyRoll, SCENES, SCENE, WILDCARD } from './loginScene'

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

  // Three Moons is a summer wildcard, and can only run at night.
  const poolAt = (roll: number, hr: number): string => nameOf(pickScene(at(2026, 7, 10, hr), roll).scene)
  const second = WILDCARD * 0.75            // lands on index 1 of a two-scene pool
  eq('night wildcard can be Three Moons', poolAt(second, 22), 'Three Moons')
  eq('day wildcard swaps it for Clear Day', poolAt(second, 13), 'Clear Day')
}

// ── Seasonal wildcards ─────────────────────────────────────────────────────────
// The seasonless scenes are not uniformly random: each season has its own two, so
// the forge turns up when it's cold and deep water when it isn't.
{
  const first  = WILDCARD * 0.25            // index 0 of a two-scene pool
  const second = WILDCARD * 0.75            // index 1
  const wild = (m: number, d: number, roll: number, hr = 13): string =>
    nameOf(pickScene(at(2026, m, d, hr), roll).scene)

  eq('spring wildcard 1', wild(3, 15, first),  'Deep Water')
  eq('spring wildcard 2', wild(3, 15, second), 'Downpour')
  eq('summer wildcard 1', wild(6, 20, first),  'Deep Water')
  eq('autumn wildcard 1', wild(9, 10, first),  'Forge')
  eq('autumn wildcard 2', wild(9, 10, second), 'Downpour')
  eq('winter wildcard 1', wild(0, 15, first),  'Forge')
  eq('winter wildcard 2', wild(0, 15, second, 22), 'Three Moons')

  // The scenes each season DOESN'T own must never arrive by wildcard.
  let strays = 0
  for (let n = 0; n < 365; n++) {
    const d = new Date(2026, 0, 1 + n); d.setHours(13)
    const season = seasonOf(d)
    const allowed: Record<string, string[]> = {
      spring: ['Deep Water', 'Downpour'], summer: ['Deep Water', 'Three Moons'],
      autumn: ['Forge', 'Downpour'],      winter: ['Forge', 'Three Moons'],
    }
    for (const roll of [first, second]) {
      const r = pickScene(d, roll, { holidays: false })
      // rule 'clock' means the pick was swapped for the hour, which is its own test.
      if (r.rule === 'random' && !allowed[season].includes(nameOf(r.scene))) strays++
    }
  }
  eq('no wildcard escapes its season', strays, 0)
}

// ── One scene per day ──────────────────────────────────────────────────────────
// The art must not change while someone sits on the login screen, and must not be
// the same every day either.
{
  const day = (m: number, d: number): number => dailyRoll(at(2026, m, d))

  eq('same day, same roll', day(5, 14), day(5, 14))
  check('consecutive days differ', day(5, 14) !== day(5, 15),
    `${day(5, 14)} vs ${day(5, 15)}`)
  check('roll stays in range',
    [...Array(400)].every((_, i) => { const r = day(0, 1 + i); return r >= 0 && r < 1 }))

  // The hour must not move the roll — only the calendar day.
  const morning = new Date(2026, 5, 14); morning.setHours(7)
  const night   = new Date(2026, 5, 14); night.setHours(23)
  eq('hour does not change the day roll', dailyRoll(morning), dailyRoll(night))

  // Spread: over a year the wildcard should fire on a sane slice of days, not
  // never (a constant hash) and not always (a broken range).
  let wild = 0
  for (let n = 0; n < 365; n++) {
    const d = new Date(2026, 0, 1 + n)
    if (dailyRoll(d) < WILDCARD) wild++
  }
  check('wildcards land on 15-35% of days', wild > 54 && wild < 128, `got ${wild}`)
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
