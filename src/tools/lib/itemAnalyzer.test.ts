// Run via: npm run test:tools
import assert from 'node:assert/strict'
import type { MtxEvent, MtxRow } from './mtxItems.generated'
import { appraise, buildIndex, normalize, parseInventory, toCsv } from './itemAnalyzer'

const EVENTS: MtxEvent[] = [
  { name: 'Sleeping Dragon Corn Maze 447', family: 'Sleeping Dragon Corn Maze', currency: 'kernels', scLo: 10, scHi: 10, rateHow: 'test' },
  { name: "Drathrok's Duskruin 452", family: "Drathrok's Duskruin", currency: 'bloodscrip', scLo: 0.4, scHi: 2, rateHow: 'test' },
  { name: 'Ruins of Ulf\'Hara', family: 'Ruins of Ulf\'Hara', currency: null, scLo: null, scHi: null, rateHow: null },
  { name: 'Sleeping Dragon Corn Maze 439', family: 'Sleeping Dragon Corn Maze', currency: 'kernels', scLo: 10, scHi: 10, rateHow: 'test' },
]
const ROWS: MtxRow[] = [
  ['pale kirmiko pocket with reinforced seams', 'shop', 0, 'End loot', 350, 88, null],
  ['pale kirmiko pocket with reinforced seams', 'shop', 3, 'End loot', 300, 80, null],
  ['agonite dragon\'s talon clutching a chakrel globe', 'shop', 1, 'End Loot', 500, 23, null],
  ['origami lightning bolt', 'auction', 1, 'Auction', 55550, 90, 'adds elemental flare, fire or ice'],
  ['onyx chunk', 'incidental', 2, 'Incidental loot', null, null, null],
  ['white lotusweave register cover adorned with a blood-red mortar and pestle', 'incidental', 1, 'Incidental loot', null, null, null],
]
const index = buildIndex(ROWS, EVENTS)

// normalize: articles, counts and "pair of" drop away; punctuation goes
assert.equal(normalize('Some sleek demonscale leathers.'), 'sleek demonscale leathers')
assert.equal(normalize('two pairs of insectile wings'), 'insectile wings')
assert.equal(normalize("an agonite dragon's talon"), "agonite dragon's talon")

// parseInventory: sections, nesting, home furniture prefixes, noise lines
const PASTE = `Name: Someone   Race: Human
  26 platinum, 2 gold Kronars (262924 copper Kronars).
> inv list
You have:

  a pale kirmiko pocket with reinforced seams
     -an origami lightning bolt
  a black gem pouch (closed)
> home recall
The home contains:
Floor: a dusty oak floor.
  Attached: an onyx chunk.
Armor Stand: a felwood armor stand.
  Attached: a pale kirmiko pocket with reinforced seams.
> read vault book
Vault Inventory:
    a branch-framed canvas backpack
      a white lotusweave deed register adorned with a blood-red mortar and pestle
      two pale kirmiko pockets
`
const lines = parseInventory(PASTE)
assert.deepEqual(lines.map(l => l.place), ['Carried', 'Carried', 'Carried', 'Home', 'Home', 'Home', 'Home', 'Vault', 'Vault', 'Vault'])
assert.equal(lines[1].text, 'an origami lightning bolt')
assert.equal(lines[1].container, 'a pale kirmiko pocket with reinforced seams')
assert.equal(lines[2].text, 'a black gem pouch')
assert.equal(lines[4].text, 'an onyx chunk')
assert.equal(lines[4].container, 'a dusty oak floor')
assert.equal(lines[8].container, 'a branch-framed canvas backpack')
assert.equal(lines[9].count, 2)
assert.ok(!lines.some(l => /platinum|Name:/.test(l.text)), 'stats and wealth lines are not items')

// Hand-written lists: bullets without articles, trailing "(note)" dropped
const LIST = `My stuff
- pale kirmiko pocket with reinforced seams (spare)
* origami lightning bolt
• agonite dragon's talon clutching a chakrel globe
1. onyx chunk
2) some sleek leathers
-
not a bullet so not an item
- 42
`
const listed = parseInventory(LIST)
assert.deepEqual(listed.map(l => l.text), [
  'pale kirmiko pocket with reinforced seams',
  'origami lightning bolt',
  "agonite dragon's talon clutching a chakrel globe",
  'onyx chunk',
  'some sleek leathers',
])
assert.ok(listed.every(l => l.container === null), 'a flat list has no nesting')
assert.equal(appraise(listed, index).length, 4, 'article-less list lines still match')
// Game output is read exactly as before: same lines from the PASTE above
assert.equal(parseInventory(PASTE).length, 10)

// appraise: tiers, grouping across places, estimate from the most recent event
const result = appraise(lines, index)
const by = (t: string) => result.find(r => r.text.includes(t))!
assert.equal(by('origami').tier, 'prize')
assert.equal(result[0].tier, 'prize', 'auction items sort first')

const pocket = by('kirmiko pocket with')
assert.equal(pocket.tier, 'shop')
assert.equal(pocket.count, 2)
assert.deepEqual(pocket.places, ['Carried', 'Home'])
assert.equal(pocket.best.event.name, 'Sleeping Dragon Corn Maze 447', 'newest event wins')
assert.equal(pocket.best.scLo, 3500)

const onyx = by('onyx')
assert.equal(onyx.tier, 'drop')
assert.ok(onyx.generic, 'two-word drop names are flagged as generic')

const deed = by('lotusweave deed register')
assert.equal(deed.tier, 'possible', 'near-miss names come back as possible matches')
assert.ok(deed.similarity! >= 0.5)

assert.ok(!result.some(r => r.text.includes('gem pouch')), 'unlisted items are not reported')

// bloodscrip carries a range
const talon = appraise(parseInventory("  an agonite dragon's talon clutching a chakrel globe"), index)[0]
assert.equal(talon.best.scLo, 200)
assert.equal(talon.best.scHi, 1000)

// CSV: header plus one row per appraisal, quoted where needed
const csv = toCsv(result).split('\r\n')
assert.equal(csv.length, result.length + 1)
assert.match(csv[0], /^Tier,Item,Count,Where/)
assert.ok(csv.some(r => r.includes(',Carried; Home,')))
assert.ok(csv.some(r => r.includes('"adds elemental flare, fire or ice"')), 'cells with commas are quoted')

console.log('✓ itemAnalyzer')
