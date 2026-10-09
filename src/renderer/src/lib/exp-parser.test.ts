/**
 * EXP report text tests — skills and the rested-exp line.
 *
 * The rested-exp cases are taken verbatim from logged sessions, because the
 * shape of those figures is the whole difficulty: they're prose, the hour form
 * carries its own minutes after a colon, and the noun isn't pluralised
 * consistently ("1:41 hour" and "2:13 hours" are the same line on two nights).
 *
 * Run: npm run test:tools
 */

import {
  parseExpSkills, parseRestedExp, restedSeconds,
  parseCircle, parseOverallMind, sleepState, ranksGained, hasFieldExp,
} from './exp-parser'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── Skills ───────────────────────────────────────────────────────────────────
{
  const s = parseExpSkills('         Tactics:   1580 48% riveted       (28/34)')
  eq('one skill parsed', s.length, 1)
  eq('name',  s[0]?.name, 'Tactics')
  eq('rank',  s[0]?.rank, '1580')
  eq('pct',   s[0]?.pct, '48')
  eq('mind',  s[0]?.mind, 'riveted')
  eq('frac',  s[0]?.frac, '28/34')
}

// ── Rested exp ───────────────────────────────────────────────────────────────
{
  const r = parseRestedExp(
    'Rested EXP Stored: 4:21 hours  Usable This Cycle: 4:07 hours  Cycle Refreshes: 17:59 hours',
  )
  eq('stored',  r?.stored,  4 * 3600 + 21 * 60)
  eq('usable',  r?.usable,  4 * 3600 + 7 * 60)
  eq('refresh', r?.refresh, 17 * 3600 + 59 * 60)
}

// Same line, the other way DR words it: a bare hour, a colon form that says
// "hour" singular, and plain minutes.
{
  const r = parseRestedExp(
    'Rested EXP Stored: 1 hour  Usable This Cycle: 1:41 hour  Cycle Refreshes: 43 minutes',
  )
  eq('bare hours',            r?.stored,  3600)
  eq('singular colon hour',   r?.usable,  3600 + 41 * 60)
  eq('plain minutes',         r?.refresh, 43 * 60)
}

eq('a single minute', restedSeconds('1 minute'), 60)
eq('none is zero', restedSeconds('none'), 0)
// The game can sit on this phrasing for a long time; Lich treats it as nothing
// usable and so do we.
eq('less than a minute is zero', restedSeconds('less than a minute'), 0)
eq('empty is zero', restedSeconds(''), 0)

// Everything else in the report — including the line that merely mentions the
// feature in the BOOST menu — must not be read as a rested-exp reading.
eq('an ordinary line is not rested exp', parseRestedExp('Overall state of mind: clear'), null)
eq(
  'the boost menu entry is not rested exp',
  parseRestedExp('     27 BOOST EXP.................Rested EXP Refill/Reset'),
  null,
)

// ── Circle and overall mind ──────────────────────────────────────────────────
eq('circle parses', parseCircle('Circle: 200'), 200)
eq('a circle-less line is null', parseCircle('Total Ranks Displayed: 19594'), null)
// Spell circles are named, not numbered, so they can't be read as a character's
// circle even though the word matches.
eq('a named circle is not a number', parseCircle('Circle: Minor Elemental'), null)
eq('overall mind parses', parseOverallMind('Overall state of mind: clear'), 'clear')
eq('two-word mindstates survive', parseOverallMind('Overall state of mind: mind lock'), 'mind lock')
eq('an unrelated line is null', parseOverallMind('Overall state of the realm'), null)

// ── Sleep ────────────────────────────────────────────────────────────────────
// Both notices verbatim from logged sessions.
eq('awake when empty', sleepState(''), 'awake')
eq('awake when blank', sleepState('   '), 'awake')
eq(
  'deep sleep',
  sleepState('You are fully relaxed and your mind has entered a state of deep sleep.  To wake up and start learning again, type: AWAKEN'),
  'deep',
)
eq(
  'resting',
  sleepState('You are relaxed and your mind has entered a state of rest.  To wake up and start learning again, type: AWAKEN'),
  'resting',
)

// ── Ranks gained ─────────────────────────────────────────────────────────────
{
  const skills = [
    { name: 'Athletics', rank: 305, pct: 66 },   // baseline 305.00 → +0.66
    { name: 'Tactics',   rank: 1581, pct: 0 },   // baseline 1580.48 → +0.52
    { name: 'Sorcery',   rank: 100, pct: 0 },    // no baseline → ignored
  ]
  const baselines = { Athletics: 305, Tactics: 1580.48 }
  eq('gains sum across skills', ranksLabelish(ranksGained(skills, baselines)), '1.18')
  eq('no baseline, no contribution', ranksGained([skills[2]], baselines), 0)
  eq('nothing gained yet', ranksGained([{ name: 'Athletics', rank: 305, pct: 0 }], baselines), 0)
}
// A skill can read LOWER than its baseline — field experience decays back to
// clear — and that must not subtract from the session's total.
eq(
  'decay never goes negative',
  ranksGained([{ name: 'Athletics', rank: 305, pct: 0 }], { Athletics: 305.66 }),
  0,
)

// ── Field experience ─────────────────────────────────────────────────────────
// What decides whether a skill is listed in the Experience panel. It is the
// mindstate pool and never the percent toward the next rank — the panel used to
// test the percent, which hid a skill for as long as it sat at the start of a rank.
{
  check('a learning skill at 0% of a rank still has field exp',
    hasFieldExp({ mind: '12/34', mindWord: 'learning' }))
  check('a clear skill part-way through a rank has none',
    !hasFieldExp({ mind: '0/34', mindWord: 'clear' }))
  check('a fraction with padding is read', hasFieldExp({ mind: ' 1/34' }))
  check('no fraction: a mindstate word counts', hasFieldExp({ mind: '', mindWord: 'dabbling' }))
  check('no fraction: "clear" does not', !hasFieldExp({ mind: '', mindWord: 'clear' }))
  check('no fraction and no word is nothing', !hasFieldExp({ mind: '' }))

  // Straight off a report line, as the panel receives it: a guild skill that has
  // just ranked up, and a skill that is 13% into a rank but not learning at all.
  const [astrology, lunar] = parseExpSkills(
    '       Astrology:    450  0% mind lock    (34/34)     Lunar Magic:   1432 13% clear          (0/34)')
    .map(r => ({ name: r.name, mind: r.frac, mindWord: r.mind }))
  eq('the report line parses', `${astrology?.name}, ${lunar?.name}`, 'Astrology, Lunar Magic')
  check('ranked-up and mind locked is listed', hasFieldExp(astrology))
  check('mid-rank and clear is not', !hasFieldExp(lunar))
}

/** The panel rounds for display; do the same here so float noise can't fail the test. */
function ranksLabelish(n: number): string {
  return n.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ exp-parser: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ exp-parser: ${passed} passed`)
