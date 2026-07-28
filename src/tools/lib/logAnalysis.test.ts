/**
 * Log-analysis tests.
 *
 * The important idea here: rather than hand-writing what we WISH a log looked like,
 * the fixtures are built by pushing raw DR stream XML through the very same
 * transform the real writers use — `stripToLines` from src/main/log-store.ts, plus
 * writeLine's whitespace collapsing and empty/prompt filtering. So if the log format
 * ever changes on the writing side, these tests break on the reading side, which is
 * exactly what we want.
 *
 * Run: npm run test:tools
 */

import { stripToLines } from '../../main/stream-events'
import {
  parseLogFile, readExpFragments, readExpReports, skillProgress,
  roomStats, heuristicCounts, analyze, combine, fmtDuration, DEFAULT_IDLE_MS,
} from './logAnalysis'
import { resolveSkillAbbrev } from '../../renderer/src/lib/skillAbbrev'
import type { StreamEvent } from '../../main/stream-events'

// ── Tiny assert harness (no test framework in this repo yet) ────────────────────
let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}
function near(name: string, actual: number, expected: number, tol = 1e-6): void {
  check(name, Math.abs(actual - expected) <= tol, `expected ≈${expected}, got ${actual}`)
}

// ── Fixture builder: raw stream chunk → log file text, exactly as shipped ───────
// Mirrors LogStore.writeLine: collapse whitespace, drop empties and bare prompts.
function toLogLines(clock: string, rawChunk: string): string[] {
  return stripToLines(rawChunk)
    .map(t => t.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim())
    .filter(t => t && t !== '>' && t !== 'R>')
    .map(t => `[${clock}] ${t}`)
}

function buildLog(entries: [clock: string, raw: string][]): string {
  return entries.flatMap(([c, r]) => toLogLines(c, r)).join('\n') + '\n'
}

// ── 1. Abbreviation resolution ─────────────────────────────────────────────────
eq('abbrev: Aug → Augmentation',        resolveSkillAbbrev('Aug'), 'Augmentation')
eq('abbrev: full name passes through',  resolveSkillAbbrev('Augmentation'), 'Augmentation')
eq('abbrev: TM → Targeted Magic',       resolveSkillAbbrev('TM'), 'Targeted Magic')
eq('abbrev: L Armor → Light Armor',     resolveSkillAbbrev('L Armor'), 'Light Armor')
eq('abbrev: ambiguous "L" → null',      resolveSkillAbbrev('L'), null)
eq('abbrev: nonsense → null',           resolveSkillAbbrev('zzz'), null)
eq('abbrev: empty → null',              resolveSkillAbbrev(''), null)

// ── 2. Exp ticks survive the strip/split round trip ────────────────────────────
const expChunk = (skill: string, abbr: string, rank: number, pct: number) =>
  `<component id='exp ${skill}'><preset id='whisper'><d cmd='skill ${skill}'>${abbr}</d>:  ${rank} ${pct}%  [ 1/34]</preset></component>`

const expLog = buildLog([
  ['12:00:00', expChunk('Augmentation', 'Aug', 305, 10)],
  ['13:00:00', expChunk('Augmentation', 'Aug', 305, 60)],
  ['13:00:00', expChunk('Targeted Magic', 'TM', 120, 0)],
  ['14:00:00', expChunk('Targeted Magic', 'TM', 121, 0)],
])

const parsedExp = parseLogFile('refia-2026-07-09.log', expLog)
eq('parse: character slug', parsedExp.char, 'refia')
eq('parse: day',            parsedExp.day,  '2026-07-09')
check('parse: produced lines', parsedExp.lines.length > 0, `got ${parsedExp.lines.length}`)

const ticks = readExpFragments(parsedExp.lines)
eq('ticks: recovered all four', ticks.length, 4)
eq('ticks: skill resolved',     ticks[0]?.skill, 'Augmentation')
near('ticks: value = rank + pct/100', ticks[0]?.value ?? 0, 305.10, 1e-9)

const prog = skillProgress(ticks)
const aug = prog.find(p => p.skill === 'Augmentation')!
const tm  = prog.find(p => p.skill === 'Targeted Magic')!
near('progress: Augmentation gained 0.50 ranks', aug.ranksGained, 0.50, 1e-9)
near('progress: Augmentation 0.50 ranks/hr',     aug.perHour,     0.50, 1e-9)
near('progress: Targeted Magic gained 1.00',     tm.ranksGained,  1.00, 1e-9)

// ── 3. A typed EXP report ──────────────────────────────────────────────────────
const reportLog = buildLog([
  ['09:00:00', 'Climbing:    34  50%  Mind lock  [340/900]    Forging:      5   0%  clear [0/10]'],
])
const reportSamples = readExpReports(parseLogFile('refia-2026-07-09.log', reportLog).lines)
eq('report: two skills read', reportSamples.length, 2)
eq('report: names are full',  reportSamples[0]?.skill, 'Climbing')
near('report: value',         reportSamples[0]?.value ?? 0, 34.5, 1e-9)

// ── 4. Prose must not be mistaken for experience ───────────────────────────────
const proseLog = buildLog([
  ['10:00:00', 'You see nothing unusual.'],
  ['10:00:01', 'A kobold arrives, moving quickly.'],
  ['10:00:02', 'Roundtime: 5 seconds.'],
])
const proseLines = parseLogFile('refia-2026-07-09.log', proseLog).lines
eq('prose: no exp ticks found',   readExpFragments(proseLines).length, 0)
eq('prose: no exp reports found', readExpReports(proseLines).length, 0)

// ── 5. Room timing, including the idle cap ─────────────────────────────────────
// Each room title is followed by an "Obvious paths:" line, which is what corroborates
// a bracketed line as a real room — without it these would (correctly) be ignored as
// script noise. See ROOM_CANDIDATE_RE.
const roomLog = buildLog([
  ['10:00:00', "<component id='room name'>[Crossing, Town Square]</component>"],
  ['10:00:00', 'Obvious paths: north, south.'],
  ['10:10:00', "<component id='room name'>[Crossing, Hodierna Way]</component>"],
  ['10:10:00', 'Obvious paths: east.'],
  ['10:12:00', 'You feel a chill.'],
  // 40-minute silence: neither room is credited it, because it exceeds the idle
  // threshold — see the accounting note on roomStats.
  ['10:52:00', "<component id='room name'>[Crossing, Town Square]</component>"],
  ['10:57:00', 'The wind picks up.'],
])
const roomLines = parseLogFile('refia-2026-07-09.log', roomLog).lines
const rooms = roomStats(roomLines)
const square    = rooms.find(r => r.room === 'Crossing, Town Square')!
const hodierna  = rooms.find(r => r.room === 'Crossing, Hodierna Way')!
eq('rooms: two distinct rooms', rooms.length, 2)
eq('rooms: square visited twice', square.visits, 2)
// The 10m of silence in Square and the 40m in Hodierna both exceed the 5m idle
// threshold, so neither is credited to any room. Hodierna keeps only its live
// 10:10→10:12; Square keeps only its second visit's 10:52→10:57.
eq('rooms: hodierna keeps its 2 active minutes', hodierna.msSpent, 2 * 60_000)
eq('rooms: square keeps its 5 active minutes',   square.msSpent,   5 * 60_000)

// ── 5b. Bracketed noise must NOT be reported as rooms ──────────────────────────
// This is the bug that shipped: a text log is full of bracketed lines that are script
// output and roundtime notices, and matching them produced a fictional room table.
// Worse, the real room name is sent as an XML attribute, which flattening deletes —
// so in a text-only log there is usually nothing to find and "nothing" is the correct
// answer.
{
  const noiseLog = buildLog([
    ['10:00:00', '[go2]'],
    ['10:00:05', '[go2: moving to Town Square]'],
    ['10:00:10', '[Roundtime: 5 sec.]'],
    ['10:00:15', '[waggle]'],
    ['10:00:20', '[bigshot: attacking]'],
    ['10:00:25', '[script paused]'],
    ['10:00:30', 'You feel a chill.'],
  ])
  const rooms = roomStats(parseLogFile('refia-2026-07-09.log', noiseLog).lines)
  eq('noise: no rooms invented from script output', rooms.length, 0)
}

// A bracketed line that LOOKS like a room but is never corroborated stays out.
{
  const uncorroborated = buildLog([
    ['10:00:00', '[Crossing, Town Square]'],
    ['10:00:05', 'Nothing else happens.'],
  ])
  const rooms = roomStats(parseLogFile('refia-2026-07-09.log', uncorroborated).lines)
  eq('noise: uncorroborated bracket ignored', rooms.length, 0)
}

// Once corroborated, LATER visits count even without a repeat of the paths line —
// re-entering a room doesn't always reprint them.
{
  const revisit = buildLog([
    ['10:00:00', '[Crossing, Town Square]'],
    ['10:00:01', 'Obvious paths: north.'],
    ['10:05:00', '[Crossing, Town Square]'],
    ['10:05:30', 'You wait.'],
  ])
  const rooms = roomStats(parseLogFile('refia-2026-07-09.log', revisit).lines)
  eq('rooms: confirmed name counts on revisit', rooms[0]?.visits, 2)
}

// ── 5c. With a sidecar, rooms are exact and need no corroboration ──────────────
{
  const plain = buildLog([
    ['10:00:00', 'You head north.'],
    ['10:01:00', 'A courier rushes past.'],
    ['10:02:00', 'You head south.'],
  ])
  const parsed = parseLogFile('refia-2026-07-09.log', plain)
  const base = Date.parse('2026-07-09T10:00:00')
  const events: StreamEvent[] = [
    { t: base,           e: 'room', name: 'Crossing, Town Square' },
    { t: base + 120_000, e: 'room', name: 'Crossing, Hodierna Way' },
  ]
  const rooms = roomStats(parsed.lines, DEFAULT_IDLE_MS, events)
  eq('sidecar rooms: both recorded', rooms.length, 2)
  check('sidecar rooms: named from the event',
        rooms.some(r => r.room === 'Crossing, Hodierna Way'), JSON.stringify(rooms))

  const a = analyze(parsed, { streamEvents: events })
  eq('sidecar rooms: reported as exact', a.roomSource, 'events')
  eq('text-only rooms: reported as text', analyze(parsed).roomSource, 'text')
}

// ── 6. Sessions split on idle gaps; active time excludes them ──────────────────
const a = analyze(parseLogFile('refia-2026-07-09.log', roomLog))
// Three spans, but the first is the single 10:00 line with silence on both sides —
// zero length, so it is dropped and two real sessions remain.
eq('sessions: two real sessions', a.sessions.length, 2)
eq('sessions: wall clock is 57m', a.wallMs, 57 * 60_000)
eq('sessions: active time is 2m + 5m', a.activeMs, 7 * 60_000)

// The property that makes the room table a breakdown rather than a second estimate.
eq('rooms: room times sum to active time',
   rooms.reduce((n, r) => n + r.msSpent, 0), a.activeMs)

// ── 7. Heuristic prose events ──────────────────────────────────────────────────
const combatLog = buildLog([
  ['11:00:00', 'The kobold falls to the ground and dies.'],
  ['11:01:00', 'The kobold falls to the ground and dies.'],
  ['11:02:00', 'A gnoll collapses in a heap.'],
  ['11:03:00', 'You pick up 250 coins.'],
  ['11:04:00', 'You are dead.'],
  ['11:05:00', 'The kobold swings a club at you!'],   // must NOT count as a kill
])
const ev = heuristicCounts(parseLogFile('refia-2026-07-09.log', combatLog).lines)
eq('events: total kills',        ev.totalKills, 3)
eq('events: kobold counted 2',   ev.kills.find(k => k.name === 'kobold')?.count, 2)
eq('events: one death',          ev.deaths, 1)

// One death emits several matching lines; they must collapse into one death, but a
// genuinely separate death later must still count.
const deathLog = buildLog([
  ['12:00:00', 'You are dead.'],
  ['12:00:02', 'Your spirit slips free of your body.'],
  ['12:00:05', 'You have been killed!'],
  ['12:40:00', 'You are dead.'],           // a separate death, well outside the window
])
const deaths = heuristicCounts(parseLogFile('refia-2026-07-09.log', deathLog).lines)
eq('events: repeat messages collapse into one death', deaths.deaths, 2)
eq('events: coins summed',       ev.coins, 250)
eq('events: labelled heuristic', ev.confidence, 'heuristic')

// ── 8. Midnight rollover ───────────────────────────────────────────────────────
const midnightLog = buildLog([
  ['23:58:00', 'Late night in the Crossing.'],
  ['00:03:00', 'The sun is still down.'],
])
const mid = parseLogFile('refia-2026-07-09.log', midnightLog)
eq('midnight: 5 minutes apart, not 23h back',
   mid.lines[1].at - mid.lines[0].at, 5 * 60_000)

// ── 9. Combining logs across characters ────────────────────────────────────────
const logA = analyze(parseLogFile('refia-2026-07-09.log', expLog))
const logB = analyze(parseLogFile('taro-2026-07-10.log', expLog))
const c = combine([logA, logB])
eq('combine: two characters', c.chars.length, 2)
eq('combine: two days',       c.days.length, 2)
near('combine: gains add up', c.totalRanks, logA.totalRanks + logB.totalRanks, 1e-9)

// ── 9b. The structured sidecar supersedes the text ─────────────────────────────
{
  // Same session, both ways. The text carries a skill whose abbreviation can't be
  // resolved ("L"), so the text path drops it entirely; the sidecar names it.
  const textLog = buildLog([
    ['12:00:00', expChunk('Light Armor', 'L', 12, 0)],
    ['13:00:00', expChunk('Light Armor', 'L', 13, 0)],
  ])
  const parsedText = parseLogFile('refia-2026-07-09.log', textLog)

  const fromText = analyze(parsedText)
  eq('sidecar: text alone cannot resolve "L"', fromText.skills.length, 0)
  eq('sidecar: and reports that honestly', fromText.expSource, 'none')

  const base = Date.parse('2026-07-09T12:00:00')
  const events: StreamEvent[] = [
    { t: base,               e: 'exp', skill: 'Light Armor', rank: 12, pct: 0 },
    { t: base + 3_600_000,   e: 'exp', skill: 'Light Armor', rank: 13, pct: 0 },
  ]
  const withEvents = analyze(parsedText, { streamEvents: events })
  eq('sidecar: recovers the skill',        withEvents.skills[0]?.skill, 'Light Armor')
  eq('sidecar: with the right gain',       withEvents.skills[0]?.ranksGained, 1)
  eq('sidecar: and is marked as exact',    withEvents.expSource, 'events')

  // Non-experience analysis still comes from the text — the sidecar has no timing or
  // room context of its own, so the two are complementary, not alternatives.
  eq('sidecar: line count still from text', withEvents.lineCount, fromText.lineCount)
}

// Events must REPLACE text samples, not merge with them: a stale text-derived sample
// would widen the observed span and drag the rate down.
{
  const textLog = buildLog([
    ['12:00:00', expChunk('Augmentation', 'Aug', 300, 0)],
    ['20:00:00', expChunk('Augmentation', 'Aug', 310, 0)],   // 8 hours of text span
  ])
  const parsed = parseLogFile('refia-2026-07-09.log', textLog)
  const base = Date.parse('2026-07-09T12:00:00')
  const events: StreamEvent[] = [
    { t: base,             e: 'exp', skill: 'Augmentation', rank: 300, pct: 0 },
    { t: base + 3_600_000, e: 'exp', skill: 'Augmentation', rank: 302, pct: 0 },
  ]
  const a = analyze(parsed, { streamEvents: events })
  eq('sidecar: text samples are discarded, not merged', a.skills[0]?.ranksGained, 2)
  eq('sidecar: only one skill entry', a.skills.length, 1)
}

// A sidecar with no exp events must not claim to be the source.
{
  const parsed = parseLogFile('refia-2026-07-09.log', buildLog([['12:00:00', 'Nothing happens.']]))
  const a = analyze(parsed, { streamEvents: [{ t: 1, e: 'room', name: 'Crossing, Temple' }] })
  eq('sidecar: rooms-only sidecar leaves exp source as none', a.expSource, 'none')
}

// ── 10. Degenerate input must not throw ────────────────────────────────────────
const empty = analyze(parseLogFile('refia-2026-07-09.log', ''))
eq('empty: zero lines', empty.lineCount, 0)
eq('empty: zero rate',  empty.ranksPerHour, 0)
const junk = parseLogFile('not-a-log-name.txt', 'no timestamps here\njust text\n')
eq('junk: unknown character', junk.char, 'unknown')
eq('junk: no lines parsed',   junk.lines.length, 0)

// ── 11. Formatting ─────────────────────────────────────────────────────────────
eq('fmt: hours',   fmtDuration(3 * 3_600_000 + 25 * 60_000), '3h 25m')
eq('fmt: minutes', fmtDuration(90_000), '1m 30s')
eq('fmt: seconds', fmtDuration(9_000), '9s')

// ── Report ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`\n✓ all ${passed} log-analysis assertions passed\n`)
