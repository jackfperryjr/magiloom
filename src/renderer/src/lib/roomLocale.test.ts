/**
 * Room-locale classifier tests. Run: npm run test:tools
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { classifyRoom, type RoomLocale } from './roomLocale'

let passed = 0
const failures: string[] = []
function eq<T>(name: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++
  else failures.push(`${name} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

// ── The description gets a vote, not just the title ─────────────────────────
eq('park on Temple Hill', classifyRoom('[Temple Hill, Memorial Park]',
  'Grass surrounds a small reflecting pool in this wooded park at the top of the hill.'), 'forest')
eq('lane on Temple Hill', classifyRoom('[Temple Hill, Temple Hill Lane]'), 'urban')
eq('guild courtyard', classifyRoom("[Paladins' Guild, Courtyard]"), 'urban')
eq('bank lobby is not a river bank', classifyRoom('[Bank of Riverhaven, Main Lobby]'), 'indoor')
eq('a temple is still a temple', classifyRoom('[Temple of Light, Nave]'), 'indoor')
eq('shop under a forest title', classifyRoom('[Mistwood Forest, Trading Post]',
  'Shelves of goods line the walls behind a worn counter.'), 'indoor')

// ── Aboard a boat (moving rooms the shipped map never has) ──────────────────
eq('ferry', classifyRoom("[Kertigen's Honor]",
  'The ferry rocks gently as you step aboard. Surrounded by the cool, briny air of the ' +
  'Segoltha, you take your place on the deserted deck and gaze up into the night sky.'), 'water')

// ── Underground areas stay underground ───────────────────────────────────────
eq('bridge in a mine', classifyRoom('[Abandoned Mine, Bridge]'), 'underground')

// ── Garden/park count only in titles, below shop words ──────────────────────
eq('garden shop', classifyRoom('[Observatory, Celestial Garden Shop]'), 'indoor')
eq('street past a garden', classifyRoom('[Ratha, Port Walk]',
  'A cobbled street runs past a walled garden.'), 'urban')

// ── Sky words count against indoor ───────────────────────────────────────────
eq('open sky over ruined walls', classifyRoom('[Old Ruins]',
  'Only the walls remain on a cracked floor; the open sky shows through where the roof fell, and a cold wind blows through.'), 'default')
eq('same walls, roof intact', classifyRoom('[Old Ruins]',
  'Only the walls remain on a cracked floor beneath a sagging roof.'), 'indoor')

// ── Open country and nothing at all ──────────────────────────────────────────
eq('mountain pass', classifyRoom('[Hraagkaal, Mountain Pass]',
  'Clumps of brush grass do little to hinder the fierce wind.'), 'default')
eq('nothing matches', classifyRoom('[Nowhere Special]'), 'default')

// ── Accuracy against a hand-labelled sample of shipped rooms ────────────────
// roomLocale.sample.json pairs a room id with the locale(s) a person reading the
// description would accept ("f/w" for a garden pond). 0.9 is a floor, not a target:
// it was ~94% when written. If a cue change drops it, look at what flipped.
const CODE: Record<RoomLocale, string> = {
  underground: 'g', water: 'w', forest: 'f', indoor: 'n', urban: 'u', default: 'd',
}
const rooms = new Map<number, { t: string; desc: string }>(
  JSON.parse(readFileSync(join(process.cwd(), 'resources/map-data/dr-prime/rooms.json'), 'utf8'))
    .rooms.map((r: { id: number; t: string; desc: string }) => [r.id, r]),
)
const sample: [number, string][] = JSON.parse(
  readFileSync(join(process.cwd(), 'src/renderer/src/lib/roomLocale.sample.json'), 'utf8'))
let right = 0
for (const [id, want] of sample) {
  const r = rooms.get(id)
  if (r && want.split('/').includes(CODE[classifyRoom(r.t, r.desc)])) right++
}
const accuracy = right / sample.length
eq(`sample accuracy ${(accuracy * 100).toFixed(1)}% ≥ 90%`, accuracy >= 0.9, true)

if (failures.length) {
  console.error(`\n✗ roomLocale: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ roomLocale: ${passed} passed (sample ${(accuracy * 100).toFixed(1)}%)`)
