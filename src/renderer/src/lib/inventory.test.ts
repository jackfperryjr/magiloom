/**
 * Structured-inventory tests — parser capture and tree assembly.
 *
 * The fixture below is a real `_inventory manager` response captured from DR, kept
 * verbatim (ids and all) because its quirks are the point: the name field is three
 * comma-separated parts whose FIRST part carries leading adjectives ("a rugged" /
 * "brown" / "backpack"), an empty middle part is legal ("a,,razor"), and nesting is
 * expressed only through parent exist ids.
 *
 * Run: npm run test:tools
 */

import { parseLine, resetParser, type GameEvent, type InvEnvelope } from './sge-parser'
import {
  InvAssembler, parseInvItem, validateTree, pathTo, isContainer, isClosed, isFixed,
  depthOf, isBuried, childrenOf, summarizeCarried, sortItems, isInvSort, PLAYER,
  type InvItem, type InvSnapshot, type InvSortKey, type InvSortDir,
} from './inventory'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const CAPTURED =
  "<inventoryManager id='test1' room='84105'>" +
  `<i id='57189142' loc='worn,player' name="a rugged,brown,backpack" weight='60' in_max='10000'/>` +
  `<i id='57189141' loc='worn,player' name="some scorched,punka,workboots" long="some scorched punka workboots with firestained buckles" weight='10' in_max='120'/>` +
  `<i id='57189137' loc='worn,player' name="a,nondescript,jacket" long="a nondescript jacket with a shadowy dragon imprinted on the sleeve" weight='20' in_max='2000'/>` +
  `<i id='57189140' loc='in,57189137' name="a,,razor" weight='3'/>` +
  `<i id='57189139' loc='in,57189137' name="a silversteel,signet,ring" long="a wide silversteel signet ring incised with a flying dragon" weight='1'/>` +
  `<i id='57189138' loc='in,57189137' name="a forbidding,dragon-skull,mask" long="a forbidding dragon-skull mask with long teeth and majestically sweeping horns" weight='5'/>` +
  `<i id='57189136' loc='worn,player' name="some black,leather,pants" long="some straight-legged black leather pants" weight='10' in_max='100'/>` +
  '</inventoryManager>'

/** Parse a line and return the inventory envelopes it emitted. */
function envelopes(raw: string): InvEnvelope[] {
  return parseLine(raw)
    .filter((e: GameEvent): e is Extract<GameEvent, { type: 'inventoryTree' }> => e.type === 'inventoryTree')
    .map(e => e.envelope)
}

/** Non-inventory text the line would have shown in the game window. */
function textOf(raw: string): string[] {
  return parseLine(raw)
    .filter((e: GameEvent): e is Extract<GameEvent, { type: 'text' }> => e.type === 'text')
    .map(e => e.text)
}

function snapshotOf(...raws: string[]): InvSnapshot {
  const asm = new InvAssembler()
  let state = asm.take(envelopes(raws[0])[0])
  for (const raw of raws.slice(1)) state = asm.take(envelopes(raw)[0])
  if (state.status !== 'ready') throw new Error(`expected ready, got ${JSON.stringify(state)}`)
  return state.snapshot
}

// ── Parser capture ────────────────────────────────────────────────────────────
resetParser()
{
  const envs = envelopes(CAPTURED)
  eq('one envelope per response', envs.length, 1)
  eq('request id round-trips', envs[0]?.id, 'test1')
  eq('room comes off the envelope', envs[0]?.room, '84105')
  eq('every item collected', envs[0]?.items.length, 7)
  eq('no continuations in a small tree', envs[0]?.continuations.length, 0)
  eq('nothing leaks into the game window', textOf(CAPTURED).length, 0)
}

resetParser()
{
  // The response can share a line with ordinary output; the envelope must not eat it.
  const line = `<pushBold/>You see nothing unusual.<popBold/>${CAPTURED}`
  eq('surrounding text survives', textOf(line)[0], 'You see nothing unusual.')
  eq('envelope still captured', envelopes(line).length, 1)
}

resetParser()
{
  // A refusal arrives self-closing with no body — it must not open a capture that
  // then swallows every following line.
  const envs = envelopes("<inventoryManager id='test2' room='84105' state='stale'/>")
  eq('stale envelope emitted', envs.length, 1)
  eq('stale state preserved', envs[0]?.state, 'stale')
  eq('capture closed again', textOf('Just some text.')[0], 'Just some text.')
}

resetParser()
{
  // Cut short by a prompt: hand over what arrived, flagged, rather than staying open.
  const envs = envelopes(
    `<inventoryManager id='test3' room='84105'><i id='1' loc='worn,player' name="a,,cloak" weight='5'/>` +
    `<prompt time="123">&gt;</prompt>`,
  )
  eq('truncated envelope emitted', envs.length, 1)
  eq('flagged malformed', envs[0]?.state, 'malformed')
  eq('partial items kept for diagnosis', envs[0]?.items.length, 1)
}

resetParser()
{
  // <i> outside an envelope is inline emphasis, not an item.
  eq('bare <i> is not an item', envelopes('<i>emphasis</i>').length, 0)
  eq('its text still shows', textOf('<i>emphasis</i>')[0], 'emphasis')
}

// ── Field parsing ─────────────────────────────────────────────────────────────
resetParser()
{
  const snap = snapshotOf(CAPTURED)
  const backpack = snap.items.get('57189142')!
  const razor    = snap.items.get('57189140')!
  const jacket   = snap.items.get('57189137')!
  const ring     = snap.items.get('57189139')!

  eq('every item typed', snap.items.size, 7)
  eq('snapshot keeps the room', snap.room, '84105')

  eq('display name rejoins all three fields', backpack.name, 'a rugged brown backpack')
  eq('leading adjectives stay in field one', backpack.article, 'a rugged')
  eq('only the last field is the bare noun', backpack.noun, 'backpack')
  eq('empty middle field is legal', razor.name, 'a razor')
  eq('… and yields an empty adjective', razor.adjective, '')

  eq('worn items hang off the character', backpack.parent, 'player')
  eq('worn relation preserved', backpack.relation, 'worn')
  eq('nesting resolves by exist id', razor.parent, '57189137')
  eq('containment relation preserved', razor.relation, 'in')

  eq('long description read', ring.long, 'a wide silversteel signet ring incised with a flying dragon')
  eq('absent long stays absent', razor.long, undefined)
  eq('weight is the raw server integer', backpack.weight, 60)
  eq('capacity is the raw server integer', backpack.inMax, 10000)
  eq('no capacity attribute means none', razor.inMax, undefined)

  check('a container is a container', isContainer(jacket))
  check('a razor is not', !isContainer(razor))
  check('nothing is closed in this sample', !isClosed(jacket))
  check('nothing is fixed in place', !isFixed(backpack))

  eq('path to a nested item lists its containers', pathTo(snap, razor).map(i => i.noun).join(','), 'jacket')
  eq('worn items are at depth 0', depthOf(snap, backpack), 0)
  eq('items in a worn container are at depth 1', depthOf(snap, razor), 1)
  check('nothing is buried behind a closed lid', !isBuried(snap, razor))
  eq('children found by parent id', childrenOf(snap, '57189137').length, 3)
}

// ── At-a-glance summary ───────────────────────────────────────────────────────
resetParser()
{
  // The captured sample is a fully dressed character: backpack, workboots, jacket
  // and trousers all worn, with three loose items inside the jacket.
  const snap = snapshotOf(CAPTURED)
  const sum  = summarizeCarried(snap)

  // The bug this guards: every one of those four garments reports an in_max, so
  // classifying each item as EITHER worn OR a container scored this outfit as 0 worn.
  eq('worn counts every garment, container or not', sum.worn, 4)
  eq('items counts contents too', sum.items, 7)
  eq('load sums every raw weight', sum.weight, 109)

  // ...and the same overlap means an unfiltered container list would name the
  // trousers and the boots. Only the jacket is actually holding anything.
  eq('only containers with contents are listed', sum.containers.length, 1)
  eq('… and it is the jacket', sum.containers[0]?.item.noun, 'jacket')
  eq('… with its child count', sum.containers[0]?.count, 3)
}

{
  // Things at your feet are parented to the player but are on the ground: they
  // must not land in the load, the item count, or the worn count.
  const snap = snapshotOf(
    "<inventoryManager id='feet' room='84105'>" +
    `<i id='40' loc='worn,player' name="a,,cloak" weight='5'/>` +
    `<i id='41' loc='atfeet,player' name="a heavy,iron,anvil" weight='900'/>` +
    '</inventoryManager>',
  )
  const sum = summarizeCarried(snap)
  eq('an anvil at your feet is not carried', sum.weight, 5)
  eq('… nor counted as an item', sum.items, 1)
  eq('… nor counted as worn', sum.worn, 1)
}

{
  // Fullest container first, so the pack you're digging in is at the top.
  const snap = snapshotOf(
    "<inventoryManager id='sort' room='84105'>" +
    `<i id='50' loc='worn,player' name="a,,satchel" weight='10' in_max='500'/>` +
    `<i id='51' loc='worn,player' name="a,,pouch" weight='5' in_max='500'/>` +
    `<i id='52' loc='in,50' name="a,,rock" weight='1'/>` +
    `<i id='53' loc='in,51' name="a,,gem" weight='1'/>` +
    `<i id='54' loc='in,51' name="a,,coin" weight='1'/>` +
    '</inventoryManager>',
  )
  const sum = summarizeCarried(snap)
  eq('containers sort fullest first', sum.containers.map(c => c.item.noun).join(','), 'pouch,satchel')
}

// ── Sorting ───────────────────────────────────────────────────────────────────
{
  // A deliberately awkward spread: an item with an unknown weight, a container
  // holding nothing, and a plain garment that is not a container at all — the three
  // cases where a key has no value to sort on.
  const snap = snapshotOf(
    "<inventoryManager id='s' room='84105'>" +
    `<i id='60' loc='worn,player' name="a,,satchel" weight='10' in_max='500'/>` +
    `<i id='61' loc='in,60' name="a,,rock" weight='7'/>` +
    `<i id='62' loc='in,60' name="an ancient,silver,amulet" weight='2'/>` +
    `<i id='63' loc='worn,player' name="a,,cloak" weight='30'/>` +
    `<i id='64' loc='worn,player' name="a,,belt" weight='4' in_max='120'/>` +
    `<i id='65' loc='worn,player' name="a,,anklet" weight='-1'/>` +
    '</inventoryManager>',
  )
  const worn = [...snap.items.values()].filter(i => i.parent === PLAYER)
  const by = (key: InvSortKey, dir: InvSortDir): string =>
    sortItems(snap, worn, { key, dir }).map(i => i.noun).join(',')

  eq('location sorting leaves the game’s order alone', by('location', 'asc'), 'satchel,cloak,belt,anklet')
  eq('… and reverses on demand',                       by('location', 'desc'), 'anklet,belt,cloak,satchel')

  // Names begin with "a"/"some" almost universally in DR, so sorting on the display
  // name would file the whole inventory under A. The noun is what people read.
  eq('name sorts by the noun', by('name', 'asc'), 'anklet,belt,cloak,satchel')
  eq('… and reverses',         by('name', 'desc'), 'satchel,cloak,belt,anklet')
  eq('the noun wins over the leading adjectives',
     sortItems(snap, childrenOf(snap, '60'), { key: 'name', dir: 'asc' }).map(i => i.noun).join(','),
     'amulet,rock')

  eq('weight sorts heaviest first', by('weight', 'desc'), 'cloak,satchel,belt,anklet')
  // The bug this guards: reversing must not float the blanks to the top. An unknown
  // weight is not "the lightest thing you own", it is a thing we know nothing about.
  eq('… and unknown weights stay at the bottom either way', by('weight', 'asc'), 'belt,satchel,cloak,anklet')

  // Non-containers have no capacity at all — different from a capacity of zero — so
  // they sink, and tie among themselves by name.
  eq('capacity sorts roomiest first', by('capacity', 'desc'), 'satchel,belt,anklet,cloak')
  eq('… and non-containers still sink when reversed', by('capacity', 'asc'), 'belt,satchel,anklet,cloak')

  // The belt IS a container, just an empty one, so it ranks above the things that
  // can't hold anything rather than beside them.
  eq('contents sorts fullest first', by('contents', 'desc'), 'satchel,belt,anklet,cloak')
  eq('an empty container still outranks a non-container', by('contents', 'asc'), 'belt,satchel,anklet,cloak')

  const before = worn.map(i => i.id).join(',')
  sortItems(snap, worn, { key: 'weight', dir: 'desc' })
  eq('sorting does not disturb the caller’s array', worn.map(i => i.id).join(','), before)

  check('a stored sort is accepted', isInvSort({ key: 'weight', dir: 'desc' }))
  check('an unknown key is not', !isInvSort({ key: 'colour', dir: 'desc' }))
  check('a bad direction is not', !isInvSort({ key: 'weight', dir: 'sideways' }))
  check('junk is not', !isInvSort('weight'))
}

// ── Items in the room ─────────────────────────────────────────────────────────
resetParser()
{
  // Ground items hang off the bare "room" root, and a container sitting there holds
  // its contents the same way a worn one does.
  const snap = snapshotOf(
    "<inventoryManager id='g' room='84105'>" +
    `<i id='30' loc='room' name="a wooden,storage,bin" weight='400' in_max='5000'/>` +
    `<i id='31' loc='in,30' name="a,,shovel" weight='40'/>` +
    `<i id='32' loc='room' name="a discarded,leather,boot" weight='10'/>` +
    '</inventoryManager>',
  )
  const bin   = snap.items.get('30')!
  const spade = snap.items.get('31')!

  eq('room items use the room root', bin.parent, 'room')
  eq('a loose item does too', snap.items.get('32')!.parent, 'room')
  eq('contents of a room container nest under it', spade.parent, '30')
  eq('… at depth 1', depthOf(snap, spade), 1)
  eq('… and know their container', pathTo(snap, spade)[0]?.noun, 'bin')
  eq('children of a room container', childrenOf(snap, '30').length, 1)
}

// ── Validation ────────────────────────────────────────────────────────────────
{
  const bad = (attrs: Record<string, string>, why: string): void => {
    let threw = false
    try { parseInvItem(attrs) } catch { threw = true }
    check(`rejects ${why}`, threw)
  }
  const ok = { id: '1', loc: 'worn,player', name: 'a,,cloak', weight: '5' }

  eq('a minimal item parses', parseInvItem(ok).name, 'a cloak')
  bad({ ...ok, id: '' },                 'a missing id')
  bad({ ...ok, loc: '' },                'a missing loc')
  bad({ ...ok, loc: 'worn' },            'a loc with no parent')
  bad({ ...ok, loc: 'in,player' },       'a container relation on the character')
  bad({ ...ok, loc: 'worn,12345' },      'a character relation on a container')
  bad({ ...ok, loc: 'in,1,2' },          'a loc with too many fields')
  bad({ ...ok, name: 'a cloak' },        'a name that is not three fields')
  bad({ ...ok, name: 'a,dark,' },        'a name with no noun')
  bad({ ...ok, weight: '' },             'an empty weight')
  bad({ ...ok, weight: '1.5' },          'a fractional weight')
  bad({ ...ok, weight: '-2' },           'a negative weight')
  bad({ ...ok, in_max: '-1' },           'a negative capacity')

  eq('-1 weight is the server’s "unknown"', parseInvItem({ ...ok, weight: '-1' }).weight, -1)
  check('… and marks the item fixed in place', isFixed(parseInvItem({ ...ok, weight: '-1' })))
  eq('room items use the bare root', parseInvItem({ ...ok, loc: 'room' }).parent, 'room')
  eq('flags split on commas', parseInvItem({ ...ok, flags: 'closed, locked' }).flags.size, 2)
  check('… and are membership-tested', parseInvItem({ ...ok, flags: 'closed' }).flags.has('closed'))
  check('locker flag read', parseInvItem({ ...ok, locker: '1' }).locker === true)

  const item = (id: string, parent: string): InvItem =>
    parseInvItem({ id, loc: `${parent === 'player' ? 'worn' : 'in'},${parent}`, name: 'a,,box', weight: '1' })
  const map = (...items: InvItem[]): Map<string, InvItem> => new Map(items.map(i => [i.id, i]))

  eq('a sound tree validates', validateTree(map(item('1', 'player'))), null)
  check('a missing parent is caught', !!validateTree(map(item('1', '999'))))
  check('a cycle is caught', !!validateTree(map(item('1', '2'), item('2', '1'))))
}

// ── Assembly across envelopes ─────────────────────────────────────────────────
{
  const head =
    "<inventoryManager id='a' room='84105'>" +
    `<i id='10' loc='worn,player' name="a,,backpack" weight='60' in_max='100'/>` +
    "<continuation root='10' last='10'/>" +
    '</inventoryManager>'
  const tail =
    "<inventoryManager id='b' room='84105' root='10' after='10'>" +
    `<i id='11' loc='in,10' name="a,,coin" weight='1'/>` +
    '</inventoryManager>'

  resetParser()
  const asm = new InvAssembler()
  const first = asm.take(envelopes(head)[0])
  eq('a continuation keeps the walk open', first.status, 'collecting')
  eq('… and reports the cursor to request', first.status === 'collecting' ? first.pending[0]?.root : '', '10')
  eq('drain hands out the cursor', asm.drain(4).length, 1)
  eq('… and does not hand it out twice', asm.drain(4).length, 0)

  const second = asm.take(envelopes(tail)[0])
  eq('the last envelope completes the walk', second.status, 'ready')
  eq('items from both envelopes are merged', second.status === 'ready' ? second.snapshot.items.size : 0, 2)

  resetParser()
  const dup = new InvAssembler()
  dup.take(envelopes(head)[0])
  const repeat = dup.take(envelopes(head.replace("id='a'", "id='c'"))[0])
  check('a repeated cursor fails the walk', repeat.status === 'failed')

  resetParser()
  const wrongRoom = new InvAssembler()
  wrongRoom.take(envelopes(head)[0])
  const moved = wrongRoom.take(envelopes(tail.replace("room='84105'", "room='99999'"))[0])
  check('an envelope from another room fails the walk', moved.status === 'failed')

  resetParser()
  const orphan = new InvAssembler()
  const orphaned = orphan.take(envelopes(
    "<inventoryManager id='d' room='84105'>" +
    `<i id='20' loc='in,999' name="a,,coin" weight='1'/>` +
    '</inventoryManager>',
  )[0])
  check('a child before its parent fails the walk', orphaned.status === 'failed')

  resetParser()
  const stale = new InvAssembler()
  eq('a stale envelope reports stale', stale.take(envelopes("<inventoryManager id='e' room='84105' state='stale'/>")[0]).status, 'stale')
}

// ── Report ────────────────────────────────────────────────────────────────────
if (failures.length > 0) {
  console.error(`inventory: ${failures.length} failure(s)`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`inventory: ${passed} checks passed`)
