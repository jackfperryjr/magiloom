// Room-locale classifier for the ambient room-tint overlay.
//
// DR has no structured room-type field, so we infer a coarse "locale" from the
// room NAME + DESCRIPTION by keyword — enough to pick an atmospheric colour for
// the ambient tint (see AmbientOverlay / ambient.css). Deliberately fuzzy: a wrong
// guess only shifts a faint edge wash, never anything functional. `default` (no
// tint) is the safe fallback whenever nothing matches confidently.

export type RoomLocale =
  | 'underground'   // caves, tunnels, mines, crypts — dim, cool
  | 'forest'        // woods, groves, jungle — green
  | 'indoor'        // taverns, inns, shops, halls — warm hearth
  | 'water'         // shores, docks, rivers, swamps — cool blue
  | 'urban'         // streets, plazas, city ways — neutral stone
  | 'default'       // unknown → no tint

// Each locale's tint, as an rgba the overlay drops straight into a vignette. Kept
// low-alpha; the overlay concentrates it at the panel edges so the reading column
// stays clean regardless of theme. Ordered by match priority below.
export const LOCALE_TINT: Record<Exclude<RoomLocale, 'default'>, string> = {
  underground: 'rgba(70, 84, 120, 0.34)',   // cool slate-blue gloom
  water:       'rgba(56, 130, 168, 0.30)',   // cool aqua
  forest:      'rgba(78, 132, 74, 0.30)',    // mossy green
  indoor:      'rgba(196, 132, 58, 0.26)',   // warm hearth amber
  urban:       'rgba(120, 116, 132, 0.24)',  // neutral stone
}

// Keyword sets per locale. Matched against a lowercased "name + description" blob.
// Order matters: the first locale (top → bottom) with a hit wins, so the more
// specific/atmospheric locales are listed before the generic `urban`. Word-boundary
// matching avoids false hits inside longer words (e.g. "cavern" vs "scavenger").
const RULES: { locale: Exclude<RoomLocale, 'default'>; words: string[] }[] = [
  { locale: 'underground', words: [
    'cave', 'cavern', 'tunnel', 'mine', 'crypt', 'catacomb', 'grotto', 'burrow',
    'cellar', 'dungeon', 'chasm', 'crevice', 'undergound', 'subterranean', 'lair',
    'sewer', 'vault', 'passage underground', 'stalactite', 'stalagmite',
  ] },
  { locale: 'water', words: [
    'shore', 'beach', 'dock', 'pier', 'wharf', 'harbor', 'harbour', 'river',
    'stream', 'brook', 'lake', 'pond', 'marsh', 'swamp', 'bog', 'fen', 'bank',
    'shallows', 'lagoon', 'waterfall', 'ford', 'bridge', 'quay', 'tide',
  ] },
  { locale: 'forest', words: [
    'forest', 'wood', 'woods', 'grove', 'thicket', 'glade', 'copse', 'jungle',
    'clearing', 'trail', 'brush', 'undergrowth', 'canopy', 'pine', 'oak',
    'foliage', 'meadow', 'field', 'moor', 'heath', 'orchard',
  ] },
  { locale: 'indoor', words: [
    'tavern', 'inn', 'pub', 'shop', 'store', 'hall', 'room', 'chamber', 'kitchen',
    'parlor', 'parlour', 'library', 'temple', 'shrine', 'hearth', 'fireplace',
    'lodge', 'workshop', 'forge', 'smithy', 'bakery', 'guild', 'foyer', 'lobby',
    'bedroom', 'study', 'office', 'cottage interior', 'indoors',
  ] },
  { locale: 'urban', words: [
    'street', 'road', 'lane', 'avenue', 'plaza', 'square', 'courtyard', 'alley',
    'gate', 'wall', 'rampart', 'market', 'bazaar', 'boulevard', 'promenade',
    'way', 'crossing', 'town', 'city', 'village', 'commons', 'yard',
  ] },
]

// Precompiled word-boundary regexes, one per rule, cached at module load.
const COMPILED = RULES.map(r => ({
  locale: r.locale,
  re: new RegExp('\\b(?:' + r.words.map(escapeRe).join('|') + ')\\b', 'i'),
}))

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// ── Wire format ───────────────────────────────────────────────────────────────
// The locale is BAKED per room into rooms.json (scripts/build-rooms.js) and shipped,
// so it is stored as a single character. Baking is not just a speed trick: the live
// classifier only ever sees one room, and auditing it over the shipped corpus found
// 5,121 pairs of CONNECTED rooms that share a title but classify differently — a
// tint that flickered every time you walked through one of them. The bake sees the
// whole graph and smooths those runs; see smoothLocales in the build script.
export const LOCALE_CODE: Record<Exclude<RoomLocale, 'default'>, string> = {
  underground: 'g', water: 'w', forest: 'f', indoor: 'n', urban: 'u',
}
const BY_CODE: Record<string, RoomLocale> = {
  g: 'underground', w: 'water', f: 'forest', n: 'indoor', u: 'urban',
}

export function localeFromCode(code: string | undefined): RoomLocale {
  return (code && BY_CODE[code]) || 'default'
}

// Classify a room by its name + description. The name is weighted first (checked on
// its own before falling back to the whole blob) since a room's title is the most
// reliable locale signal — "Kaerna Village, Herb Shop" should read as indoor even
// if the description mentions the street outside.
//
// This remains the live fallback for rooms the shipped map has never heard of. Where
// a baked locale exists it wins, because it had the graph to smooth against.
export function classifyRoom(name: string, description = ''): RoomLocale {
  const title = name.toLowerCase()
  for (const c of COMPILED) if (c.re.test(title)) return c.locale
  const blob = (name + ' ' + description).toLowerCase()
  for (const c of COMPILED) if (c.re.test(blob)) return c.locale
  return 'default'
}
