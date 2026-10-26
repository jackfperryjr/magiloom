// Room-locale classifier for the ambient room-tint overlay and the room panel art.
//
// DR has no structured room-type field, so we infer a coarse "locale" from the
// room NAME + DESCRIPTION — enough to pick an atmospheric colour for the ambient
// tint (see AmbientOverlay / ambient.css) and a header painting for the room panel.
// Deliberately fuzzy: a wrong guess only changes a picture, never anything
// functional. `default` (open country / no tint) is the fallback whenever nothing
// scores confidently.

export type RoomLocale =
  | 'underground'   // caves, tunnels, mines, crypts — dim, cool
  | 'forest'        // woods, groves, jungle — green
  | 'indoor'        // taverns, inns, shops, halls — warm hearth
  | 'water'         // shores, docks, rivers, swamps — cool blue
  | 'urban'         // streets, plazas, city ways — neutral stone
  | 'default'       // open country or unknown → no tint

// Each locale's tint, as an rgba the overlay drops straight into a vignette. Kept
// low-alpha; the overlay concentrates it at the panel edges so the reading column
// stays clean regardless of theme.
export const LOCALE_TINT: Record<Exclude<RoomLocale, 'default'>, string> = {
  underground: 'rgba(70, 84, 120, 0.34)',   // cool slate-blue gloom
  water:       'rgba(56, 130, 168, 0.30)',   // cool aqua
  forest:      'rgba(78, 132, 74, 0.30)',    // mossy green
  indoor:      'rgba(196, 132, 58, 0.26)',   // warm hearth amber
  urban:       'rgba(120, 116, 132, 0.24)',  // neutral stone
}

// ── Scoring ──────────────────────────────────────────────────────────────────
// Every cue that appears in the room adds its weight to its locale, and the highest
// total wins. A single keyword used to decide the whole room, so "[Temple Hill,
// Memorial Park]" read as indoor on the word "temple" while its description talked
// about grass, a reflecting pool and a wooded park.
//
// Where a cue appears scales its weight:
//   - the place in the title, after the comma ("Memorial Park"):  × PLACE
//   - the area in the title, before it ("Temple Hill"):           × AREA
//   - the description:                                             × 1
// A title with no comma counts as all place. Each cue counts once per source.
//
// `wilds` is a pseudo-locale for open country (cliffs, desert, plains). It has no
// tint of its own and comes out as `default`, but it needs a vote, or a mountain
// pass falls to whichever locale has the most incidental words.
//
// SKY cues (sun, breeze, clouds) don't vote for anything: they count against
// indoor and underground, since you can't feel the wind in a cellar.
//
// Weights were tuned against a hand-labelled sample of shipped rooms; see
// roomLocale.test.ts. Adding a cue? Run `npm run test:tools` — the sample check
// there fails if accuracy drops.

type Scored = Exclude<RoomLocale, 'default'> | 'wilds'

// A cue is "word" or "word:weight" (default 2). Single words also match their
// plural (+s / +es). `title` cues only count in the room title.
interface CueSet { locale: Scored; desc: string[]; title?: string[]; notBefore?: string[] }

const PLACE = 3
const AREA = 2
const SKY_PENALTY = 1.5
// Below this the room is unplaceable and gets `default`.
const MIN_SCORE = 1.5

const CUES: CueSet[] = [
  { locale: 'underground', desc: [
    'cave:3', 'cavern:3', 'tunnel:3', 'mine:3', 'mineshaft:3', 'crypt:3', 'catacomb:3',
    'grotto:3', 'burrow:3', 'dungeon:3', 'sewer:3', 'subterranean:3', 'underground:3',
    'stalactite:3', 'stalagmite:3', 'ossuary:3', 'cellar', 'lair', 'chasm', 'crevice',
    'rock walls', 'stone ceiling', 'rough-hewn', 'rough hewn', 'phosphorescent',
    'luminescent', 'bioluminescent', 'fungus', 'fungi', 'ore:1', 'depths',
    'heart of the mountain:3', 'into the earth', 'beneath the earth', 'damp:1',
    'dripping:1', 'drip:1', 'echo:1', 'echoing:1', 'darkness:1', 'blackness:1',
    'stale air:1.5', 'dank:1', 'rubble:1', 'rock fall:1.5', 'passage:1', 'passageway:1',
    'shaft:1.5', 'fissure:1',
  ] },
  { locale: 'water', desc: [
    'shore:3', 'shoreline:3', 'beach:3', 'surf:3', 'dock:3', 'pier:3', 'wharf:3',
    'harbor:3', 'harbour:3', 'quay:3', 'marina:3', 'river:3', 'riverbank:3', 'riverside:3',
    'stream:3', 'creek:3', 'brook:3', 'lake:3', 'lakeshore:3', 'pond:3', 'marsh:3',
    'swamp:3', 'bog:3', 'fen:3', 'bayou:3', 'mire:3', 'lagoon:3', 'sandbar:3', 'cove:3',
    'sea:3', 'ocean:3', 'underwater:3', 'shallows:3', 'rapids:3', 'waterfall:3',
    'in the water:3', "water's edge:3", 'waves', 'tide', 'current', 'ford', 'sailor',
    'ship', 'boat', 'boardwalk', 'reeds', 'cattails', 'fish:1', 'driftwood', 'seaweed',
    'murky:1', 'water:1', 'bridge:1', 'mud:1', 'muddy:1', 'sandy:1', 'splash:1',
    // Aboard something. Ferries and ships are moving rooms the shipped map never
    // has, so the live classifier is all they get.
    'ferry:3', 'barge:3', 'raft:3', 'skiff:3', 'rowboat:3', 'sailboat:3', 'aboard:3',
    'gangplank:3', 'deck:1', 'hull', 'mast', 'sail:1.5', 'keel', 'rigging', 'oars', 'helm:1',
    'anchor:1', 'vessel:1', 'briny', 'brine', 'salt spray',
  ] },
  { locale: 'forest', desc: [
    'forest:3', 'woods:3', 'woodland:3', 'wooded:3', 'grove:3', 'thicket:3', 'copse:3',
    'jungle:3', 'glade:3', 'undergrowth:3', 'underbrush:3', 'canopy:3', 'wildwood:3',
    'orchard:3', 'tree', 'trunk', 'branch', 'leaves', 'foliage', 'bush', 'shrub', 'fern',
    'vine', 'bramble', 'sapling', 'pine', 'birch', 'elm', 'willow', 'larch', 'cedar',
    'bamboo', 'meadow', 'clearing', 'game trail:3', 'deer trail:3', 'wildflower',
    'briar', 'moss:1', 'grass:1', 'grassy:1', 'flower:1', 'rose:1',
    'trail:1', 'leafy:1', 'bark:1', 'ivy:1', 'creeper:1', 'needles:1', 'squirrel:1',
    'deer:1', 'hedge:1', 'lawn:1.5',
  ], title: ['garden:2.5', 'park:2.5'] },
  { locale: 'indoor', desc: [
    'room', 'ceiling:3', 'shop:3', 'store:3', 'boutique:3', 'emporium:3', 'tavern:3',
    'inn:3', 'pub:3', 'kitchen:3', 'parlor:3', 'parlour:3', 'lobby:3', 'chamber', 'hallway:3',
    'corridor', 'ballroom:3', 'bedroom:3', 'salesroom:3', 'workroom:3', 'workshop:3',
    'library:3', 'chapel:3', 'office:3', 'foyer:3', 'lounge:3', 'attic:3', 'indoors:3',
    'interior', 'inside:1.5', 'tent', 'wallpaper:3', 'wainscoting:3', 'rafters:3',
    'floorboards:3', 'shelves:3', 'shelf', 'counter', 'fireplace:3', 'hearth:3',
    'staircase', 'stairway', 'stairs:1', 'walls:1', 'floor:1.5', 'rack', 'table:1.5',
    'chair', 'desk', 'bed:1', 'rug', 'carpet', 'tapestry', 'tapestries', 'curtain',
    'window:1.5', 'windowsill', 'stove', 'candle:1', 'lamp:1', 'sconce', 'chandelier',
    'doorway:1', 'cushion', 'furniture', 'merchandise:3', 'wares', 'customer', 'patron',
    'clerk', 'goods:1.5', 'altar', 'dome', 'skylight', 'alcove:1.5', 'booth', 'cabinet', 'hall',
    'mantel', 'for sale:3', 'display:1.5', 'cupboard', 'apartment', 'barracks', 'quarters:1',
    'roof:1', 'door:1',
  ], title: ['temple', 'shrine', 'guild:1', 'house:1', 'manor', 'cottage', 'hall',
    'tower:1', 'keep:1', 'palace:1', 'sanctum', 'abbey', 'monastery', 'cloister:1', 'bar:3',
    'barn:3', 'loft:3', 'cabin'],
  notBefore: ['hill', 'grounds', 'district', 'quarter', 'row', 'street', 'lane', 'road',
    'way', 'square', 'path', 'walk', 'gate', 'island', 'mountain'] },
  { locale: 'urban', desc: [
    'street:3', 'lane:3', 'avenue:3', 'boulevard:3', 'plaza:3', 'courtyard:3', 'alley:3',
    'alleyway:3', 'cobblestone:3', 'cobbled:3', 'cobbles:3', 'bazaar:3', 'marketplace:3',
    'promenade:3', 'thoroughfare:3', 'city:3', 'square', 'road:1.5', 'town', 'village',
    'home', 'houses', 'buildings', 'shops', 'storefront', 'townsfolk', 'citizen',
    'passersby', 'traffic', 'wagon', 'carriage', 'market', 'estates', 'tenement', 'hovel',
    'hut', 'yard', 'commons', 'gate:1.5', 'paved', 'pavement', 'fountain', 'lamppost',
    'rooftops', 'district', 'quarter:1.5', 'neighborhood', 'residents', 'crowd',
    'merchant:1.5', 'stall', 'portico', 'walkway', 'cart:1', 'guard:1', 'sign:1',
  ] },
  { locale: 'wilds', desc: [
    'cliff:3', 'crags:3', 'mountain:3', 'mountainside:3', 'ridge:3', 'canyon:3',
    'gorge:3', 'ravine:3', 'desert:3', 'dunes:3', 'plains:3', 'prairie:3', 'steppe:3',
    'grassland:3', 'tundra:3', 'wasteland:3', 'badlands:3', 'farmland:3', 'hillside:3',
    'foothills:3', 'crater:3', 'salt flats:3', 'lake bed:3', 'scrubland:3', 'heath:3',
    'moor:3', 'highlands:3', 'plateau:3', 'hill:1.5', 'knoll', 'valley', 'field', 'farm',
    'pasture', 'slope', 'ledge', 'rocks', 'boulder', 'outcrop', 'scrub', 'sagebrush',
    'cactus', 'dust:1', 'dirt:1', 'rocky:1', 'stones:1', 'pass:1.5', 'track:1',
  ] },
]

const SKY = ['sky', 'skies', 'sun', 'sunlight', 'sunshine', 'sunrise', 'sunset', 'breeze',
  'wind', 'gust', 'cloud', 'rain', 'snow', 'weather', 'open air', 'night air', 'stars']

// ── Compilation ──────────────────────────────────────────────────────────────

interface Cue { re: RegExp; weight: number }
interface CompiledSet { locale: Scored; desc: Cue[]; title: Cue[] }

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function compileCue(spec: string, notBefore?: string[]): Cue {
  const i = spec.lastIndexOf(':')
  const word = i > 0 ? spec.slice(0, i) : spec
  const weight = i > 0 ? Number(spec.slice(i + 1)) : 2
  const phrase = word.includes(' ')
  const body = escapeRe(word).replace(/ /g, '\\s+') + (phrase ? '' : '(?:s|es)?')
  const tail = notBefore ? '(?!\\s+(?:' + notBefore.map(escapeRe).join('|') + ')\\b)' : ''
  return { re: new RegExp('\\b' + body + '\\b' + tail, 'i'), weight }
}

const COMPILED: CompiledSet[] = CUES.map(s => {
  const desc = s.desc.map(c => compileCue(c, s.notBefore))
  return { locale: s.locale, desc, title: [...desc, ...(s.title ?? []).map(c => compileCue(c, s.notBefore))] }
})
const SKY_CUES = SKY.map(c => compileCue(c))

const sum = (cues: Cue[], text: string): number => {
  let n = 0
  for (const c of cues) if (c.re.test(text)) n += c.weight
  return n
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

/** Each locale's score for a room, highest first. Exposed for tests and tuning. */
export function scoreRoom(name: string, description = ''): [Scored, number][] {
  const title = name.replace(/^\[|\]$/g, '')
  const comma = title.indexOf(',')
  const area = comma >= 0 ? title.slice(0, comma) : ''
  const place = comma >= 0 ? title.slice(comma + 1) : title
  const sky = SKY_CUES.filter(c => c.re.test(description) || c.re.test(title)).length

  const scores = COMPILED.map(s => {
    let n = sum(s.title, place) * PLACE + sum(s.desc, description)
    if (area) n += sum(s.title, area) * AREA
    if (s.locale === 'indoor' || s.locale === 'underground') n -= sky * SKY_PENALTY
    return [s.locale, n] as [Scored, number]
  })
  // Stable sort keeps CUES order as the tiebreak.
  return scores.sort((a, b) => b[1] - a[1])
}

// Classify a room by its name + description.
//
// This is the live fallback for rooms the shipped map has never heard of. Where a
// baked locale exists it wins, because it had the graph to smooth against.
export function classifyRoom(name: string, description = ''): RoomLocale {
  const [best, score] = scoreRoom(name, description)[0]
  if (score < MIN_SCORE || best === 'wilds') return 'default'
  return best
}
