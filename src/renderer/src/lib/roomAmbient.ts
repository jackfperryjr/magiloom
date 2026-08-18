/**
 * Room-driven ambient EFFECTS — the atmospheric particle layers keyed to a place
 * rather than to the weather or the clock (see components/game/AmbientOverlay).
 *
 * This is a separate axis from lib/roomLocale: a locale is the room's colour (a
 * forge is `indoor`, warm amber), an ambience is something actively happening in it
 * (that forge throws embers). A room can have both, one, or neither.
 *
 * Precision over recall, deliberately. These effects are rare by design — a handful
 * of rooms in the world are underwater and a few hundred have a fire in them — so a
 * miss costs nothing while a false positive puts drifting embers in a bookshop. The
 * vocabulary below was scored against the full 18.7k-room shipped corpus and the
 * rules that survived are the ones whose matches were all defensible; see
 * scripts/audit-ambient.js to re-run that check after any edit here.
 *
 * Classification is BAKED at build time (scripts/build-rooms.js) rather than run per
 * move, so the matches ship as a reviewable artifact instead of being re-guessed on
 * every step. classifyAmbience stays exported for rooms the shipped map has never
 * heard of, which the live automapper still meets.
 */

export type RoomAmbience = 'embers' | 'underwater'

// ── Underwater ────────────────────────────────────────────────────────────────
// Title-driven almost entirely. Scanning descriptions for "swim" put the effect in
// [Muspar'i, Street of Nobles] — a room in the middle of a desert city — because the
// prose mentions swimming; DR writes about water constantly in rooms that are merely
// NEAR it. A title that says you are under the water is a claim about where you are
// standing, which is the only thing worth trusting here.
//
// "sunken" only counts attached to a VESSEL. On its own it described [Sunken Pit,
// Mass Graveyard], which the audit caught: a dry pit whose prose is about skeletons
// "after long exposure to the elements". Things sink into ground as readily as sea.
const UNDERWATER_TITLE = /\bunderwater\b|\bsunken (?:ship|vessel|wreck|galley|barge|boat)\b|\bbeneath the waves\b|\bsea ?floor\b|\bseabed\b/i

// The one description form specific enough to survive the audit: prose that states
// you are IN it, not that water is nearby. "submerged" alone matched riverbanks.
const UNDERWATER_BODY = /\byou are (?:now )?(?:underwater|submerged)\b|\bwater closes over\b|\bcompletely submerged\b/i

// ── Embers ────────────────────────────────────────────────────────────────────
// A named fire feature in the room's own title is the strongest signal there is:
// "[Knife Clan, Firepit]", "[North Road, Lava Field]", "[Gorbesh Fortress, Firepit]".
// DR titles read "[Area, specific room]" and the specific part names what you are
// standing in.
const EMBERS_TITLE = /\bfire ?pit\b|\bbonfire\b|\bcamp ?fire\b|\bbrazier|\bforge\b|\bsmithy\b|\blava\b|\bmagma\b|\bvolcan/i

// Description fallback, restricted to prose describing a fire that is BURNING —
// verbs and states, not the noun on its own. "fireplace" unqualified matched
// [The Noble's Barn, Fanciful Fireplaces], a shop that sells them cold, and "forge"
// unqualified matched [The Crossing, Hodierna Way], a street near one.
const EMBERS_BODY = new RegExp([
  '\\b(?:flames?|fire|blaze|embers?|coals?)\\b[^.]{0,40}\\b(?:crackl|danc|flicker|leap|roar|burn|glow|smoulder|smolder|blaz)',
  '\\b(?:crackling|roaring|blazing|glowing|smouldering|smoldering)\\b[^.]{0,20}\\b(?:fire|flames?|embers?|coals?|hearth|forge|brazier)',
  '\\bmolten (?:rock|lava|stone)\\b',
  '\\bglowing coals?\\b',
].join('|'), 'i')

// A room whose title marks it as a place of business is describing its STOCK, not its
// hearth: [The Noble's Barn, Fanciful Fireplaces] sells them cold, and [Iltesh Neg
// Degti, Forge Supply Shop] sells to smiths without being a smithy. Applied to the
// specific-room segment for BOTH the title and description rules — gating only the
// prose left the shop names themselves matching.
const MERCANTILE = /\bshops?\b|\bstore\b|\bemporium\b|\bwares\b|\bgallery\b|\bshowroom\b|\bmarket\b|\bstall\b|\bboutique\b|\bsupplies\b|\bsales(?:room|\s?floor)?\b/i

// The same trap roomType.ts documents, and it caught this classifier too: DR names
// its roads after what stands on them, so [The Crossing, Smithy Lane] is a dozen
// rooms of open street that matched `smithy` and filled a public thoroughfare with
// forge embers. A road is somewhere you walk THROUGH — it never takes an ambience
// from its name. Kept in sync with roomType.ts's THOROUGHFARE by intent, not import:
// they answer different questions and should be free to diverge.
const THOROUGHFARE = /\b(?:street|lane|way|walk|road|avenue|alley|path|boulevard|bridge|stair(?:s|way)?|steps|trail|pike|row|approach)\s*\]?\s*$/

/**
 * The ambient effect a room should run, or null for the overwhelming majority that
 * run none. `title` is the room name as the stream reports it, `desc` its first
 * description.
 */
export function classifyAmbience(title: string, desc = ''): RoomAmbience | null {
  const t = title.toLowerCase()
  // DR titles read "[Area, specific room]", and the specific part is what you are
  // standing in — so a thoroughfare is judged on its own segment, not on the area
  // name that happens to precede it.
  const room = t.replace(/^\[?[^,\]]*,\s*/, '') || t
  // A forge is a fire; a forge SUPPLY SHOP is a counter. Neither a road nor a shop
  // can claim an ambience, from its name or its prose.
  const quiet = THOROUGHFARE.test(room) || MERCANTILE.test(room)

  if (UNDERWATER_TITLE.test(t)) return 'underwater'
  if (!quiet && EMBERS_TITLE.test(t)) return 'embers'

  const body = desc.toLowerCase()
  if (UNDERWATER_BODY.test(body)) return 'underwater'
  if (!quiet && EMBERS_BODY.test(body)) return 'embers'
  return null
}

// ── Wire format ───────────────────────────────────────────────────────────────
// rooms.json ships to every user, so the baked field is a single character rather
// than the word. Absent means "no ambience", which is ~97% of rooms.
export const AMBIENCE_CODE: Record<RoomAmbience, string> = { embers: 'e', underwater: 'w' }
const BY_CODE: Record<string, RoomAmbience> = { e: 'embers', w: 'underwater' }

export function ambienceFromCode(code: string | undefined): RoomAmbience | null {
  return (code && BY_CODE[code]) || null
}
