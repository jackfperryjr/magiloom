/**
 * Server-clock offset tests.
 *
 * The estimator's whole claim is "max of floored, latency-delayed samples converges
 * on the true offset from below, and small skew is left alone". These simulate
 * prompts at random sub-second phases with a known true offset and check both.
 *
 * Run: npm run test:tools
 */

import { ServerClock } from './serverClock'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// Deterministic PRNG so a failure reproduces.
let seed = 42
const rand = (): number => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31 }

/** Feed `n` prompts from a server whose clock is `trueOffset` ms ahead of local. */
function simulate(clock: ServerClock, trueOffset: number, n: number, latency = 80): void {
  let local = 1_783_000_000_000
  for (let i = 0; i < n; i++) {
    local += 500 + Math.floor(rand() * 4000)          // prompts every 0.5–4.5s
    const serverAtSend = local + trueOffset
    const arrival      = local + Math.floor(rand() * latency)
    clock.observe(Math.floor(serverAtSend / 1000), arrival)
  }
}

{
  const c = new ServerClock()
  eq('no samples → no correction', c.offset(), 0)
  eq('no timer stays 0', c.toLocal(0), 0)
}

{
  const c = new ServerClock()
  simulate(c, 0, 30)
  eq('synced clock → no correction', c.offset(), 0)
}

{
  const c = new ServerClock()
  simulate(c, 900, 30)
  eq('sub-deadband skew is left alone', c.offset(), 0)
}

{
  const c = new ServerClock()
  simulate(c, 5000, 30)
  const off = c.offset()
  check('local clock 5s behind → offset converges just under 5s', off <= 5000 && off > 4700, `got ${off}`)
  check('RT expiry lands ~5s earlier in local time', Math.abs(c.toLocal(1_783_000_010_000) - 1_783_000_005_000) < 300)
}

{
  const c = new ServerClock()
  simulate(c, -8000, 30)
  const off = c.offset()
  check('local clock 8s ahead → offset converges just under -8s', off <= -8000 && off > -8300, `got ${off}`)
}

{
  const c = new ServerClock()
  simulate(c, 6000, 30)
  simulate(c, 0, 30)
  eq('rolling window follows an NTP step back to synced', c.offset(), 0)
}

{
  const c = new ServerClock()
  c.observe(0, 1_783_000_000_000)
  c.observe(NaN, 1_783_000_000_000)
  eq('missing prompt time is ignored', c.offset(), 0)
}

if (failures.length) {
  console.error(`✗ serverClock: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ serverClock: ${passed} passed`)
