// Build the prebaked DR room graph. Run: npm run map:build-rooms
//
// The automapper learns the world by walking it, which means a fresh install
// knows nothing and a player only ever has the map they personally explored.
// This script front-loads that: it converts Lich's DragonRealms map database —
// a community-maintained crawl of the whole game, already installed alongside
// Lich — into a single rooms.json the app can ship. Live mapping still runs on
// top of it and still records anything the crawl missed; this just means the
// map starts populated instead of empty.
//
// Generated artifact. Never hand-edit the output — edit the curation overlay
// (map-data/authored.json) and re-run, so a mapdb refresh doesn't clobber the
// hand-authored parts.
//
// The two id spaces matter and are easy to conflate:
//   • Lich room id  — dense 0..N, assigned by the crawler, stable within one
//                     mapdb file. The graph's own keys and the wayto targets.
//   • DR prime uid  — the game's native room number, what <nav rm='NNNN'/> and
//                     the "(NNNN)" title tag carry, and what the running app
//                     identifies rooms by.
// Most mapdb rooms carry a uid (~83% of this crawl) but far from all, so the app
// joins on uid where it exists and falls back to content matching (title +
// description hash) elsewhere, backfilling uids onto nodes as live play observes
// them. The build prints the real ratio each run.

const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')
const os = require('os')

const ROOT = path.resolve(__dirname, '..')
const OUT_DIR = path.join(ROOT, 'resources', 'map-data', 'dr-prime')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'map-build')

// ── Locate the newest Lich DR mapdb ──────────────────────────────────────────
// Lich writes a timestamped snapshot per update and keeps the old ones, so take
// the highest timestamp rather than whatever readdir happens to return first.
function findMapDb() {
  const explicit = process.env['MAGILOOM_DR_MAPDB']
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`MAGILOOM_DR_MAPDB not found: ${explicit}`)
    return explicit
  }
  const home = os.homedir()
  const roots = [
    'C:\\Ruby4Lich5\\Lich5\\data\\DR',
    path.join(home, 'lich5', 'data', 'DR'),
    path.join(home, 'Desktop', 'Lich5', 'data', 'DR'),
    '/opt/lich/data/DR',
  ]
  for (const dir of roots) {
    if (!fs.existsSync(dir)) continue
    const snaps = fs.readdirSync(dir)
      .map(f => f.match(/^map-(\d+)\.json$/))
      .filter(Boolean)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
    if (snaps.length) return path.join(dir, snaps[0][0])
  }
  throw new Error(
    'No Lich DR mapdb found. Install Lich, or set MAGILOOM_DR_MAPDB to a map-<ts>.json.',
  )
}

// ── Reuse the app's own move classifier ──────────────────────────────────────
// The exits in the mapdb are literal move COMMANDS ("northwest", "go wooden
// gate"), and turning those into a canonical direction is exactly what
// classifyMove already does for live play. Bundling the real module keeps the
// prebaked graph and the live mapper from drifting apart on, say, which verbs
// count as travel.
function loadMapModel() {
  fs.mkdirSync(CACHE, { recursive: true })
  const out = path.join(CACHE, 'mapModel.mjs')
  buildSync({
    entryPoints: [path.join(ROOT, 'src/renderer/src/lib/mapModel.ts')],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    logLevel: 'warning',
  })
  return import('file://' + out.replace(/\\/g, '/'))
}

// Lich stores titles with its own bracket wrapper around the game's, e.g.
// "[[Muspar'i, Tuul Yamshuk Staho]]". Peel one layer so it matches the title
// the stream actually delivers.
function normTitle(raw) {
  const s = String(raw ?? '').trim()
  return /^\[\[.*\]\]$/.test(s) ? s.slice(1, -1) : s
}

// "Obvious paths: northeast, southeast, west, northwest." -> [northeast, ...].
// Also covers the "Obvious exits:" wording and a bare "none".
function parsePaths(raw) {
  const s = String(raw ?? '')
  const m = s.match(/Obvious (?:paths|exits):\s*(.+?)\.?\s*$/i)
  if (!m || /^none$/i.test(m[1].trim())) return []
  return m[1].split(/,\s*/).map(p => p.trim().toLowerCase()).filter(Boolean)
}

// ── Forageables ──────────────────────────────────────────────────────────────
// A mapdb room's `tags` are an untyped grab-bag that Lich's own scripts filter by
// convention: forageable item names sit alongside shop tags ("bank", "pawnshop"),
// guild tags ("moon mage"), hunting-zone ids ("wood_trolls"), travel-script
// fragments ("peer e =~ /a gate.../") and structured "meta:" entries. Only the
// item names are worth shipping, so this pulls them out and drops the rest.
//
// The extraction is deliberately conservative — a false positive puts "bank" in a
// room's forage list, which reads as a bug, while a miss just omits one item from
// a list that was never exhaustive to begin with.

// Everything else is dropped: structured metadata, Lich's own markers, hunting
// zone ids (always underscored), and script conditions (contain a regex or path).
const NOT_AN_ITEM = /^meta:|^lich-|^no-auto-map$|^suit-yourself$|_|=~|\//

// Head noun of an item name. DR's forageables are overwhelmingly regular families
// — every tree yields a branch/limb/stick, every bush a berry — so matching the
// last word covers the long tail without enumerating ~200 species by hand.
const ITEM_HEAD = new RegExp('(?:^|\\s)(?:' + [
  // wood
  'branch', 'branche', 'branches', 'limb', 'stick', 'twig', 'log', 'splinter', 'chip', 'bark',
  // plants
  'root', 'roots', 'leaf', 'leave', 'leaves', 'vine', 'stem', 'weed', 'grass', 'moss',
  'sap', 'cattail', 'fern', 'clover', 'thistle', 'reed', 'seed', 'needle', 'cone',
  // flowers
  'flower', 'flowers', 'blossom', 'pollen', 'rose', 'lavender', 'sage', 'chamomile', 'catnip',
  // fungi
  'toadstool', 'mushroom',
  // fruit + food
  'berry', 'berries', 'berrie', 'strawberry', 'strawberries', 'strawberrie',
  'blueberry', 'blueberries', 'boysenberries', 'loganberries', 'gooseberries',
  'olallieberry', 'taffelberries', 'cherry', 'lemon', 'apple', 'acorn',
  'carrot', 'corn', 'turnip', 'scallion',
  // animal / mineral
  'shell', 'feather', 'bone', 'comb', 'rock', 'dirt',
].join('|') + ')$')

// Items whose names end in something too generic to match on ("cloth", "coin",
// "tack"). These are DR's forage JUNK — the filler results a failed forage returns
// — so they are common enough in the data to be worth naming explicitly.
const ITEM_EXACT = new Set([
  'shoe tack', 'torn cloth', 'tarnished Imperial coin', 'rusty nail', 'nail',
  'old button', 'bread crumb', 'dust bunny', 'dust bunnie', 'grungy feather',
  'wood chip', 'honey comb', 'pale toadstool',
])

// "sprig of lavender", "handful of blueberries" — the head noun is the item, but
// the measure-word prefix is what the game actually reports.
const ITEM_PREFIX = /^(?:sprig|handful|piece|bunch) of\s/

// Typo/plural variants the crawl accumulated. Collapsing them stops a room from
// listing "alder branch" and "alder branche" as two different things.
const VARIANTS = [
  [/branches?$/, 'branch'], [/branche$/, 'branch'],
  [/leaves$/, 'leaf'], [/leave$/, 'leaf'],
  [/strawberrie$/, 'strawberry'], [/berrie$/, 'berries'],
  [/flowers$/, 'flower'],
]

function normItem(tag) {
  let s = tag.trim()
  for (const [re, to] of VARIANTS) if (re.test(s)) { s = s.replace(re, to); break }
  return s
}

// A room's forageable items, deduped and sorted. Empty for the vast majority of
// rooms — only ~4k of 18k carry any tags at all.
function forageables(tags) {
  const out = new Set()
  for (const raw of tags ?? []) {
    const tag = String(raw ?? '').trim()
    if (!tag || NOT_AN_ITEM.test(tag)) continue
    // "shard" alone is the city of Shard (cf. "shard bank"), not a gem shard.
    if (tag === 'shard' || tag === 'herb' || tag === 'herbs' || tag === 'pile') continue
    if (ITEM_EXACT.has(tag) || ITEM_PREFIX.test(tag) || ITEM_HEAD.test(tag)) out.add(normItem(tag))
  }
  return [...out].sort()
}

async function main() {
  const { classifyMove, fnv1a } = await loadMapModel()

  const dbPath = findMapDb()
  console.log(`source     ${dbPath}`)
  const raw = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
  const entries = (Array.isArray(raw) ? raw : Object.values(raw)).filter(Boolean)

  let withUid = 0, special = 0, unknown = 0, dropped = 0
  const rooms = []
  for (const r of entries) {
    if (r.id == null) { dropped++; continue }

    // wayto maps destination id -> the literal command that gets you there.
    //
    // A null command is a connection the crawl proved exists but could not name:
    // the move came from a script's direction table, a password door, or some
    // other transition with no reproducible command. Those keep their edge with
    // an empty move and dir 'unknown', so the map still DRAWS the link (the rooms
    // really do connect, and a player can go work out how) while route finding
    // refuses to plan through a step it cannot actually send.
    const exits = []
    for (const [to, move] of Object.entries(r.wayto ?? {})) {
      if (typeof move !== 'string' || !move.trim()) { exits.push([Number(to), '', 'unknown']); unknown++; continue }
      const cls = classifyMove(move)
      // Not a movement verb we recognize, but the crawl still walked it — keep the
      // literal command and let it route as a non-cardinal step.
      exits.push([Number(to), move, cls ? cls.dir : 'special'])
      if (!cls || cls.dir === 'special') special++
    }

    const uids = (r.uid ?? []).map(Number).filter(Number.isFinite)
    if (uids.length) withUid++

    const title = normTitle((r.title ?? [])[0])
    const desc = String((r.description ?? [])[0] ?? '')
    // The obvious-paths line, not the wayto keys. Content identity is matched
    // against what the live stream reports, and the stream's exits event carries
    // exactly this list — wayto additionally includes scripted moves ("go gate")
    // that never appear in obvious paths, so hashing those would stop prebaked
    // rooms from ever matching an observed one.
    const obvious = parsePaths((r.paths ?? [])[0])
    const forage  = forageables(r.tags)
    rooms.push({
      id: Number(r.id),
      ...(uids.length ? { uid: uids } : {}),
      t: title,
      desc,
      // Content identity, precomputed so the app doesn't rehash 18k rooms on boot.
      h: fnv1a(desc),
      ...(obvious.length ? { e: obvious } : {}),
      // Region — the crawl's own area name ("Riverhaven", "Velaka Desert"). Coarser
      // and more human than the title-derived zone, and the only label the wilds
      // rooms (whose titles carry no area at all) ever get.
      ...(r.location ? { loc: String(r.location) } : {}),
      x: exits,
      // Per-edge traversal seconds — the natural weight for route finding.
      ...(r.timeto && Object.keys(r.timeto).length ? { w: r.timeto } : {}),
      ...(forage.length ? { f: forage } : {}),
    })
  }

  // A content hash of the graph, so the layout bake can tell whether its cached
  // positions still correspond to these rooms.
  const roomsVersion = fnv1a(JSON.stringify(rooms.map(r => [r.id, r.t, r.x])))

  const doc = {
    instance: 'dr-prime',
    source: path.basename(dbPath),
    generated: Math.floor(Date.now() / 1000),
    roomsVersion,
    rooms,
  }
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const outFile = path.join(OUT_DIR, 'rooms.json')
  fs.writeFileSync(outFile, JSON.stringify(doc))

  const mb = (fs.statSync(outFile).size / 1048576).toFixed(1)
  console.log(`rooms      ${rooms.length}${dropped ? ` (${dropped} dropped, no id)` : ''}`)
  console.log(`with uid   ${withUid} (${((withUid / rooms.length) * 100).toFixed(1)}%)`)
  console.log(`exits      ${rooms.reduce((a, r) => a + r.x.length, 0)} (${special} scripted/non-cardinal, ${unknown} unroutable)`)
  const regions = new Set(rooms.map(r => r.loc).filter(Boolean))
  const items   = new Set(rooms.flatMap(r => r.f ?? []))
  console.log(`regions    ${rooms.filter(r => r.loc).length} rooms in ${regions.size} regions`)
  console.log(`forage     ${rooms.filter(r => r.f).length} rooms, ${items.size} distinct items`)
  console.log(`version    ${roomsVersion}`)
  console.log(`wrote      ${path.relative(ROOT, outFile)} (${mb} MB)`)
}

main().catch(err => { console.error(`\n✗ ${err.message}`); process.exit(1) })
