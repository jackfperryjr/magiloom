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
 * The rule tying them together, and the one assumption in this file worth stating:
 * a skill named explicitly by a guild's table is EXCLUDED from that guild's
 * positional pool. Otherwise Thief's "Stealth" requirement and its "1st Survival"
 * requirement could both be satisfied by the same rank of Stealth, and the eight
 * positional Survival slots would be competing with two named ones for the same
 * skills. The arithmetic corroborates it: Thief has exactly eight positional Survival
 * slots and exactly eight Survival skills once Stealth and Thievery are removed. Every
 * guild is checked against this in the tests — if a guild ever asks for more positional
 * slots than it has skills to fill them, that's a taxonomy error and it fails loudly
 * rather than silently under-reporting.
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
 * Guild skills are INCLUDED in whichever skillset they belong to. The experience
 * window shows them in their own "Guild Skills" row, but that's a display grouping —
 * mechanically Backstab is a Survival skill and Expertise a Weapon skill, and circle
 * requirements treat them that way. The arithmetic confirms it: Thief asks for eight
 * positional Survival slots and has exactly eight Survival skills once its two named
 * ones (Stealth, Thievery) are removed — which only works with Backstab in the pool.
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

/**
 * Slots satisfied by the best of a small set of skills rather than by one named skill
 * or by a position in a whole skillset. Barbarian's "Primary Mastery" is whichever of
 * the two masteries you've trained higher — a Barbarian who went missile shouldn't be
 * told to train Melee Mastery.
 *
 * The masteries are deliberately kept OUT of `SKILLSETS.Weapon`: they belong to the
 * Weapon skillset in the game, but letting them into the positional pool would mean a
 * high Melee Mastery could satisfy "2nd Weapon", which is asking about actual weapons.
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

  // Skills this guild names explicitly are spoken for and can't also fill a
  // positional slot — see the header.
  const claimed = new Set(parsed.filter(p => p.skill).map(p => p.skill!.toLowerCase()))

  // Rank lookup that tolerates the case and spacing of a pasted report.
  const rankOf = (skill: string): number => {
    const want = canonicalSkill(skill).toLowerCase()
    for (const [name, rank] of ranks) {
      if (canonicalSkill(name).toLowerCase() === want) return rank
    }
    return 0
  }

  // Positional pools: each skillset's skills, minus the claimed ones, ranked high to
  // low. Built once per skillset rather than per slot.
  const pools = new Map<string, { skill: string; rank: number }[]>()
  for (const [set, skills] of Object.entries(SKILLSETS)) {
    pools.set(set, skills
      .filter(s => !claimed.has(s.toLowerCase()))
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
