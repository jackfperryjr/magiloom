// Precompute map layouts. Run: npm run map:bake
//
// Laying out an area is the expensive half of drawing a map: a BFS placement pass
// per area, over a graph with ~19k rooms. Doing that on the fly means the panel
// stalls the first time you open each area, on every machine, forever. The graph
// it operates on is generated and identical for everyone, so the work is done once
// here and the coordinates ship alongside the rooms.
//
// Live mapping still lays out at runtime — it has to, because a player can walk
// into a room the crawl never saw. This only removes the cost for the rooms we
// already knew about, which is nearly all of them.
//
// Generated artifact; never hand-edit. Two versions guard it:
//   • roomsVersion  — content hash of the room graph, from build-rooms.js. A
//                     refreshed mapdb changes it and every baked area is stale.
//   • LAYOUT_VERSION — bumped by hand when the layout algorithm changes shape, so
//                     an algorithm fix invalidates coordinates baked by the old one.
// The runtime checks both and falls back to laying out live if either disagrees,
// which means a stale bake degrades to "slower", never to "wrong".

const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'map-build')
const DATA_DIR = path.join(ROOT, 'resources', 'map-data', 'dr-prime')

// Bump when areaLayout's placement changes in a way that moves rooms.
const LAYOUT_VERSION = 1

// areaLayout caps how much of a component it will draw. Areas above this are
// genuinely huge (a whole contiguous landmass) and get bounded the same way at
// runtime, so baking with the same cap keeps the two consistent.
const MAX_AREA_NODES = 600

function bundle(entry, name) {
  fs.mkdirSync(CACHE, { recursive: true })
  const out = path.join(CACHE, name)
  buildSync({
    entryPoints: [path.join(ROOT, entry)],
    outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  })
  return import('file://' + out.replace(/\\/g, '/'))
}

async function main() {
  const roomsFile = path.join(DATA_DIR, 'rooms.json')
  if (!fs.existsSync(roomsFile)) {
    throw new Error(`no dataset — run npm run map:build-rooms first`)
  }
  const [dataset, mapper] = await Promise.all([
    bundle('src/renderer/src/lib/mapDataset.ts', 'dataset.mjs'),
    bundle('src/renderer/src/lib/mapper.ts', 'mapper.mjs'),
  ])

  const doc = JSON.parse(fs.readFileSync(roomsFile, 'utf8'))
  if (!dataset.isDataset(doc)) throw new Error('rooms.json is not a valid dataset')
  console.log(`source        ${doc.source} (v${doc.roomsVersion})`)

  // Mirror one-way arcs before laying out: the placement walks the graph in both
  // directions, and a missing backlink makes an area look artificially stringy.
  const db = dataset.mirrorArcs(dataset.datasetToDb(doc))

  const areas = mapper.listAreas(db)
  console.log(`areas         ${areas.length}`)

  const out = {}
  let placed = 0, capped = 0, empty = 0
  const t0 = Date.now()
  for (const area of areas) {
    const layout = mapper.areaLayout(db, area.id, MAX_AREA_NODES)
    const nodes = Object.values(layout.zone.nodes)
    if (!nodes.length) { empty++; continue }
    if (area.rooms > MAX_AREA_NODES) capped++
    placed += nodes.length

    out[area.id] = {
      name: layout.name || area.name,
      rooms: area.rooms,
      // [nodeId, x, y, z] — the node ids are derived deterministically from room
      // content by mapDataset, so they line up with whatever the runtime rebuilds.
      pos: nodes.map(n => [n.id, n.x, n.y, n.z]),
      // Street lettering is placed as part of the layout pass, so it would have to
      // be recomputed alongside the coordinates; bake it too.
      labels: layout.labels,
      exits: layout.exits,
    }
  }
  const ms = Date.now() - t0

  const doc2 = {
    instance: doc.instance,
    layoutVersion: LAYOUT_VERSION,
    roomsVersion: doc.roomsVersion,
    generated: Math.floor(Date.now() / 1000),
    maxAreaNodes: MAX_AREA_NODES,
    areas: out,
  }
  const outFile = path.join(DATA_DIR, 'layouts.json')
  fs.writeFileSync(outFile, JSON.stringify(doc2))

  const mb = (fs.statSync(outFile).size / 1048576).toFixed(2)
  const total = doc.rooms.length
  console.log(`baked         ${Object.keys(out).length} areas, ${placed} rooms placed (${((placed / total) * 100).toFixed(1)}% of ${total})`)
  if (capped) console.log(`capped        ${capped} areas exceeded ${MAX_AREA_NODES} rooms`)
  if (empty) console.log(`skipped       ${empty} areas laid out empty`)
  console.log(`time          ${ms}ms`)
  console.log(`wrote         ${path.relative(ROOT, outFile)} (${mb} MB)`)
}

main().catch(err => { console.error(`\n✗ ${err.message}`); process.exit(1) })
