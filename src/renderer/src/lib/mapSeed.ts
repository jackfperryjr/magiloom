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
import type { MapDB, MapNode, Zone } from './mapModel'

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

/** Whether a dataset was loaded — lets the UI word destructive actions honestly. */
export function hasSeed(): boolean {
  return cachedSeed !== null
}

/**
 * Fetch the shipped dataset and merge it under `recorded`.
 * Returns the untouched db when no dataset is available (web client, or a package
 * built without one) — the map then behaves exactly as it did before.
 */
export async function seedFromDataset(recorded: MapDB): Promise<SeedResult> {
  const api = window.dr?.map?.dataset
  if (!api) return { db: recorded, added: 0, skipped: 0, baked: false }

  let raw: { rooms: string | null; layouts: string | null }
  try {
    raw = await api()
  } catch (err) {
    console.warn('[map] dataset unavailable:', err)
    return { db: recorded, added: 0, skipped: 0, baked: false }
  }
  if (!raw?.rooms) return { db: recorded, added: 0, skipped: 0, baked: false }

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
