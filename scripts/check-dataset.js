// Integrity check for the generated room dataset. Run: npm run map:check
//
// Cheap guardrails over the real shipped file, which unit tests deliberately
// don't touch (they use small deterministic fixtures instead). This catches the
// failure that actually matters: a graph that parses fine but whose edges point
// at rooms that aren't there, which would strand routing at runtime rather than
// erroring at build time.
const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'map-build', 'dataset.mjs')
const DATA = path.join(ROOT, 'resources', 'map-data', 'dr-prime', 'rooms.json')

async function main() {
  if (!fs.existsSync(DATA)) throw new Error(`no dataset at ${path.relative(ROOT, DATA)} — run npm run map:build-rooms`)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  buildSync({
    entryPoints: [path.join(ROOT, 'src/renderer/src/lib/mapDataset.ts')],
    outfile: OUT, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  })
  const m = await import('file://' + OUT.replace(/\\/g, '/'))

  const doc = JSON.parse(fs.readFileSync(DATA, 'utf8'))
  if (!m.isDataset(doc)) throw new Error('file is not a valid dataset')

  const t0 = Date.now()
  const db = m.mirrorArcs(m.datasetToDb(doc))
  const ms = Date.now() - t0

  const zoneOf = new Map()
  for (const z of Object.values(db.zones)) for (const id in z.nodes) zoneOf.set(id, z.id)

  let same = 0, cross = 0, dangling = 0
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      const fz = zoneOf.get(a.from), tz = zoneOf.get(a.to)
      if (!fz || !tz) dangling++
      else if (fz === tz) same++
      else cross++
    }
  }
  const nodes = zoneOf.size
  const idx = m.indexDataset(doc)

  console.log(`source        ${doc.source} (v${doc.roomsVersion})`)
  console.log(`built         ${nodes} nodes in ${Object.keys(db.zones).length} zones, ${ms}ms`)
  console.log(`arcs          ${same} intra-zone, ${cross} inter-zone`)
  console.log(`index         ${idx.byUid.size} by uid, ${idx.bySig.size} by signature`)
  console.log(`content dupes ${doc.rooms.length - idx.bySig.size} rooms share a signature`)

  // ── Baked layouts, when present ─────────────────────────────────────────────
  // Two rooms on one grid cell render exactly on top of each other, which reads
  // as a missing room rather than as a bug, so it is worth failing the build over.
  const layoutFile = path.join(path.dirname(DATA), 'layouts.json')
  let overlaps = 0, stale = false
  if (fs.existsSync(layoutFile)) {
    const L = JSON.parse(fs.readFileSync(layoutFile, 'utf8'))
    stale = L.roomsVersion !== doc.roomsVersion
    let placed = 0
    for (const area of Object.values(L.areas ?? {})) {
      const seen = new Set()
      for (const [, x, y, z] of area.pos) {
        const k = `${x},${y},${z}`
        if (seen.has(k)) overlaps++
        seen.add(k)
        placed++
      }
    }
    console.log(`layouts       ${Object.keys(L.areas ?? {}).length} areas, ${placed} rooms placed` +
      (stale ? `  ⚠ baked against v${L.roomsVersion}, rooms are v${doc.roomsVersion}` : ''))
  } else {
    console.log(`layouts       (none — run npm run map:bake)`)
  }

  // Inter-zone arcs are normal — an exit that leaves the area is still an exit,
  // and the layout draws those as portals. An arc pointing at a node that exists
  // in NO zone is a build bug.
  const errs = []
  if (dangling) errs.push(`${dangling} dangling arcs (target node missing entirely)`)
  if (overlaps) errs.push(`${overlaps} rooms share a grid cell with another room`)
  if (errs.length) {
    for (const e of errs) console.error(`\n✗ ${e}`)
    process.exit(1)
  }
  // A stale bake is a warning, not a failure: the runtime detects the version
  // mismatch and lays out live, so the map is correct, just slower to open.
  if (stale) console.log(`\n⚠ layouts are stale — re-run npm run map:bake`)
  else console.log(`\n✓ dataset and layouts consistent`)
}

main().catch(err => { console.error(`\n✗ ${err.message}`); process.exit(1) })
