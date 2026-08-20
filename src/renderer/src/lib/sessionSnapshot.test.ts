/**
 * Session-snapshot tests — what may be restored, and what must not be.
 *
 * The snapshot exists because a web client applying an update reloads the page
 * while the server keeps the game session: nothing reconnects, so the game never
 * re-announces the room, and the panels stay blank until the character next
 * moves. The risk on the other side is restoring state into the WRONG session —
 * a different character, or one so old the character has since been moved by a
 * script. These pin the guards that decide that.
 *
 * Run: npm run test:tools
 */

import {
  parseSnapshot, isWorthSaving, SNAPSHOT_TTL_MS, type SessionSnapshot,
} from './sessionSnapshot'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const NOW = 1_700_000_000_000

function snap(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    char: 'Kaelith',
    at: NOW,
    room: {
      name: 'The Crossing, Town Green',
      uid: '1234',
      description: 'A wide green.',
      exits: ['north', 'east'],
      objs: 'You also see a rock.',
      players: ['Melete'],
      playerNames: ['Melete'],
    },
    exp: { skills: [{ name: 'Athletics', rank: 100, pct: 50, mind: 'clear' }], tdps: 12, favors: 3 },
    hands: { left: 'a longsword', right: '' },
    ...over,
  } as SessionSnapshot
}

const json = (s: SessionSnapshot): string => JSON.stringify(s)

// ── Round trip ───────────────────────────────────────────────────────────────
{
  const got = parseSnapshot(json(snap()), 'Kaelith', NOW)
  check('a fresh snapshot for the same character restores', Boolean(got))
  eq('room name survives', got?.room.name, 'The Crossing, Town Green')
  eq('room id survives — the map re-anchors from it', got?.room.uid, '1234')
  eq('exits survive', got?.room.exits.length, 2)
  eq('exp survives', got?.exp.skills[0]?.name, 'Athletics')
  eq('hands survive', got?.hands.left, 'a longsword')
}

// ── Wrong session guards ─────────────────────────────────────────────────────
{
  eq('another character is refused', parseSnapshot(json(snap()), 'Melete', NOW), null)
  check('the name match is case-insensitive', Boolean(parseSnapshot(json(snap()), 'kaelith', NOW)))
  check('surrounding whitespace is tolerated', Boolean(parseSnapshot(json(snap()), '  Kaelith ', NOW)))
  eq('an empty name matches nothing', parseSnapshot(json(snap()), '', NOW), null)
}

// ── Staleness ────────────────────────────────────────────────────────────────
{
  const old = snap({ at: NOW - SNAPSHOT_TTL_MS - 1 })
  eq('past the TTL it is refused', parseSnapshot(json(old), 'Kaelith', NOW), null)
  const recent = snap({ at: NOW - 5000 })  // a real update takes seconds
  check('seconds old is exactly the case this is for', Boolean(parseSnapshot(json(recent), 'Kaelith', NOW)))
  const future = snap({ at: NOW + 60_000 })
  eq('a future timestamp is refused (clock skew)', parseSnapshot(json(future), 'Kaelith', NOW), null)
}

// ── Malformed input ──────────────────────────────────────────────────────────
// A snapshot written by an older build must not crash a newer one.
{
  eq('nothing stored', parseSnapshot(null, 'Kaelith', NOW), null)
  eq('not json', parseSnapshot('{oh no', 'Kaelith', NOW), null)
  eq('json but not a snapshot', parseSnapshot('{"char":"Kaelith"}', 'Kaelith', NOW), null)
  eq('null', parseSnapshot('null', 'Kaelith', NOW), null)
  eq('an array', parseSnapshot('[]', 'Kaelith', NOW), null)
  const noRoom = JSON.stringify({ ...snap(), room: undefined })
  eq('missing room', parseSnapshot(noRoom, 'Kaelith', NOW), null)
  const badExits = JSON.stringify({ ...snap(), room: { ...snap().room, exits: 'north' } })
  eq('exits of the wrong type', parseSnapshot(badExits, 'Kaelith', NOW), null)
}

// ── Worth saving ─────────────────────────────────────────────────────────────
// Writing an empty snapshot would overwrite the one we are about to need with
// blanks — which is how a restore turns into a wipe.
{
  check('a populated session saves', isWorthSaving(snap()))
  const blank = snap({
    room: { name: '', uid: '', description: '', exits: [], objs: '', players: [], playerNames: [] },
    exp: { skills: [], tdps: 0, favors: 0 },
  })
  check('an empty session does not', !isWorthSaving(blank))
  check('no character name, no save', !isWorthSaving(snap({ char: '' })))
  // Exp alone is worth keeping: it is the panel that never refills on its own.
  const expOnly = snap({
    room: { name: '', uid: '', description: '', exits: [], objs: '', players: [], playerNames: [] },
  })
  check('exp alone is still worth saving', isWorthSaving(expOnly))
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ sessionSnapshot: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ sessionSnapshot: ${passed} passed`)
