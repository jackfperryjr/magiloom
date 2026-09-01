// Bundle-and-run the pure-logic test files. Run: npm run test:tools
//
// There's no test framework in this repo and adding one for a handful of pure
// modules would be more configuration than code. esbuild already ships here (it
// comes with vite), it resolves the extensionless TypeScript imports that node's
// own type stripping won't, and it's fast enough that the whole suite runs in well
// under a second. Each test file asserts with plain code and exits non-zero on
// failure, so this just needs to bundle each one, run it, and propagate the status.
//
// esbuild is driven through its Node API rather than its CLI: node 24 refuses to
// spawn .cmd shims without a shell (EINVAL), which is exactly what node_modules/.bin
// holds on Windows, and routing through a shell to dodge that is worse than just
// calling the library.
const { buildSync } = require('esbuild')
const { execFileSync } = require('child_process')
const path = require('path')
const fs   = require('fs')

const ROOT  = path.resolve(__dirname, '..')
const CACHE = path.join(ROOT, 'node_modules', '.cache', 'tests')

const TESTS = [
  'src/tools/lib/logAnalysis.test.ts',
  'src/tools/lib/streamEvents.test.ts',
  'src/tools/lib/logStore.test.ts',
  'src/tools/lib/lichLog.test.ts',
  'src/tools/lib/circleReqs.test.ts',
  'src/tools/lib/tdp.test.ts',
  'src/renderer/src/lib/mapper.test.ts',
  'src/renderer/src/lib/sge-parser.test.ts',
  'src/renderer/src/lib/exp-parser.test.ts',
  'src/renderer/src/lib/loginProgress.test.ts',
  'src/renderer/src/lib/inventory.test.ts',
  'src/renderer/src/lib/injuries.test.ts',
  'src/renderer/src/lib/sessionSnapshot.test.ts',
  'src/renderer/src/lib/mapSeed.test.ts',
  'src/renderer/src/lib/elanthianSky.test.ts',
  'src/renderer/src/lib/weather.test.ts',
  'src/renderer/src/lib/rules.test.ts',
  'src/renderer/src/lib/quickActions.test.ts',
  'src/renderer/src/lib/roomAmbient.test.ts',
  'src/renderer/src/lib/ambientMix.test.ts',
  'src/renderer/src/lib/loginScene.test.ts',
  'src/renderer/src/lib/loginArtFx.test.ts',
]

fs.mkdirSync(CACHE, { recursive: true })

let failed = 0
for (const rel of TESTS) {
  const out = path.join(CACHE, path.basename(rel).replace(/\.ts$/, '.mjs'))
  try {
    buildSync({
      entryPoints: [path.join(ROOT, rel)],
      outfile: out,
      bundle: true,
      platform: 'node',
      format: 'esm',
      logLevel: 'warning',
    })
    execFileSync(process.execPath, [out], { stdio: 'inherit' })
  } catch (err) {
    // A failing test already printed why. A failing BUILD hasn't, so say so.
    if (!fs.existsSync(out)) console.error(`\n✗ ${rel} — ${err.message}`)
    failed++
  }
}

if (failed) {
  console.error(`\n${failed} of ${TESTS.length} test files failed.`)
  process.exit(1)
}
console.log(`\n${TESTS.length} test files passed.`)
