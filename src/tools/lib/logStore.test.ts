/**
 * End-to-end log round trip: raw stream XML → LogStore → real files on disk →
 * analyzer → numbers.
 *
 * The unit tests above each cover one hop. This covers the seam between them, which
 * is where a format assumption would actually break: it writes with the shipping
 * LogStore (no mocks, no reimplemented formatting), reads with the shipping reader,
 * and checks that a known amount of experience survives the whole trip intact.
 *
 * Run: npm run test:tools
 */

import { mkdtempSync, rmSync, readdirSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { LogStore } from '../../main/log-store'
import { parseJsonl } from '../../main/stream-events'
import { parseLogFile, analyze } from './logAnalysis'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

const dir = mkdtempSync(join(tmpdir(), 'magiloom-logtest-'))

try {
  const exp = (skill: string, abbr: string, rank: number, pct: number) =>
    `<component id='exp ${skill}'><preset id='whisper'><d cmd='skill ${skill}'>${abbr}</d>:  ${rank} ${pct}%  [ 1/34]</preset></component>`

  const store = new LogStore(dir)
  store.setEnabled(true)
  store.setChar('Refia')

  store.write("<component id='room name'>[Crossing, Town Square]</component>")
  store.write(exp('Augmentation', 'Aug', 305, 10))
  store.write('A kobold arrives, moving quickly.\r\n')
  store.write(exp('Light Armor', 'L', 12, 0))     // abbreviation the text path can't resolve
  store.write(exp('Augmentation', 'Aug', 305, 60))
  store.write('The kobold falls to the ground and dies.\r\n')

  // ── Both files exist, named as documented ────────────────────────────────────
  const files = readdirSync(dir + '/logs').sort()
  eq('writes exactly two files', files.length, 2)
  check('a .log was written',   files.some(f => /^refia-\d{4}-\d{2}-\d{2}\.log$/.test(f)),   files.join(', '))
  check('a .jsonl was written', files.some(f => /^refia-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)), files.join(', '))

  const logName = files.find(f => f.endsWith('.log'))!

  // ── The listing pairs them ───────────────────────────────────────────────────
  const listed = store.listFiles()
  eq('listing shows one log, not the sidecar too', listed.length, 1)
  eq('listing flags the sidecar', listed[0]?.events, true)
  eq('listing reads the character out of the name', listed[0]?.char, 'refia')

  // ── Read back through the shipping reader ────────────────────────────────────
  const text   = store.readFile(logName).content
  const events = parseJsonl(store.readEvents(logName).content)

  check('text log contains the prose', text.includes('A kobold arrives, moving quickly.'))
  check('text log is timestamped', /^\[\d{2}:\d{2}:\d{2}\] /m.test(text))

  const expEvents = events.filter(e => e.e === 'exp')
  eq('sidecar captured every exp update', expEvents.length, 3)
  eq('sidecar opens with a session marker', events[0]?.e, 'session')
  check('sidecar kept full skill names',
        expEvents.some(e => e.e === 'exp' && e.skill === 'Light Armor'),
        JSON.stringify(expEvents))
  check('sidecar captured the room',
        events.some(e => e.e === 'room' && e.name === 'Crossing, Town Square'))

  // ── Analyze both ways ────────────────────────────────────────────────────────
  const parsed = parseLogFile(logName, text)

  const fromText = analyze(parsed)
  eq('text path: source is text', fromText.expSource, 'text')
  check('text path: finds Augmentation via the abbreviation',
        fromText.skills.some(s => s.skill === 'Augmentation'))
  check('text path: cannot resolve the ambiguous "L"',
        !fromText.skills.some(s => s.skill === 'Light Armor'))

  const withEvents = analyze(parsed, { streamEvents: events })
  eq('sidecar path: source is events', withEvents.expSource, 'events')
  check('sidecar path: Light Armor is recovered',
        withEvents.skills.some(s => s.skill === 'Light Armor'))

  const aug = withEvents.skills.find(s => s.skill === 'Augmentation')
  check('sidecar path: Augmentation gained half a rank',
        Math.abs((aug?.ranksGained ?? 0) - 0.5) < 1e-9, `got ${aug?.ranksGained}`)

  // Rooms and prose still come from the text side in both cases.
  check('rooms survive the round trip',
        withEvents.rooms.some(r => r.room === 'Crossing, Town Square'),
        JSON.stringify(withEvents.rooms))
  eq('the kill was counted', withEvents.events.totalKills, 1)

  // ── Logging off writes nothing further ───────────────────────────────────────
  const sizeBefore = readFileSync(join(dir, 'logs', logName), 'utf8').length
  store.setEnabled(false)
  store.write(exp('Augmentation', 'Aug', 306, 0))
  eq('disabled store writes nothing',
     readFileSync(join(dir, 'logs', logName), 'utf8').length, sizeBefore)

  // ── Switching character opens a new pair and doesn't cross-contaminate ───────
  store.setEnabled(true)
  store.setChar('Taro')
  store.write(exp('Forging', 'For', 40, 0))
  const after = readdirSync(dir + '/logs').sort()
  eq('a second character gets its own pair', after.length, 4)
  check('and is named for that character', after.some(f => f.startsWith('taro-')), after.join(', '))

  const refiaEvents = parseJsonl(store.readEvents(logName).content).filter(e => e.e === 'exp')
  eq("the first character's sidecar was not appended to", refiaEvents.length, 3)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`✓ all ${passed} log-store round-trip assertions passed`)
