/**
 * Stream parser tests — native room id from <nav>, stream routing, and exp components.
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

// ── Stream routing ───────────────────────────────────────────────────────────
// DR splits player talk across several stream ids; all of them are one feed as far
// as the Conversation panel is concerned. `thoughts` (ESP) stays its own stream.
/** The stream each text event landed on, for one pushStream + one line of text. */
function streamOf(id: string): string | undefined {
  resetParser()
  const events = parseLine(`<pushStream id='${id}'/>Someone says, "Hello."`)
  return events.find(e => e.type === 'text')?.stream
}
eq('talk routes to speech',         streamOf('talk'),         'speech')
eq('whispers routes to speech',     streamOf('whispers'),     'speech')
eq('whisper routes to speech',      streamOf('whisper'),      'speech')
eq('conversation routes to speech', streamOf('conversation'), 'speech')
eq('speech still routes to speech', streamOf('speech'),       'speech')
eq('thoughts gets its own stream',  streamOf('thoughts'),     'thoughts')
eq('combat still routes to combat', streamOf('combat'),       'combat')
eq('an unknown stream falls back to main', streamOf('nosuchstream'), 'main')

// Lich's own chatter is retagged onto the 'lich' stream by content, with no
// pushStream involved. The Scripts panel's `;list` reader keys off this, and
// gating that reader on 'main' instead silently did nothing at all — so the
// routing is asserted here rather than assumed.
/** The stream a bare (non-XML) line lands on, past the login phase. */
function bareStream(text: string): string | undefined {
  resetParser()
  parseLine('<prompt time="1">&gt;</prompt>')
  return parseLine(text).find(e => e.type === 'text')?.stream
}
eq('a --- Lich: notice routes to lich', bareStream('--- Lich: no active scripts'), 'lich')
eq('a real ;list reply routes to lich',
  bareStream('--- Lich: afk2, almanac, sanowret-crystal, t2, hunting-buddy2, combat-trainer2'), 'lich')
eq('script chatter routes to lich', bareStream('[bigshot: hunting]'), 'lich')
eq('ordinary game text still routes to main', bareStream('You see a small rock.'), 'main')

// ── Monospace blocks ─────────────────────────────────────────────────────────
// <output class="mono"/> makes DR's ASCII blocks (guild registers, maps, tables)
// render verbatim, indentation and all. Two things about it have to hold, because
// together they leaked DR's worn-item refresh into the game window: the toggle has
// to turn back OFF, and while it's on it must not steal text from other streams.
/** Text events (stream + text) from a sequence of lines, past the login phase. */
function feed(lines: string[]): { stream: string; text: string }[] {
  resetParser()
  parseLine('<prompt time="1">&gt;</prompt>')
  return lines.flatMap(l => parseLine(l))
    .filter((e): e is Extract<GameEvent, { type: 'text' }> => e.type === 'text')
    .map(e => ({ stream: e.stream, text: e.text }))
}

// The worn-item refresh DR sends after every wear/remove/stow: bare indented lines
// on the inv stream, which belong to the Inventory panel and nowhere else.
const WORN = [
  "<pushStream id='inv'/>\n",
  '  a pair of copper zills\n',
  '  some faded silk slippers\n',
  '<popStream/>\n',
  'You slide a pair of copper zills onto your finger.\n',
]

{
  const out = feed(['<output class="mono"/>\n', '  +----+\n'])
  eq('a mono line keeps its indentation', out[0]?.text, '  +----+')
  eq('and stays on main when main is open', out[0]?.stream, 'main')
}
{
  const out = feed(['<output class="mono"/>\n', ...WORN])
  eq('mono does not pull inv text into main', out.filter(l => l.stream === 'inv').length, 2)
  eq('the action line is still main', out[out.length - 1]?.stream, 'main')
}
// DR closes the block by re-opening the tag empty, but a plain close has to work
// too — the toggle used to be one-way, so one missed close stuck for the session.
eq(
  'an empty class ends mono',
  feed(['<output class="mono"/>\n', '<output class=""/>\n', '  a pair of copper zills\n'])[0]?.text,
  'a pair of copper zills',
)
eq(
  'a closing tag ends mono',
  feed(['<output class="mono"/>\n', '</output>\n', '  a pair of copper zills\n'])[0]?.text,
  'a pair of copper zills',
)
eq(
  'a prompt ends mono',
  feed(['<output class="mono"/>\n', '<prompt time="2">&gt;</prompt>\n', '  a pair of copper zills\n'])[0]?.text,
  'a pair of copper zills',
)

// ── Exp components ───────────────────────────────────────────────────────────
/** Parse one exp component and return the single exp event it produced. */
function expEvent(id: string, body: string): GameEvent | undefined {
  resetParser()
  return parseLine(`<component id='${id}'>${body}</component>`)
    .find(e => e.type === 'expSkill' || e.type === 'expClear' || e.type === 'expMeta')
}

{
  const e = expEvent('exp Athletics', '        Athletics:  305 66% learning     [ 17/34]') as
    Extract<GameEvent, { type: 'expSkill' }>
  eq('bracketed form is a skill', e?.type, 'expSkill')
  eq('bracketed rank',  e?.rank, 305)
  eq('bracketed pct',   e?.pct, 66)
  eq('bracketed mind',  e?.mind, '17/34')
  eq('bracketed word',  e?.mindWord, 'learning')
}

// Ranks pass four digits and DR groups them — a bare \d+ read 1,305 as 1.
{
  const e = expEvent('exp Athletics', '        Athletics:  1,305 66% learning     [ 17/34]') as
    Extract<GameEvent, { type: 'expSkill' }>
  eq('comma-grouped rank parses whole', e?.rank, 1305)
}

// The fraction-less form was previously unmatched and fell through to the TDP
// branch, so the push was dropped on the floor.
{
  const e = expEvent('exp Athletics', '        Athletics:  305 66% learning') as
    Extract<GameEvent, { type: 'expSkill' }>
  eq('word-only form is a skill', e?.type, 'expSkill')
  eq('word-only rank', e?.rank, 305)
  eq('word-only pct',  e?.pct, 66)
  eq('word-only word', e?.mindWord, 'learning')
  eq('word-only has no fraction', e?.mind, '')
}

// An empty body is how DR says the skill decayed back to clear.
{
  const e = expEvent('exp Athletics', '') as Extract<GameEvent, { type: 'expClear' }>
  eq('empty component clears', e?.type, 'expClear')
  eq('cleared skill is named', e?.name, 'Athletics')
}
eq('whitespace-only component clears', expEvent('exp Athletics', '   ')?.type, 'expClear')

// Self-closing is the same statement with no closing tag to hang it on. It must
// also leave no component open — otherwise the next one's body is read as this
// skill's exp.
{
  resetParser()
  const events = parseLine(
    "<component id='exp Athletics'/><component id='exp Outdoorsmanship'>  Outdoors:  22 3% clear [ 1/34]</component>",
  )
  const cleared = events.find(e => e.type === 'expClear') as Extract<GameEvent, { type: 'expClear' }>
  const skill   = events.find(e => e.type === 'expSkill') as Extract<GameEvent, { type: 'expSkill' }>
  eq('self-closing component clears', cleared?.name, 'Athletics')
  eq('the next component is still its own skill', skill?.name, 'Outdoorsmanship')
  eq('and carries its own rank', skill?.rank, 22)
}

// The summary rows share the component and must not be read as skills.
{
  const e = expEvent('exp tdp', 'TDPs: 3,348  Favors: 50') as Extract<GameEvent, { type: 'expMeta' }>
  eq('tdp row is meta', e?.type, 'expMeta')
  eq('comma-grouped TDPs parse whole', e?.tdps, 3348)
  eq('favors parse', e?.favors, 50)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ sge-parser: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ sge-parser: ${passed} passed`)
