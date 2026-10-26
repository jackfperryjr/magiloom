/**
 * Art-key mapping tests. Run: npm run test:tools
 */
import { roomArtKey, roomNightKey, roomNightOpacity, crestKey, guildFromInfoLine, deathCardFor, DEPART_RE } from './artKeys'

let passed = 0
const failures: string[] = []
function eq<T>(name: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++
  else failures.push(`${name} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

// ── Room headers ─────────────────────────────────────────────────────────────
eq('forest is forest', roomArtKey('forest'), 'forest')
eq('urban is urban', roomArtKey('urban'), 'urban')
eq('unclassified is open country', roomArtKey('default'), 'wilds')
eq('new types use their own name', roomArtKey('village'), 'village')
eq('night key', roomNightKey('desert'), 'desert-night')
eq('open country at night', roomNightKey('default'), 'wilds-night')
eq('full day shows no night', roomNightOpacity(1), 0)
eq('deep night is all night', roomNightOpacity(0), 1)
eq('dusk is part way', roomNightOpacity(0.4) > 0 && roomNightOpacity(0.4) < 1, true)
eq('darker is more night', roomNightOpacity(0.3) > roomNightOpacity(0.5), true)

// ── Crests ───────────────────────────────────────────────────────────────────
eq('one-word guild', crestKey('Bard'), 'bard')
eq('two-word guild', crestKey('Moon Mage'), 'moonmage')
eq('warrior mage', crestKey('Warrior Mage'), 'warriormage')
eq('case and spacing', crestKey('  necroMANCER '), 'necromancer')
eq('trailing "Guild"', crestKey('Ranger Guild'), 'ranger')
eq('commoners have no crest', crestKey('Commoner'), null)
eq('nothing is nothing', crestKey(undefined), null)
eq('a plural is not guessed', crestKey('Thieves'), null)

// ── INFO line (verbatim from a logged session) ───────────────────────────────
eq('INFO guild', guildFromInfoLine('Name: Penello Highwind   Race: Human   Guild: Bard'), 'Bard')
eq('two-word INFO guild', guildFromInfoLine('Name: Kalika   Race: Elf   Guild: Moon Mage'), 'Moon Mage')
eq('other lines are not INFO', guildFromInfoLine('Gender: Female   Age: 47   Circle: 60'), null)
eq('Guild mentioned in prose is not INFO', guildFromInfoLine('You head to the Guild: it is closed.'), null)

// ── Death cards ──────────────────────────────────────────────────────────────
eq('dying shows death', deathCardFor(false, true, false), 'death')
eq('departing shows depart', deathCardFor(true, false, true), 'depart')
eq('coming back otherwise is a resurrection', deathCardFor(true, false, false), 'resurrect')
eq('staying alive shows nothing', deathCardFor(false, false, true), null)
eq('staying dead shows nothing', deathCardFor(true, true, false), null)

eq('DEPART', DEPART_RE.test('depart'), true)
eq('DEPART FULL', DEPART_RE.test('DEPART FULL'), true)
eq('dep', DEPART_RE.test('dep'), true)
eq('not "departure"', DEPART_RE.test('departure'), false)
eq('not "deposit"', DEPART_RE.test('deposit 5 silver'), false)

if (failures.length) {
  console.error(`\n✗ artKeys: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ artKeys: ${passed} passed`)
