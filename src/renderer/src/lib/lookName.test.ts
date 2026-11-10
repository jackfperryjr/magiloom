import assert from 'node:assert/strict'
import { stripLeadingTitle, lookCharacterName, selfLookName } from './lookName'

// Titles come off the front.
assert.equal(stripLeadingTitle('Paintress Catheroine Rotschreck, a Human.'), 'Catheroine Rotschreck, a Human.')
assert.equal(stripLeadingTitle('Adviser to the Twelve Elanarie, an Elf.'), 'Elanarie, an Elf.')
assert.equal(stripLeadingTitle('Accountant Penello, a Halfling.'), 'Penello, a Halfling.')

// A name that is also a title survives when nothing name-like follows it.
assert.equal(stripLeadingTitle('Abra, a Gnome.'), 'Abra, a Gnome.')
assert.equal(stripLeadingTitle('Abra has a soft face.'), 'Abra has a soft face.')
assert.equal(stripLeadingTitle('Mitsuri, a Human.'), 'Mitsuri, a Human.')

// Description line wins: skips the title and the surname.
assert.equal(lookCharacterName([
  'You see Paintress Catheroine Rotschreck, a Human.',
  'Catheroine has a soft-featured face.',
]), 'Catheroine')

// No description line: the "You see" line minus its title.
assert.equal(lookCharacterName(['You see Paintress Catheroine Rotschreck, a Human.']), 'Catheroine')
assert.equal(lookCharacterName(['You see Adviser to the Twelve Elanarie, an Elf.']), 'Elanarie')
assert.equal(lookCharacterName(['You see Abra, a Gnome.']), 'Abra')

// A pronoun-led second line is not a name.
assert.equal(lookCharacterName(['You see Paintress Catheroine, a Human.', 'She is wearing a cloak.']), 'Catheroine')

// Nothing parseable: fall back to what was typed.
assert.equal(lookCharacterName(['You see someone.'], 'Mits'), 'Mits')

// Our own LOOK: a worn title must not become the name.
assert.equal(selfLookName('You are Visionary Refia Highwind, Woodland Princess of Ilithi, a Human.'), 'Refia')
assert.equal(selfLookName('You are Refia Highwind, Woodland Princess of Ilithi, a Human.'), 'Refia')
assert.equal(selfLookName('You are Penello Highwind, a Human.'), 'Penello')

console.log('lookName: ok')
