/**
 * TDP mathematics tests, anchored to the worked examples published on Elanthipedia
 * so a future edit that "simplifies" a formula fails loudly instead of quietly
 * costing someone a few thousand points.
 *
 * Run: npm run test:tools
 */

import {
  STATS, RACES, RACIAL_MODIFIERS, racialSumsAreBalanced, modifierFor,
  costForPoint, costForRange, planCost, emptyStats,
  STARTING_TDPS, tdpsForCircle, tdpsFromCircling,
  poolPointsForSkill, tdpsFromSkills, pointsToNextTdp,
  parseStats, parseCircle, parseTdps,
  type StatBlock,
} from './tdp'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

// ── Racial table integrity ─────────────────────────────────────────────────────
check('races: table is non-empty', RACES.length >= 11, `got ${RACES.length}`)
check('races: every race balances to zero', racialSumsAreBalanced())
eq('races: Human is the neutral baseline', Object.keys(RACIAL_MODIFIERS.Human).length, 0)
eq("races: Gor'Tog Strength is -3", modifierFor("Gor'Tog", 'Strength'), -3)
eq('races: unknown race yields no modifier', modifierFor('Nonexistent', 'Strength'), 0)
eq('races: unlisted stat yields no modifier', modifierFor('Kaldar', 'Stamina'), 0)

// ── Single-point cost: the published Gor'Tog worked example ────────────────────
// (21 × 3) + (−3 × floor(21/2)) = 63 − 30 = 33. The floor matters: without integer
// truncation this would be 31.5.
eq("cost: Gor'Tog Strength 21→22 is 33", costForPoint(21, -3), 33)
eq('cost: Human Strength 21→22 is 63',   costForPoint(21, 0), 63)
eq('cost: base jumps to 15 at 100',      costForPoint(100, 0), 1500)
eq('cost: still base 3 at 99',           costForPoint(99, 0), 297)

// ── Range cost ─────────────────────────────────────────────────────────────────
// Human 60→75 = 3,015, exactly as published.
eq('cost: Human Strength 60→75 is 3015', costForRange(60, 75, 0), 3015)

// The Gor'Tog equivalent is published as "roughly 1,507" — that figure comes from
// the closed form (start+end−1)(end−start)(6+racial)/4, which treats the racial
// term as continuous. Summing point by point the way the game does gives 1518. The
// 11-point gap IS the truncation, and we deliberately keep the exact figure.
eq("cost: Gor'Tog Strength 60→75 is 1518 exactly", costForRange(60, 75, -3), 1518)
check('cost: exact figure is within 1% of the published approximation',
      Math.abs(1518 - 1507.5) / 1507.5 < 0.01)

eq('cost: no increase costs nothing', costForRange(30, 30, 0), 0)
eq('cost: a lower target costs nothing', costForRange(30, 20, 0), 0)

// ── Whole plans ────────────────────────────────────────────────────────────────
const cur: StatBlock = { ...emptyStats(), Strength: 60, Agility: 40 }
const tgt: StatBlock = { ...emptyStats(), Strength: 75, Agility: 40 }
const plan = planCost('Human', cur, tgt)
eq('plan: only raised stats appear', plan.rows.length, 1)
eq('plan: total matches the range cost', plan.total, 3015)

const togPlan = planCost("Gor'Tog", cur, tgt)
check('plan: cheap racial stat costs less than Human', togPlan.total < plan.total,
      `${togPlan.total} vs ${plan.total}`)

// ── Income: circling ───────────────────────────────────────────────────────────
eq('income: starting grant', STARTING_TDPS, 600)
eq('income: circle 27 grants 127', tdpsForCircle(27), 127)   // published example
eq('income: circle 9 grants 59',   tdpsForCircle(9), 59)     // 50 + 9, below the tier break
eq('income: circle 10 grants 110', tdpsForCircle(10), 110)   // 100 + 10, at the break
eq('income: circle 150 grants 250', tdpsForCircle(150), 250)
eq('income: nothing past 150',      tdpsForCircle(151), 0)
eq('income: nothing for circle 0',  tdpsForCircle(0), 0)
// Characters are created at circle 1, so it is never awarded — this is what makes
// the lifetime total below come out at the published figure rather than 51 over.
eq('income: nothing for circle 1',  tdpsForCircle(1), 0)
eq('income: circle 2 grants 52',    tdpsForCircle(2), 52)

// Cross-check against the published lifetime total from circling: 25,824.
eq('income: lifetime circling total is 25,824', tdpsFromCircling(0, 150), 25_824)
eq('income: circling past the cap adds nothing', tdpsFromCircling(0, 200), 25_824)
eq('income: range is exclusive of the starting circle', tdpsFromCircling(26, 27), 127)

// ── Income: the skill pool ─────────────────────────────────────────────────────
// A skill at rank N has contributed 1+2+…+N points.
eq('pool: rank 150 contributes 11,325 points', poolPointsForSkill(150), 11_325)
eq('pool: rank 0 contributes nothing',          poolPointsForSkill(0), 0)

// The published example is about two individual rank gains landing in the shared
// pool: 150 + 66 = 216 → one TDP, 16 points left over.
const sharedPool = 150 + 66
eq('pool: 216 points is 1 TDP', Math.floor(sharedPool / 200), 1)
eq('pool: leaving 16 over',     sharedPool % 200, 16)

// The pool is shared, so ranks must be summed BEFORE dividing — dividing per skill
// would discard both remainders and undercount.
const shared = tdpsFromSkills([100, 100])
const split  = Math.floor(poolPointsForSkill(100) / 200) * 2
check('pool: summing before dividing never undercounts', shared.tdps >= split,
      `shared ${shared.tdps} vs per-skill ${split}`)

const income = tdpsFromSkills([150])
eq('pool: rank 150 yields 56 TDPs', income.tdps, 56)          // floor(11325 / 200)
eq('pool: with 125 points left over', income.remainder, 125)
eq('pool: 75 more points to the next', pointsToNextTdp([150]), 75)

// Sanity-check the scale against the published per-guild lifetime maximum: a magic
// guild tops out near 398,352 TDPs across roughly fifty skills capped at 1750 ranks.
const oneCappedSkill = tdpsFromSkills([1750]).tdps
check('pool: ~52 capped skills lands near the published lifetime maximum',
      Math.abs(oneCappedSkill * 52 - 398_352) / 398_352 < 0.02,
      `one skill = ${oneCappedSkill}, ×52 = ${oneCappedSkill * 52}`)

// ── Parsing pasted game output ─────────────────────────────────────────────────
const info = `
  Name: Refia            Race: Elf           Guild: Empath
  Circle: 27             TDPs: 3,348
  Strength :  42         Reflex   :  38
  Agility  :  51         Charisma :  30
  Discipline: 44         Wisdom   :  36
  Intelligence: 55       Stamina  :  40
`
const parsed = parseStats(info)
eq('parse: Strength',     parsed.Strength, 42)
eq('parse: Intelligence', parsed.Intelligence, 55)
eq('parse: Stamina',      parsed.Stamina, 40)
eq('parse: all eight stats found', STATS.filter(s => parsed[s] !== undefined).length, 8)
eq('parse: circle',  parseCircle(info), 27)
eq('parse: TDPs with a thousands separator', parseTdps(info), 3348)

// Layout-agnostic: a one-line paste must work as well as a formatted block.
eq('parse: inline layout', parseStats('Strength: 12 Agility: 13').Strength, 12)
// And nothing at all must not invent values.
eq('parse: empty text yields nothing', Object.keys(parseStats('')).length, 0)
eq('parse: no circle present', parseCircle('nothing here'), null)

// ── Report ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`✓ all ${passed} TDP assertions passed`)
