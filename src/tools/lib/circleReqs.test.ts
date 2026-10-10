/**
 * Circle-requirement tests.
 *
 * The load-bearing one is "every guild's positional slots can actually be filled".
 * The requirement tables ask for things like an 8th-highest Survival skill, and
 * whether that's satisfiable depends on the skillset membership in circleReqs.ts and
 * on the rule that explicitly-named skills leave the positional pool. If either is
 * wrong, some guild asks for more slots than it has skills — and the failure mode
 * without this check is silent: an unfillable slot reports as "you have 0 ranks",
 * which reads like a real shortfall and would send someone off to train nothing.
 *
 * Run: npm run test:tools
 */

import {
  CIRCLE_REQS, GUILDS, SKILLSETS, parseSlot, guildFromSkills,
  checkCircle, reqsFor, highestCircleMet, GUILD_BY_SKILL, PRIMARY_MAGIC_BY_GUILD, circleForSlot, canonicalSkill,
  isProjectedCircle, nthPool,
} from './circleReqs'
import { EXP_GROUPS } from '../../renderer/src/lib/expGroups'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

// ── Data integrity ─────────────────────────────────────────────────────────────
eq('all eleven guilds present', GUILDS.length, 11)
for (const guild of GUILDS) {
  const g = CIRCLE_REQS[guild]
  check(`${guild}: reaches circle 300`, g.lastCircle === 300, `got ${g.lastCircle}`)
  check(`${guild}: scraped through circle 200`, g.scrapedThrough === 200, `got ${g.scrapedThrough}`)
  check(`${guild}: starts at circle 2`, g.firstCircle === 2, `got ${g.firstCircle}`)
  eq(`${guild}: one row per circle`, g.table.length, g.lastCircle - g.firstCircle + 1)
  check(`${guild}: every row matches slot count`,
        g.table.every(r => r.length === g.slots.length))
  check(`${guild}: no negative requirements`,
        g.table.every(r => r.every(v => v >= 0)))
  // Requirements never go DOWN as you circle — a decrease would mean a scrape error.
  const monotonic = g.table.every((row, i) =>
    i === 0 || row.every((v, j) => v >= g.table[i - 1][j]))
  check(`${guild}: requirements never decrease with circle`, monotonic)
}

// ── The load-bearing check: every positional slot is fillable ──────────────────
for (const guild of GUILDS) {
  const g = CIRCLE_REQS[guild]
  const parsed = g.slots.map(parseSlot)

  // Named slots must name a skill we actually know about, or the alias table is stale.
  for (const p of parsed.filter(p => p.skill)) {
    const known = Object.values(SKILLSETS).some(list =>
      list.some(s => s.toLowerCase() === p.skill!.toLowerCase()))
    check(`${guild}: named slot "${p.label}" is a known skill`, known, p.skill!)
  }
  // Best-of slots must offer candidates.
  for (const p of parsed.filter(p => p.bestOf)) {
    check(`${guild}: best-of slot "${p.label}" has candidates`, p.bestOf!.length > 0)
  }
  // Every slot must resolve to exactly one kind — an unclassified slot would silently
  // report zero ranks forever.
  for (const p of parsed) {
    const kinds = [p.skill ? 1 : 0, p.bestOf ? 1 : 0, (p.skillset && p.position) ? 1 : 0]
    eq(`${guild}: slot "${p.label}" has exactly one interpretation`,
       kinds.reduce((a, b) => a + b, 0), 1)
  }

  // Positional depth per skillset must not exceed what's left in the pool.
  const deepest = new Map<string, number>()
  for (const p of parsed) {
    if (!p.skillset || !p.position) continue
    deepest.set(p.skillset, Math.max(deepest.get(p.skillset) ?? 0, p.position))
  }
  for (const [set, depth] of deepest) {
    const available = nthPool(guild, set).length
    check(`${guild}: ${set} has ${depth} slots and ${available} skills to fill them`,
          available >= depth, `needs ${depth}, pool has ${available}`)
  }
}

// ── Obsolete skill names must never come back ──────────────────────────────────
// DR 3.0 merged Light + Medium Edged into Small Edged and renamed Heavy to Large
// (same for Blunt), and pluralised Bow/Crossbow. A skill listed under a dead name
// matches nothing in a real report, so every weapon requirement would silently read
// as "you have 0 ranks" — the tool would tell every character they're short on
// weapons. These names are also still all over old fan sites, so they're easy to
// reintroduce by copying from one.
{
  // Bow and Crossbow are deliberately NOT here. Elanthipedia lists them plural, and
  // an earlier version "corrected" them to Bows/Crossbows on that basis — but real
  // Lich XML captures show the stream sending <component id='exp Bow'>. A live game
  // log beats the wiki, which lists article titles rather than skill names.
  const OBSOLETE = [
    'Light Edged', 'Medium Edged', 'Heavy Edged',
    'Light Blunt', 'Medium Blunt', 'Heavy Blunt',
  ]
  const everySkill = Object.values(SKILLSETS).flat()
  for (const dead of OBSOLETE) {
    check(`obsolete: "${dead}" is not in any skillset`,
          !everySkill.some(s => s.toLowerCase() === dead.toLowerCase()))
  }
  // And the current names ARE present, so the list wasn't just emptied.
  for (const live of ['Small Edged', 'Large Edged', 'Small Blunt', 'Large Blunt', 'Bow', 'Crossbow']) {
    check(`current: "${live}" is in the Weapon skillset`,
          SKILLSETS.Weapon.some(s => s === live))
  }
  // The client's own exp-window taxonomy must agree, or the game panel groups a real
  // skill into "Other" while this file resolves it fine.
  const clientSkills = EXP_GROUPS.flatMap(g => g.skills)
  for (const dead of OBSOLETE) {
    check(`obsolete: "${dead}" is not in the client's exp groups`,
          !clientSkills.some(s => s.toLowerCase() === dead.toLowerCase()))
  }
  for (const live of ['Small Edged', 'Large Edged', 'Bow', 'Crossbow']) {
    check(`current: "${live}" is in the client's exp groups`, clientSkills.includes(live))
  }
}

// Every guild's primary magic skill must be a real Magic skill, since some tables
// name it directly (Thief's "Inner Magic", Barbarian's "Inner Fire").
for (const [guild, skill] of Object.entries(PRIMARY_MAGIC_BY_GUILD)) {
  check(`primary magic: ${guild}'s ${skill} is a Magic skill`,
        SKILLSETS.Magic.includes(skill), skill)
  check(`primary magic: ${guild} has a requirement table`, CIRCLE_REQS[guild] !== undefined)
}
eq('primary magic: one entry per guild', Object.keys(PRIMARY_MAGIC_BY_GUILD).length, GUILDS.length)

// ── Slot parsing ───────────────────────────────────────────────────────────────
eq('slot: positional position', parseSlot('3rd Survival').position, 3)
eq('slot: positional skillset', parseSlot('3rd Survival').skillset, 'Survival')
eq('slot: 8th parses',          parseSlot('8th Survival').position, 8)
eq('slot: named skill',         parseSlot('Parry Ability').skill, 'Parry Ability')
eq('slot: alias resolved',      parseSlot('Outdoors').skill, 'Outdoorsmanship')
// DR 3.0 names pass straight through — mapping them anywhere would be a rename in
// the wrong direction (Light/Medium Edged were merged INTO Small Edged, not from it).
eq('slot: DR 3.0 weapon name is canonical', parseSlot('Small Edged').skill, 'Small Edged')
check('slot: named has no position', parseSlot('Stealth').position === undefined)

// ── Renamed skills ─────────────────────────────────────────────────────────────
// Every rename DR has made breaks something different and silently. Scouting →
// Instinct was the worst: a Ranger's report contained no skill this file knew, so
// their guild couldn't be identified and the page had nothing to say at all.
{
  eq('rename: Scouting resolves to Instinct', canonicalSkill('Scouting'), 'Instinct')
  eq('rename: case-insensitive',              canonicalSkill('  scouting '), 'Instinct')
  eq('rename: Blindside resolves to Backstab', canonicalSkill('Blindside'), 'Backstab')
  eq('rename: Music Theory resolves to Bardic Lore', canonicalSkill('Music Theory'), 'Bardic Lore')
  eq('rename: an unknown name passes through', canonicalSkill('Evasion'), 'Evasion')

  // The bug as reported: a Ranger's report identifies the guild.
  eq('rename: Instinct identifies a Ranger', guildFromSkills(['Evasion', 'Instinct']), 'Ranger')
  // And an old report still works, so nothing regresses for saved text.
  eq('rename: Scouting still identifies a Ranger', guildFromSkills(['Scouting']), 'Ranger')
  eq('rename: Blindside identifies a Thief', guildFromSkills(['Blindside']), 'Thief')

  // Ranger's requirement table has a "Scouting" column; a report saying "Instinct"
  // must satisfy it. Before the alias this read as 0 ranks forever.
  const rangerRanks = new Map<string, number>([['Instinct', 120]])
  const c = checkCircle('Ranger', 2, rangerRanks)!
  const slot = c.slots.find(s => s.slot === 'Scouting')!
  eq('rename: the Scouting column resolves to Instinct', slot.skill, 'Instinct')
  eq('rename: and picks up the ranks', slot.have, 120)

  // Both spellings of a skill must never be counted as two separate skills.
  const both = checkCircle('Ranger', 2, new Map([['Instinct', 120], ['Scouting', 120]]))!
  eq('rename: duplicate spellings do not double up',
     both.slots.find(s => s.slot === 'Scouting')!.have, 120)

  // Every guild must still be identifiable — this is what would have caught the
  // Ranger bug before a user did.
  for (const guild of GUILDS) {
    const skill = Object.entries(GUILD_BY_SKILL).find(([, g]) => g === guild)?.[0]
    check(`rename: ${guild} has an identifying skill`, !!skill, guild)
    if (skill) eq(`rename: ${guild} is identified by ${skill}`, guildFromSkills([skill]), guild)
  }
  // Obsolete guild-skill names must not be in any skillset under the old spelling.
  check('rename: Scouting is not in the Survival skillset',
        !SKILLSETS.Survival.includes('Scouting'))
  check('rename: Instinct IS in the Survival skillset',
        SKILLSETS.Survival.includes('Instinct'))
  check("rename: the client's exp groups list Instinct, not Scouting",
        EXP_GROUPS.flatMap(g => g.skills).includes('Instinct') &&
        !EXP_GROUPS.flatMap(g => g.skills).includes('Scouting'))
}

// ── Guild identification from the report ───────────────────────────────────────
eq('guild: Backstab → Thief',        guildFromSkills(['Evasion', 'Backstab']), 'Thief')
eq('guild: Empathy → Empath',        guildFromSkills(['Empathy']), 'Empath')
eq('guild: Summoning → Warrior Mage', guildFromSkills(['Summoning']), 'Warrior Mage')
eq('guild: none present → null',     guildFromSkills(['Evasion', 'Athletics']), null)
check('guild: every guild skill maps to a guild that has a table',
      Object.values(GUILD_BY_SKILL).every(g => CIRCLE_REQS[g] !== undefined))
eq('guild: one guild skill per guild', new Set(Object.values(GUILD_BY_SKILL)).size, GUILDS.length)

// Barbarian's mastery slot picks whichever mastery is higher — a missile Barbarian
// must not be told to train Melee Mastery.
{
  const missile = checkCircle('Barbarian', 5, new Map([['Missile Mastery', 40], ['Melee Mastery', 3]]))!
  const slot = missile.slots.find(s => s.slot === 'Primary Mastery')!
  eq('mastery: picks the higher of the two', slot.skill, 'Missile Mastery')
  eq('mastery: uses its rank', slot.have, 40)
}

// ── Checking a character ───────────────────────────────────────────────────────
{
  // Thief at circle 2 needs (per the table): 1st Weapon 6, Stealth 4, Thievery 4, …
  const req = reqsFor('Thief', 2)!
  check('reqs: Thief circle 2 exists', !!req)
  eq('reqs: 1st Weapon is 6 at circle 2', req.values[req.slots.indexOf('1st Weapon')], 6)
  eq('reqs: 1st Weapon is 90 at circle 30',
     reqsFor('Thief', 30)!.values[req.slots.indexOf('1st Weapon')], 90)

  // A character with nothing is short by the full requirement everywhere.
  const empty = checkCircle('Thief', 2, new Map())!
  check('check: empty character is not ready', !empty.ready)
  check('check: every non-zero slot is unmet',
        empty.unmet.length === empty.slots.filter(s => s.needed > 0).length)

  // A generously-trained character meets circle 2 easily.
  const strong = new Map<string, number>(
    [...SKILLSETS.Weapon, ...SKILLSETS.Armor, ...SKILLSETS.Survival,
     ...SKILLSETS.Lore, ...SKILLSETS.Magic].map(s => [s, 500]))
  const ok = checkCircle('Thief', 2, strong)!
  check('check: well-trained character is ready at circle 2', ok.ready)
  eq('check: nothing short', ok.totalShort, 0)
  check('check: every slot resolved to a skill', ok.slots.every(s => s.skill !== null),
        JSON.stringify(ok.slots.filter(s => s.skill === null)))
}

// ── Which skills can fill an Nth slot ───────────────────────────────────────────
// The rules are the game's, from each guild's Elanthipedia page; see nthPool.
{
  const slotOf = (guild: string, ranks: [string, number][], slot: string) =>
    checkCircle(guild, 2, new Map(ranks))!.slots.find(s => s.slot === slot)!

  // Mastery skills never count, for any guild. Offhand Weapon was the one reported:
  // a Thief with a high Offhand Weapon was being told it was their best weapon.
  const offhand = slotOf('Thief', [['Offhand Weapon', 900], ['Small Edged', 40]], '1st Weapon')
  eq('mastery: Offhand Weapon is not a weapon for Nth purposes', offhand.skill, 'Small Edged')
  eq('mastery: so the real weapon rank is what is checked', offhand.have, 40)
  for (const guild of GUILDS) {
    for (const m of ['Offhand Weapon', 'Parry Ability', 'Melee Mastery', 'Missile Mastery']) {
      check(`mastery: ${m} never fills ${guild} Nth Weapon`, !nthPool(guild, 'Weapon').includes(m))
    }
    check(`mastery: Defending never fills ${guild} Nth Armor`, !nthPool(guild, 'Armor').includes('Defending'))
    const primary = PRIMARY_MAGIC_BY_GUILD[guild]
    check(`mastery: ${primary} never fills ${guild} Nth Magic`, !nthPool(guild, 'Magic').includes(primary))
  }
  // Trader names no Parry requirement, so "named skills are excluded" never caught it.
  eq('mastery: Parry does not count for a guild that does not name it',
    slotOf('Trader', [['Parry Ability', 900], ['Staves', 25]], '1st Weapon').skill, 'Staves')
  eq('mastery: Defending is not armor for a Thief',
    slotOf('Thief', [['Defending', 900], ['Light Armor', 30]], '1st Armor').skill, 'Light Armor')

  // Soft requirements are checked on their own AND count as Nth skills.
  const soft: [string, number][] = [['Stealth', 999]]
  eq('soft: Stealth fills its named slot', slotOf('Thief', soft, 'Stealth').have, 999)
  eq('soft: and ALSO counts as the Thief 1st Survival', slotOf('Thief', soft, '1st Survival').skill, 'Stealth')
  check('soft: Instinct counts toward a Ranger Nth Survival', nthPool('Ranger', 'Survival').includes('Instinct'))
  check('soft: Tactics counts toward a Paladin Nth Lore', nthPool('Paladin', 'Lore').includes('Tactics'))

  // Hard requirements are checked on their own and can NOT also be an Nth skill.
  eq('hard: Evasion fills the Barbarian Evasion slot',
    slotOf('Barbarian', [['Evasion', 999]], 'Evasion').have, 999)
  check('hard: but not its 1st Survival',
    slotOf('Barbarian', [['Evasion', 999]], '1st Survival').skill !== 'Evasion')
  check('hard: Appraisal is not one of a Trader Nth Lore', !nthPool('Trader', 'Lore').includes('Appraisal'))
  check('hard: Tactics is hard for a Barbarian though soft for a Bard',
    !nthPool('Barbarian', 'Lore').includes('Tactics') && nthPool('Bard', 'Lore').includes('Tactics'))

  // Barred per guild.
  check('barred: Sorcery and Thievery do not count for a Cleric',
    !nthPool('Cleric', 'Magic').includes('Sorcery') && !nthPool('Cleric', 'Survival').includes('Thievery'))
  check('barred: Sorcery does count for a Moon Mage', nthPool('Moon Mage', 'Magic').includes('Sorcery'))
  check('barred: Expertise is not one of a Barbarian weapons', !nthPool('Barbarian', 'Weapon').includes('Expertise'))

  // What is left is the fourteen real weapons, for everyone.
  eq('pool: fourteen weapons count for a Thief', nthPool('Thief', 'Weapon').length, 14)
}

// Positional ordering really is by rank, highest first.
{
  const ranks = new Map<string, number>([
    ['Athletics', 10], ['Perception', 50], ['Skinning', 30],
  ])
  const c = checkCircle('Moon Mage', 2, ranks)!
  eq('order: 1st Survival is the highest', c.slots.find(s => s.slot === '1st Survival')?.skill, 'Perception')
  eq('order: 2nd Survival is the next',    c.slots.find(s => s.slot === '2nd Survival')?.skill, 'Skinning')
  eq('order: 3rd Survival is the next',    c.slots.find(s => s.slot === '3rd Survival')?.skill, 'Athletics')
}

// Ties are reported, so the UI doesn't recommend one arbitrarily-chosen skill.
{
  // One weapon trained; every other Weapon skill sits at 0, so "2nd Weapon" is a tie
  // among all of them and naming just one would be misleading advice.
  const c = checkCircle('Thief', 2, new Map([['Small Edged', 50]]))!
  const first  = c.slots.find(s => s.slot === '1st Weapon')!
  const second = c.slots.find(s => s.slot === '2nd Weapon')!
  eq('ties: the trained weapon is unambiguous', first.tiedWith, 0)
  eq('ties: 1st Weapon is the trained one', first.skill, 'Small Edged')
  check('ties: 2nd Weapon is flagged as a tie', second.tiedWith > 0, `got ${second.tiedWith}`)

  // With two distinct weapons there's no tie for either slot.
  const two = checkCircle('Thief', 2, new Map([['Small Edged', 50], ['Bow', 20]]))!
  eq('ties: 2nd Weapon is unambiguous once trained',
     two.slots.find(s => s.slot === '2nd Weapon')!.tiedWith, 0)
  eq('ties: and names the right skill',
     two.slots.find(s => s.slot === '2nd Weapon')!.skill, 'Bow')
}

// ── Per-slot circle ────────────────────────────────────────────────────────────
{
  const g = CIRCLE_REQS.Thief
  const weaponIdx = g.slots.indexOf('1st Weapon')

  // 1st Weapon is 3 x circle for Thief, so rank 90 is exactly circle 30.
  eq('slot circle: rank 90 reaches circle 30', circleForSlot('Thief', weaponIdx, 90), 30)
  eq('slot circle: rank 89 falls short of 30', circleForSlot('Thief', weaponIdx, 89), 29)
  eq('slot circle: rank 0 is below the first', circleForSlot('Thief', weaponIdx, 0), g.firstCircle - 1)
  eq('slot circle: a huge rank caps at the table end',
     circleForSlot('Thief', weaponIdx, 999_999), g.lastCircle)

  // The binary search must agree with a linear scan at every slot — this is the check
  // that would catch a non-monotonic column breaking the search.
  for (const guild of GUILDS) {
    const gg = CIRCLE_REQS[guild]
    let mismatches = 0
    for (let slot = 0; slot < gg.slots.length; slot++) {
      for (const rank of [0, 1, 7, 50, 123, 400, 1500]) {
        let linear = gg.firstCircle - 1
        for (let c = gg.firstCircle; c <= gg.lastCircle; c++) {
          if (gg.table[c - gg.firstCircle][slot] <= rank) linear = c; else break
        }
        if (circleForSlot(guild, slot, rank) !== linear) mismatches++
      }
    }
    eq(`${guild}: binary search matches a linear scan`, mismatches, 0)
  }
}

// ── Highest circle met ─────────────────────────────────────────────────────────
{
  const none = highestCircleMet('Thief', new Map())
  check('highest: untrained character is below circle 2', none < 2, `got ${none}`)

  const strong = new Map<string, number>(
    Object.values(SKILLSETS).flat().map(s => [s, 60]))
  const got = highestCircleMet('Thief', strong)
  check('highest: 60 ranks everywhere clears some circles', got >= 2, `got ${got}`)
  // And the circle above it must genuinely fail, or the search is off by one.
  check('highest: the next circle is not met',
        checkCircle('Thief', got + 1, strong)?.ready === false, `got ${got}`)
}

// ── Unknown inputs ─────────────────────────────────────────────────────────────
eq('unknown guild yields null',  reqsFor('Commoner', 2), null)
eq('circle below range yields null', reqsFor('Thief', 1), null)
eq('circle above range yields null', reqsFor('Thief', 301), null)
eq('checkCircle on unknown guild', checkCircle('Commoner', 2, new Map()), null)

// ── Projected circles ──────────────────────────────────────────────────────────
// Circles above the scrape continue each guild's own constant step. The check that
// matters is that they're flagged as projected AND that the step is the one the
// published tail actually uses — a wrong step would read as real published data.
for (const guild of GUILDS) {
  const g = CIRCLE_REQS[guild]
  check(`${guild}: circle 200 is published`, !isProjectedCircle(guild, 200))
  check(`${guild}: circle 201 is projected`, isProjectedCircle(guild, 201))

  const idx = (c: number): number[] => g.table[c - g.firstCircle]
  const step = idx(200).map((v, i) => v - idx(199)[i])
  let drift = 0
  for (let c = 201; c <= g.lastCircle; c++) {
    if (idx(c).some((v, i) => v - idx(c - 1)[i] !== step[i])) drift++
  }
  eq(`${guild}: projection continues the published step`, drift, 0)
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`✓ all ${passed} circle-requirement assertions passed`)
