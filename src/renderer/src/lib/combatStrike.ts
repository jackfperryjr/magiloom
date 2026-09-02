/**
 * "Your hit landed" detection — the amber counterpart to the red damage flash.
 *
 * The red vignette (store/game combatHeatAtom) only rises when you LOSE HEALTH, so a
 * fight you're winning cleanly never lights the panel up at all. That is the correct
 * behaviour for a danger cue and the wrong one for "am I in combat", which is what
 * this module feeds: a second, dimmer, differently-coloured flash on every blow YOU
 * land.
 *
 * DR does the hard part for us. On the combat stream it prefixes the lines with who
 * is swinging:
 *
 *   < You slice a glaive at a moth.  A moth fails to block.  The glaive lands a
 *     solid hit to the moth's neck.
 *   * A moth lunges at you.  You fail to evade.  The proboscis lands a light hit to
 *     your left arm.
 *
 * `< ` is yours, `* ` is incoming, and a third party's attack ("Gnarta's bolt lands
 * a solid hit…") carries neither. Contact in every direction is the same phrase —
 * `lands a/an <severity> hit|strike|blow` — and its absence is a miss ("…dodges.",
 * "…barely blocks with its uncanny wings."). Verified against ~3.3M lines of this
 * character's own logs: 54,180 of 63,316 swings landed, and every landed line matched
 * the phrase above.
 *
 * That 86% land rate is why the intensities here top out below 1. At roughly one swing
 * per roundtime the flash fires almost every round, so it has to read as a pulse rather
 * than a wash — the same mistake the always-lit red rim made before it was cut back to
 * a flash.
 *
 * The ceiling is not a like-for-like fraction of the red's, because opacity is not
 * brightness: the amber (#f2a63a) carries a relative luminance of 0.46 against the
 * red's (#ff3028) 0.24, so at equal opacity it lands roughly twice as loud. Matching
 * the two by luminance would cap this around 0.4 and make a light hit invisible,
 * which defeats the point. The two cues are separated by HUE, and the numbers here
 * are set by what a pulse every few seconds can sustain without becoming wallpaper.
 *
 * An earlier pass set that sustainable ceiling at 0.48 and it was wrong — the whole
 * ladder sat far enough down that the flash didn't register unless you were watching
 * for it, and a cue you have to look for isn't doing its job. The floor moved up more
 * than the ceiling did: the top of the ladder was always going to be seen, and it was
 * the ordinary hits that were vanishing. Note that these numbers only ever made sense
 * alongside the geometry in ambient.css — a low peak on a shape that reaches deep into
 * the panel is a very different cue from the same peak on a hairline rim — so retune
 * them together, not one at a time.
 */

/**
 * DR's damage tiers, ascending, mapped onto flash intensity. The wording is the
 * severity adjective between "lands a/an" and "hit"/"strike"/"blow".
 *
 * Every tier below was observed in real logs except `grazing`/`devastating`, which
 * sit at the ends of DR's published ladder and are here so the extremes don't fall
 * through to the default. The spread is deliberately compressed at the top: two
 * thirds of this character's landed hits are heavy-or-better, so stretching those
 * apart would put the flash near its ceiling on almost every swing.
 */
const TIERS: Record<string, number> = {
  brushing:           0.30,
  grazing:            0.30,
  light:              0.36,
  good:               0.42,
  solid:              0.47,
  hard:               0.52,
  strong:             0.56,
  heavy:              0.60,
  'very heavy':       0.64,
  'extremely heavy':  0.68,
  awesome:            0.70,
  vicious:            0.70,
  powerful:           0.71,
  massive:            0.75,
  demolishing:        0.75,
  devastating:        0.75,
  // The top of the ladder is hyphenated, which is why the pattern below can't just
  // scan for letters and spaces — these read as misses if the hyphen breaks the
  // match, and they are the last hits that should go unremarked.
  'spine-rattling':   0.75,
  'earth-shaking':    0.75,
}

/**
 * What an unrecognised severity is worth. Elemental and spell weapons write their own
 * adjectives ("sizzling", "splattering", "poofy") that don't map onto the physical
 * ladder, and DR adds wording faster than anyone can enumerate it. Landing SOMETHING
 * is the signal; treating an unknown word as a mid-tier hit is a better failure than
 * going dark.
 */
const UNKNOWN_TIER = 0.47

/** A blow connecting, in either direction. The article varies ("an extremely heavy"). */
const LANDS_RE = /\blands an?\s+([a-z][a-z -]{0,20}?)\s+(?:hit|strike|blow)\b/g

/**
 * Yours, by DR's own-attack prefix. The fallback covers a feed the marker has been
 * stripped from: "You <verb> <weapon> at <target>." is still unmistakably an attack
 * you made, and it can't collide with an incoming hit (those open with the attacker,
 * "A moth lunges at you") or a bystander's ("Gnarta's bolt lands…").
 */
const MARKED_RE   = /^<\s*You\b/
const UNMARKED_RE = /^You\s+\w+\s[^.]*\bat\s+(?:an?|the)\s[^.]*\./

/**
 * The flash intensity a combat line should produce, or 0 if it isn't you landing one.
 *
 * A single line can carry more than one blow (multi-strike weapons); the hardest of
 * them sets the flash rather than the sum, so a flurry of light hits can't outshine a
 * massive strike.
 */
export function strikeIntensity(text: string): number {
  if (!MARKED_RE.test(text) && !UNMARKED_RE.test(text)) return 0

  let best = 0
  LANDS_RE.lastIndex = 0
  for (let m = LANDS_RE.exec(text); m; m = LANDS_RE.exec(text)) {
    const tier = TIERS[m[1].toLowerCase()] ?? UNKNOWN_TIER
    if (tier > best) best = tier
  }
  return best
}
