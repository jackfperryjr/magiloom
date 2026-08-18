// Audit the ambient room classifiers against the whole shipped dataset.
// Run: node scripts/audit-ambient.js [--all]
//
// Same idea as audit-roomtypes.js, for the other two heuristics that colour the
// game panel. Both are fuzzy by nature, and both ship their guesses baked into
// rooms.json — so the guesses are worth LOOKING at, because a bad rule shows up
// here as a list of obviously-wrong room names long before anyone notices drifting
// embers in a bookshop.
//
// Reports three things:
//   • the ambience matches, grouped, with the rooms they fired on — the list to read
//   • how many connected same-title room pairs still disagree on locale, which is
//     the flicker the graph smoothing exists to remove and should stay at zero
//   • what the description fallback (rather than the title) is responsible for
const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'map-build')
const DATA = path.join(ROOT, 'resources', 'map-data', 'dr-prime', 'rooms.json')
const ALL = process.argv.includes('--all')

function bundle(name, entry) {
  fs.mkdirSync(CACHE, { recursive: true })
  const out = path.join(CACHE, `${name}.mjs`)
  buildSync({
    entryPoints: [path.join(ROOT, entry)],
    outfile: out, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  })
  return import('file://' + out.replace(/\\/g, '/'))
}

async function main() {
  const ambient = await bundle('roomAmbient', 'src/renderer/src/lib/roomAmbient.ts')
  const doc = JSON.parse(fs.readFileSync(DATA, 'utf8'))

  // ── Ambience ───────────────────────────────────────────────────────────────
  const hits = {}
  let viaBody = 0
  for (const r of doc.rooms) {
    const a = ambient.classifyAmbience(r.t, r.desc)
    if (!a) continue
    ;(hits[a] ??= []).push(r.t)
    if (!ambient.classifyAmbience(r.t, '')) viaBody++
  }
  const total = Object.values(hits).reduce((a, b) => a + b.length, 0)
  console.log(`ambience   ${total} of ${doc.rooms.length} rooms (${((total / doc.rooms.length) * 100).toFixed(1)}%), ` +
    `${viaBody} matched on description rather than title\n`)
  for (const [kind, rooms] of Object.entries(hits).sort((a, b) => b[1].length - a[1].length)) {
    // Titles repeat heavily (a street is a dozen rooms), so show distinct titles with
    // their room counts — that is what makes a bad rule obvious at a glance.
    const byTitle = new Map()
    for (const t of rooms) byTitle.set(t, (byTitle.get(t) ?? 0) + 1)
    const distinct = [...byTitle].sort((a, b) => b[1] - a[1])
    console.log(`${kind}  ${rooms.length} rooms, ${distinct.length} distinct titles`)
    for (const [t, n] of ALL ? distinct : distinct.slice(0, 25)) {
      console.log(`     ${String(n).padStart(3)}x  ${t}`)
    }
    if (!ALL && distinct.length > 25) console.log(`     … ${distinct.length - 25} more (--all)`)
    console.log()
  }

  // ── Locale flicker ─────────────────────────────────────────────────────────
  // Reads the BAKED field, so this measures what actually ships.
  const byId = new Map(doc.rooms.map(r => [r.id, r]))
  let flicker = 0
  const examples = []
  for (const r of doc.rooms) {
    for (const [to] of r.x || []) {
      const n = byId.get(to)
      if (!n || n.t !== r.t) continue
      if ((n.lc || '') !== (r.lc || '')) {
        flicker++
        if (examples.length < 6) examples.push(`${r.t}  ${r.lc || '-'} -> ${n.lc || '-'}`)
      }
    }
  }
  const tinted = doc.rooms.filter(r => r.lc).length
  console.log(`locale     ${tinted} of ${doc.rooms.length} rooms tinted (${((tinted / doc.rooms.length) * 100).toFixed(1)}%)`)
  console.log(`flicker    ${flicker} connected same-title pairs disagree` +
    (flicker ? '  ← smoothing regressed; see smoothLocales in build-rooms.js' : '  (smoothing holding)'))
  for (const e of examples) console.log(`     ${e}`)
}

main().catch(err => { console.error(`\n✗ ${err.message}`); process.exit(1) })
