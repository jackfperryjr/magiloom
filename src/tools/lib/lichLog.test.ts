/**
 * Lich log tests.
 *
 * Fixtures use the exact shapes taken from real Lich captures — including the two
 * quirks that broke the first attempt: Lich appends its own room id to the room
 * subtitle ("[Kaal Utewg, Old Growth] (4219310)", or "(**)" when it doesn't know the
 * room), and DR room names are full of apostrophes, which a naive attribute regex
 * truncates at.
 *
 * Run: npm run test:tools
 */

import {
  parseLichLog, parseLichXml, looksLikeLichXml, looksLikeLichText, charFromPath,
} from './lichLog'
import { analyze } from './logAnalysis'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

// Epoch seconds, as `<prompt time=…>` carries them.
const T0 = 1783010459
const prompt = (t: number) => `<prompt time="${t}">&gt;</prompt>`
const room = (name: string, id: string) =>
  `<streamWindow id='room' title='Room' subtitle=" - [${name}] (${id})"/>`
const exp = (skill: string, abbr: string, rank: number, pct: number) =>
  `<component id='exp ${skill}'><d cmd='skill ${skill}'>${abbr}</d>: ${rank} ${pct}%  [ 2/34]</component>`

const XML_FIXTURE = [
  '2026-07-02 11:41am',
  `<streamWindow id="logons" title="Arrivals" location="left" resident="true"/>`,
  room("Vela'Tohr Woods, Blighted Tangle", '4218224'),
  'Stunted trees press in from all sides.',
  exp('Small Edged', 'S Edged', 100, 10),
  prompt(T0),
  'You attack a kobold.',
  'The kobold falls to the ground and dies.',
  exp('Small Edged', 'S Edged', 100, 60),
  prompt(T0 + 600),
  room('Kaal Utewg, Old Growth', '**'),
  'You wander onward.',
  prompt(T0 + 1200),
].join('\n')

// ── Detection ──────────────────────────────────────────────────────────────────
check('detect: XML recognised', looksLikeLichXml(XML_FIXTURE))
check('detect: XML is not mistaken for the flattened log', !looksLikeLichText(XML_FIXTURE))

const TEXT_FIXTURE = [
  '2026-07-02 11:41:01.728 -05:00',
  '-'.repeat(76),
  '   Last login :  Thu Jul  2 12:12:48 ET 2026',
  "[Vela'Tohr Woods, Blighted Tangle] (4218224)",
  'Obvious paths: north, east, south, northwest.',
].join('\n')
check('detect: flattened Lich log recognised', looksLikeLichText(TEXT_FIXTURE))
check('detect: flattened log is not XML', !looksLikeLichXml(TEXT_FIXTURE))

const MAGILOOM_FIXTURE = '[12:00:00] You see a kobold.\n[12:00:01] Obvious paths: north.\n'
check('detect: a Magiloom log is neither', !looksLikeLichXml(MAGILOOM_FIXTURE) && !looksLikeLichText(MAGILOOM_FIXTURE))
eq('detect: and is reported as not-lich',
   parseLichLog('refia-2026-07-09.log', MAGILOOM_FIXTURE).kind, 'not-lich')
eq('detect: the flattened log is reported as text',
   parseLichLog('2026-07-02_11-41-01.log', TEXT_FIXTURE).kind, 'text')

// ── Character from the path ────────────────────────────────────────────────────
eq('char: from a folder pick', charFromPath('DR-Refia/2026/07/2026-07-02_11-41-01.xml'), 'refia')
eq('char: from a full path',   charFromPath('C:/Ruby4Lich5/Lich5/logs/DR-Penello/2026/07/x.xml'), 'penello')
eq('char: backslashes too',    charFromPath('logs\\DR-Jackreous\\2026\\07\\x.xml'), 'jackreous')
eq('char: no directory → none', charFromPath('2026-07-02_11-41-01.xml'), '')

// ── Parsing ────────────────────────────────────────────────────────────────────
{
  const p = parseLichXml('2026-07-02_11-41-01.xml', XML_FIXTURE, 'DR-Refia/2026/07/2026-07-02_11-41-01.xml')
  eq('parse: character from the path', p.log.char, 'refia')
  eq('parse: day from the filename',   p.log.day, '2026-07-02')

  const rooms = p.events.filter(e => e.e === 'room')
  eq('parse: two rooms', rooms.length, 2)
  // Both Lich quirks at once: the appended id is dropped, the apostrophe survives.
  eq('parse: apostrophe intact and id stripped',
     rooms[0]?.e === 'room' ? rooms[0].name : '', "Vela'Tohr Woods, Blighted Tangle")
  eq('parse: the unknown-room marker (**) is stripped too',
     rooms[1]?.e === 'room' ? rooms[1].name : '', 'Kaal Utewg, Old Growth')

  const exps = p.events.filter(e => e.e === 'exp')
  eq('parse: two experience updates', exps.length, 2)
  eq('parse: full skill name from the tag',
     exps[0]?.e === 'exp' ? exps[0].skill : '', 'Small Edged')

  // Timing comes from the prompts, and output is stamped with the prompt that ends it.
  eq('parse: first run stamped by its closing prompt', exps[0]?.t, T0 * 1000)
  eq('parse: second run stamped by the next prompt',  exps[1]?.t, (T0 + 600) * 1000)

  check('parse: prose lines were kept for matching',
        p.log.lines.some(l => l.text.includes('falls to the ground and dies')))
}

// ── Whole analysis ─────────────────────────────────────────────────────────────
{
  const p = parseLichXml('2026-07-02_11-41-01.xml', XML_FIXTURE, 'DR-Refia/2026/07/x.xml')
  const a = analyze(p.log, { streamEvents: p.events })

  eq('analysis: experience is exact', a.expSource, 'events')
  eq('analysis: rooms are exact',     a.roomSource, 'events')
  check('analysis: half a rank gained', Math.abs(a.totalRanks - 0.5) < 1e-9, `got ${a.totalRanks}`)
  eq('analysis: the kill was counted', a.events.totalKills, 1)
  check('analysis: rooms recorded', a.rooms.length > 0)
  // 10 minutes between the first two prompts exceeds the 5-minute idle threshold, so
  // active time is NOT the full 20-minute wall span.
  check('analysis: idle gaps excluded from active time', a.activeMs < a.wallMs,
        `active ${a.activeMs} wall ${a.wallMs}`)
}

// ── Degenerate input ───────────────────────────────────────────────────────────
{
  eq('empty file is not Lich', parseLichLog('x.xml', '').kind, 'not-lich')
  const noPrompts = parseLichXml('x.xml', `<streamWindow id='room' subtitle=" - [A Room] (1)"/>`)
  eq('a log with no prompts still parses', noPrompts.events.filter(e => e.e === 'room').length, 1)
  check('and does not throw on analysis', analyze(noPrompts.log, { streamEvents: noPrompts.events }).lineCount >= 0)
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`✓ all ${passed} Lich-log assertions passed`)
