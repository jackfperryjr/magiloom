/**
 * Room-ambience classifier tests.
 *
 * This heuristic ships its output baked into rooms.json, so a rule that widens by
 * accident puts drifting embers into a few hundred rooms at once and nobody finds
 * out until it's on someone's screen. Every case below is a real room title or a
 * real description fragment from the shipped corpus — most of them are regressions
 * the audit (scripts/audit-ambient.js) caught while the rules were being written.
 *
 * The false-positive cases matter more than the true-positive ones here: the effect
 * is deliberately rare, so missing a room costs nothing and inventing one is the
 * only failure anybody will notice.
 *
 * Run: npm run test:tools
 */

import { classifyAmbience, ambienceFromCode, AMBIENCE_CODE } from './roomAmbient'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── Embers: the real thing ───────────────────────────────────────────────────
{
  eq('a forge is embers', classifyAmbience('[Forging Society, Forge]'), 'embers')
  eq('a smithy is embers', classifyAmbience("[Mer'Kresh Forging Society, Smithy]"), 'embers')
  eq('a firepit is embers', classifyAmbience('[Gorbesh Fortress, Firepit]'), 'embers')
  eq('a lava field is embers', classifyAmbience('[North Road, Lava Field]'), 'embers')
  eq('a volcano is embers', classifyAmbience('[Pivilho Volcano, Fellgust Vale]'), 'embers')
  // Description fallback: prose describing a fire that is actually burning. This is
  // the real text of [Riverhaven Forging Society, Crucible], which has no fire word
  // in its title at all and is reached entirely through its description.
  eq('a described burning fire is embers',
    classifyAmbience('[Riverhaven Forging Society, Crucible]',
      'A large granite crucible hanging over a glowing fire rests in the center of the room. ' +
      'The fire pit beneath the crucible forms a star pattern from the way in which its stones arrange.'),
    'embers')
  eq('glowing coals are embers',
    classifyAmbience('[Some Hall]', 'Glowing coals bank the low hearth.'), 'embers')
}

// ── Embers: what must NOT match ──────────────────────────────────────────────
{
  // The thoroughfare trap, the one roomType.ts documents. DR names roads after the
  // businesses on them, and [The Crossing, Smithy Lane] is a dozen rooms of open
  // street — it filled a public road with forge embers before the guard went in.
  eq('a lane named for a smithy is not embers',
    classifyAmbience('[The Crossing, Smithy Lane]'), null)
  eq('an approach is not embers',
    classifyAmbience("[The Crossing, Immortals' Approach]"), null)

  // Shops describe their STOCK, not their hearth.
  eq('a forge supply shop is not embers',
    classifyAmbience('[Iltesh Neg Degti, Forge Supply Shop]'), null)
  eq('a salesroom is not embers', classifyAmbience("[Krrikt'k's Forge, Salesroom]"), null)

  // A cold noun on its own is not a fire. The real text of [The Noble's Barn,
  // Fanciful Fireplaces] — a shop full of unlit fireplaces, which is exactly the
  // room the "burning verb" requirement in EMBERS_BODY exists to keep out.
  eq('a shop full of unlit fireplaces is not embers',
    classifyAmbience("[The Noble's Barn, Fanciful Fireplaces]",
      'The floor has been lined with riverstone concrete and the walls covered with brick, ' +
      'creating the feeling of stepping inside the hearth of a fireplace. A tickling hickory ' +
      'smell lingers in the room.'), null)
  eq('a bare mention of a fireplace is not embers',
    classifyAmbience('[A Parlor]', 'A dusty fireplace stands cold against the far wall.'), null)
  eq('an ordinary room is nothing', classifyAmbience('[The Crossing, Town Square]',
    'Cobblestones fan out beneath your feet.'), null)
}

// ── Underwater ───────────────────────────────────────────────────────────────
{
  eq('an underwater room is underwater', classifyAmbience('[Satha Cavern, Underwater]'), 'underwater')
  eq('a sunken ship is underwater', classifyAmbience('[A Sunken Ship, Cargo Hold]'), 'underwater')
  eq('beneath the waves is underwater', classifyAmbience('[Saendalan Sea, Beneath the Waves]'), 'underwater')
  eq('a seafloor room is underwater', classifyAmbience("[Sirit's Seafloor Leathers, Main Room]"), 'underwater')

  // "sunken" on its own described [Sunken Pit, Mass Graveyard] — dry ground whose
  // prose is about skeletons left out in the weather. Things sink into earth too.
  eq('a sunken pit is not underwater',
    classifyAmbience('[Sunken Pit, Mass Graveyard]',
      'The lifeless ground is covered in a massive tangle of skeletons.'), null)
  // Prose about water is not a claim that you are IN it — this matched a room in the
  // middle of a desert city because its description mentions swimming.
  eq('prose mentioning swimming is not underwater',
    classifyAmbience("[Muspar'i, Street of Nobles]",
      'A mosaic shows figures swimming in a cool blue pool.'), null)
  eq('a riverbank is not underwater',
    classifyAmbience('[Sandcastle Cove, Faldesu Riverbank]',
      'Submerged roots break the surface near the bank.'), null)
}

// ── Wire format ──────────────────────────────────────────────────────────────
// The codes are what ships in rooms.json; a mismatch between the two directions
// would silently drop every baked ambience on the floor.
{
  eq('embers round-trips', ambienceFromCode(AMBIENCE_CODE.embers), 'embers')
  eq('underwater round-trips', ambienceFromCode(AMBIENCE_CODE.underwater), 'underwater')
  eq('an absent code is null', ambienceFromCode(undefined), null)
  eq('an unknown code is null', ambienceFromCode('z'), null)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ roomAmbient: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ roomAmbient: ${passed} passed`)
