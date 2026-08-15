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

// The four moves a street actually runs along. A cardinal keeps one axis fixed, so
// following them first is what makes a road lay out as a straight line.
const CARDINALS = new Set(['north', 'south', 'east', 'west'])

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

// ── Area scoping ──────────────────────────────────────────────────────────────
/**
 * A room's neighbours *within the same walkable area*.
 *
 * An "area" is the unit a hand-drawn MUD map shows: one town's street grid, one
 * stretch of road, one building's interior — never the whole world at once. We
 * derive it from the arcs themselves:
 *
 *   - a COMPASS arc (n/s/e/w/diagonals, up/down) always stays inside the area —
 *     these are the moves that lay out on a grid;
 *   - a non-compass arc ("go gate", "out", an uncaptured Lich hop) stays inside
 *     only when both ends are in the SAME zone. Crossing a zone on a non-compass
 *     move is exactly the "you went through a door into somewhere else" case —
 *     a bank lobby, a guild hall, the wilderness past the gate — so it becomes an
 *     area EXIT rather than being crammed onto the street grid.
 *
 * The same-zone clause matters: DR records some street-to-street links with no
 * direction (Lich `;go2` moves server-side, so no "You go east." is ever seen).
 * Splitting on those would tear a town's grid in half at random.
 */
function areaNeighbours(
  adj: Map<string, { to: string; dir: string; move: string }[]>,
  zoneOf: Map<string, string>,
  from: string,
): { inside: { to: string; dir: string }[]; exits: { to: string; move: string }[] } {
  const inside: { to: string; dir: string }[] = []
  const exits: { to: string; move: string }[] = []
  for (const e of adj.get(from) ?? []) {
    if (SNAP_DIRS.has(e.dir) || zoneOf.get(from) === zoneOf.get(e.to)) inside.push({ to: e.to, dir: e.dir })
    else exits.push({ to: e.to, move: e.move })
  }
  return { inside, exits }
}

/** A connection that leaves the rendered area — drawn as a labelled portal marker. */
export interface AreaExit {
  fromId: string    // room inside the area that the link leaves from
  toId:   string    // room outside it
  move:   string    // the command that travels it ("go gate"); '' when never captured
  title:  string    // destination room title
  area:   string    // destination area (zone) name
}

export interface AreaLayout {
  zone:   Zone        // synthetic, positioned zone for the renderer
  exits:  AreaExit[]
  labels: StreetLabel[]   // street lettering, placed as part of the layout
  name:   string      // the area's display name
}

/**
 * A name lettered onto the map, in grid units. `minor` marks a one-room landmark
 * (a gate, a plaza) as opposed to a run of rooms sharing a street name — the
 * renderer letters those smaller and only once you're zoomed in enough to read them.
 */
export interface StreetLabel { text: string; x: number; y: number; vertical: boolean; z: number; minor: boolean }

// Roughly how many grid cells a label covers along its reading direction. Labels are
// ~9px in a 50px cell, so a character is about a tenth of a cell; the label needs
// that whole span clear, not just the cell its midpoint lands on.
const LABEL_CELLS = (text: string) => Math.max(1, Math.round(text.length * 0.095))

/**
 * Where each portal marker sits, in grid units — several exits can leave one room,
 * so they fan around it on a 45°-stepped ring instead of stacking. Shared by the
 * layout (which keeps labels off them) and the renderer (which draws them), so the
 * two can't disagree.
 */
export interface PortalPoint { exit: AreaExit; x: number; y: number; ax: number; ay: number }

const PORTAL_R = 0.62   // grid units from the room's centre

export function portalPoints(zone: Zone, exits: AreaExit[], level: number): PortalPoint[] {
  const byRoom = new Map<string, AreaExit[]>()
  for (const e of exits) {
    const n = zone.nodes[e.fromId]
    if (!n || n.z !== level) continue
    ;(byRoom.get(e.fromId) ?? byRoom.set(e.fromId, []).get(e.fromId)!).push(e)
  }
  const out: PortalPoint[] = []
  for (const [id, list] of byRoom) {
    const n = zone.nodes[id]
    list.forEach((exit, i) => {
      const angle = (-Math.PI / 4) + (i * Math.PI) / 4
      out.push({
        exit,
        x: n.x + Math.cos(angle) * PORTAL_R, y: n.y + Math.sin(angle) * PORTAL_R,
        ax: n.x, ay: n.y,
      })
    })
  }
  return out
}

// The same fan, but computed straight from the in-progress position map — the layout
// needs it before a Zone exists.
function portalCells(
  pos: Map<string, { x: number; y: number; z: number }>,
  rawExits: { fromId: string; toId: string; move: string }[],
  area: Set<string>,
  level: number,
): { x: number; y: number }[] {
  const byRoom = new Map<string, number>()
  const out: { x: number; y: number }[] = []
  const done = new Set<string>()
  for (const e of rawExits) {
    const p = pos.get(e.fromId)
    if (!p || p.z !== level || area.has(e.toId)) continue
    const k = `${e.fromId}|${e.toId}`
    if (done.has(k)) continue
    done.add(k)
    const i = byRoom.get(e.fromId) ?? 0
    byRoom.set(e.fromId, i + 1)
    const angle = (-Math.PI / 4) + (i * Math.PI) / 4
    out.push({ x: p.x + Math.cos(angle) * PORTAL_R, y: p.y + Math.sin(angle) * PORTAL_R })
  }
  return out
}

/**
 * Lay out the walkable AREA around `rootId` — the map you can read at a glance.
 *
 * Supersedes the old `componentLayout`, which drew the entire connected world (on
 * this user's DB: 1087 rooms across 208 zones in one view) from a sticky position
 * cache. Both parts were what made the map illegible:
 *
 *   - SCOPE. Everything reachable was inlined, so a town's grid, the roads out of
 *     it, and every shop interior overlapped in one sprawl. Scoping to the area
 *     (above) draws The Crossing as its own 69-room grid with 9 exits — the same
 *     unit a hand-drawn map shows.
 *   - THE CACHE. Positions were assigned on first sight and kept forever, so a room
 *     first reached by a long detour stayed where that detour put it; when a direct
 *     link turned up later it rendered as a line across the whole map. Measured on
 *     the real DB, carrying the cache took non-adjacent edges from 10% to 40% and
 *     the longest edge from 16 to 101 cells. Laying out fresh each render costs
 *     nothing at area scale and drops that to 2.9% / 11 cells across all 36 areas.
 *
 * Stability (what the cache was for) instead comes from a deterministic anchor —
 * the smallest id in the area — so the same rooms land on the same cells every
 * render, and the view recenters on the current room anyway. Hand-dragged `pin`s
 * still win over the computed position.
 */
export function areaLayout(db: MapDB, rootId: string | null, maxNodes = 600): AreaLayout {
  // Index every node once (id → node); findNode is a full scan, so doing it per
  // node inside the placement passes would be O(n²).
  const nodeIndex = new Map<string, MapNode>()
  const zoneOf = new Map<string, string>()
  for (const z of Object.values(db.zones)) {
    for (const id in z.nodes) { nodeIndex.set(id, z.nodes[id]); zoneOf.set(id, z.id) }
  }

  let root = rootId && nodeIndex.has(rootId) ? rootId : null
  if (!root) { for (const id of nodeIndex.keys()) { root = id; break } }
  if (!root) return { zone: { id: 'area', name: 'Map', nodes: {}, arcs: [] }, exits: [], labels: [], name: 'Map' }

  // Directed adjacency, BOTH ways per arc (a compass arc auto-records its reverse;
  // specials don't, so synthesize it) — one BFS can then grid-lay every compass
  // step wherever it occurs, not only those pointing away from the root.
  const adj = new Map<string, { to: string; dir: string; move: string }[]>()
  const add = (f: string, t: string, d: string, m: string) =>
    { (adj.get(f) ?? adj.set(f, []).get(f)!).push({ to: t, dir: d, move: m }) }
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      if (!nodeIndex.has(a.to) || !nodeIndex.has(a.from)) continue
      add(a.from, a.to, a.dir, a.move)
      add(a.to, a.from, DIR_OPPOSITE[a.dir] ?? 'special', '')   // reverse move is unknown
    }
  }

  // Gather the area (bounded, nearest-first) and collect the links that leave it.
  const area = new Set<string>([root])
  const rawExits: { fromId: string; toId: string; move: string }[] = []
  const gq = [root]
  while (gq.length && area.size < maxNodes) {
    const c = gq.shift()!
    const { inside, exits } = areaNeighbours(adj, zoneOf, c)
    for (const { to } of inside) if (!area.has(to)) { area.add(to); gq.push(to) }
    for (const { to, move } of exits) rawExits.push({ fromId: c, toId: to, move })
  }

  // ── Placement: BFS from a deterministic anchor, compass steps → grid offsets ──
  // The lattice pitch is constant, but rooms need not land on consecutive cells:
  // where the grid is crowded we OPEN a lattice line rather than shove a room
  // sideways, so a connector simply gets longer. That's how a drawn map handles a
  // busy junction, and it's what keeps every room's true bearing from its neighbours.
  const pos = new Map<string, { x: number; y: number; z: number }>()
  const cells = new Map<string, string>()          // cell key → node id
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const taken = (x: number, y: number, z: number) => cells.has(key(x, y, z))
  const reindex = () => { cells.clear(); for (const [id, p] of pos) cells.set(key(p.x, p.y, p.z), id) }

  /**
   * Slide every room at or beyond `at` along `axis` one lattice step outward,
   * leaving that line empty. Shifting a whole half-plane can't create a new overlap
   * (the moved and unmoved sets stay disjoint) and it preserves every direction
   * relationship — "east of" survives a shift. All it changes is how far apart
   * things sit, which is exactly the freedom we want.
   */
  const openLine = (axis: 'x' | 'y', at: number, sign: number) => {
    for (const p of pos.values()) {
      if (sign > 0 ? p[axis] >= at : p[axis] <= at) p[axis] += sign
    }
    reindex()
  }

  const place = (id: string, x: number, y: number, z: number, from?: { x: number; y: number }) => {
    if (taken(x, y, z)) {
      // Open the grid along the axis we actually travelled, so the room still lands
      // in the direction you walked — just further out.
      const dx = from ? Math.sign(x - from.x) : 0
      const dy = from ? Math.sign(y - from.y) : 0
      if (dx) openLine('x', x, dx)
      if (taken(x, y, z) && dy) openLine('y', y, dy)
      // Pure up/down has no axis to open on (the clash is on another level), so the
      // old sideways nudge remains the last resort.
      if (taken(x, y, z)) ({ x, y, z } = nearestFreeCell(cells, x, y, z))
    }
    pos.set(id, { x, y, z }); cells.set(key(x, y, z), id)
  }

  // Hand-dragged pins are a deliberate user override — seed them first so the
  // computed layout flows around them instead of over them.
  for (const id of area) {
    const n = nodeIndex.get(id)
    if (n?.pin) place(id, n.pin.x, n.pin.y, n.z ?? 0)
  }
  if (pos.size === 0) place([...area].sort()[0], 0, 0, 0)

  /**
   * A room is placed by ONE of the moves that reach it, and that move decides where
   * it lands; every other link into it then just draws to wherever it ended up. A
   * plain queue lets whichever move happens to arrive first win, which is arbitrary
   * — and when the winner is a side street, the through street it belonged to comes
   * out bent. (Real case: Clanthew Boulevard #10062 →east→ #10063 is a clean east
   * move, but #10063 got placed off Via Iltesh first, so the boulevard kinked up a
   * row and the east arc drew as a diagonal.)
   *
   * So candidates are ranked, and the best one places the room. Running a street to
   * its end before branching keeps it straight, and pushes the slack onto the link
   * BETWEEN streets — which is what a drawn map does: streets stay straight and one
   * cross-connector runs long.
   */
  const rank = (from: string, to: string, dir: string): number => {
    if (!SNAP_DIRS.has(dir)) return 4                       // undirected hop — last
    if (dir === 'up' || dir === 'down') return 3            // no bearing on this level
    if (!CARDINALS.has(dir)) return 2                       // diagonal
    // A cardinal move between two rooms of the same name IS the street — follow it
    // first so the whole run lands on one line.
    const a = nodeIndex.get(from), b = nodeIndex.get(to)
    return a && b && stripArea(a.title) === stripArea(b.title) ? 0 : 1
  }

  // Directions recovered by elimination from the rooms' obvious paths, so the layout
  // places a command-less link as well as the router replays one. Arcs are stored one
  // way round, so a link may have been inferred from the far end — flip it if so.
  const inferred = inferMoves(db)
  const inferredDir = (from: string, to: string): string | null => {
    const fwd = inferred.get(`${from}|${to}`)
    if (fwd && DIR_VECTORS[fwd]) return fwd
    const rev = inferred.get(`${to}|${from}`)
    const back = rev ? DIR_OPPOSITE[rev] : undefined
    return back && DIR_VECTORS[back] ? back : null
  }

  const frontier: { from: string; to: string; dir: string }[][] = [[], [], [], [], []]
  const offer = (from: string) => {
    for (const { to, dir } of areaNeighbours(adj, zoneOf, from).inside) {
      if (!area.has(to) || pos.has(to)) continue
      frontier[rank(from, to, dir)].push({ from, to, dir })
    }
  }
  for (const id of [...pos.keys()]) offer(id)

  for (;;) {
    let job: { from: string; to: string; dir: string } | undefined
    for (const bucket of frontier) {
      while (bucket.length && pos.has(bucket[0].to)) bucket.shift()   // already placed
      if (bucket.length) { job = bucket.shift(); break }
    }
    if (!job) break
    // Re-read: placing a sibling may have opened a line and moved the source.
    const cp = pos.get(job.from)!
    if (SNAP_DIRS.has(job.dir)) {
      const v = DIR_VECTORS[job.dir]
      place(job.to, cp.x + v.dx, cp.y + v.dy, cp.z + v.dz, cp)   // compass step → grid cell
    } else {
      // A hop we watched someone take without seeing which way they went. The room
      // still has to go SOMEWHERE, and dropping it one cell east — the old fallback —
      // is a guess that quietly shoves whole neighbourhoods sideways: everything
      // hanging off that link inherits the offset, so a block can end up streets away
      // from where it belongs, or laid across one.
      //
      // The room's own obvious paths usually settle it. If exactly one of them is
      // unaccounted for by any other link out of this room, that IS the way we went —
      // the same reasoning the router uses to replay these links (see inferMoves).
      const guess = inferredDir(job.from, job.to)
      const v = guess ? DIR_VECTORS[guess] : null
      if (v) place(job.to, cp.x + v.dx, cp.y + v.dy, cp.z + v.dz, cp)
      else place(job.to, cp.x + 1, cp.y, cp.z, cp)
    }
    offer(job.to)
  }
  // A pinned room whose area is otherwise unreachable from it still needs placing.
  for (const id of area) if (!pos.has(id)) place(id, 0, 0, nodeIndex.get(id)?.z ?? 0)

  // ── Lettering: give each street a clear lane, opening the grid when there isn't one
  // A drawn map leaves room for its own labels — that's most of why it reads at a
  // glance. So street names are placed as part of the LAYOUT, not squeezed into
  // whatever cell happens to be spare afterwards: a street that can't find a clear
  // lane gets one opened for it, and the connectors crossing that line stretch by a
  // cell. Longest streets go first, since they're the map's landmarks.
  const labels: StreetLabel[] = []
  const reserved = new Set<string>()
  const cellKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`

  const levelsPresent = [...new Set([...pos.values()].map(p => p.z))].sort((a, b) => a - b)
  for (const lvl of levelsPresent) {
    const groups = new Map<string, string[]>()
    for (const id of pos.keys()) {
      if (pos.get(id)!.z !== lvl) continue
      const name = stripArea(nodeIndex.get(id)!.title)
      if (name) (groups.get(name) ?? groups.set(name, []).get(name)!).push(id)
    }
    // Longest runs first — they're the map's landmarks, so they get first pick of the
    // clear space. One-room names (gates, plazas, squares) come last and fill in
    // wherever there's still room; the reference map letters those too, and they're
    // most of how you recognise where you are.
    const ordered = [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))

    // A room's own square blocks a label; so does a portal ring hanging off it.
    const blocked = () => {
      const s = new Set<string>()
      for (const [, p] of pos) if (p.z === lvl) s.add(cellKey(p.x, p.y))
      for (const p of portalCells(pos, rawExits, area, lvl)) s.add(cellKey(p.x, p.y))
      return s
    }

    for (const [text, ids] of ordered) {
      const box = () => {
        const ps = ids.map(i => pos.get(i)!)
        return {
          minX: Math.min(...ps.map(p => p.x)), maxX: Math.max(...ps.map(p => p.x)),
          minY: Math.min(...ps.map(p => p.y)), maxY: Math.max(...ps.map(p => p.y)),
        }
      }
      const b = box()
      const vertical = (b.maxY - b.minY) > (b.maxX - b.minX)
      const spanCells = (x: number, y: number) => {
        const half = LABEL_CELLS(text) / 2
        const out: string[] = []
        for (let d = -half; d <= half; d += 1) out.push(vertical ? cellKey(x, y + d) : cellKey(x + d, y))
        return out
      }
      // Beside the run first, then progressively further off and along it. A street
      // name a little way from its road still reads, because the road is a long
      // shape you can trace back to. A single room's name can't afford that — at two
      // cells out it's just floating text pointing at nothing — so landmarks only
      // ever letter immediately alongside their square, or not at all.
      const reach = ids.length >= 2 ? [1, 2, 3] : [1]
      const candidates = (bb: typeof b): [number, number][] => {
        const cx = (bb.minX + bb.maxX) / 2, cy = (bb.minY + bb.maxY) / 2
        const out: [number, number][] = []
        for (const d of reach) {
          if (vertical) out.push([bb.minX - d, cy], [bb.maxX + d, cy], [bb.minX - d, cy - 1], [bb.maxX + d, cy + 1])
          else out.push([cx, bb.maxY + d], [cx, bb.minY - d], [cx - 1, bb.maxY + d], [cx + 1, bb.minY - d])
        }
        return out
      }
      const free = (spot: [number, number]) => {
        const bl = blocked()
        return spanCells(spot[0], spot[1]).every(k => !bl.has(k) && !reserved.has(k))
      }

      // Labels never move rooms. Opening a lane for one stretches every connector
      // that crosses it, which turns a compact junction into a fan of long diagonals
      // — the exact mess this whole rewrite is meant to remove. So lettering takes
      // the space that's actually free, and a street with nowhere legible to put its
      // name simply goes unlettered (the name is still in the room's tooltip).
      const spot = candidates(b).find(free)
      if (!spot) continue
      for (const k of spanCells(spot[0], spot[1])) reserved.add(k)
      labels.push({ text, x: spot[0], y: spot[1], vertical, z: lvl, minor: ids.length < 2 })
    }
  }

  const nodes: Record<string, MapNode> = {}
  for (const [id, p] of pos) { const n = nodeIndex.get(id)!; nodes[id] = { ...n, x: p.x, y: p.y, z: p.z } }
  const arcs: MapArc[] = []
  for (const z of Object.values(db.zones)) for (const a of z.arcs) if (nodes[a.from] && nodes[a.to]) arcs.push(a)

  // One portal per destination room; prefer the variant that captured a real move
  // command, since that's what we can label it with (and walk with).
  const byPair = new Map<string, AreaExit>()
  for (const e of rawExits) {
    if (!nodes[e.fromId] || area.has(e.toId)) continue
    const dest = nodeIndex.get(e.toId); if (!dest) continue
    const k = `${e.fromId}|${e.toId}`
    const prev = byPair.get(k)
    if (prev && (prev.move || !e.move)) continue
    byPair.set(k, {
      fromId: e.fromId, toId: e.toId, move: e.move,
      title: stripArea(dest.title),
      area: db.zones[zoneOf.get(e.toId)!]?.name ?? '',
    })
  }

  const name = areaName(db, nodes)
  return { zone: { id: 'area', name, nodes, arcs }, exits: [...byPair.values()], labels, name }
}

// The area's display name: the zone most of its rooms belong to. An area can span
// several title-derived zones (DR splits "[Temple Hill, …]" from "[Temple Hill
// Lane, …]"), so the majority zone names it better than the root's does.
function areaName(db: MapDB, nodes: Record<string, MapNode>): string {
  const tally = new Map<string, number>()
  for (const id in nodes) {
    const zn = db.zones[nodes[id].zoneId]?.name
    if (zn) tally.set(zn, (tally.get(zn) ?? 0) + 1)
  }
  let best = 'Map', bestN = 0
  for (const [n, c] of tally) if (c > bestN) { best = n; bestN = c }
  return best
}

/**
 * The room's own name, with the leading area segment dropped:
 *   "[The Crossing, Clanthew Boulevard]" → "Clanthew Boulevard"
 * This is what a drawn map letters onto the grid — the street, not the town.
 */
export function stripArea(title: string): string {
  const m = title.match(/^\[[^,\]]+,\s*(.+)\]$/)
  if (m) return m[1].trim()
  return title.replace(/^\[|\]$/g, '').trim()
}

/**
 * Every distinct area in the DB, largest first — the "browse maps" list. Each entry
 * carries a representative room id the caller can root a layout on.
 */
export function listAreas(db: MapDB): { id: string; name: string; rooms: number }[] {
  const nodeIndex = new Map<string, MapNode>()
  const zoneOf = new Map<string, string>()
  for (const z of Object.values(db.zones)) {
    for (const id in z.nodes) { nodeIndex.set(id, z.nodes[id]); zoneOf.set(id, z.id) }
  }
  const adj = new Map<string, { to: string; dir: string; move: string }[]>()
  const add = (f: string, t: string, d: string, m: string) =>
    { (adj.get(f) ?? adj.set(f, []).get(f)!).push({ to: t, dir: d, move: m }) }
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      if (!nodeIndex.has(a.to) || !nodeIndex.has(a.from)) continue
      add(a.from, a.to, a.dir, a.move)
      add(a.to, a.from, DIR_OPPOSITE[a.dir] ?? 'special', '')
    }
  }

  const done = new Set<string>()
  const out: { id: string; name: string; rooms: number }[] = []
  for (const start of nodeIndex.keys()) {
    if (done.has(start)) continue
    const seen = new Set<string>([start])
    const q = [start]
    while (q.length) {
      const c = q.shift()!
      for (const { to } of areaNeighbours(adj, zoneOf, c).inside) if (!seen.has(to)) { seen.add(to); q.push(to) }
    }
    const nodes: Record<string, MapNode> = {}
    for (const id of seen) { done.add(id); nodes[id] = nodeIndex.get(id)! }
    out.push({ id: [...seen].sort()[0], name: areaName(db, nodes), rooms: seen.size })
  }
  return out.sort((a, b) => b.rooms - a.rooms || a.name.localeCompare(b.name))
}

function nearestFreeCell(occupied: { has(k: string): boolean }, x: number, y: number, z: number): { x: number; y: number; z: number } {
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

// Directions, in the abbreviations DR's obvious-paths list may use.
const EXIT_ALIAS: Record<string, string> = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest', u: 'up', d: 'down',
}
const canonExit = (s: string) => { const t = s.trim().toLowerCase(); return EXIT_ALIAS[t] ?? t }

/**
 * Recover the command for a link we traversed without seeing how.
 *
 * The game hands us a room's obvious paths every time we walk in, so a link out of
 * A whose command we never captured has to be one of A's exits that no OTHER link
 * out of A already explains. One exit left over means we've identified it. Several
 * left over is usually still decidable from the far side: the exit whose OPPOSITE is
 * an unexplained exit of B is the one that joins A to B.
 *
 * Deliberately derived at route time rather than baked into storage, so it keeps
 * improving on maps recorded before this existed — every newly-walked exit narrows
 * what's left over for its neighbours.
 */
function inferMoves(db: MapDB): Map<string, string> {
  const nodes = new Map<string, MapNode>()
  for (const z of Object.values(db.zones)) for (const id in z.nodes) nodes.set(id, z.nodes[id])

  const knownMove = (a: MapArc) => a.move || (a.dir && a.dir !== 'special' ? a.dir : '')
  const explained = new Map<string, Set<string>>()
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      const m = knownMove(a)
      if (m) (explained.get(a.from) ?? explained.set(a.from, new Set()).get(a.from)!).add(canonExit(m))
    }
  }
  const spare = (id: string) => {
    const used = explained.get(id) ?? new Set<string>()
    return (nodes.get(id)?.exits ?? []).map(canonExit).filter(e => !used.has(e))
  }

  const out = new Map<string, string>()
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      if (knownMove(a)) continue
      const cands = spare(a.from)
      if (cands.length === 1) { out.set(a.from + '|' + a.to, cands[0]); continue }
      if (cands.length > 1) {
        const back = new Set(spare(a.to))
        const fits = cands.filter(c => DIR_OPPOSITE[c] && back.has(DIR_OPPOSITE[c]))
        if (fits.length === 1) out.set(a.from + '|' + a.to, fits[0])
      }
    }
  }
  return out
}

/**
 * When a walk can't be routed, name the link that broke it: the first connection on
 * the DRAWN path whose command was never captured. That's the one to walk by hand —
 * doing so records the command and repairs every route through it permanently.
 * Returns null when the two rooms simply aren't connected on the map at all.
 */
export function firstUnwalkableLink(db: MapDB, fromId: string, toId: string): string | null {
  const nodes = new Map<string, MapNode>()
  for (const z of Object.values(db.zones)) for (const id in z.nodes) nodes.set(id, z.nodes[id])
  const walkable = buildAdjacency(db)
  const canWalk = (f: string, t: string) => (walkable.get(f) ?? []).some(e => e.to === t)

  // Undirected adjacency over every arc — what the map draws, walkable or not.
  const drawn = new Map<string, string[]>()
  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      if (!nodes.has(a.from) || !nodes.has(a.to)) continue
      ;(drawn.get(a.from) ?? drawn.set(a.from, []).get(a.from)!).push(a.to)
      ;(drawn.get(a.to)   ?? drawn.set(a.to,   []).get(a.to)!).push(a.from)
    }
  }

  const prev = new Map<string, string>()
  const seen = new Set([fromId])
  const q = [fromId]
  while (q.length) {
    const c = q.shift()!
    if (c === toId) {
      const path: string[] = []
      for (let n: string | undefined = toId; n; n = prev.get(n)) path.unshift(n)
      for (let i = 0; i + 1 < path.length; i++) {
        if (!canWalk(path[i], path[i + 1])) {
          return `${stripArea(nodes.get(path[i])!.title)} → ${stripArea(nodes.get(path[i + 1])!.title)}`
        }
      }
      return null
    }
    for (const t of drawn.get(c) ?? []) if (!seen.has(t)) { seen.add(t); prev.set(t, c); q.push(t) }
  }
  return null
}

function buildAdjacency(db: MapDB): Map<string, MapArc[]> {
  const adj = new Map<string, MapArc[]>()
  const push = (from: string, arc: MapArc) => {
    const list = adj.get(from) ?? []
    list.push(arc)
    adj.set(from, list)
  }
  // Directed (from|to) pairs that actually exist, so we only synthesize a reverse
  // edge where the map doesn't already record one.
  const pairs = new Set<string>()
  for (const z of Object.values(db.zones)) for (const a of z.arcs) pairs.add(a.from + '|' + a.to)
  const inferred = inferMoves(db)

  for (const z of Object.values(db.zones)) {
    for (const a of z.arcs) {
      // Walkable command: the recorded move, else the direction word — DR accepts a
      // bare compass/up/down/in/out as a movement command, so a connectivity-only
      // arc (no captured command) is still walkable when its direction is known.
      // Failing both, an exit we can pin down by elimination (see inferMoves).
      const move = a.move || (a.dir && a.dir !== 'special' ? a.dir : '')
        || (inferred.get(a.from + '|' + a.to) ?? '')
      if (move) push(a.from, { ...a, move })
      // Synthesize the return trip for standard directions when the map only recorded
      // one way (common in imported maps), so a corridor is walkable both ways. If the
      // reverse move is actually blocked, the walk executor stops when it doesn't arrive.
      const opp = DIR_OPPOSITE[a.dir]
      if (opp && !pairs.has(a.to + '|' + a.from)) {
        push(a.to, { from: a.to, to: a.from, dir: opp, move: opp })
      }
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
