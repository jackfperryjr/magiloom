/**
 * Structured sidecar extraction tests.
 *
 * The central claim these defend: the sidecar recovers what flattening to text loses
 * — full skill names instead of abbreviations, and one event per update instead of
 * two orphaned lines. Several cases deliberately feed a chunk split at an awkward
 * point, because that is what a socket actually does and it's where a naive
 * per-chunk regex would quietly drop data.
 *
 * Run: npm run test:tools
 */

import { StreamEventExtractor, toJsonl, parseJsonl, EVENT_FORMAT_VERSION } from '../../main/stream-events'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) { passed++; return }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`)
}

const expChunk = (skill: string, abbr: string, rank: number, pct: number) =>
  `<component id='exp ${skill}'><preset id='whisper'><d cmd='skill ${skill}'>${abbr}</d>:  ${rank} ${pct}%  [ 1/34]</preset></component>`

// ── 1. An experience update becomes ONE event with the FULL skill name ─────────
{
  const x = new StreamEventExtractor()
  const ev = x.feed(expChunk('Augmentation', 'Aug', 305, 66), 1000)
  eq('exp: one event', ev.length, 1)
  eq('exp: full skill name, not the abbreviation', ev[0]?.e === 'exp' ? ev[0].skill : '', 'Augmentation')
  eq('exp: rank', ev[0]?.e === 'exp' ? ev[0].rank : 0, 305)
  eq('exp: pct',  ev[0]?.e === 'exp' ? ev[0].pct  : 0, 66)
  eq('exp: mind pool', ev[0]?.e === 'exp' ? ev[0].pool : '', '1/34')
  eq('exp: timestamp is the injected one', ev[0]?.t, 1000)
}

// ── 2. Ambiguous abbreviations are no longer a problem ─────────────────────────
// From text alone "L" is unresolvable and the sample is dropped. From the stream the
// name is right there in the tag, so nothing is lost.
{
  const x = new StreamEventExtractor()
  const ev = x.feed(expChunk('Light Armor', 'L', 12, 3), 1)
  eq('exp: ambiguous abbreviation still resolves', ev[0]?.e === 'exp' ? ev[0].skill : '', 'Light Armor')
}

// ── 3. A component split across two socket reads ───────────────────────────────
{
  const whole = expChunk('Targeted Magic', 'TM', 120, 40)
  for (const cut of [10, 40, whole.length - 12]) {
    const x = new StreamEventExtractor()
    const a = x.feed(whole.slice(0, cut), 1)
    const b = x.feed(whole.slice(cut), 2)
    const all = [...a, ...b]
    eq(`split@${cut}: exactly one event`, all.length, 1)
    eq(`split@${cut}: skill intact`, all[0]?.e === 'exp' ? all[0].skill : '', 'Targeted Magic')
    eq(`split@${cut}: rank intact`,  all[0]?.e === 'exp' ? all[0].rank : 0, 120)
  }
}

// ── 3b. Split at EVERY position, including mid-tag and mid-attribute ───────────
// The three cut points above are a spot check; a socket can cut anywhere, so assert
// the whole space. This is what caught the tokenizer dropping a tag that straddled
// two reads.
{
  const whole = expChunk('Light Edged', 'LE', 38, 22)
  const bad: number[] = []
  for (let cut = 0; cut <= whole.length; cut++) {
    const x = new StreamEventExtractor()
    const all = [...x.feed(whole.slice(0, cut), 1), ...x.feed(whole.slice(cut), 2)]
    const ok = all.length === 1 && all[0].e === 'exp' &&
               all[0].skill === 'Light Edged' && all[0].rank === 38 && all[0].pct === 22
    if (!ok) bad.push(cut)
  }
  check('split: survives a cut at every one of ' + whole.length + ' positions',
        bad.length === 0, `failed at ${bad.slice(0, 8).join(', ')}${bad.length > 8 ? '…' : ''}`)
}

// ── 3c. Split into many small reads ────────────────────────────────────────────
{
  const whole = expChunk('Perception', 'Perc', 200, 50)
  const x = new StreamEventExtractor()
  const all: ReturnType<StreamEventExtractor['feed']> = []
  for (let i = 0; i < whole.length; i += 3) all.push(...x.feed(whole.slice(i, i + 3), 1))
  eq('split: three bytes at a time still yields one event', all.length, 1)
  eq('split: skill intact', all[0]?.e === 'exp' ? all[0].skill : '', 'Perception')
}

// ── 4. Rooms ───────────────────────────────────────────────────────────────────
{
  const x = new StreamEventExtractor()
  const ev = x.feed("<component id='room name'>[Crossing, Town Square]</component>", 5)
  eq('room: one event', ev.length, 1)
  eq('room: brackets stripped', ev[0]?.e === 'room' ? ev[0].name : '', 'Crossing, Town Square')
}

// ── 4b. The room name as DR actually sends it: an ATTRIBUTE ────────────────────
// This is the path that matters. Flattening the stream to text deletes attributes,
// so this name exists ONLY in the sidecar — it is unrecoverable from a text log.
{
  const x = new StreamEventExtractor()
  const ev = x.feed("<streamWindow id='room' title='Room' subtitle=' - [Crossing, Hodierna Way]'/>", 9)
  eq('subtitle: one room event', ev.length, 1)
  eq('subtitle: name extracted and unbracketed',
     ev[0]?.e === 'room' ? ev[0].name : '', 'Crossing, Hodierna Way')
}

// The same subtitle rides both the id='main' and id='room' windows on a single move;
// counting both would double every visit.
{
  const x = new StreamEventExtractor()
  const all = [
    ...x.feed("<streamWindow id='main' subtitle=' - [Crossing, Temple]'/>", 1),
    ...x.feed("<streamWindow id='room' subtitle=' - [Crossing, Temple]'/>", 1),
  ]
  eq('subtitle: duplicate windows collapse to one visit', all.length, 1)

  // Moving away and back is two real visits, though.
  const more = [
    ...x.feed("<streamWindow id='room' subtitle=' - [Crossing, Town Square]'/>", 2),
    ...x.feed("<streamWindow id='room' subtitle=' - [Crossing, Temple]'/>", 3),
  ]
  eq('subtitle: returning to a room counts again', more.length, 2)
}

// A subtitle that isn't a room ("Spells", "Inventory") has no " - " prefix.
{
  const x = new StreamEventExtractor()
  eq('subtitle: non-room windows ignored',
     x.feed("<streamWindow id='inv' title='Inventory' subtitle='Your worn items'/>", 1).length, 0)
}

// The component form still works, and is deduped against the subtitle form.
{
  const x = new StreamEventExtractor()
  const all = [
    ...x.feed("<streamWindow id='room' subtitle=' - [Crossing, Temple]'/>", 1),
    ...x.feed("<component id='room name'>[Crossing, Temple]</component>", 1),
  ]
  eq('subtitle: component form deduped against subtitle', all.length, 1)
}

// ── 5. TDP/favor summary shares the exp component ──────────────────────────────
{
  const x = new StreamEventExtractor()
  const ev = x.feed("<component id='exp tdp'>TDPs: 3348  Favors: 50</component>", 7)
  eq('tdp: one event', ev.length, 1)
  eq('tdp: total',  ev[0]?.e === 'tdp' ? ev[0].tdps : 0, 3348)
  eq('tdp: favors', ev[0]?.e === 'tdp' ? ev[0].favors : 0, 50)
}

// ── 6. Ordinary prose and other components produce nothing ─────────────────────
{
  const x = new StreamEventExtractor()
  eq('noise: plain text', x.feed('A kobold arrives, moving quickly.\n', 1).length, 0)
  eq('noise: room description component',
     x.feed("<component id='room desc'>A wide cobbled square.</component>", 1).length, 0)
  eq('noise: prompt', x.feed('<prompt time="123">&gt;</prompt>', 1).length, 0)
  eq('noise: a line that merely mentions a skill',
     x.feed('You practice your Augmentation: it is hard work.', 1).length, 0)
}

// ── 7. A component left unclosed must not leak into the next one ───────────────
{
  const x = new StreamEventExtractor()
  x.feed("<component id='exp Forging'>garbage with no close", 1)
  const ev = x.feed(expChunk('Evasion', 'Ev', 45, 10), 2)
  eq('leak: only the well-formed event survives', ev.length, 1)
  eq('leak: and it is the right skill', ev[0]?.e === 'exp' ? ev[0].skill : '', 'Evasion')
}

// ── 8. reset() drops partial state ─────────────────────────────────────────────
{
  const x = new StreamEventExtractor()
  const whole = expChunk('Evasion', 'Ev', 45, 10)
  x.feed(whole.slice(0, 30), 1)
  x.reset()
  eq('reset: the dangling half yields nothing', x.feed(whole.slice(30), 2).length, 0)
}

// ── 9. Entity decoding ─────────────────────────────────────────────────────────
{
  const x = new StreamEventExtractor()
  const ev = x.feed("<component id='room name'>[Ain Ghazal, Mo&apos;s Alley]</component>", 1)
  eq('entities: decoded in room names', ev[0]?.e === 'room' ? ev[0].name : '', "Ain Ghazal, Mo's Alley")
}

// ── 10. Round trip through JSON Lines ──────────────────────────────────────────
{
  const x = new StreamEventExtractor()
  const ev = [
    ...x.feed(expChunk('Augmentation', 'Aug', 305, 66), 1000),
    ...x.feed("<component id='room name'>[Crossing, Temple]</component>", 2000),
  ]
  const text = toJsonl(ev)
  eq('jsonl: one line per event', text.trim().split('\n').length, 2)
  const back = parseJsonl(text)
  eq('jsonl: round trips', JSON.stringify(back), JSON.stringify(ev))

  // A crash or a tail-read can leave a half-written final line; the rest must survive.
  const truncated = text.slice(0, text.length - 12)
  check('jsonl: a partial trailing line is skipped, not fatal', parseJsonl(truncated).length >= 1)
  eq('jsonl: blank lines ignored', parseJsonl('\n\n' + text).length, 2)
  eq('jsonl: junk ignored', parseJsonl('not json\n' + text).length, 2)
  eq('jsonl: empty input', parseJsonl('').length, 0)
}

eq('format version is recorded', EVENT_FORMAT_VERSION, 1)

if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`✓ all ${passed} stream-event assertions passed`)
