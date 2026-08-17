/**
 * Automapper layout tests.
 *
 * These pin the two properties that make a map readable at a glance, both of which
 * were regressions found by eye and are easy to reintroduce:
 *
 *   1. A street lays out STRAIGHT. A room is positioned by exactly one of the moves
 *      that reach it, and that move decides where it lands — so placement ORDER
 *      silently decides which links come out bent. Ranking street moves first is
 *      what keeps a boulevard on one row; a plain queue let whichever link arrived
 *      first win and kinked it.
 *   2. A neighbourhood lands INSIDE the streets that bound it, which follows from
 *      the same thing: run each street to its end before branching, and the blocks
 *      between them close where those streets cross.
 *
 * Run: npm run test:tools
 */

import { areaLayout, listAreas, stripArea, firstUnwalkableLink, findRoute, locateRoom, observeRoom } from './mapper'
import { parseGenieMap, exportGenieMap } from './mapImport'
import type { MapDB, MapArc, MapNode, Zone } from './mapModel'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const OPP: Record<string, string> = { north: 'south', south: 'north', east: 'west', west: 'east' }

/** Build a one-zone DB from a room table and a link list. */
function build(
  rooms: Record<string, string>,
  links: [string, string, string][],
  zoneName = 'The Crossing',
): MapDB {
  const nodes: Record<string, MapNode> = {}
  for (const [id, title] of Object.entries(rooms)) {
    nodes[id] = {
      id, uid: id, zoneId: 'z', title: `[${zoneName}, ${title}]`,
      descHash: id, descriptions: [''], exits: [], x: 0, y: 0, z: 0,
    }
  }
  const arcs: MapArc[] = []
  for (const [a, b, d] of links) {
    arcs.push({ from: a, to: b, dir: d, move: d })
    if (OPP[d]) arcs.push({ from: b, to: a, dir: OPP[d], move: OPP[d] })
  }
  return { version: 1, zones: { z: { id: 'z', name: zoneName, nodes, arcs } } }
}

/** Laid-out cells, translated so `origin` sits at (0,0). */
function cells(zone: Zone, origin: string): Record<string, [number, number]> {
  const base = zone.nodes[origin]
  const out: Record<string, [number, number]> = {}
  for (const id in zone.nodes) out[id] = [zone.nodes[id].x - base.x, zone.nodes[id].y - base.y]
  return out
}

// ── A neighbourhood inside its bounding streets ───────────────────────────────
// The real arrangement in The Crossing: Clanthew Boulevard along the north,
// Asemath Walk down the west, Via Iltesh down the east, with Crofton Walk and
// Smithy Lane as the blocks between them. The geometry is a flat grid, so a correct
// layout has to reproduce it exactly:
//
//        x0         x1        x2        x3
//  y0  Clanthew  Clanthew  Clanthew  Clanthew
//  y1  Asemath   Crofton   Crofton   ViaIltesh
//  y2  Asemath   Smithy    Smithy    ViaIltesh
//  y3  Asemath                       ViaIltesh
{
  const truth: Record<string, [string, number, number]> = {
    clan0: ['Clanthew Boulevard', 0, 0], clan1: ['Clanthew Boulevard', 1, 0],
    clan2: ['Clanthew Boulevard', 2, 0], clan3: ['Clanthew Boulevard', 3, 0],
    asem1: ['Asemath Walk', 0, 1], asem2: ['Asemath Walk', 0, 2], asem3: ['Asemath Walk', 0, 3],
    via1:  ['Via Iltesh', 3, 1],   via2:  ['Via Iltesh', 3, 2],   via3:  ['Via Iltesh', 3, 3],
    crof1: ['Crofton Walk', 1, 1], crof2: ['Crofton Walk', 2, 1],
    smit1: ['Smithy Lane', 1, 2],  smit2: ['Smithy Lane', 2, 2],
  }
  const rooms: Record<string, string> = {}
  for (const id in truth) rooms[id] = truth[id][0]

  const db = build(rooms, [
    ['clan0', 'clan1', 'east'], ['clan1', 'clan2', 'east'], ['clan2', 'clan3', 'east'],
    ['clan0', 'asem1', 'south'], ['asem1', 'asem2', 'south'], ['asem2', 'asem3', 'south'],
    ['clan3', 'via1', 'south'],  ['via1', 'via2', 'south'],   ['via2', 'via3', 'south'],
    ['clan1', 'crof1', 'south'], ['crof1', 'crof2', 'east'],  ['crof2', 'via1', 'east'],
    ['asem1', 'crof1', 'east'],
    ['crof1', 'smit1', 'south'], ['smit1', 'smit2', 'east'],  ['smit2', 'via2', 'east'],
    ['asem2', 'smit1', 'east'],
  ])

  const { zone } = areaLayout(db, 'clan0')
  const got = cells(zone, 'clan0')

  let exact = 0
  for (const id in truth) {
    const [, tx, ty] = truth[id]
    if (got[id][0] === tx && got[id][1] === ty) exact++
  }
  eq('block: every room lands in its true cell', exact, Object.keys(truth).length)

  // Streets stay on one line…
  for (const [name, ids] of [
    ['Clanthew Boulevard', ['clan0', 'clan1', 'clan2', 'clan3']],
    ['Asemath Walk',       ['asem1', 'asem2', 'asem3']],
    ['Via Iltesh',         ['via1', 'via2', 'via3']],
    ['Crofton Walk',       ['crof1', 'crof2']],
    ['Smithy Lane',        ['smit1', 'smit2']],
  ] as [string, string[]][]) {
    const xs = new Set(ids.map(i => got[i][0])), ys = new Set(ids.map(i => got[i][1]))
    check(`block: ${name} lays out straight`, xs.size === 1 || ys.size === 1,
      ids.map(i => `(${got[i]})`).join(' '))
  }

  // …and the interior blocks sit inside them.
  const bound = ['clan0', 'clan1', 'clan2', 'clan3', 'asem1', 'asem2', 'asem3', 'via1', 'via2', 'via3']
  const minX = Math.min(...bound.map(i => got[i][0])), maxX = Math.max(...bound.map(i => got[i][0]))
  const minY = Math.min(...bound.map(i => got[i][1])), maxY = Math.max(...bound.map(i => got[i][1]))
  for (const i of ['crof1', 'crof2', 'smit1', 'smit2']) {
    const [x, y] = got[i]
    check(`block: ${stripArea(zone.nodes[i].title)} sits inside its bounding streets`,
      x > minX && x < maxX && y > minY && y <= maxY, `at (${x},${y})`)
  }
}

// ── A block EXPANDS to fit the streets inside it ──────────────────────────────
// The bounding streets here sit one row apart, but the neighbourhood between them
// needs two. The far street has to be pushed out to make the room — and the
// neighbourhood must still end up inside, not spilling past it.
//
//   y0  C----C----C----C      Clanthew east along the top
//   y1  A    r----r    V      Crofton hangs south off Clanthew
//   y2  A    s----s    V      Smithy hangs south off Crofton
//   y3  A----L----L----V      Lorethew has to give way to y3
{
  const db = build({
    c0: 'Clanthew Boulevard', c1: 'Clanthew Boulevard', c2: 'Clanthew Boulevard', c3: 'Clanthew Boulevard',
    aw1: 'Asemath Walk', aw2: 'Asemath Walk',
    vi1: 'Via Iltesh', vi2: 'Via Iltesh',
    lo1: 'Lorethew Street', lo2: 'Lorethew Street',
    cr1: 'Crofton Walk', cr2: 'Crofton Walk',
    sm1: 'Smithy Lane', sm2: 'Smithy Lane',
  }, [
    ['c0', 'c1', 'east'], ['c1', 'c2', 'east'], ['c2', 'c3', 'east'],
    ['c0', 'aw1', 'south'], ['aw1', 'aw2', 'south'],
    ['c3', 'vi1', 'south'], ['vi1', 'vi2', 'south'],
    ['aw2', 'lo1', 'south'], ['lo1', 'lo2', 'east'],
    ['c1', 'cr1', 'south'], ['cr1', 'cr2', 'east'],
    ['cr1', 'sm1', 'south'], ['sm1', 'sm2', 'east'],
  ])
  const { zone } = areaLayout(db, 'c0')
  const got = cells(zone, 'c0')

  const north = Math.max(...['c0', 'c1', 'c2', 'c3'].map(i => got[i][1]))
  const south = Math.min(...['lo1', 'lo2'].map(i => got[i][1]))
  check('expand: the block opened up for the streets inside it', south - north - 1 >= 2,
    `only ${south - north - 1} interior rows`)
  for (const i of ['cr1', 'cr2', 'sm1', 'sm2']) {
    const [, y] = got[i]
    check(`expand: ${stripArea(zone.nodes[i].title)} stays inside the block`,
      y > north && y < south, `at row ${y}, block is ${north}..${south}`)
  }
  eq('expand: no rooms overlap',
    new Set(Object.values(zone.nodes).map(n => `${n.x},${n.y}`)).size, Object.keys(zone.nodes).length)
}

// ── A street stays straight even when a side street reaches it first ──────────
// The regression that kinked Clanthew Boulevard: #10063 is due east of #10062, but
// it is ALSO reachable off a side street, and whichever link placed it won. Laying
// the boulevard out must not depend on that race.
{
  const db = build({
    a: 'Clanthew Boulevard', b: 'Clanthew Boulevard', c: 'Clanthew Boulevard',
    side1: 'Via Iltesh', side2: 'Via Iltesh',
  }, [
    ['a', 'b', 'east'], ['b', 'c', 'east'],       // the boulevard
    ['a', 'side1', 'south'], ['side1', 'side2', 'east'],
    ['side2', 'c', 'north'],                       // the side street also reaches c
  ])
  const { zone } = areaLayout(db, 'a')
  const got = cells(zone, 'a')
  eq('street: boulevard stays on one row', new Set(['a', 'b', 'c'].map(i => got[i][1])).size, 1)
  eq('street: boulevard runs consecutively east', got.c[0] - got.a[0], 2)
}

// ── A command-less link is placed by direction, not shoved east ───────────────
// Everything hanging off such a link inherits wherever it lands, so guessing "one
// cell east" doesn't misplace a room — it misplaces a whole neighbourhood, which is
// how a block ends up streets away from where it belongs or laid across one. The
// room's own obvious paths settle it: if only one is unaccounted for, that's the way.
{
  // stored forwards: b --(no command)--> c, and b's only unexplained exit is north
  const db = build({ a: 'High Street', b: 'High Street', c: 'Back Alley' }, [['a', 'b', 'east']])
  db.zones.z.nodes.b.exits = ['west', 'north']       // west is the link back to a
  db.zones.z.arcs.push({ from: 'b', to: 'c', dir: 'special', move: '' })
  const got = cells(areaLayout(db, 'a').zone, 'b')
  eq('unknown link: placed north, where the spare exit points', got.c.join(','), '0,-1')

  // stored backwards: the arc is recorded c --> b, so the inference lands on the far
  // end and has to be flipped to place c.
  const db2 = build({ a: 'High Street', b: 'High Street', c: 'Back Alley' }, [['a', 'b', 'east']])
  db2.zones.z.nodes.c.exits = ['south']
  db2.zones.z.arcs.push({ from: 'c', to: 'b', dir: 'special', move: '' })
  const got2 = cells(areaLayout(db2, 'a').zone, 'b')
  eq('unknown link: reverse-stored inference is flipped', got2.c.join(','), '0,-1')

  // nothing to infer from — the old fallback still applies rather than guessing wildly
  const db3 = build({ a: 'High Street', b: 'High Street', c: 'Back Alley' }, [['a', 'b', 'east']])
  db3.zones.z.arcs.push({ from: 'b', to: 'c', dir: 'special', move: '' })
  const got3 = cells(areaLayout(db3, 'a').zone, 'b')
  eq('unknown link: falls back beside the room when nothing pins it', got3.c.join(','), '1,0')
}

// ── Areas, exits and lettering ────────────────────────────────────────────────
{
  // A shop behind a "go door" belongs to its own area, reached through a portal —
  // it must not be crammed onto the street grid.
  const db: MapDB = build({ s1: 'Main Street', s2: 'Main Street' }, [['s1', 's2', 'east']])
  db.zones.shop = {
    id: 'shop', name: "Barnom's Shop",
    nodes: { shop1: {
      id: 'shop1', uid: 'shop1', zoneId: 'shop', title: "[Barnom's Shop, Sales Floor]",
      descHash: 'shop1', descriptions: [''], exits: [], x: 0, y: 0, z: 0,
    } },
    arcs: [{ from: 's2', to: 'shop1', dir: 'special', move: 'go door' }],
  }
  const area = areaLayout(db, 's1')
  eq('area: the shop is not inlined on the street', Object.keys(area.zone.nodes).length, 2)
  eq('area: it becomes an exit instead', area.exits.length, 1)
  eq('area: the exit keeps its command', area.exits[0].move, 'go door')
  eq('area: the exit names its destination area', area.exits[0].area, "Barnom's Shop")
  eq('area: the street is named after its own zone', area.name, 'The Crossing')

  const areas = listAreas(db).map(a => a.name).sort()
  eq('listAreas: street and shop are separate maps', areas.join('|'), "Barnom's Shop|The Crossing")

  // A multi-room street gets lettered; the label may never sit on a room.
  const roomCells = new Set(Object.values(area.zone.nodes).map(n => `${n.x},${n.y}`))
  check('labels: a street is lettered', area.labels.some(l => l.text === 'Main Street'))
  check('labels: no label sits on a room',
    area.labels.every(l => !roomCells.has(`${Math.round(l.x)},${Math.round(l.y)}`)))
}

// ── Layout is deterministic and independent of which room roots it ────────────
{
  const db = build({ a: 'Road', b: 'Road', c: 'Road', d: 'Lane' }, [
    ['a', 'b', 'east'], ['b', 'c', 'east'], ['b', 'd', 'north'],
  ])
  const key = (z: Zone) => Object.keys(z.nodes).sort()
    .map(i => `${i}:${z.nodes[i].x},${z.nodes[i].y}`).join('|')
  eq('layout: repeat calls agree', key(areaLayout(db, 'a').zone), key(areaLayout(db, 'a').zone))
  eq('layout: rooting elsewhere in the area agrees',
    key(areaLayout(db, 'a').zone), key(areaLayout(db, 'd').zone))
  // No two rooms may ever share a cell.
  const z = areaLayout(db, 'a').zone
  eq('layout: no two rooms share a cell',
    new Set(Object.values(z.nodes).map(n => `${n.x},${n.y},${n.z}`)).size, Object.keys(z.nodes).length)
}

// ── Routing: a link recorded without a command breaks the walk, and says so ───
{
  const db = build({ a: 'Road', b: 'Road', c: 'Road' }, [['a', 'b', 'east']])
  // c is drawn as connected but the command was never captured (Lich moved us).
  db.zones.z.nodes.c.exits = []
  db.zones.z.arcs.push({ from: 'b', to: 'c', dir: 'special', move: '' })

  check('route: a walkable link routes', !!findRoute(db, 'a', 'b'))
  check('route: an uncommanded link does not', findRoute(db, 'a', 'c') === null)
  const gap = firstUnwalkableLink(db, 'a', 'c')
  eq('route: the broken link is named', gap, 'Road → Road')
  eq('route: no gap reported when the walk works', firstUnwalkableLink(db, 'a', 'b'), null)

  // The same link becomes walkable once the command can be pinned down: 'b' has one
  // obvious exit nothing else explains, so it must be the way to 'c'.
  db.zones.z.nodes.b.exits = ['west', 'north']   // west is the arc back to 'a'
  const r = findRoute(db, 'a', 'c')
  check('route: an unexplained obvious exit is inferred', !!r)
  eq('route: and it is the right one', r ? r.moves.join(',') : '', 'east,north')
}

// ── Locating a room must not depend on recording it ───────────────────────────
// With auto-record off, the mapper still has to follow the character across the map
// they already have. It used to decide "do I know this room?" by observing it and
// checking whether the db came back unchanged — but observeRoom rewrites a room it
// MATCHED as well (exits refresh, uid backfill, the shipped `seed` flag dropped), so
// that check was false for every room, recognised or not, and the map answered
// "Locating you…" forever. locateRoom is the same identity decision with no writing.
{
  const db = build({ a: 'Road', b: 'Road' }, [['a', 'b', 'east']])
  // A room straight off the shipped dataset: never walked, so still flagged.
  db.zones.z.nodes.b.seed = true
  db.zones.z.nodes.b.exits = ['west']
  const obs = { title: '[The Crossing, Road]', description: '', exits: ['west'], uid: 'b' }

  eq('locate: a known room is found by its DR room number', locateRoom(db, obs), 'b')
  const before = JSON.stringify(db)
  locateRoom(db, obs, { id: 'a', dir: 'east', move: 'east' })
  eq('locate: …without touching the map', JSON.stringify(db), before)

  // The two must agree: whatever observeRoom folds this into is where we are.
  eq('locate: agrees with observeRoom', locateRoom(db, obs), observeRoom(db, obs).id)
  // And observing it really does rewrite the node — the reason identity can't be
  // inferred from "the db is unchanged".
  check('locate: observing a matched room still rewrites it', observeRoom(db, obs).db !== db)

  const unknown = { title: '[The Crossing, Alley]', description: 'dark', exits: [], uid: 'zz' }
  eq('locate: an unmapped room is null, not a new node', locateRoom(db, unknown), null)
  eq('locate: …and the map still has two rooms', Object.keys(db.zones.z.nodes).length, 2)
}

// ── Export must be a faithful backup ──────────────────────────────────────────
// Every one of these was silently lost on a round-trip, which made Export useless as
// a backup and impossible to diagnose a map from:
//   - links that LEAVE their zone (every shop door), because Genie's `destination`
//     is a number that only means something inside one zone;
//   - links recorded with no command, because the importer treated an empty move as
//     a missing field — those are most of a real map's connectivity;
//   - whole ROOMS, because the zone key was guessed from the first room's title and
//     two zones could guess the same key and overwrite each other.
{
  const db = build({ a: 'High Street', b: 'High Street' }, [['a', 'b', 'east']])
  // a shop in its own zone, entered by a door and left with no recorded command
  db.zones.shop = {
    id: 'shop', name: 'Barnom Slim',
    nodes: { s1: {
      id: 's1', zoneId: 'shop', title: '[Barnom Slim, Sales Floor]',
      descHash: 's1', descriptions: ['Shelves.'], exits: [], x: 0, y: 0, z: 0,
    } },
    arcs: [],
  }
  db.zones.z.arcs.push({ from: 'b', to: 's1', dir: 'special', move: 'go door' })
  db.zones.shop.arcs.push({ from: 's1', to: 'b', dir: 'special', move: '' })
  // a second zone whose rooms are titled for somewhere else entirely — this is what
  // used to collide with another zone's derived key
  db.zones.outskirts = {
    id: 'outskirts', name: 'Outskirts',
    nodes: { o1: {
      id: 'o1', zoneId: 'outskirts', title: '[High Street, Far End]',
      descHash: 'o1', descriptions: [''], exits: [], x: 0, y: 0, z: 0,
    } },
    arcs: [],
  }

  const before = Object.values(db.zones)
  const beforeRooms = before.reduce((s, z) => s + Object.keys(z.nodes).length, 0)
  const beforeArcs = before.reduce((s, z) => s + z.arcs.length, 0)

  const { zones: after } = parseGenieMap(exportGenieMap(before))
  const afterRooms = after.reduce((s, z) => s + Object.keys(z.nodes).length, 0)
  const afterArcs = after.reduce((s, z) => s + z.arcs.length, 0)
  const all = new Set<string>()
  for (const z of after) for (const id in z.nodes) all.add(id)

  eq('export: every zone survives', after.length, before.length)
  eq('export: every room survives', afterRooms, beforeRooms)
  eq('export: every link survives', afterArcs, beforeArcs)
  check('export: the cross-zone door survives',
    after.some(z => z.arcs.some(a => a.move === 'go door' && all.has(a.to))))
  check('export: a link with no command survives as one',
    after.some(z => z.arcs.some(a => a.move === '' && a.dir === 'special')))
  check('export: rooms titled for another area keep their own zone',
    after.some(z => z.id === 'outskirts' && Object.keys(z.nodes).length === 1))
  // DR's room number is the definitive identity; without it an imported map can never
  // be reconciled with rooms walked afterwards, so the import just duplicates them.
  const uids = after.flatMap(z => Object.values(z.nodes)).map(n => n.uid).filter(Boolean).sort()
  eq('export: DR room numbers survive', uids.join(','), 'a,b')
  // and a non-compass move that reads like a direction stays non-compass
  {
    const db2 = build({ p: 'Lobby', q: 'Street' }, [])
    db2.zones.z.arcs.push({ from: 'p', to: 'q', dir: 'special', move: 'out' })
    const rt = parseGenieMap(exportGenieMap(Object.values(db2.zones)))
    const arc = rt.zones[0].arcs[0]
    eq('export: "out" stays a non-compass link', arc.dir, 'special')
    eq('export: …and keeps its command', arc.move, 'out')
  }
}

// ── Report ─────────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`✓ all ${passed} automapper layout assertions passed`)
