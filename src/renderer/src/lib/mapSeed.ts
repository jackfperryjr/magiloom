/**
 * Load the shipped map dataset and merge it under the player's own recorded map.
 *
 * Precedence is the whole design here: **recorded rooms always win.** The dataset
 * is a community crawl and can be out of date or plain wrong for a given room,
 * whereas a room the player walked is ground truth for their game. So the seed
 * fills gaps and never overwrites — a dataset room is dropped the moment the
 * recorded map already has that room, by either handle:
 *
 *   • uid — the game's native room number. Definitive when both sides have one.
 *   • node id — derived from room content identically on both sides (see
 *     mapDataset.datasetToDb), so a content match is just an id collision.
 *
 * Baked coordinates are applied only when both version stamps agree with the
 * dataset they were computed from. A mismatch means the graph or the layout
 * algorithm moved on, so the positions are ignored and the map lays out live:
 * slower to open, never wrong.
 */

import {
  datasetToDb, mirrorArcs, isDataset, type Dataset,
} from './mapDataset'
import { MAP_DB_VERSION, type MapDB, type MapNode, type Zone } from './mapModel'

/** Bumped in scripts/bake-layouts.js when placement changes. Must match. */
export const LAYOUT_VERSION = 1

export interface BakedArea {
  name:   string
  rooms:  number
  pos:    [string, number, number, number][]   // [nodeId, x, y, z]
  labels: unknown[]
  exits:  unknown[]
}

export interface BakedLayouts {
  instance:      string
  layoutVersion: number
  roomsVersion:  string
  maxAreaNodes:  number
  areas:         Record<string, BakedArea>
}

export interface SeedResult {
  db:      MapDB
  /** Rooms contributed by the dataset (i.e. not already recorded). */
  added:   number
  /** Dataset rooms skipped because the player already had them. */
  skipped: number
  /** Whether baked coordinates were applied. */
  baked:   boolean
  /** Set when a bake existed but did not match — surfaced for diagnostics. */
  staleReason?: string
}

/**
 * Apply baked coordinates onto a dataset-derived db, in place.
 * Returns false (touching nothing) when the bake doesn't correspond to this graph.
 */
export function applyBakedLayouts(
  db: MapDB, layouts: BakedLayouts, roomsVersion: string,
): { ok: boolean; reason?: string } {
  if (layouts.layoutVersion !== LAYOUT_VERSION) {
    return { ok: false, reason: `layout v${layouts.layoutVersion} != v${LAYOUT_VERSION}` }
  }
  if (layouts.roomsVersion !== roomsVersion) {
    return { ok: false, reason: `baked against rooms v${layouts.roomsVersion}, have v${roomsVersion}` }
  }
  const index = new Map<string, MapNode>()
  for (const z of Object.values(db.zones)) for (const id in z.nodes) index.set(id, z.nodes[id])
  for (const area of Object.values(layouts.areas)) {
    for (const [id, x, y, z] of area.pos) {
      const n = index.get(id)
      if (n) { n.x = x; n.y = y; n.z = z }
    }
  }
  return { ok: true }
}

/**
 * Merge a dataset-derived db into the player's recorded db.
 *
 * Zones are merged rather than replaced: a zone can legitimately hold both
 * recorded and dataset rooms, and dropping either side would lose part of the map.
 */
export function mergeSeed(recorded: MapDB, seed: MapDB): SeedResult {
  // Everything the player already has, by both handles.
  const haveId = new Set<string>()
  const haveUid = new Map<string, string>()   // uid → the recorded node's id
  for (const z of Object.values(recorded.zones)) {
    for (const id in z.nodes) {
      haveId.add(id)
      const u = z.nodes[id].uid
      if (u && !haveUid.has(u)) haveUid.set(u, id)
    }
  }

  const out: MapDB = { version: recorded.version, zones: { ...recorded.zones } }
  let added = 0, skipped = 0
  // Dataset node ids that we actually kept — arcs referencing a dropped node have
  // to be dropped too, or the graph gains edges pointing at rooms that aren't there.
  const kept = new Set<string>()
  // Dataset node id → recorded node id, for rooms the player already has under a
  // DIFFERENT id (uid matched but content drifted, so the ids don't collide).
  // Without this the dataset's arcs into those rooms would be dropped, severing
  // the map exactly at the boundary between explored and unexplored — the seam
  // that most needs to connect.
  const remap = new Map<string, string>()

  for (const sz of Object.values(seed.zones)) {
    const target: Zone = out.zones[sz.id]
      ? { ...out.zones[sz.id], nodes: { ...out.zones[sz.id].nodes }, arcs: [...out.zones[sz.id].arcs] }
      : { id: sz.id, name: sz.name, nodes: {}, arcs: [] }

    for (const id in sz.nodes) {
      const n = sz.nodes[id]
      if (haveId.has(id)) { skipped++; continue }
      const byUid = n.uid ? haveUid.get(n.uid) : undefined
      if (byUid) { remap.set(id, byUid); skipped++; continue }
      target.nodes[id] = n
      kept.add(id)
      added++
    }
    out.zones[sz.id] = target
  }

  // Second pass for arcs, so an arc is admitted only once both endpoints are known
  // to exist — kept from the seed, already recorded, or redirected onto the
  // recorded node that stood in for a skipped one.
  const resolve = (id: string): string | null => {
    const to = remap.get(id) ?? id
    return kept.has(to) || haveId.has(to) ? to : null
  }
  for (const sz of Object.values(seed.zones)) {
    const target = out.zones[sz.id]
    const seen = new Set(target.arcs.map(a => `${a.from}>${a.to}`))
    for (const a of sz.arcs) {
      const from = resolve(a.from), to = resolve(a.to)
      if (!from || !to || from === to) continue
      const k = `${from}>${to}`
      if (seen.has(k)) continue      // recorded arcs win; never duplicate one
      seen.add(k)
      target.arcs.push({ ...a, from, to })
    }
  }

  return { db: out, added, skipped, baked: false }
}

// A room the player has edited. Their annotation is recorded data even when the
// room itself came from the dataset, so it has to survive into their store.
const isAnnotated = (n: MapNode): boolean => !!(n.note || n.tag || n.color || n.pin)

/**
 * The part of a zone that belongs to the PLAYER — the only part their store may hold.
 *
 * Once seeded, a zone holds recorded and shipped rooms side by side, and every save
 * writes a whole zone. Without this filter the first step into a seeded area would
 * copy the entire shipped graph into the player's own files: tens of MB they never
 * walked, and — worse — the recorded/shipped distinction that mergeSeed relies on to
 * decide what wins would be gone, freezing today's dataset in place so later
 * corrections to it could never reach them.
 *
 * Arcs follow their endpoints: one whose room was dropped is dropped too, since it
 * would point at a room that is not in the file. Nothing real is lost — walking into
 * a shipped room promotes it to recorded (see observeRoom), so every link the player
 * has actually travelled has two surviving ends. Arcs leaving the zone are kept
 * regardless: their far end lives in another file and can't be judged from here.
 */
export function recordedZone(zone: Zone): Zone {
  const nodes: Record<string, MapNode> = {}
  const dropped = new Set<string>()
  for (const id in zone.nodes) {
    const n = zone.nodes[id]
    if (n.seed && !isAnnotated(n)) dropped.add(id)
    else nodes[id] = n
  }
  if (dropped.size === 0) return zone
  return { ...zone, nodes, arcs: zone.arcs.filter(a => !dropped.has(a.from) && !dropped.has(a.to)) }
}

// NOTE: there is deliberately no "keep only the shipped rooms" helper here.
//
// It looks like the natural inverse of recordedZone, and it is wrong: `seed` is not
// a durable marker of provenance. Walking into a shipped room clears it (see
// observeRoom's `delete n.seed`) precisely so the room can be written to the
// player's own store, which means an area they have actually travelled has no
// seed-flagged rooms left. Filtering on the flag there keeps nothing and deletes the
// town. "Clear zone" removes the zone and re-seeds instead — once the rooms are out
// of the recorded map, the dataset supplies them again.

// The built seed graph, kept after the first load. Clearing a zone has to put the
// shipped rooms back immediately (see reseed), and re-parsing ~19k rooms to do it
// would stall the UI on what should be an instant action.
let cachedSeed: MapDB | null = null

/**
 * Re-merge the shipped rooms into `recorded`, reusing the already-built seed.
 *
 * This is what makes "clear" honest. Seeded rooms are not part of the player's
 * store, so deleting a zone only removes what they recorded; the shipped rooms
 * would come back by themselves on the next launch. Re-seeding immediately means
 * the map they are looking at after a clear is the map they will get on restart,
 * rather than an empty view that silently repopulates later.
 *
 * A no-op when nothing has been seeded (web client, or no dataset packaged), so
 * clearing still empties the map exactly as it did before.
 */
export function reseed(recorded: MapDB): SeedResult {
  if (!cachedSeed) return { db: recorded, added: 0, skipped: 0, baked: false }
  return mergeSeed(recorded, cachedSeed)
}

/**
 * Re-merge the shipped rooms into a single zone that arrived from another window.
 *
 * Zone files hold only what the player recorded (see recordedZone), so a zone read
 * back off disk is a fill-only slice of what this window is displaying. Dropping it
 * in as-is would erase the shipped rooms from the open map until the next launch,
 * which is what makes this the counterpart of the persistence filter rather than an
 * optimisation. Scoped to one zone because it runs on every step another character
 * takes; a full reseed re-walks ~19k rooms and is far too slow for that.
 */
export function reseedZone(zone: Zone): Zone {
  const sz = cachedSeed?.zones[zone.id]
  if (!sz) return zone
  const one = (z: Zone): MapDB => ({ version: MAP_DB_VERSION, zones: { [z.id]: z } })
  return mergeSeed(one(zone), one(sz)).db.zones[zone.id] ?? zone
}

/** Whether a dataset was loaded — lets the UI word destructive actions honestly. */
export function hasSeed(): boolean {
  return cachedSeed !== null
}

/** Where the shipped dataset lives on the web build (see vite.web.config.ts). */
const WEB_DATA_BASE = 'map-data/dr-prime'

/**
 * Read the dataset from whichever transport this build has.
 *
 * Desktop hands it over IPC from the main process, which can read the packaged
 * resources directory. The web client has no main process, so it fetches the same
 * files over HTTP. Both return raw JSON text; everything downstream is identical.
 */
async function fetchDataset(): Promise<{ rooms: string | null; layouts: string | null }> {
  const api = window.dr?.map?.dataset
  if (api) return api()

  // Relative to the document, so this keeps working under a subpath deploy
  // (the PWA is served from /app/), matching the build's relative `base`.
  const get = async (name: string): Promise<string | null> => {
    try {
      const res = await fetch(new URL(`${WEB_DATA_BASE}/${name}`, document.baseURI).href)
      return res.ok ? await res.text() : null
    } catch {
      return null
    }
  }
  // Rooms first: without them the layouts are meaningless, and skipping the second
  // request when there's no dataset avoids a pointless 404 on every load.
  const rooms = await get('rooms.json')
  if (!rooms) return { rooms: null, layouts: null }
  return { rooms, layouts: await get('layouts.json') }
}

/**
 * Fetch the shipped dataset and merge it under `recorded`.
 * Returns the untouched db when no dataset is available (web client, or a package
 * built without one) — the map then behaves exactly as it did before.
 */
export async function seedFromDataset(recorded: MapDB): Promise<SeedResult> {
  const none: SeedResult = { db: recorded, added: 0, skipped: 0, baked: false }

  let raw: { rooms: string | null; layouts: string | null }
  try {
    raw = await fetchDataset()
  } catch (err) {
    console.warn('[map] dataset unavailable:', err)
    return none
  }
  if (!raw?.rooms) return none

  let doc: Dataset
  try {
    doc = JSON.parse(raw.rooms) as Dataset
  } catch (err) {
    console.error('[map] dataset is not valid JSON:', err)
    return { db: recorded, added: 0, skipped: 0, baked: false }
  }
  if (!isDataset(doc)) {
    console.error('[map] dataset failed its shape check; ignoring')
    return { db: recorded, added: 0, skipped: 0, baked: false }
  }

  const seed = mirrorArcs(datasetToDb(doc))

  let baked = false
  let staleReason: string | undefined
  if (raw.layouts) {
    try {
      const layouts = JSON.parse(raw.layouts) as BakedLayouts
      const res = applyBakedLayouts(seed, layouts, doc.roomsVersion)
      baked = res.ok
      staleReason = res.reason
    } catch (err) {
      console.warn('[map] baked layouts unreadable; laying out live:', err)
    }
  }

  // Hold the built graph (positions already applied) so a later clear can restore
  // the shipped rooms without re-parsing the dataset.
  cachedSeed = seed

  const merged = mergeSeed(recorded, seed)
  return { ...merged, baked, staleReason }
}
