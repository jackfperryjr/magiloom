/**
 * Memory flight recorder + watchdog policy tests.
 *
 * The watchdog is the part that acts on its own, so its cases are the ones that
 * matter: it must never reload a page the player is looking at, never reload in a
 * loop right after a load, and never trip on a healthy (~40 MB) session.
 *
 * Run: npm run test:tools
 */

import {
  appendSample, appendEvent, parseLog, emptyLog, toMB, watchdogDecision, watchdogThreshold,
  formatLog, segments, MAX_SAMPLES, MAX_EVENTS, SAMPLE_EVERY_MS, WATCHDOG_GRACE_MS, type MemSample,
} from './memoryLog'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const s = (at: number, heap: number | null = 40): MemSample => ({ at, heap, limit: 4096, dom: 9000, hidden: false })
const LATE = WATCHDOG_GRACE_MS + 1

// ── Ring buffer ──────────────────────────────────────────────────────────────
{
  let log = emptyLog()
  for (let i = 0; i < MAX_SAMPLES + 25; i++) log = appendSample(log, s(i))
  eq('samples capped at MAX_SAMPLES', log.samples.length, MAX_SAMPLES)
  eq('oldest dropped first', log.samples[0].at, 25)
  for (let i = 0; i < MAX_EVENTS + 5; i++) log = appendEvent(log, { at: i, kind: 'boot', unclean: false })
  eq('events capped', log.events.length, MAX_EVENTS)
}

// ── Parsing is tolerant ──────────────────────────────────────────────────────
eq('null → empty', parseLog(null), emptyLog())
eq('garbage → empty', parseLog('{not json'), emptyLog())
eq('foreign shape → empty', parseLog('{"samples":"x","events":5}'), emptyLog())
eq('bad rows dropped', parseLog(JSON.stringify({ samples: [s(1), null, { at: 'x' }], events: [] })).samples.length, 1)
eq('round trip', parseLog(JSON.stringify({ samples: [s(5)], events: [{ at: 6, kind: 'boot', unclean: true }] })).events[0],
  { at: 6, kind: 'boot', unclean: true })

eq('toMB', toMB(41_234_567), 41.2)

// ── Watchdog ─────────────────────────────────────────────────────────────────
eq('threshold: 1 GB under a 4 GB limit', watchdogThreshold(4096), 1024)
eq('threshold: half a small limit', watchdogThreshold(1024), 512)
eq('threshold: no limit reported', watchdogThreshold(null), 1024)
eq('healthy session', watchdogDecision(40, 4096, true, LATE), 'ok')
eq('no performance.memory', watchdogDecision(null, null, true, LATE), 'ok')
eq('high + hidden → reload', watchdogDecision(1500, 4096, true, LATE), 'reload')
eq('high + visible → never reload in front of the player', watchdogDecision(1500, 4096, false, LATE), 'defer')
eq('critical + visible → warn', watchdogDecision(3200, 4096, false, LATE), 'warn')
eq('high right after a load → defer (no reload loop)', watchdogDecision(1500, 4096, true, 60_000), 'defer')

// ── Export ───────────────────────────────────────────────────────────────────
{
  const log = { samples: [s(new Date(2026, 9, 1, 9, 5).getTime(), 41.2)],
    events: [{ at: new Date(2026, 9, 1, 9, 0).getTime(), kind: 'boot' as const, unclean: true }] }
  const text = formatLog(log)
  check('export is chronological (event before later sample)', text.indexOf('crash?') < text.indexOf('heap 41.2'), text)
  check('export has timestamps', text.includes('2026-10-01 09:05'), text)
}

// ── Segments break across gaps ───────────────────────────────────────────────
{
  const t = (i: number) => i * SAMPLE_EVERY_MS
  const segs = segments([s(t(0)), s(t(1)), s(t(2)), s(t(10)), s(t(11))])
  eq('two runs across a gap', segs.map(r => r.length), [3, 2])
  eq('no samples → no runs', segments([]), [])
}

if (failures.length) {
  console.error(`✗ memoryLog: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ memoryLog: ${passed} passed`)
