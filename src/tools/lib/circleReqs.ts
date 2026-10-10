/**
 * Circle requirements: matching a character's EXP ALL report against their guild's
 * required ranks.
 *
 * The numbers live in circleReqs.generated.ts (scraped — see that file's banner).
 * What lives here is the part that isn't a table: working out WHICH of your skills
 * each requirement is talking about.
 *
 * SLOTS. A guild's requirements are columns like "1st Weapon", "8th Survival",
 * "Parry Ability". Two kinds:
 *   • POSITIONAL — "3rd Survival" means your third-highest Survival skill. Which
 *     skill that is depends on your character, so it's resolved per report.
 *   • NAMED — "Parry Ability", "Stealth", "Theurgy" name one specific skill.
 *
 * WHICH SKILLS CAN FILL AN Nth SLOT is the part that is easy to get wrong, and this
 * file did: it used to let any skill of the skillset fill a positional slot unless the
 * guild named it. The game's rule, as each guild's Elanthipedia page states it, is
 * narrower in three ways and wider in one — see `nthPool` below, which is the single
 * place it is applied:
 *   • "Mastery" skills never count, for anyone: Defending, Parry Ability, Offhand
 *     Weapon, Melee Mastery, Missile Mastery, and the guild's own primary magic.
 *   • A guild's HARD requirements (Barbarian's Evasion, Trader's Appraisal) are checked
 *     on their own and cannot also be one of its Nth skills.
 *   • A few skills are barred per guild (Sorcery and Thievery for a Cleric).
 *   • But a guild's SOFT requirements (Thief's Stealth and Thievery) are checked on
 *     their own AND count as Nth skills. The old rule excluded every named skill,
 *     which under-counted exactly the skills those guilds train hardest.
 *
 * Every guild is checked in the tests for having enough eligible skills to fill its
 * positional slots — if one ever asks for more than it has, that's a taxonomy error
 * and it fails loudly rather than silently under-reporting.
 *
 * Pure: no DOM, no React.
 */

import { CIRCLE_REQS, type GuildCircleReqs } from './circleReqs.generated'

export { CIRCLE_REQS }
export const GUILDS = Object.keys(CIRCLE_REQS).sort()

/**
 * True when a circle's requirements are projected rather than published — see the
 * generated file's banner. Every guild is scraped to the same circle, so this is a
 * property of the circle, not of the guild.
 */
export function isProjectedCircle(guild: string, circle: number): boolean {
  const g = CIRCLE_REQS[guild]
  return !!g && circle > g.scrapedThrough
}

// ── Skillsets ───────────────────────────────────────────────────────────────────

/**
 * Skillset membership, per https://elanthipedia.play.net/Category:Skills.
 *
 * This is MEMBERSHIP — which skillset a skill belongs to — and nothing more. Being a
 * Weapon skill does not make a skill count toward "2nd Weapon"; `nthPool` decides
 * that. Guild skills are listed under the skillset they belong to (the experience
 * window's "Guild Skills" row is a display grouping: mechanically Backstab is a
 * Survival skill and Expertise a Weapon skill).
 *
 * Weapon names are the DR 3.0 ones. Light + Medium Edged were merged into Small
 * Edged and Heavy Edged renamed to Large Edged (same for Blunt); the old names are
 * marked obsolete on the wiki and never appear in a modern report.
 */
export const SKILLSETS: Record<string, string[]> = {
  Weapon: [
    'Parry Ability', 'Small Edged', 'Large Edged', 'Twohanded Edged',
    'Small Blunt', 'Large Blunt', 'Twohanded Blunt',
    'Slings', 'Bow', 'Crossbow', 'Staves', 'Polearms',
    'Light Thrown', 'Heavy Thrown', 'Brawling', 'Offhand Weapon', 'Expertise',
  ],
  Armor: [
    'Shield Usage', 'Light Armor', 'Chain Armor', 'Brigandine', 'Plate Armor', 'Defending',
  ],
  Survival: [
    'Evasion', 'Athletics', 'Perception', 'Stealth', 'Locksmithing', 'Thievery',
    'First Aid', 'Outdoorsmanship', 'Skinning', 'Backstab', 'Instinct',
  ],
  Lore: [
    'Alchemy', 'Appraisal', 'Enchanting', 'Engineering', 'Forging', 'Outfitting',
    'Performance', 'Scholarship', 'Mechanical Lore', 'Tactics', 'Bardic Lore', 'Trading',
  ],
  Magic: [
    'Arcana', 'Attunement', 'Augmentation', 'Debilitation', 'Utility', 'Warding',
    'Sorcery', 'Targeted Magic',
    'Arcane Magic', 'Elemental Magic', 'Holy Magic', 'Inner Magic', 'Inner Fire',
    'Life Magic', 'Lunar Magic',
    'Astrology', 'Theurgy', 'Thanatology', 'Summoning', 'Conviction', 'Empathy',
  ],
}

/**
 * Each guild's PRIMARY MAGIC skill — the one magic skill whose name varies by guild.
 * Several requirement tables name it directly (Thief's "Inner Magic", Barbarian's
 * "Inner Fire"), which is why those look like odd one-off columns.
 * Source: https://elanthipedia.play.net/Primary_Magic_skill
 */
export const PRIMARY_MAGIC_BY_GUILD: Record<string, string> = {
  Barbarian:      'Inner Fire',
  Bard:           'Elemental Magic',
  Cleric:         'Holy Magic',
  Empath:         'Life Magic',
  'Moon Mage':    'Lunar Magic',
  Necromancer:    'Arcane Magic',
  Paladin:        'Holy Magic',
  Ranger:         'Life Magic',
  Thief:          'Inner Magic',
  Trader:         'Lunar Magic',
  'Warrior Mage': 'Elemental Magic',
}

/**
 * Alternate names → the canonical skill name.
 *
 * Two things land here. Requirement columns that abbreviate ("Outdoors"), and skills
 * DR has RENAMED — of which there are more than you'd expect, and each one silently
 * breaks something different. Scouting became Instinct, so a Ranger's report contained
 * no skill this file recognised and their guild couldn't be identified at all. The
 * Backstab command became Blindside in 2018. Bardic Lore was once Music Theory.
 *
 * Aliases are accepted in BOTH directions of use: looking up a rank from a pasted
 * report, and matching a requirement column. So a report using either name works, and
 * so does a requirement table using either name.
 */
const SKILL_ALIASES: Record<string, string> = {
  'outdoors':     'Outdoorsmanship',
  'scouting':     'Instinct',       // renamed; Scouting redirects to Instinct
  'blindside':    'Backstab',       // the command was renamed, the skill wasn't
  'music theory': 'Bardic Lore',    // renamed
}

/** Resolve any known alternate name to the canonical one; other names pass through. */
export function canonicalSkill(name: string): string {
  const key = name.trim().toLowerCase()
  return SKILL_ALIASES[key] ?? name.trim()
}

/**
 * Guild skill → guild. Each guild has exactly one, so a character's own EXP report
 * identifies their guild with no need to ask. (Commoners have none and no circle
 * requirements, so they simply don't resolve.)
 */
export const GUILD_BY_SKILL: Record<string, string> = {
  'Expertise':   'Barbarian',
  'Bardic Lore': 'Bard',
  'Theurgy':     'Cleric',
  'Empathy':     'Empath',
  'Astrology':   'Moon Mage',
  'Thanatology': 'Necromancer',
  'Conviction':  'Paladin',
  'Instinct':    'Ranger',
  'Backstab':    'Thief',
  'Trading':     'Trader',
  'Summoning':   'Warrior Mage',
}

// ── Which skills can fill an Nth slot ───────────────────────────────────────────
// Source for everything in this section: the "Circle Requirements" section of each
// guild's page on https://elanthipedia.play.net (e.g. /Barbarian, /Paladin, /Thief).

/**
 * "Mastery" skills. Each page carries the same note: they "never count toward Nth
 * skill requirements, since they affect all or most of the skillset". The guild's
 * primary magic skill is on that list too — see PRIMARY_MAGIC_BY_GUILD.
 */
const NEVER_NTH = ['Defending', 'Parry Ability', 'Offhand Weapon', 'Melee Mastery', 'Missile Mastery']

/**
 * SOFT requirements: named in the guild's table, and ALSO eligible as an Nth skill.
 * Every other named requirement is HARD — checked on its own, and barred from the
 * Nth slots. Hard is the default for anything not listed here, because wrongly
 * calling a requirement soft lets one skill satisfy two requirements and tells a
 * player they can circle when they can't.
 *
 * Warrior Mage is the one entry read between the lines: its page names Summoning as
 * its only hard requirement, which leaves Scholarship and Targeted Magic soft.
 */
const SOFT_BY_GUILD: Record<string, string[]> = {
  Bard:           ['Tactics'],
  Empath:         ['Outdoorsmanship'],
  Necromancer:    ['Targeted Magic'],
  Paladin:        ['Shield Usage', 'Tactics', 'Scholarship'],
  Ranger:         ['Instinct'],
  Thief:          ['Stealth', 'Thievery'],
  'Warrior Mage': ['Scholarship', 'Targeted Magic'],
}

/**
 * Skills a guild cannot use toward its Nth slots although it names no requirement
 * for them. Two kinds: skills the guild's page bars outright ("For Clerics, Sorcery
 * and Thievery also do not count"), and guild skills its eligible-skill list leaves
 * out (Expertise is a Weapon skill, but not one of the fourteen that count).
 *
 * Only what a page states is here. Several pages say nothing either way — whether
 * Sorcery counts for a Thief or a Trader, and whether Backstab counts toward a
 * Thief's Nth Survival — and those are left counting, as they did before.
 */
const BARRED_BY_GUILD: Record<string, string[]> = {
  Barbarian:      ['Expertise', 'Targeted Magic', 'Sorcery', 'Thievery'],
  Bard:           ['Bardic Lore'],
  Cleric:         ['Sorcery', 'Thievery'],
  'Moon Mage':    ['Thievery'],
  'Warrior Mage': ['Sorcery', 'Thievery'],
}

/**
 * The skills eligible to fill a guild's "Nth <skillset>" slots — the skillset's
 * members, less everything the rules above take out. Order is not meaningful.
 */
export function nthPool(guild: string, skillset: string): string[] {
  const named = (CIRCLE_REQS[guild]?.slots ?? []).map(parseSlot)
    .filter(p => p.skill).map(p => p.skill!.toLowerCase())
  const soft = new Set((SOFT_BY_GUILD[guild] ?? []).map(s => s.toLowerCase()))
  const out = new Set([
    ...NEVER_NTH,
    ...(BARRED_BY_GUILD[guild] ?? []),
    ...(PRIMARY_MAGIC_BY_GUILD[guild] ? [PRIMARY_MAGIC_BY_GUILD[guild]] : []),
  ].map(s => s.toLowerCase()))
  for (const n of named) if (!soft.has(n)) out.add(n)   // hard requirements
  // Another guild's guild skill: nobody outside that guild can train it at all.
  for (const [skill, owner] of Object.entries(GUILD_BY_SKILL)) if (owner !== guild) out.add(skill.toLowerCase())
  return (SKILLSETS[skillset] ?? []).filter(s => !out.has(s.toLowerCase()))
}

/**
 * Slots satisfied by the best of a small set of skills rather than by one named skill
 * or by a position in a whole skillset. Barbarian's "Primary Mastery" is whichever of
 * the two masteries you've trained higher — a Barbarian who went missile shouldn't be
 * told to train Melee Mastery.
 *
 * The masteries are not listed in `SKILLSETS.Weapon` at all, and are in NEVER_NTH
 * besides: a high Melee Mastery must not satisfy "2nd Weapon", which is asking about
 * actual weapons.
 */
const SLOT_BEST_OF: Record<string, string[]> = {
  'Primary Mastery': ['Melee Mastery', 'Missile Mastery'],
}

const POSITIONAL_RE = /^(\d+)(?:st|nd|rd|th)\s+(Weapon|Armor|Survival|Lore|Magic)$/i

export interface ParsedSlot {
  label: string
  /** Set for positional slots: 1 = highest. */
  position?: number
  /** Set for positional slots. */
  skillset?: string
  /** Set for named slots: the DR skill name, after alias resolution. */
  skill?: string
  /** Set for best-of slots: the candidates, highest-ranked of which wins. */
  bestOf?: string[]
}

export function parseSlot(label: string): ParsedSlot {
  const trimmed = label.trim()
  const m = POSITIONAL_RE.exec(trimmed)
  if (m) {
    const skillset = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()
    return { label, position: +m[1], skillset }
  }
  const bestOf = SLOT_BEST_OF[trimmed]
  if (bestOf) return { label, bestOf }
  return { label, skill: canonicalSkill(trimmed) }
}

/**
 * Identify the guild from a set of skill names (a parsed EXP report). Returns null
 * when no guild skill is present — a partial report, or a Commoner.
 */
export function guildFromSkills(skillNames: Iterable<string>): string | null {
  for (const name of skillNames) {
    const guild = GUILD_BY_SKILL[canonicalSkill(name)]
    if (guild) return guild
  }
  return null
}

// ── Requirement checking ────────────────────────────────────────────────────────

export interface SlotResult {
  slot:     string
  /** The skill this slot resolved to, or null when nothing could fill it. */
  skill:    string | null
  needed:   number
  have:     number
  short:    number
  met:      boolean
  /**
   * The highest circle this slot alone would allow, given the rank you have. Your
   * actual circle is the lowest of these across every slot, so comparing a slot's own
   * number against that minimum shows at a glance which requirements are holding you
   * back and which are far ahead. `firstCircle - 1` means not even the first circle's
   * requirement is met; `lastCircle` means it's satisfied as far as the table goes.
   */
  atCircle: number
  /**
   * How many other skills are tied with the chosen one at the same rank. A positional
   * slot picks the Nth-highest, but when several candidates sit on the same rank —
   * usually zero — the choice between them is arbitrary, and naming just one would
   * read as advice to train that specific skill. Non-zero means "any of these will
   * do", and the UI says so instead of pointing at a skill picked alphabetically.
   */
  tiedWith: number
}

export interface CircleCheck {
  guild:   string
  circle:  number
  slots:   SlotResult[]
  /** Slots not yet met, worst shortfall first. */
  unmet:   SlotResult[]
  totalShort: number
  ready:   boolean
}

export function reqsFor(guild: string, circle: number): { slots: string[]; values: number[] } | null {
  const g: GuildCircleReqs | undefined = CIRCLE_REQS[guild]
  if (!g) return null
  if (circle < g.firstCircle || circle > g.lastCircle) return null
  return { slots: g.slots, values: g.table[circle - g.firstCircle] }
}

/**
 * Check a character's ranks against a guild's requirements for a circle.
 *
 * `ranks` maps skill name → rank (from a parsed EXP ALL report). Skills absent from
 * the map are treated as rank 0, which is right: a skill you've never trained doesn't
 * appear in your report and you are short by the whole requirement.
 */
export function checkCircle(
  guild: string,
  circle: number,
  ranks: Map<string, number>,
): CircleCheck | null {
  const req = reqsFor(guild, circle)
  if (!req) return null

  const parsed = req.slots.map(parseSlot)

  // Rank lookup that tolerates the case and spacing of a pasted report.
  const rankOf = (skill: string): number => {
    const want = canonicalSkill(skill).toLowerCase()
    for (const [name, rank] of ranks) {
      if (canonicalSkill(name).toLowerCase() === want) return rank
    }
    return 0
  }

  // Positional pools: the skills eligible for each skillset's Nth slots (see nthPool),
  // ranked high to low. Built once per skillset rather than per slot.
  const pools = new Map<string, { skill: string; rank: number }[]>()
  for (const set of Object.keys(SKILLSETS)) {
    pools.set(set, nthPool(guild, set)
      .map(s => ({ skill: s, rank: rankOf(s) }))
      .sort((a, b) => b.rank - a.rank || a.skill.localeCompare(b.skill)))
  }

  const slots: SlotResult[] = parsed.map((p, i) => {
    const needed = req.values[i]
    let skill: string | null = null
    let have = 0
    let tiedWith = 0

    if (p.bestOf) {
      // Whichever candidate you've trained highest is the one being asked about.
      const best = p.bestOf
        .map(s => ({ skill: s, rank: rankOf(s) }))
        .sort((a, b) => b.rank - a.rank || a.skill.localeCompare(b.skill))[0]
      if (best) { skill = best.skill; have = best.rank }
    } else if (p.skill) {
      skill = p.skill
      have = rankOf(p.skill)
    } else if (p.skillset && p.position) {
      const pool = pools.get(p.skillset) ?? []
      const pick = pool[p.position - 1]
      if (pick) {
        skill = pick.skill
        have = pick.rank
        // Everything else in the pool sitting on the same rank is an equally valid
        // answer; the sort put this one first alphabetically, which is not a reason
        // to recommend it.
        tiedWith = pool.filter(e => e.rank === pick.rank).length - 1
      }
    }

    const short = Math.max(0, needed - have)
    return {
      slot: p.label, skill, needed, have, short, met: short === 0, tiedWith,
      atCircle: circleForSlot(guild, i, have),
    }
  })

  const unmet = slots.filter(s => !s.met).sort((a, b) => b.short - a.short)
  return {
    guild, circle, slots, unmet,
    totalShort: unmet.reduce((n, s) => n + s.short, 0),
    ready: unmet.length === 0,
  }
}

/**
 * The highest circle a single slot's requirement is satisfied at, for a given rank.
 *
 * Requirements never decrease as circles rise (asserted in the tests), so the column
 * is sorted and this is a binary search — which matters because the UI calls it for
 * every slot on every keystroke, over tables that now run to circle 300.
 */
export function circleForSlot(guild: string, slotIndex: number, rank: number): number {
  const g = CIRCLE_REQS[guild]
  if (!g) return 0
  const at = (c: number): number => g.table[c - g.firstCircle][slotIndex]

  if (rank < at(g.firstCircle)) return g.firstCircle - 1
  let lo = g.firstCircle, hi = g.lastCircle
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (at(mid) <= rank) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * The highest circle every requirement is already met for — "what circle could I be".
 * That's simply the lowest per-slot circle: one unmet requirement holds up the rest.
 */
export function highestCircleMet(guild: string, ranks: Map<string, number>): number {
  const g = CIRCLE_REQS[guild]
  if (!g) return 0
  // Slot resolution depends on the ranks, not on the circle, so one check is enough
  // to learn which skill fills each slot and how far each one reaches.
  const check = checkCircle(guild, g.firstCircle, ranks)
  if (!check) return 0
  return check.slots.reduce((lowest, s) => Math.min(lowest, s.atCircle), g.lastCircle)
}
