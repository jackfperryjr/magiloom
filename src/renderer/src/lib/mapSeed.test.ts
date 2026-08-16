/**
 * Seed-merge tests.
 *
 * The shipped dataset is a community crawl merged UNDER the player's own recorded
 * map, and the merge has to hold three properties that are easy to break and hard
 * to notice once broken:
 *
 *   1. Recorded rooms win. The dataset can be stale or wrong for a given room;
 *      a room the player walked is ground truth for their game.
 *   2. The seam stays connected. A dataset room the player already has under a
 *      different node id must still absorb the dataset's arcs, or the map splits
 *      exactly where explored meets unexplored.
 *   3. Baked coordinates apply only to the graph they were computed from.
 *   4. Shipped rooms never leak into the player's store, and are never lost from
 *      the view when a zone comes back from it.
 *
 * Run: npm run test:tools
 */

import {
  mergeSeed, applyBakedLayouts, recordedZone, reseedZone, seedFromDataset,
  clearRecorded, LAYOUT_VERSION, type BakedLayouts,
} from './mapSeed'
import { emptyDb, type MapDB, type MapNode, type Zone } from './mapModel'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

function node(id: string, uid?: string): MapNode {
  return {
    id, zoneId: 'z', title: `[Town, ${id}]`, descHash: 'h', descriptions: ['d'],
    exits: ['north'], x: 0, y: 0, z: 0, ...(uid ? { uid } : {}),
  }
}
/** One-zone db from nodes + [from, to] arcs. */
function db(nodes: MapNode[], arcs: [string, string][] = []): MapDB {
  const zone: Zone = {
    id: 'z', name: 'Town', nodes: {},
    arcs: arcs.map(([from, to]) => ({ from, to, dir: 'north', move: 'north' })),
  }
  for (const n of nodes) zone.nodes[n.id] = n
  return { version: emptyDb().version, zones: { z: zone } }
}
const nodesOf = (d: MapDB): string[] => Object.keys(d.zones['z']?.nodes ?? {}).sort()
const arcsOf = (d: MapDB): string[] =>
  (d.zones['z']?.arcs ?? []).map(a => `${a.from}>${a.to}`).sort()

// ── 1. Gap filling ───────────────────────────────────────────────────────────
{
  const r = mergeSeed(db([node('a')]), db([node('b'), node('c')], [['b', 'c']]))
  eq('adds unseen rooms', r.added, 2)
  eq('skips nothing', r.skipped, 0)
  eq('merged node set', nodesOf(r.db).join(','), 'a,b,c')
  eq('seed arcs come along', arcsOf(r.db).join(','), 'b>c')
}

// ── 2. Recorded rooms win ────────────────────────────────────────────────────
{
  // Same node id on both sides = same content. The recorded one must survive
  // untouched, carrying whatever the player's own mapping recorded on it.
  const recorded = db([{ ...node('a'), title: '[Town, RECORDED]' }])
  const r = mergeSeed(recorded, db([{ ...node('a'), title: '[Town, DATASET]' }]))
  eq('skips a room already recorded', r.skipped, 1)
  eq('adds nothing', r.added, 0)
  eq('recorded content preserved', r.db.zones['z'].nodes['a'].title, '[Town, RECORDED]')
}
{
  // Different id, same uid: the player walked it and its description drifted from
  // the crawl. Still their room.
  const r = mergeSeed(db([node('rec', '1001')]), db([node('ds', '1001')]))
  eq('uid match skips the dataset room', r.skipped, 1)
  eq('uid match adds nothing', r.added, 0)
  eq('only the recorded node remains', nodesOf(r.db).join(','), 'rec')
}

// ── 3. The seam stays connected ──────────────────────────────────────────────
{
  // 'ds' is the player's 'rec' under the dataset's id. The dataset's ds→new arc
  // has to survive as rec→new, or the explored/unexplored boundary is severed.
  const recorded = db([node('rec', '1001')])
  const seed = db([node('ds', '1001'), node('new')], [['ds', 'new'], ['new', 'ds']])
  const r = mergeSeed(recorded, seed)
  eq('new room still added', r.added, 1)
  eq('arcs redirected onto the recorded node', arcsOf(r.db).join(','), 'new>rec,rec>new')
  check('no arc references the dropped id',
    !arcsOf(r.db).some(a => a.includes('ds')), arcsOf(r.db).join(','))
}
{
  // An arc whose endpoint is neither kept nor recorded must be dropped, not left
  // dangling at a room that does not exist.
  const seed = db([node('b')], [['b', 'ghost']])
  const r = mergeSeed(emptyDb(), seed)
  eq('dangling arc dropped', arcsOf(r.db).length, 0)
}
{
  // A recorded arc is never duplicated by an identical seed arc.
  const r = mergeSeed(db([node('a'), node('b')], [['a', 'b']]), db([node('a'), node('b')], [['a', 'b']]))
  eq('no duplicate arc', arcsOf(r.db).join(','), 'a>b')
}

// ── 4. Baked coordinates are version-gated ───────────────────────────────────
function baked(over: Partial<BakedLayouts> = {}): BakedLayouts {
  return {
    instance: 'dr-prime', layoutVersion: LAYOUT_VERSION, roomsVersion: 'v1',
    maxAreaNodes: 600,
    areas: { a: { name: 'Town', rooms: 1, pos: [['a', 7, 9, 2]], labels: [], exits: [] } },
    ...over,
  }
}
{
  const d = db([node('a')])
  const res = applyBakedLayouts(d, baked(), 'v1')
  eq('matching bake applies', res.ok, true)
  eq('x placed', d.zones['z'].nodes['a'].x, 7)
  eq('y placed', d.zones['z'].nodes['a'].y, 9)
  eq('z placed', d.zones['z'].nodes['a'].z, 2)
}
{
  const d = db([node('a')])
  const res = applyBakedLayouts(d, baked({ roomsVersion: 'OLD' }), 'v1')
  eq('stale rooms version rejected', res.ok, false)
  eq('coordinates untouched', d.zones['z'].nodes['a'].x, 0)
  check('reason explains the mismatch', /rooms v/.test(res.reason ?? ''), res.reason ?? '')
}
{
  const d = db([node('a')])
  const res = applyBakedLayouts(d, baked({ layoutVersion: LAYOUT_VERSION + 1 }), 'v1')
  eq('stale layout version rejected', res.ok, false)
  eq('coordinates untouched on layout bump', d.zones['z'].nodes['a'].x, 0)
}
{
  // Positions for rooms that aren't in this graph are ignored, not an error.
  const d = db([node('a')])
  const res = applyBakedLayouts(d, baked({
    areas: { a: { name: 'T', rooms: 1, pos: [['nope', 1, 1, 1]], labels: [], exits: [] } },
  }), 'v1')
  eq('unknown room in bake tolerated', res.ok, true)
  eq('known room left at origin', d.zones['z'].nodes['a'].x, 0)
}

// ── 5. Shipped rooms stay out of the player's store ──────────────────────────
const shipped = (id: string, uid?: string): MapNode => ({ ...node(id, uid), seed: true })
const zoneOf = (d: MapDB): Zone => d.zones['z']
const idsOf = (z: Zone): string => Object.keys(z.nodes).sort().join(',')
const linksOf = (z: Zone): string => z.arcs.map(a => `${a.from}>${a.to}`).sort().join(',')

{
  // The whole point: a zone holding both kinds saves only what was walked.
  const z = zoneOf(db([node('rec'), shipped('ship')], [['rec', 'ship'], ['ship', 'rec']]))
  const out = recordedZone(z)
  eq('shipped room not persisted', idsOf(out), 'rec')
  eq('arcs to a dropped room go with it', linksOf(out), '')
  eq('the live zone is not mutated', idsOf(z), 'rec,ship')
}
{
  // Walking into a shipped room promotes it (observeRoom clears the flag), which is
  // what lets the room AND the link the player travelled reach their store.
  const z = zoneOf(db([node('rec'), node('walked')], [['rec', 'walked']]))
  eq('a promoted room persists', idsOf(recordedZone(z)), 'rec,walked')
  eq('and keeps its link', linksOf(recordedZone(z)), 'rec>walked')
}
{
  // A note on a shipped room is recorded data; losing it on the next launch would
  // read as the app silently discarding the player's edit.
  const z = zoneOf(db([shipped('a'), { ...shipped('b'), note: 'ranger camp' }]))
  eq('annotated shipped room is kept', idsOf(recordedZone(z)), 'b')
}
{
  const z = zoneOf(db([node('a'), node('b')], [['a', 'b']]))
  check('an all-recorded zone is passed through untouched', recordedZone(z) === z)
}
{
  // Arcs leaving the zone can't be judged here — the far end lives in another file —
  // so they survive as long as their own end does.
  const z = zoneOf(db([node('rec')], [['rec', 'elsewhere']]))
  eq('cross-zone arc kept', linksOf(recordedZone(z)), 'rec>elsewhere')
}

// ── 6. A zone read back from the store is re-seeded ──────────────────────────
{
  // Without a dataset loaded there is nothing to put back, and the zone must pass
  // through unchanged rather than being emptied.
  const z = zoneOf(db([node('a')]))
  check('reseedZone is a no-op with no dataset', reseedZone(z) === z)
}
{
  // Load a tiny dataset through the real path, so cachedSeed is populated exactly
  // as it is at runtime. Desktop hands the JSON over IPC; stubbing that is enough.
  const rooms = JSON.stringify({
    instance: 'dr-prime', source: 'test', generated: 0, roomsVersion: 'v1',
    rooms: [
      { id: 1, t: '[Town, Square]', desc: 'd1', h: 'h1', e: ['north'], loc: 'Zoluren', f: ['rock'], x: [[2, 'north', 'north']] },
      { id: 2, t: '[Town, Road]',   desc: 'd2', h: 'h2', e: ['south'], x: [] },
    ],
  })
  ;(globalThis as unknown as { window: unknown }).window = {
    dr: { map: { dataset: async () => ({ rooms, layouts: null }) } },
  }

  const seeded = await seedFromDataset(emptyDb())
  eq('dataset rooms seeded', seeded.added, 2)
  const zid = Object.keys(seeded.db.zones)[0]
  const live = seeded.db.zones[zid]
  eq('region carried onto the node', Object.values(live.nodes)[0].region, 'Zoluren')
  check('forage carried onto the node',
    Object.values(live.nodes).some(n => n.forage?.[0] === 'rock'))
  check('seeded rooms are flagged', Object.values(live.nodes).every(n => n.seed === true))

  // What the store would actually hold for this zone after the player walked one
  // room of it — and what another window then hands us back.
  const walked = Object.keys(live.nodes)[0]
  const asStored = recordedZone({
    ...live,
    nodes: { ...live.nodes, [walked]: { ...live.nodes[walked], seed: undefined } },
  })
  eq('store holds only the walked room', Object.keys(asStored.nodes).join(','), walked)

  const back = reseedZone(asStored)
  eq('shipped rooms restored on the way back in', Object.keys(back.nodes).length, 2)
  check('the walked room stays the recorded one', back.nodes[walked].seed === undefined)
  check('shipped neighbour is still flagged',
    Object.values(back.nodes).filter(n => n.id !== walked).every(n => n.seed === true))
}

// ── Clearing a zone keeps the shipped rooms ─────────────────────────────────
// "Clear zone" removes only what the player recorded. The previous implementation
// deleted the whole zone and re-merged the dataset into the hole, which quietly
// took the shipped rooms with it whenever the dataset had not loaded.
{
  const walked  = { ...node('walked'), title: '[Town, Walked]' }
  const shipped = { ...node('shipped'), seed: true as const }
  const annotated = { ...node('annotated'), seed: true as const, note: 'herbs here', tag: 'HRB', color: '#f00', pin: { x: 3, y: 4 } }

  const zone: Zone = {
    id: 'z', name: 'Town',
    nodes: { walked, shipped, annotated },
    arcs: [
      { from: 'walked', to: 'shipped', dir: 'north', move: 'north' },
      { from: 'shipped', to: 'annotated', dir: 'east', move: 'east' },
    ],
  }

  const cleared = clearRecorded(zone)
  check('the zone survives while shipped rooms remain', cleared !== null)
  eq('the walked room is gone', Object.keys(cleared!.nodes).sort().join(','), 'annotated,shipped')
  check('the plain shipped room is untouched', cleared!.nodes['shipped'] === shipped)

  // An annotated shipped room stays, but the annotation was the player's — it goes.
  const a = cleared!.nodes['annotated']
  check('the annotated shipped room is kept', !!a)
  check('its note is cleared', a.note === undefined)
  check('its label is cleared', a.tag === undefined)
  check('its colour is cleared', a.color === undefined)
  check('its dragged position is cleared', a.pin === undefined)
  check('but the room itself is intact', a.id === 'annotated' && a.seed === true)

  // An arc loses its endpoint along with the room.
  eq('arcs into the removed room are dropped',
    cleared!.arcs.map(x => `${x.from}>${x.to}`).join(','), 'shipped>annotated')

  // A zone the player mapped themselves has nothing to keep, so it goes entirely
  // rather than lingering as an empty area in the browse list.
  const ownOnly: Zone = { id: 'z', name: 'Town', nodes: { walked }, arcs: [] }
  eq('a wholly player-recorded zone clears to nothing', clearRecorded(ownOnly), null)

  // The important property: this does not depend on the dataset being loaded, which
  // is exactly where the old delete-and-reseed approach failed open.
  const shippedOnly: Zone = { id: 'z', name: 'Town', nodes: { shipped }, arcs: [] }
  eq('a wholly shipped zone is left alone',
    Object.keys(clearRecorded(shippedOnly)?.nodes ?? {}).join(','), 'shipped')
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ mapSeed: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ mapSeed: ${passed} passed`)
