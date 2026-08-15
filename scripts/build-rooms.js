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
// Only ~20% of mapdb rooms carry a uid, so the app joins on uid where it exists
// and falls back to content matching (title + description hash) elsewhere,
// backfilling uids onto nodes as live play observes them.

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
    rooms.push({
      id: Number(r.id),
      ...(uids.length ? { uid: uids } : {}),
      t: title,
      desc,
      // Content identity, precomputed so the app doesn't rehash 18k rooms on boot.
      h: fnv1a(desc),
      ...(obvious.length ? { e: obvious } : {}),
      ...(r.location ? { loc: String(r.location) } : {}),
      x: exits,
      // Per-edge traversal seconds — the natural weight for route finding.
      ...(r.timeto && Object.keys(r.timeto).length ? { w: r.timeto } : {}),
      ...(r.tags?.length ? { rf: r.tags } : {}),
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
  console.log(`version    ${roomsVersion}`)
  console.log(`wrote      ${path.relative(ROOT, outFile)} (${mb} MB)`)
}

main().catch(err => { console.error(`\n✗ ${err.message}`); process.exit(1) })
