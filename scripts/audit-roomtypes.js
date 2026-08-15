// Audit the room-type classifier against the whole shipped dataset.
// Run: node scripts/audit-roomtypes.js
//
// The classifier guesses a room's type from regexes over its title and
// description, which is cheap and needs no curation but is inherently fuzzy —
// the rules carry warnings about cases like "the west bank of the river". Now
// that a full room corpus ships with the app, those guesses can be measured
// instead of argued about: this prints what each rule actually matches so a
// bad rule shows up as a list of obviously-wrong room names.
const { buildSync } = require('esbuild')
const path = require('path')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'node_modules', '.cache', 'map-build', 'roomType.mjs')
const DATA = path.join(ROOT, 'resources', 'map-data', 'dr-prime', 'rooms.json')

async function main() {
  buildSync({
    entryPoints: [path.join(ROOT, 'src/renderer/src/lib/roomType.ts')],
    outfile: OUT, bundle: true, platform: 'node', format: 'esm', logLevel: 'warning',
  })
  const m = await import('file://' + OUT.replace(/\\/g, '/'))
  const doc = JSON.parse(fs.readFileSync(DATA, 'utf8'))

  const counts = {}
  const samples = {}
  // Rooms matched on DESCRIPTION rather than title are the risky ones: a title
  // match is usually deliberate, prose is where false positives hide.
  const viaBody = {}
  for (const r of doc.rooms) {
    const t = m.roomType({ title: r.t, descriptions: [r.desc] })
    if (!t) continue
    counts[t] = (counts[t] || 0) + 1
    ;(samples[t] ??= []).push(r.t)
    if (!m.roomType({ title: r.t, descriptions: [''] })) viaBody[t] = (viaBody[t] || 0) + 1
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`classified ${total} of ${doc.rooms.length} rooms (${((total / doc.rooms.length) * 100).toFixed(1)}%)\n`)
  for (const [t, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const body = viaBody[t] ?? 0
    console.log(`${t.padEnd(8)} ${String(n).padStart(5)}${body ? `   (${body} matched on description only)` : ''}`)
    for (const s of samples[t].slice(0, 4)) console.log(`     ${s}`)
  }
}

main().catch(err => { console.error(`\n✗ ${err.message}`); process.exit(1) })
