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
 *
 * Run: npm run test:tools
 */

import { mergeSeed, applyBakedLayouts, LAYOUT_VERSION, type BakedLayouts } from './mapSeed'
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

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ mapSeed: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ mapSeed: ${passed} passed`)
