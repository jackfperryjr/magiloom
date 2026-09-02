/**
 * Login progress tests.
 *
 * The log lines here are copied from the emitters in src/main/game-connection.ts
 * and src/main/lich-manager.ts, prefixed the way src/main/index.ts tags them. If
 * a reworded message stops moving the bar, it fails here rather than silently
 * leaving the player on "Starting up…" for the whole login.
 *
 * Run: npm run test:tools
 */

import { loginProgress } from './loginProgress'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── Stages ───────────────────────────────────────────────────────────────────
eq('nothing logged yet', loginProgress([]).stage, 'starting')

eq(
  'launching lich',
  loginProgress(['[lich] Launching Lich: C:\\Ruby4Lich5\\ruby.exe lich.rbw --dragonrealms']).stage,
  'lich',
)
eq(
  'headless lich counts too',
  loginProgress(['[lich] Launching Lich (headless, port 11024): ruby lich.rbw']).stage,
  'lich',
)
eq(
  'reaching the game',
  loginProgress(['[game] Attempting to connect to dr.simutronics.net:11024...']).stage,
  'connecting',
)
eq(
  'socket open, handshaking',
  loginProgress(['[game] Connected to Lich on port 11024, sending key + FE token...']).stage,
  'handshake',
)
eq(
  'the direct connection reports it differently',
  loginProgress(['[game] Connected to dr.simutronics.net:4901']).stage,
  'handshake',
)

// A whole Lich login in order.
{
  const p = loginProgress([
    '[lich] Launching Lich (headless, port 11024): ruby lich.rbw',
    '[lich] --- Lich: initialized',
    '[game] Attempting to connect to 127.0.0.1:11024...',
    '[game] Connected to Lich on port 11024, sending key + FE token...',
  ])
  eq('the run ends at the handshake', p.stage, 'handshake')
  check('and the bar is most of the way along', p.value > 0.7 && p.value < 1)
}

// Lich rejects the socket until it has bound its port, so the client retries —
// which puts "Attempting to connect" AFTER "Connected" in the log. The bar must
// not walk backwards when that happens.
{
  const p = loginProgress([
    '[game] Attempting to connect to 127.0.0.1:11024...',
    '[game] Connected to Lich on port 11024, sending key + FE token...',
    '[game] Attempting to connect to 127.0.0.1:11024...',
  ])
  eq('progress is monotonic', p.stage, 'handshake')
}

// Ordinary Lich chatter is not a stage.
eq(
  'unrelated lines do not advance it',
  loginProgress([
    '[lich] --- Lich: no active scripts',
    '[lich] Still waiting for Lich to start… (3s elapsed)',
  ]).stage,
  'starting',
)

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ loginProgress: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ loginProgress: ${passed} passed`)
