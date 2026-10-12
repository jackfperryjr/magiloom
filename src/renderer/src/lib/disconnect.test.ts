/**
 * Disconnect classification + reconnect budget tests.
 *
 * The cause is inferred by elimination, so the order of the checks is the thing to
 * pin down: a deliberate action here must always win over "the other end closed it",
 * or a Disconnect click would be answered with an automatic reconnect.
 *
 * Run: npm run test:tools
 */

import {
  classifyDrop, describeSocketError, shouldReconnect, ReconnectBudget, RECONNECT_ATTEMPTS,
  type DropContext,
} from './disconnect'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const ctx = (over: Partial<DropContext> = {}): DropContext => ({
  userRequested: false, loginOpen: false, lastSent: 'look', lastSentAgoMs: 60_000, viaLich: false, ...over,
})

// ── Causes ─────────────────────────────────────────────────────────────────────
eq('clean close is the game',        classifyDrop(ctx()).cause, 'remote')
eq('clean close note',               classifyDrop(ctx()).note, 'Closed by the game server')
eq('clean close via Lich note',      classifyDrop(ctx({ viaLich: true })).note, 'Closed by the game server or Lich')
eq('socket error',                   classifyDrop(ctx({ error: 'read ECONNRESET' })).cause, 'error')
eq('socket error note',              classifyDrop(ctx({ error: 'read ECONNRESET' })).note, 'Connection lost: connection reset (ECONNRESET)')
eq('disconnect click',               classifyDrop(ctx({ userRequested: true })).cause, 'user')
eq('new login',                      classifyDrop(ctx({ loginOpen: true })).cause, 'switch')
eq('quit just sent',                 classifyDrop(ctx({ lastSent: 'quit', lastSentAgoMs: 900 })).cause, 'quit')
eq('exit just sent',                 classifyDrop(ctx({ lastSent: ' EXIT ', lastSentAgoMs: 900 })).note, 'Logged out: EXIT was sent')
eq('old quit is not the reason',     classifyDrop(ctx({ lastSent: 'quit', lastSentAgoMs: 120_000 })).cause, 'remote')
eq('"quit" inside a command',        classifyDrop(ctx({ lastSent: 'say quit', lastSentAgoMs: 900 })).cause, 'remote')
eq('server lost the session',        classifyDrop(ctx({ linkReopenedAgoMs: 200 })).cause, 'link')
eq('link reopened long ago',         classifyDrop(ctx({ linkReopenedAgoMs: 600_000 })).cause, 'remote')

// ── Precedence: anything done here beats anything inferred ─────────────────────
eq('click beats error',              classifyDrop(ctx({ userRequested: true, error: 'read ECONNRESET' })).cause, 'user')
eq('click beats quit',               classifyDrop(ctx({ userRequested: true, lastSent: 'quit', lastSentAgoMs: 100 })).cause, 'user')
eq('new login beats error',          classifyDrop(ctx({ loginOpen: true, error: 'read ECONNRESET' })).cause, 'switch')
eq('quit beats error',               classifyDrop(ctx({ lastSent: 'quit', lastSentAgoMs: 100, error: 'read ECONNRESET' })).cause, 'quit')
eq('quit beats link',                classifyDrop(ctx({ lastSent: 'quit', lastSentAgoMs: 100, linkReopenedAgoMs: 100 })).cause, 'quit')

// ── Which causes reconnect ─────────────────────────────────────────────────────
eq('reconnect after remote close',   shouldReconnect('remote'), true)
eq('reconnect after error',          shouldReconnect('error'), true)
eq('reconnect after link loss',      shouldReconnect('link'), true)
eq('no reconnect after click',       shouldReconnect('user'), false)
eq('no reconnect after quit',        shouldReconnect('quit'), false)
eq('no reconnect after new login',   shouldReconnect('switch'), false)

// ── Error wording ──────────────────────────────────────────────────────────────
eq('timeout',                        describeSocketError('connect ETIMEDOUT 1.2.3.4:4901'), 'connection timed out (ETIMEDOUT)')
eq('unknown code passes through',    describeSocketError('socket hang up'), 'socket hang up')
eq('empty error',                    describeSocketError(''), 'unknown error')

// ── Budget ─────────────────────────────────────────────────────────────────────
const b = new ReconnectBudget()
eq('starts full',                    b.remaining, RECONNECT_ATTEMPTS)
eq('first attempt is 1',             b.attempt, 1)
check('take 1', b.take()); check('take 2', b.take())
eq('third attempt is 3',             b.attempt, 3)
check('take 3', b.take())
eq('fourth is refused',              b.take(), false)
eq('stays empty',                    b.remaining, 0)
b.refill()
eq('refill restores all',            b.remaining, RECONNECT_ATTEMPTS)

if (failures.length) {
  console.error(`✗ disconnect: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ disconnect: ${passed} passed`)
