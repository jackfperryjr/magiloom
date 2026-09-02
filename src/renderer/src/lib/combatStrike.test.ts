/**
 * "Your hit landed" detection tests.
 *
 * Every combat line here is copied verbatim out of a real DR log rather than written
 * by hand — the whole feature rests on DR's `< ` / `* ` attack prefixes and on the
 * exact "lands a/an <severity> hit" wording, and a fixture someone paraphrased would
 * prove only that the regex matches itself.
 *
 * The cases that matter are the two false positives that would ruin the cue: an
 * incoming hit flashing amber (it must stay red-only) and a bystander's attack in a
 * crowded hunting room flashing at all.
 *
 * Run: npm run test:tools
 */

import { strikeIntensity } from './combatStrike'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── Your landed hits, scaled by severity ──────────────────────────────────────
eq('solid hit',
  strikeIntensity("< You lob a glittery lilac sprite-bone handled throwing hammer with a heavy vardite head at a void-black umbral moth.  A void-black umbral moth fails to block with its uncanny wings.  The hammer lands a solid hit that rips open the entire left thigh as fractured bones tear through the skin's surface."),
  0.27)

eq('light hit is dimmer than solid',
  strikeIntensity("< You fire a smooth rock at a void-black umbral moth.  A void-black umbral moth attempts to evade.  The rock lands a light hit that thumps it in the gut (it's the thought that counts)."),
  0.19)

eq('very heavy outranks heavy',
  strikeIntensity('< You slice a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth fails to dodge.  The glaive lands a very heavy hit that rips skin and exposes bloody cartilage under the left kneecap, lightly stunning it.'),
  0.39)

// "an extremely heavy" — the article changes with the adjective, which is what the
// first pass at this regex missed on 7,319 of this character's landed hits.
eq('extremely heavy takes the "an" article',
  strikeIntensity('< You slice a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth fails to block with its uncanny wings.  The glaive lands an extremely heavy hit that rips the left leg from the hip socket, making a wet sound.'),
  0.42)

eq('powerful strike',
  strikeIntensity('< You slice a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth badly fails to block with its uncanny wings.  The glaive lands a powerful strike that rips through muscle and organs, cutting the foe cleanly in half.'),
  0.45)

// Flaring weapon prose runs "…and lands a heavy strike…" mid-sentence, so the phrase
// can't be anchored to the start of the damage clause.
eq('a flaring weapon still reads',
  strikeIntensity('< You lob a glittery lilac sprite-bone handled throwing hammer with a heavy vardite head at a void-black umbral moth.  A void-black umbral moth badly fails to block with its uncanny wings.  The hammer shines arctic-blue, gushing out multiple scalding geysers and lands a heavy strike that shatters bone and rends flesh of the right arm, leaving it pretty much useless.'),
  0.36)

// The hardest crits in the game are hyphenated, and a severity pattern built out of
// letters and spaces reads them as misses — which is how this was first written.
eq('earth-shaking survives the hyphen',
  strikeIntensity('< You slice a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth fails to evade.  The glaive lands an earth-shaking strike that cleaves the right leg from the body.'),
  0.48)

// ── Misses stay dark ──────────────────────────────────────────────────────────
for (const [name, line] of [
  ['dodge',   '< You slice a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth dodges.  '],
  ['evade',   '< You jab a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth evades.  '],
  ['block',   '< You draw a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth barely blocks with its uncanny wings.  '],
  ['counter', '< You feint a lifesculpted glaive clutching moonsilver-inlaid stones at a void-black umbral moth.  A void-black umbral moth counters little of the glaive with its shadowy claws.  '],
] as const) eq(`${name} does not flash`, strikeIntensity(line), 0)

// ── Not yours ─────────────────────────────────────────────────────────────────
// The whole point of the amber flash is that it means something different from the
// red one. An incoming hit reaching it would collapse that distinction.
eq('an incoming hit does not flash amber',
  strikeIntensity('* A void-black umbral moth slices wide at you.  You fail to evade.  The shadowy claws lands a good strike to your left leg.'),
  0)
eq('an incoming miss does not flash amber',
  strikeIntensity('* A void-black umbral moth swings at you.  You dodge.  '),
  0)
eq("a bystander's hit does not flash",
  strikeIntensity("Gnarta's nightstick lands a good strike that blasts hard into the left arm and causes purple welts to appear almost immediately."),
  0)

// ── Robustness ────────────────────────────────────────────────────────────────
// Elemental and spell weapons invent their own adjectives; landing something is the
// signal, so an unknown word must not read as a miss.
eq('an unknown severity falls back to mid-tier',
  strikeIntensity("< You swing a paintbrush at a void-black umbral moth.  A void-black umbral moth fails to evade.  The paintbrush lands a sizzling hit to the moth's chest."),
  0.27)

// A multi-strike line is worth its hardest blow, not the sum — otherwise a flurry of
// light taps would outshine a massive strike.
eq('multi-strike takes the hardest blow',
  strikeIntensity('< You slice a glaive at a moth.  The glaive lands a light hit to the chest.  The glaive lands a massive strike to the neck.'),
  0.48)

// Prefixes are DR's, not Lich's, but the store also feeds this lines that have been
// through a trim; the unprefixed form has to survive.
eq('an unprefixed own attack still reads',
  strikeIntensity('You slice a lifesculpted glaive at a void-black umbral moth.  A void-black umbral moth fails to dodge.  The glaive lands a solid hit to the moth.'),
  0.27)

// Nothing to do with combat.
eq('ordinary prose does not flash', strikeIntensity('You bow to a bearded halfling.'), 0)
eq('a returning throw does not flash', strikeIntensity('The throwing hammer lands at your feet!'), 0)

if (failures.length) {
  console.error(`✗ combatStrike: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ combatStrike: ${passed} passed`)
