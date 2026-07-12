/**
 * Automapper engine — pure graph operations over a MapDB.
 *
 * These functions never mutate their input; each returns a new DB (or a plain
 * result). The React hook (useAutomapper) owns the live DB and calls these to
 * fold in each observed room + movement, and to compute walk paths. Keeping them
 * pure means the whole recording/pathfinding core is testable in plain node.
 */

import {
  type MapDB, type Zone, type MapNode, type MapArc,
  emptyZone, roomSignature, makeNodeId, deriveZone, parseRoomUid,
  DIR_VECTORS, DIR_OPPOSITE,
} from './mapModel'

export interface RoomObservation {
  title:       string
  description: string
  exits:       string[]
  uid?:        string   // native DR room id (definitive identity when present)
}

// Locate a node by its native DR room id (the definitive identity when present).
export function findByUid(db: MapDB, uid: string): string | null {
  for (const z of Object.values(db.zones)) {
    for (const n of Object.values(z.nodes)) if (n.uid === uid) return n.id
  }
  return null
}

// Deep-ish clone of a single zone (nodes/arcs) so callers can mutate the copy.
function cloneZone(z: Zone): Zone {
  return {
    id: z.id, name: z.name,
    nodes: Object.fromEntries(Object.entries(z.nodes).map(([k, n]) => [k, { ...n }])),
    arcs: z.arcs.map(a => ({ ...a })),
  }
}

function withZone(db: MapDB, zone: Zone): MapDB {
  return { ...db, zones: { ...db.zones, [zone.id]: zone } }
}

// ── Matching ──────────────────────────────────────────────────────────────────
const normTitle = (t: string) => t.trim().toLowerCase()
const sameTitle = (a: string, b: string) => normTitle(a) === normTitle(b)

/**
 * Global content match, used only when we have NO movement context (first room
 * after connect, or a teleport) to relocate onto the existing map. Prefers an
 * exact title+desc+exits signature, then falls back to title+exits (descriptions
 * vary between visits — day/night, weather — so they can't be part of a reliable
 * relocation key). Deliberately NOT used during normal walking, where the movement
 * graph disambiguates far more reliably (see resolveExisting).
 */
export function matchRoom(db: MapDB, obs: RoomObservation): string | null {
  const zone = db.zones[deriveZone(obs.title).id]
  const sig  = roomSignature(obs.title, obs.description, obs.exits)
  const exitKey = [...new Set(obs.exits.map(e => e.trim().toLowerCase()))].sort().join(',')
  const scopes = zone ? [zone, ...Object.values(db.zones).filter(z => z !== zone)]
                      : Object.values(db.zones)
  let looseHit: string | null = null
  for (const z of scopes) {
    for (const n of Object.values(z.nodes)) {
      if (roomSignature(n.title, n.descriptions[0] ?? '', n.exits) === sig) return n.id
      if (!looseHit && sameTitle(n.title, obs.title)) {
        const nk = [...new Set(n.exits.map(e => e.trim().toLowerCase()))].sort().join(',')
        if (nk === exitKey) looseHit = n.id
      }
    }
  }
  return looseHit
}

const exitKey = (exits: string[]) =>
  [...new Set(exits.map(e => e.trim().toLowerCase()))].sort().join(',')

// The room we're standing in, given where we came from. This is how a mapper
// disambiguates rooms that share a title (a street) or whose description varies:
//   1. Arc-following — if the previous room already leads this way to a room with
//      the same title, we've simply walked that link again.
//   2. Position — a known room sitting at the exact cell this move lands on (prev +
//      direction) is that room, so loops close cleanly instead of duplicating.
//   3. Came-in-from — leaving a building/gate ("out", or a return `go`) has no
//      predictable direction and doesn't land on a grid cell, so match a known room
//      that leads INTO the one we just left and shares this room's title.
// If none resolve (a genuinely new room, or geometric drift), returns null so a new
// node is created. With no movement context, falls back to a global content match.
function resolveExisting(
  db: MapDB, obs: RoomObservation, from?: { id: string; dir: string; move?: string } | null,
): string | null {
  if (!from) return matchRoom(db, obs)
  const src = findNode(db, from.id)
  if (!src) return null
  const z = db.zones[src.zoneId]
  if (!z) return null

  // 1. Follow an existing arc that matches the way we travelled.
  for (const a of z.arcs) {
    if (a.from !== from.id) continue
    const dirHit  = from.dir !== 'special' && a.dir === from.dir
    const moveHit = !!from.move && a.move === from.move
    if (!dirHit && !moveHit) continue
    const dest = findNode(db, a.to)
    if (dest && sameTitle(dest.title, obs.title)) return dest.id
  }

  // 2. A known room at the exact cell this move lands on.
  const v = DIR_VECTORS[from.dir] ?? { dx: 1, dy: 0, dz: 0 }
  const ex = src.x + v.dx, ey = src.y + v.dy, ez = src.z + v.dz
  for (const n of Object.values(z.nodes)) {
    if (n.x === ex && n.y === ey && n.z === ez && sameTitle(n.title, obs.title)) return n.id
  }

  // 3. Returning out of a building/gate: a room that has an arc INTO the one we
  //    just left, matching this room's title (+ exits, preferred). Searches all
  //    zones because a gate can cross a zone boundary. This is what stops "out" /
  //    "go <gate>" from spawning a duplicate of the room you entered from. Limited
  //    to exit-style moves (out / non-compass `go`) so it never merges forward
  //    compass movement through same-titled corridor rooms.
  if (from.dir === 'special' || from.dir === 'out') {
    const wantExits = exitKey(obs.exits)
    let titleOnly: string | null = null
    for (const zz of Object.values(db.zones)) {
      for (const a of zz.arcs) {
        if (a.to !== from.id) continue
        const n = findNode(db, a.from)
        if (!n || !sameTitle(n.title, obs.title)) continue
        if (exitKey(n.exits) === wantExits) return a.from
        if (!titleOnly) titleOnly = a.from
      }
    }
    if (titleOnly) return titleOnly
  }
  return null   // a genuinely new (or drifted) room
}

// ── Recording ─────────────────────────────────────────────────────────────────
/**
 * Ensure a node exists for this observation, placing a freshly-created node
 * relative to `fromId` along `dir` when we know how we got here. Returns the
 * (possibly new) DB and the resolved node id.
 */
export function observeRoom(
  db: MapDB,
  obs: RoomObservation,
  from?: { id: string; dir: string; move?: string } | null,
): { db: MapDB; id: string } {
  const uid = obs.uid ?? parseRoomUid(obs.title) ?? undefined
  // The native DR room id is the definitive identity — it beats every content/graph
  // heuristic. Only without one do we fall back to resolveExisting.
  const existing = uid ? findByUid(db, uid) : resolveExisting(db, obs, from)
  const zoneInfo = deriveZone(obs.title)

  if (existing) {
    // Refresh mutable fields (exits change; description variants accumulate).
    const z = cloneZone(db.zones[nodeZoneId(db, existing)!])
    const n = z.nodes[existing]
    n.exits = obs.exits
    if (uid && !n.uid) n.uid = uid   // backfill id onto a node first recorded without one
    if (obs.description && !n.descriptions.includes(obs.description)) {
      n.descriptions = [...n.descriptions, obs.description].slice(0, 6)
    }
    return { db: withZone(db, z), id: existing }
  }

  // New node. Place it next to the source room along the travelled direction, or
  // at the origin when this is the first room we've seen.
  const zone = db.zones[zoneInfo.id]
    ? cloneZone(db.zones[zoneInfo.id])
    : emptyZone(zoneInfo.id, zoneInfo.name)

  const sig = roomSignature(obs.title, obs.description, obs.exits)
  const id  = uniqueId(db, makeNodeId(sig))

  let x = 0, y = 0, z = 0
  const src = from ? findNode(db, from.id) : null
  if (src) {
    const v = DIR_VECTORS[from!.dir] ?? { dx: 1, dy: 0, dz: 0 } // 'special' → step east
    x = src.x + v.dx; y = src.y + v.dy; z = src.z + v.dz
    ;({ x, y } = avoidCollision(zone, x, y, z))
  }

  zone.nodes[id] = {
    id, uid, zoneId: zone.id, title: obs.title,
    descHash: sig.split('|')[1] ?? '',
    descriptions: obs.description ? [obs.description] : [],
    exits: obs.exits, x, y, z,
  }
  return { db: withZone(db, zone), id }
}

/**
 * Record a directed arc fromId → toId with the literal move command. Also records
 * the reverse arc when the direction has a known opposite and none exists yet, so
 * the graph is walkable both ways after a single traversal. No-op if the arc is
 * already present. Arcs live in the source node's zone.
 */
export function recordArc(db: MapDB, fromId: string, toId: string, dir: string, move: string): MapDB {
  if (fromId === toId) return db
  const zid = nodeZoneId(db, fromId)
  if (!zid) return db
  const zone = cloneZone(db.zones[zid])

  const has = (f: string, t: string, mv: string) =>
    zone.arcs.some(a => a.from === f && a.to === t && a.move === mv)
  if (!has(fromId, toId, move)) zone.arcs.push({ from: fromId, to: toId, dir, move })

  let out = withZone(db, zone)
  const opp = DIR_OPPOSITE[dir]
  if (opp) {
    const back = nodeZoneId(out, toId)
    const already = back && out.zones[back].arcs.some(a => a.from === toId && a.to === fromId)
    if (back && !already) {
      const z2 = cloneZone(out.zones[back])
      z2.arcs.push({ from: toId, to: fromId, dir: opp, move: opp })
      out = withZone(out, z2)
    }
  }
  return out
}

// Compass directions that imply a fixed grid offset (used for snap-to-grid). In/out
// and 'special' are excluded — building interiors etc. don't sit on the street grid.
const SNAP_DIRS = new Set([
  'north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest', 'up', 'down',
])

/**
 * Re-derive every room's position in a zone from its compass-arc directions, so the
 * whole zone forms a consistent grid regardless of the order rooms were discovered.
 * BFS from a stable anchor (smallest id) following cardinal/diagonal/up-down arcs;
 * each room lands at its neighbour's cell + the direction offset. Cells that would
 * collide (non-Euclidean loops) spiral to the nearest free cell. Rooms connected
 * only by non-grid moves (in/out/go — bank interiors etc.) are then attached at a
 * small offset beside a positioned neighbour. Fully isolated rooms keep their
 * coords. This is what actually "squares up" a drifted map (single-room snapping
 * can't, because the target cells are already occupied).
 */
export function relayoutZone(zone: Zone): Zone {
  const ids = Object.keys(zone.nodes)
  if (ids.length <= 1) return zone

  const pos = new Map<string, { x: number; y: number; z: number }>()
  const occupied = new Set<string>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const place = (id: string, x: number, y: number, z: number) => {
    if (occupied.has(key(x, y, z))) ({ x, y, z } = nearestFreeCell(occupied, x, y, z))
    pos.set(id, { x, y, z }); occupied.add(key(x, y, z))
  }

  // Grid adjacency (compass arcs only). Reverse arcs are auto-recorded, so this
  // reaches the whole grid-connected component in either direction.
  const gridAdj = new Map<string, { to: string; dir: string }[]>()
  for (const a of zone.arcs) {
    if (!SNAP_DIRS.has(a.dir) || !zone.nodes[a.to]) continue
    const list = gridAdj.get(a.from) ?? []
    list.push({ to: a.to, dir: a.dir })
    gridAdj.set(a.from, list)
  }

  const anchor = ids.slice().sort()[0]
  place(anchor, 0, 0, 0)
  const queue = [anchor]
  while (queue.length) {
    const cur = queue.shift()!
    const cp = pos.get(cur)!
    for (const { to, dir } of gridAdj.get(cur) ?? []) {
      if (pos.has(to)) continue
      const v = DIR_VECTORS[dir]
      place(to, cp.x + v.dx, cp.y + v.dy, cp.z + v.dz)
      queue.push(to)
    }
  }

  // Attach non-grid-connected rooms (reached only via in/out/go) beside a
  // positioned neighbour, at a fractional offset so they don't sit on the grid.
  const anyArc = new Map<string, string[]>()
  for (const a of zone.arcs) {
    if (!zone.nodes[a.to]) continue
    ;(anyArc.get(a.from) ?? anyArc.set(a.from, []).get(a.from)!).push(a.to)
    ;(anyArc.get(a.to)   ?? anyArc.set(a.to,   []).get(a.to)!).push(a.from)
  }
  let progressed = true
  while (progressed) {
    progressed = false
    for (const id of ids) {
      if (pos.has(id)) continue
      const anchorN = (anyArc.get(id) ?? []).find(n => pos.has(n))
      if (!anchorN) continue
      const np = pos.get(anchorN)!
      let spot = { x: np.x + 0.6, y: np.y + 0.6, z: np.z }
      let i = 0
      while (occupied.has(key(spot.x, spot.y, spot.z)) && i < 8) {
        spot = { x: np.x + 0.6 + i * 0.4, y: np.y + 0.6 - i * 0.4, z: np.z }; i++
      }
      pos.set(id, spot); occupied.add(key(spot.x, spot.y, spot.z))
      progressed = true
    }
  }

  const nodes = { ...zone.nodes }
  for (const [id, p] of pos) nodes[id] = { ...nodes[id], x: p.x, y: p.y, z: p.z }
  return { ...zone, nodes }
}

/**
 * Build a single unified layout of the connected map around `rootId`, spanning zone
 * boundaries. DR splits one contiguous area across several title-derived zones
 * (e.g. "[Temple Hill, …]" vs "[Temple Hill Lane, …]"), which made the single-zone
 * view show disconnected clusters. This BFS's outward from the current room over
 * ALL arcs (any zone), laying rooms on one grid from their compass directions, so
 * the whole walkable neighbourhood renders as one connected map. Bounded by
 * `maxNodes` (nearest-first) so huge maps stay fast. Returns a synthetic zone for
 * the renderer; storage/identity/zones are untouched.
 */
export function componentLayout(db: MapDB, rootId: string | null, maxNodes = 2000): Zone {
  let root = rootId && findNode(db, rootId) ? rootId : null
  if (!root) {
    for (const z of Object.values(db.zones)) { const k = Object.keys(z.nodes)[0]; if (k) { root = k; break } }
  }
  if (!root) return { id: 'component', name: 'Map', nodes: {}, arcs: [] }
  const zoneName = db.zones[findNode(db, root)!.zoneId]?.name ?? 'Map'

  // Directed layout adjacency across every zone, BOTH ways per arc (a cardinal arc
  // auto-records its reverse; specials don't, so synthesize the reverse) — this lets
  // one BFS lay out the whole component from any anchor and grid-lay every compass
  // step wherever it occurs, not just from the root.
  const adj = new Map<string, { to: string; dir: string }[]>()
  const add = (f: string, t: string, d: string) => { (adj.get(f) ?? adj.set(f, []).get(f)!).push({ to: t, dir: d }) }
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      if (!findNode(db, a.to)) continue
      add(a.from, a.to, a.dir)
      add(a.to, a.from, DIR_OPPOSITE[a.dir] ?? 'special')
    }
  }

  // Gather the connected component around root (bounded, nearest-first), then lay it
  // out from a STABLE anchor (smallest id in the component) so the map doesn't shift
  // as you walk (the current room only changes the highlight, not the layout).
  const comp = new Set<string>([root])
  const gq = [root]
  while (gq.length && comp.size < maxNodes) {
    const c = gq.shift()!
    for (const { to } of adj.get(c) ?? []) if (!comp.has(to)) { comp.add(to); gq.push(to) }
  }
  const anchor = [...comp].sort()[0]

  const pos = new Map<string, { x: number; y: number; z: number }>()
  const occupied = new Set<string>()
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const place = (id: string, x: number, y: number, z: number) => {
    if (occupied.has(key(x, y, z))) ({ x, y, z } = nearestFreeCell(occupied, x, y, z))
    pos.set(id, { x, y, z }); occupied.add(key(x, y, z))
  }

  place(anchor, 0, 0, 0)
  const queue = [anchor]
  while (queue.length) {
    const cur = queue.shift()!
    const cp = pos.get(cur)!
    for (const { to, dir } of adj.get(cur) ?? []) {
      if (!comp.has(to) || pos.has(to)) continue
      if (SNAP_DIRS.has(dir)) {
        const v = DIR_VECTORS[dir]
        place(to, cp.x + v.dx, cp.y + v.dy, cp.z + v.dz)   // compass step → grid
      } else {
        place(to, cp.x + 0.5, cp.y + 0.5, cp.z)            // special hop (gate/in/out) → single off-grid step
      }
      queue.push(to)
    }
  }

  // Manual overrides: a hand-dragged room carries a `pin` (layout-space x/y).
  // Honour it — applied after auto-placement so tidied positions persist — while
  // keeping the auto-computed level (z). Tidy clears pins to revert to auto.
  for (const id of comp) {
    const n = findNode(db, id)
    if (n?.pin && pos.has(id)) { const p = pos.get(id)!; pos.set(id, { x: n.pin.x, y: n.pin.y, z: p.z }) }
  }

  const nodes: Record<string, MapNode> = {}
  for (const [id, p] of pos) { const n = findNode(db, id)!; nodes[id] = { ...n, x: p.x, y: p.y, z: p.z } }
  const arcs: MapArc[] = []
  for (const z of Object.values(db.zones)) for (const a of z.arcs) if (nodes[a.from] && nodes[a.to]) arcs.push(a)
  return { id: 'component', name: zoneName, nodes, arcs }
}

function nearestFreeCell(occupied: Set<string>, x: number, y: number, z: number): { x: number; y: number; z: number } {
  const key = (a: number, b: number) => `${a},${b},${z}`
  for (let r = 1; r <= 20; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
      if (!occupied.has(key(x + dx, y + dy))) return { x: x + dx, y: y + dy, z }
    }
  }
  return { x, y, z }
}

// ── Layout helpers ─────────────────────────────────────────────────────────────
// If the target grid cell (same z) is taken by another node, spiral outward to the
// nearest free cell so nodes never render exactly on top of each other.
function avoidCollision(zone: Zone, x: number, y: number, z: number): { x: number; y: number } {
  const taken = (cx: number, cy: number) =>
    Object.values(zone.nodes).some(n => n.z === z && n.x === cx && n.y === cy)
  if (!taken(x, y)) return { x, y }
  for (let r = 1; r <= 8; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue
      if (!taken(x + dx, y + dy)) return { x: x + dx, y: y + dy }
    }
  }
  return { x, y }
}

// ── Pathfinding ─────────────────────────────────────────────────────────────────
/**
 * Breadth-first shortest path (fewest moves) from one node to another over the
 * whole arc graph (arcs from every zone, so cross-zone routes work). Returns the
 * list of move commands to send, or null if unreachable. v1 is unweighted; the
 * arc shape already carries what a Dijkstra weighting would need later.
 */
export function findPath(db: MapDB, fromId: string, toId: string): string[] | null {
  if (fromId === toId) return []
  const adj = buildAdjacency(db)
  const prev = new Map<string, { node: string; move: string }>()
  const seen = new Set<string>([fromId])
  const queue: string[] = [fromId]

  while (queue.length) {
    const cur = queue.shift()!
    for (const edge of adj.get(cur) ?? []) {
      if (seen.has(edge.to)) continue
      seen.add(edge.to)
      prev.set(edge.to, { node: cur, move: edge.move })
      if (edge.to === toId) {
        const moves: string[] = []
        let n = toId
        while (n !== fromId) {
          const p = prev.get(n)!
          moves.unshift(p.move)
          n = p.node
        }
        return moves
      }
      queue.push(edge.to)
    }
  }
  return null
}

/**
 * Like findPath, but returns both the move commands and the node ids visited
 * (including endpoints) so the walk executor can verify it arrives at each
 * expected room before sending the next move. Returns null if unreachable.
 */
export function findRoute(db: MapDB, fromId: string, toId: string): { nodes: string[]; moves: string[] } | null {
  if (fromId === toId) return { nodes: [fromId], moves: [] }
  const adj = buildAdjacency(db)
  const prev = new Map<string, { node: string; move: string }>()
  const seen = new Set<string>([fromId])
  const queue: string[] = [fromId]
  while (queue.length) {
    const cur = queue.shift()!
    for (const edge of adj.get(cur) ?? []) {
      if (seen.has(edge.to)) continue
      seen.add(edge.to)
      prev.set(edge.to, { node: cur, move: edge.move })
      if (edge.to === toId) {
        const nodes: string[] = [toId]
        const moves: string[] = []
        let n = toId
        while (n !== fromId) {
          const p = prev.get(n)!
          moves.unshift(p.move)
          nodes.unshift(p.node)
          n = p.node
        }
        return { nodes, moves }
      }
      queue.push(edge.to)
    }
  }
  return null
}

function buildAdjacency(db: MapDB): Map<string, MapArc[]> {
  const adj = new Map<string, MapArc[]>()
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      if (!a.move) continue   // connectivity-only link (Lich-walked, unknown command) — not walkable
      const list = adj.get(a.from) ?? []
      list.push(a)
      adj.set(a.from, list)
    }
  }
  return adj
}

// ── Lookups ─────────────────────────────────────────────────────────────────────
export function findNode(db: MapDB, id: string): MapNode | null {
  for (const z of Object.values(db.zones)) if (z.nodes[id]) return z.nodes[id]
  return null
}

export function nodeZoneId(db: MapDB, id: string): string | null {
  for (const z of Object.values(db.zones)) if (z.nodes[id]) return z.id
  return null
}

function uniqueId(db: MapDB, base: string): string {
  if (!findNode(db, base)) return base
  let i = 2
  while (findNode(db, `${base}-${i}`)) i++
  return `${base}-${i}`
}
