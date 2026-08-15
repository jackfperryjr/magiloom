/**
 * Stream parser tests — native room id from <nav>.
 *
 * DR historically sent a bare <nav/> and the only room id available was the
 * "(NNNN)" tag ShowRoomID appended to the room title. Lich 5.20.0 (upstream
 * #1491) made <nav rm='NNNN'/> the authoritative source and stopped forcing
 * ShowRoomID on, which removes the title tag for most players — so the automapper
 * depends on this tag being read correctly, and on it CLEARING when a room has no
 * id (otherwise a no-id room inherits the previous room's and matches as the same
 * room, the bug upstream #1467 fixed on their side).
 *
 * Run: npm run test:tools
 */

import { parseLine, resetParser, type GameEvent } from './sge-parser'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

/** Parse one line in isolation and return the room ids it emitted. */
function roomIds(raw: string): string[] {
  resetParser()
  return parseLine(raw)
    .filter((e: GameEvent): e is Extract<GameEvent, { type: 'roomId' }> => e.type === 'roomId')
    .map(e => e.uid)
}

// ── The id is read off the rm attribute ──────────────────────────────────────
eq('nav rm single-quoted', roomIds("<nav rm='10041'/>")[0], '10041')
eq('nav rm double-quoted', roomIds('<nav rm="10041"/>')[0], '10041')
eq('nav rm without self-closing slash', roomIds("<nav rm='10041'>")[0], '10041')
eq('long ids survive intact', roomIds("<nav rm='4294967295'/>")[0], '4294967295')

// ── Absent / unusable ids clear rather than carry forward ────────────────────
// Each of these must still EMIT (with an empty uid) so the store overwrites the
// previous room's id — emitting nothing would leave the stale id in place.
eq('bare nav emits', roomIds('<nav/>').length, 1)
eq('bare nav clears', roomIds('<nav/>')[0], '')
eq('empty rm clears', roomIds("<nav rm=''/>")[0], '')
eq('non-numeric rm clears', roomIds("<nav rm='abc'/>")[0], '')
eq('partially numeric rm clears', roomIds("<nav rm='10041x'/>")[0], '')

// ── A closing </nav> must NOT clear the id the opening tag just set ──────────
eq('closing nav emits nothing', roomIds('</nav>').length, 0)
eq(
  'self-closing pair keeps the id',
  roomIds("<nav rm='10041'/></nav>").join(','),
  '10041',
)

// ── The tag coexists with the rest of the room feed ──────────────────────────
// <nav> leads the room feed on arrival, so it shares a line with the stream
// window that carries the room name. Both events must come through.
{
  resetParser()
  const events = parseLine("<nav rm='10041'/><streamWindow id='room' subtitle=' - [The Crossing, Town Square]'/>")
  const ids   = events.filter(e => e.type === 'roomId').map(e => (e as { uid: string }).uid)
  const names = events.filter(e => e.type === 'roomName').map(e => (e as { name: string }).name)
  eq('id parsed alongside room name', ids[0], '10041')
  eq('room name still parsed', names[0], '[The Crossing, Town Square]')
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ sge-parser: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ sge-parser: ${passed} passed`)
