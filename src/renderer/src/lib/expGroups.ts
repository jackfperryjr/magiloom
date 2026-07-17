// DR skill → EXPERIENCE-window group, so the exp panel can show the same grouped
// layout the game does. The compact `EXP` report we parse (see exp-parser.ts) has no
// group headers, so this taxonomy is hardcoded in DR's canonical order. Any skill not
// listed (e.g. a guild skill for a guild not covered here) falls into "Other" so it's
// never hidden.

export const EXP_GROUPS: { name: string; skills: string[] }[] = [
  // One per guild; a character only ever has field exp in their own, so at most one
  // row shows here. (Empathy from the Empath reference; the rest per the guild list.)
  { name: 'Guild Skills', skills: [
    'Empathy', 'Scouting', 'Backstab', 'Astrology', 'Bardic Lore', 'Conviction',
    'Expertise', 'Instinct', 'Summoning', 'Thanatology', 'Theurgy', 'Trading',
  ] },
  { name: 'Armor', skills: [
    'Shield Usage', 'Light Armor', 'Chain Armor', 'Brigandine', 'Plate Armor', 'Defending',
  ] },
  { name: 'Weapon', skills: [
    'Parry Ability', 'Light Edged', 'Medium Edged', 'Heavy Edged', 'Twohanded Edged',
    'Light Blunt', 'Medium Blunt', 'Heavy Blunt', 'Twohanded Blunt',
    'Slings', 'Bow', 'Crossbow', 'Staves', 'Polearms', 'Light Thrown', 'Heavy Thrown',
    'Brawling', 'Offhand Weapon',
  ] },
  { name: 'Magic', skills: [
    'Arcana', 'Attunement', 'Augmentation', 'Debilitation', 'Utility', 'Warding',
    'Sorcery', 'Targeted Magic',
    'Arcane Magic', 'Elemental Magic', 'Holy Magic', 'Inner Magic', 'Inner Fire',
    'Life Magic', 'Lunar Magic',
  ] },
  { name: 'Survival', skills: [
    'Evasion', 'Athletics', 'Perception', 'Stealth', 'Locksmithing', 'Thievery',
    'First Aid', 'Outdoorsmanship', 'Skinning',
  ] },
  { name: 'Lore', skills: [
    'Alchemy', 'Appraisal', 'Enchanting', 'Engineering', 'Forging', 'Outfitting',
    'Performance', 'Scholarship', 'Mechanical Lore', 'Tactics',
  ] },
]

const OTHER = 'Other'
const GROUP_INDEX = new Map<string, number>()   // lowercased skill → EXP_GROUPS index
const SKILL_ORDER = new Map<string, number>()   // lowercased skill → position within its group
EXP_GROUPS.forEach((g, gi) => g.skills.forEach((s, si) => {
  GROUP_INDEX.set(s.toLowerCase(), gi)
  SKILL_ORDER.set(s.toLowerCase(), si)
}))

export interface ExpGroup<T> { name: string; skills: T[] }

/**
 * Bucket skills into their DR groups, returned in canonical group order with each
 * group's skills in canonical order. Empty groups are omitted; unmapped skills gather
 * (alphabetically) in a trailing "Other" group.
 */
export function groupExpSkills<T extends { name: string }>(skills: T[]): ExpGroup<T>[] {
  const buckets = new Map<number, T[]>()   // group index, or -1 for Other
  for (const s of skills) {
    const gi = GROUP_INDEX.get(s.name.toLowerCase()) ?? -1
    const arr = buckets.get(gi) ?? buckets.set(gi, []).get(gi)!
    arr.push(s)
  }
  const out: ExpGroup<T>[] = []
  EXP_GROUPS.forEach((g, gi) => {
    const items = buckets.get(gi)
    if (!items?.length) return
    items.sort((a, b) => (SKILL_ORDER.get(a.name.toLowerCase()) ?? 0) - (SKILL_ORDER.get(b.name.toLowerCase()) ?? 0))
    out.push({ name: g.name, skills: items })
  })
  const other = buckets.get(-1)
  if (other?.length) {
    other.sort((a, b) => a.name.localeCompare(b.name))
    out.push({ name: OTHER, skills: other })
  }
  return out
}
