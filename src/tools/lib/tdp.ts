/**
 * DragonRealms TDP (Time Development Point) mathematics.
 *
 * Every formula and number here is sourced, not inferred — a planner that quietly
 * guesses is worse than no planner, because you only find out it was wrong after
 * spending the points. Sources:
 *
 *   • Cost to raise one attribute point, and the racial modifier table:
 *     https://elanthipedia.play.net/Attributes
 *   • TDP income (starting grant, per-circle award, the 200-point skill pool):
 *     https://elanthipedia.play.net/Time_Development_Points
 *
 * The racial table passes a useful sanity check: every race's modifiers sum to
 * exactly zero, so no race is globally cheaper — they only differ in WHERE their
 * points are cheap. A transcription error would almost certainly break that, and
 * `racialSumsAreBalanced` below asserts it at test time.
 *
 * Where a value could not be verified it is absent rather than approximated. The
 * game itself is always the final word (`TDP PROJECT <attribute> <goal>`).
 *
 * Pure: no DOM, no React. Same reasoning as logAnalysis.ts.
 */

// ── Attributes ──────────────────────────────────────────────────────────────────

export const STATS = [
  'Strength', 'Reflex', 'Agility', 'Charisma',
  'Discipline', 'Wisdom', 'Intelligence', 'Stamina',
] as const

export type StatName = typeof STATS[number]

export type StatBlock = Record<StatName, number>

export const emptyStats = (): StatBlock =>
  Object.fromEntries(STATS.map(s => [s, 0])) as StatBlock

// ── Races ───────────────────────────────────────────────────────────────────────

/**
 * Racial TDP cost modifier per attribute, -3 (cheapest) to +3 (dearest). Omitted
 * entries are 0. Only races whose rows appear on the source page are listed —
 * inventing a missing row would silently mis-plan a whole character, so a race we
 * can't source simply isn't offered.
 */
export const RACIAL_MODIFIERS: Record<string, Partial<Record<StatName, number>>> = {
  Human:       {},
  Dwarf:       { Strength: +1, Reflex: +1, Agility: -1, Charisma: -1 },
  Elf:         { Agility: +1, Charisma: -1, Discipline: -1, Wisdom: -1, Intelligence: +1, Stamina: +1 },
  Elothean:    { Reflex: +1, Charisma: -1, Discipline: -1, Wisdom: -1, Intelligence: +2 },
  Gnome:       { Strength: +3, Agility: -2, Charisma: -1, Discipline: -2, Intelligence: +2 },
  "Gor'Tog":   { Strength: -3, Reflex: +1, Agility: +2, Charisma: +2, Wisdom: -2 },
  Halfling:    { Strength: +2, Agility: -1, Charisma: -2, Discipline: +1, Wisdom: +1, Intelligence: -1 },
  Kaldar:      { Strength: -1, Reflex: -1, Agility: +1, Charisma: +1 },
  Prydaen:     { Strength: -2, Reflex: -1, Agility: +1, Discipline: +2 },
  Rakash:      { Strength: -1, Reflex: +1, Agility: -1, Charisma: +1, Discipline: +2, Wisdom: -2 },
  "S'Kra Mur": { Strength: -1, Reflex: -1, Agility: +1, Charisma: +1 },
}

export const RACES = Object.keys(RACIAL_MODIFIERS).sort()

export function modifierFor(race: string, stat: StatName): number {
  return RACIAL_MODIFIERS[race]?.[stat] ?? 0
}

/** Test hook: every race's modifiers must sum to zero (see the file header). */
export function racialSumsAreBalanced(): boolean {
  return Object.values(RACIAL_MODIFIERS).every(
    mods => Object.values(mods).reduce((n, v) => n + (v ?? 0), 0) === 0,
  )
}

// ── Cost ────────────────────────────────────────────────────────────────────────

/**
 * TDP cost to raise an attribute from `from` to `from + 1`.
 *
 *     cost = base × from + racial × floor(from / 2)
 *
 * where base is 3 below 100 and 15 at 100 and above. Integer math throughout — the
 * halving truncates, which is why the Gor'Tog worked example comes out at exactly 33
 * (3×21 = 63, then −3 × floor(21/2) = −3 × 10 = −30) rather than 31.5.
 */
export function costForPoint(from: number, racial: number): number {
  const base = from >= 100 ? 15 : 3
  return base * from + racial * Math.floor(from / 2)
}

/**
 * Total TDP cost to raise an attribute from `from` to `to`. Summed point by point
 * rather than using the published closed form, because the closed form treats the
 * racial term as continuous and drifts from the game's integer truncation.
 * Returns 0 when `to` is not above `from`.
 */
export function costForRange(from: number, to: number, racial: number): number {
  let total = 0
  for (let v = Math.max(0, from); v < to; v++) total += costForPoint(v, racial)
  return total
}

export interface StatPlanRow {
  stat:     StatName
  from:     number
  to:       number
  racial:   number
  cost:     number
}

export interface StatPlan {
  rows:  StatPlanRow[]
  total: number
}

/** Cost of a whole set of attribute goals. Stats with no increase are omitted. */
export function planCost(race: string, current: StatBlock, target: StatBlock): StatPlan {
  const rows: StatPlanRow[] = []
  for (const stat of STATS) {
    const from = current[stat] || 0
    const to   = target[stat]  || 0
    if (to <= from) continue
    const racial = modifierFor(race, stat)
    rows.push({ stat, from, to, racial, cost: costForRange(from, to, racial) })
  }
  return { rows, total: rows.reduce((n, r) => n + r.cost, 0) }
}

// ── Income ──────────────────────────────────────────────────────────────────────

/** TDPs granted by the Character Manager at creation. */
export const STARTING_TDPS = 600

/**
 * Highest circle the tools plan for. Nobody is anywhere near it — it's a ceiling on
 * the inputs, not a claim that the circle exists. Requirements past 200 are projected
 * (see circleReqs.generated.ts).
 */
export const MAX_CIRCLE = 300

/**
 * No TDPs are awarded for circles beyond this. Distinct from MAX_CIRCLE: you keep
 * circling past 150, you just stop being paid for it.
 */
export const MAX_CIRCLE_AWARD = 150

/**
 * TDPs awarded for REACHING a given circle: 50 + circle below circle 10, then
 * 100 + circle from circle 10, and nothing past circle 150. (Reaching circle 27
 * grants 127, the worked example on the source page.)
 *
 * Circle 1 awards NOTHING — a character is created at circle 1, so there is no
 * advancement to pay for, and the 600-point creation grant is the whole of it.
 * That isn't stated outright anywhere, but it's forced by the published lifetime
 * total: awarding circle 1 puts the maximum at 25,875, exactly 51 (= 50 + 1) above
 * the documented 25,824. `tdpsFromCircling(0, 150)` is asserted against that figure
 * in the tests, which is what pins this down.
 */
export function tdpsForCircle(circle: number): number {
  if (circle < 2 || circle > MAX_CIRCLE_AWARD) return 0
  return (circle < 10 ? 50 : 100) + circle
}

/** Total TDPs from circling, for every circle in (from, to]. */
export function tdpsFromCircling(from: number, to: number): number {
  let total = 0
  for (let c = Math.max(1, Math.floor(from) + 1); c <= Math.floor(to); c++) total += tdpsForCircle(c)
  return total
}

/**
 * Points a single skill has contributed to the hidden TDP pool by reaching `rank`.
 * Each rank gained contributes its own rank number, so a skill at rank N has
 * contributed 1 + 2 + … + N.
 */
export function poolPointsForSkill(rank: number): number {
  const r = Math.max(0, Math.floor(rank))
  return (r * (r + 1)) / 2
}

/** Every 200 pool points is one TDP; the remainder stays in the pool. */
export const POOL_PER_TDP = 200

export interface SkillIncome {
  /** Total pool points contributed by all supplied ranks. */
  points:    number
  tdps:      number
  /** Points left over toward the next TDP. */
  remainder: number
}

/**
 * TDPs earned from a set of skill ranks. The pool is shared across every skill, so
 * these are summed before dividing — splitting per skill would lose the remainders
 * and undercount.
 */
export function tdpsFromSkills(ranks: number[]): SkillIncome {
  const points = ranks.reduce((n, r) => n + poolPointsForSkill(r), 0)
  return {
    points,
    tdps:      Math.floor(points / POOL_PER_TDP),
    remainder: points % POOL_PER_TDP,
  }
}

/**
 * Pool points still needed for the next TDP given a set of ranks — the "you're this
 * close" number, which is the one people actually want when deciding what to train.
 */
export function pointsToNextTdp(ranks: number[]): number {
  return POOL_PER_TDP - tdpsFromSkills(ranks).remainder
}

// ── Parsing the game's own output ───────────────────────────────────────────────

/**
 * Pull attribute values out of pasted game text (the INFO report, or anything else
 * listing them). Deliberately layout-agnostic: it looks for "<Stat>: <number>"
 * anywhere in the text rather than assuming a column arrangement, because INFO's
 * formatting differs between clients and has changed over time. Unknown words are
 * ignored, so pasting a whole screen is fine.
 */
export function parseStats(text: string): Partial<StatBlock> {
  const out: Partial<StatBlock> = {}
  for (const stat of STATS) {
    const re = new RegExp(`\\b${stat}\\b\\s*:?\\s*(\\d{1,3})\\b`, 'i')
    const m = re.exec(text)
    if (m) {
      const v = +m[1]
      if (v > 0 && v < 1000) out[stat] = v
    }
  }
  return out
}

/** Pull a circle number out of pasted text ("Circle: 27"). */
export function parseCircle(text: string): number | null {
  const m = /\bcircle\b\s*:?\s*(\d{1,3})\b/i.exec(text)
  return m ? +m[1] : null
}

/** Pull a current TDP balance out of pasted text ("TDPs: 3348"). */
export function parseTdps(text: string): number | null {
  const m = /\bTDPs?\b\s*:?\s*([\d,]+)\b/i.exec(text)
  return m ? +m[1].replace(/,/g, '') : null
}
