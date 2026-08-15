/**
 * Prebaked room dataset → MapDB.
 *
 * The automapper builds its graph by walking, so a fresh install starts blank and
 * every player only ever has the rooms they personally visited. The dataset is the
 * other half: a whole-game room graph, generated offline by scripts/build-rooms.js
 * and shipped with the app. This module is the seam between the two — it turns
 * that flat file into the same MapDB shape live mapping produces, so everything
 * downstream (layout, routing, rendering) is unaware of where a room came from.
 *
 * The join is the delicate part. A room recorded live and the same room from the
 * dataset have to end up as ONE node, and there are two independent handles:
 *
 *   • uid — the game's native room number. Definitive, but only ~20% of dataset
 *     rooms carry one, because DR exposed room ids long after the community crawl
 *     this data comes from began.
 *   • content — title + description hash + obvious exits. This is why node ids are
 *     minted with makeNodeId(roomSignature(...)), exactly as recordRoom does for a
 *     live observation: the same room seen either way lands on the same id without
 *     anyone having to reconcile them.
 *
 * Coverage improves on its own — mapper.ts backfills a uid onto a node the first
 * time live play observes one, so rooms that started content-matched acquire the
 * definitive handle over time.
 *
 * Pure (no React, no IPC, no DOM), so the layout baker can run it under plain node.
 */

import {
  emptyDb, emptyZone, roomSignature, makeNodeId, deriveZone, hashDesc,
  DIR_OPPOSITE,
  type MapDB, type MapNode, type MapArc, type Zone,
} from './mapModel'

/** One room as stored in rooms.json. Keys are short — this file ships to users. */
export interface DatasetRoom {
  id:   number      // crawler-assigned room id; the key `x` targets reference
  uid?: number[]    // native DR room id(s); absent for most rooms, plural when instanced
  t:    string      // title, e.g. "[The Crossing, Town Square]"
  desc: string
  h:    string      // precomputed description hash (hashDesc(desc))
  e?:   string[]    // obvious paths, as the stream reports them
  loc?: string      // coarse region ("Muspar'i Gate")
  x:    [number, string, string][]   // [destination id, literal move, canonical dir]
  w?:   Record<string, number>       // destination id → traversal seconds
  rf?:  string[]                     // room tags ("town", "protected")
}

export interface Dataset {
  instance:     string
  source:       string
  generated:    number
  roomsVersion: string
  rooms:        DatasetRoom[]
}

/** Edges we can draw but must never route through — see build-rooms.js. */
export const UNROUTABLE_DIR = 'unknown'

export function isDataset(v: unknown): v is Dataset {
  const d = v as Dataset | null
  return !!d && typeof d.roomsVersion === 'string' && Array.isArray(d.rooms)
}

/**
 * Build a MapDB from a dataset. Nodes land at the origin — the dataset carries no
 * coordinates, because positions are the layout's job (baked by bake-layouts.js or
 * computed live by areaLayout), not the graph's.
 */
export function datasetToDb(doc: Dataset): MapDB {
  const db = emptyDb()
  const zones: Record<string, Zone> = {}
  // Crawler room id → the node id we minted for it, so `x` targets can be resolved
  // in a second pass once every node exists.
  const nodeIdOf = new Map<number, string>()
  const taken = new Set<string>()

  for (const r of doc.rooms) {
    const zi = deriveZone(r.t)
    const zone = (zones[zi.id] ??= emptyZone(zi.id, zi.name))

    // Same derivation recordRoom uses, so a live sighting of this room collides
    // onto this id rather than creating a duplicate.
    const sig = roomSignature(r.t, r.desc, r.e ?? [])
    let id = makeNodeId(sig)
    // Genuinely distinct rooms CAN share content (identical wilderness rooms are
    // common). Suffix rather than merge: they are different rooms with different
    // exits, and collapsing them would weld unrelated parts of the graph together.
    if (taken.has(id)) {
      let n = 2
      while (taken.has(`${id}-${n}`)) n++
      id = `${id}-${n}`
    }
    taken.add(id)
    nodeIdOf.set(r.id, id)

    const node: MapNode = {
      id,
      zoneId: zone.id,
      title: r.t,
      descHash: r.h || hashDesc(r.desc),
      descriptions: r.desc ? [r.desc] : [],
      exits: r.e ?? [],
      x: 0, y: 0, z: 0,
    }
    // MapNode carries a single uid; an instanced room's extra uids are dropped
    // here rather than modelled, since identity only needs one definitive handle.
    if (r.uid?.length) node.uid = String(r.uid[0])
    zone.nodes[id] = node
  }

  // Second pass: edges, now that every destination has an id.
  for (const r of doc.rooms) {
    const fromId = nodeIdOf.get(r.id)
    if (!fromId) continue
    const zone = zones[deriveZone(r.t).id]
    for (const [to, move, dir] of r.x) {
      const toId = nodeIdOf.get(to)
      if (!toId || toId === fromId) continue
      zone.arcs.push({ from: fromId, to: toId, dir, move })
    }
  }

  db.zones = zones
  return db
}

/**
 * Index a dataset by uid for the definitive-identity lookup, and by content
 * signature for everything else. Built once and reused; scanning 18k rooms per
 * room transition would be far too slow.
 */
export interface DatasetIndex {
  byUid: Map<string, DatasetRoom>
  bySig: Map<string, DatasetRoom>
}

export function indexDataset(doc: Dataset): DatasetIndex {
  const byUid = new Map<string, DatasetRoom>()
  const bySig = new Map<string, DatasetRoom>()
  for (const r of doc.rooms) {
    for (const u of r.uid ?? []) byUid.set(String(u), r)
    const sig = roomSignature(r.t, r.desc, r.e ?? [])
    // First writer wins: on a content collision neither room is more correct, and
    // a stable choice beats one that depends on file order.
    if (!bySig.has(sig)) bySig.set(sig, r)
  }
  return { byUid, bySig }
}

/**
 * Reverse arcs the crawl only ever walked one way. A one-way arc in the data
 * usually means nobody happened to walk back, not that the link is genuinely
 * one-way, and a map missing half its links lays out badly and routes worse.
 * Only mirrors directions with a known opposite, and never invents a move for an
 * unroutable edge.
 */
export function mirrorArcs(db: MapDB): MapDB {
  for (const zone of Object.values(db.zones)) {
    const seen = new Set(zone.arcs.map(a => `${a.from}>${a.to}`))
    const added: MapArc[] = []
    for (const a of zone.arcs) {
      const opp = DIR_OPPOSITE[a.dir]
      if (!opp || a.dir === UNROUTABLE_DIR) continue
      if (seen.has(`${a.to}>${a.from}`)) continue
      seen.add(`${a.to}>${a.from}`)
      added.push({ from: a.to, to: a.from, dir: opp, move: opp })
    }
    zone.arcs.push(...added)
  }
  return db
}
