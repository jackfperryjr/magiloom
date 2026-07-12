/**
 * Automapper data model + pure helpers.
 *
 * DragonRealms' StormFront stream carries NO stable numeric room id (the <nav>
 * tag is emitted but empty for DR), so a room's identity has to be derived from
 * its content: title + a hash of its description + its obvious exits. This is the
 * same signature approach Genie's DR maps use. Everything here is pure (no React,
 * no IPC, no DOM) so it can be unit-tested with a plain node harness.
 */

// ── Types ───────────────────────────────────────────────────────────────────
export interface MapNode {
  id:           string     // internal id we assign (server provides none)
  uid?:         string     // native DR room id (definitive identity when present)
  zoneId:       string
  title:        string     // room name (tag stripped)
  descHash:     string     // FNV-1a of the normalized description — identity core
  descriptions: string[]   // known description variants (weather/time can alter one room)
  exits:        string[]   // last-seen obvious paths
  x:            number      // layout coords, in grid units
  y:            number
  z:            number      // level (up/down change this)
  note?:        string      // freeform user note
  tag?:         string      // short waypoint label drawn on the node
  color?:       string      // node accent (room type / user highlight)
  pin?:         { x: number; y: number }  // manual layout override (drag-to-place); Tidy clears it
}

export interface MapArc {
  from:    string
  to:      string
  dir:     string           // canonical direction (north…/up/down) or 'special'
  move:    string           // literal command to send ("north", "go gate", "climb wall")
  hidden?: boolean          // exit not shown in obvious paths (e.g. a searched passage)
}

export interface Zone {
  id:    string
  name:  string
  nodes: Record<string, MapNode>
  arcs:  MapArc[]
}

export interface MapDB {
  version: number
  zones:   Record<string, Zone>
}

export const MAP_DB_VERSION = 1

export function emptyDb(): MapDB {
  return { version: MAP_DB_VERSION, zones: {} }
}

export function emptyZone(id: string, name: string): Zone {
  return { id, name, nodes: {}, arcs: [] }
}

// ── Directions ──────────────────────────────────────────────────────────────
// Canonical direction → unit grid offset (screen coords: +y is DOWN). Diagonals
// combine cardinals. up/down move a level (dz) with a small xy nudge so a stacked
// room doesn't render exactly on top of the one below it.
export interface DirVec { dx: number; dy: number; dz: number }

export const DIR_VECTORS: Record<string, DirVec> = {
  north:     { dx:  0, dy: -1, dz: 0 },
  south:     { dx:  0, dy:  1, dz: 0 },
  east:      { dx:  1, dy:  0, dz: 0 },
  west:      { dx: -1, dy:  0, dz: 0 },
  northeast: { dx:  1, dy: -1, dz: 0 },
  northwest: { dx: -1, dy: -1, dz: 0 },
  southeast: { dx:  1, dy:  1, dz: 0 },
  southwest: { dx: -1, dy:  1, dz: 0 },
  up:        { dx:  1, dy: -1, dz:  1 },
  down:      { dx: -1, dy:  1, dz: -1 },
  out:       { dx:  0, dy:  1, dz: 0 },
  in:        { dx:  0, dy: -1, dz: 0 },
}

// Opposite of each canonical direction (for recording the return arc when we
// only observed one way). 'special'/unknown have no reliable opposite.
export const DIR_OPPOSITE: Record<string, string> = {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast',
  northwest: 'southeast', southeast: 'northwest',
  up: 'down', down: 'up', out: 'in', in: 'out',
}

// Abbreviations → canonical direction.
const DIR_ALIAS: Record<string, string> = {
  n: 'north', s: 'south', e: 'east', w: 'west',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  u: 'up', d: 'down',
  north: 'north', south: 'south', east: 'east', west: 'west',
  northeast: 'northeast', northwest: 'northwest',
  southeast: 'southeast', southwest: 'southwest',
  up: 'up', down: 'down', out: 'out', in: 'in',
}

/**
 * Classify an outbound command as movement, returning its canonical direction (or
 * 'special' for non-cardinal travel like "go gate" / "climb wall"), or null if it
 * isn't a movement command at all. Used both to capture the move that caused a
 * room change and to know how to lay out the new node.
 */
export function classifyMove(cmd: string): { dir: string; move: string } | null {
  const move = cmd.trim().replace(/\s+/g, ' ')
  if (!move) return null
  const low = move.toLowerCase()

  // Bare direction or abbreviation.
  if (DIR_ALIAS[low]) return { dir: DIR_ALIAS[low], move: DIR_ALIAS[low] }

  // "go <dir>" / "move <dir>" where the target is a real direction.
  const goDir = low.match(/^(?:go|move|head)\s+(\w+)$/)
  if (goDir && DIR_ALIAS[goDir[1]]) return { dir: DIR_ALIAS[goDir[1]], move: DIR_ALIAS[goDir[1]] }

  // Non-cardinal travel verbs: these change rooms but have no compass bearing, so
  // dir = 'special' and the full command is preserved as the literal move. Kept
  // deliberately broad (it's the ONLY movement signal — there is no raw fallback,
  // so a real travel verb missing here means that move won't be mapped).
  if (/^(?:go|climb|clamber|crawl|enter|exit|leave|out|in|swim|wade|jump|leap|slip|squeeze|duck|scramble|scale|descend|ascend|board|disembark|mount|dismount|ride|sail|row|tunnel|hop|vault|slink|sneak|dive|wriggle|shimmy)\b/.test(low))
    return { dir: 'special', move }

  return null
}

// ── Native DR room id ─────────────────────────────────────────────────────────
// DragonRealms exposes a native room id in a trailing paren on the room title
// (a game feature, NOT injected by Lich — so it's available on a direct connection
// too, whenever the account has room-number display enabled):
//   "[The Crossing, Clanthew Boulevard] (10041)"   → id 10041 (definitive identity)
//   "[Wilds, Pine Needle Path] (**)"               → no id for this room (e.g. wilds)
// This is a STABLE room UID, so when present it beats every content/graph heuristic.
// "(**)" and untagged titles fall back to them.
export function parseRoomUid(title: string): string | null {
  const m = title.match(/\((\d{2,})\)\s*$/)
  return m ? m[1] : null
}

// The title without its trailing "(id)"/"(**)" tag — used for display, zone
// derivation, and heuristic matching so the volatile tag never skews them.
export function stripRoomTag(title: string): string {
  return title.replace(/\s*\((?:\d+|\*+)\)\s*$/, '').trim()
}

// ── Signature / identity ──────────────────────────────────────────────────────
// FNV-1a hash of normalized text (same construction as hashLook in store/game.ts).
export function fnv1a(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').trim()
  let h = 0x811c9dc5
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function hashDesc(description: string): string {
  return fnv1a(description)
}

// Normalize an exits list to a stable, order-independent key fragment.
function normExits(exits: string[]): string {
  return [...new Set(exits.map(e => e.trim().toLowerCase()).filter(Boolean))].sort().join(',')
}

/**
 * A room's identity signature. Title + description hash is the core; exits are a
 * tiebreaker for rooms that share a title+description but differ by open passages.
 * Two observations that produce the same signature are considered the same room.
 */
export function roomSignature(title: string, description: string, exits: string[]): string {
  return `${title.trim().toLowerCase()}|${hashDesc(description)}|${normExits(exits)}`
}

// A looser key (title + description only) used to find candidate matches when
// exits differ slightly (a room can gain/lose a searched exit between visits).
export function roomKeyLoose(title: string, description: string): string {
  return `${title.trim().toLowerCase()}|${hashDesc(description)}`
}

// ── Zone derivation ─────────────────────────────────────────────────────────
// DR room names often look like "[Riverhaven, Herald Street]" or "[Crossing, Town
// Hall]". The first bracket segment is the area → the zone. Plain names (no
// brackets) fall into a shared 'wilds' bucket; the mapper can re-home them onto a
// connected zone later. Kept deterministic so the same title always maps the same.
export function deriveZone(title: string): { id: string; name: string } {
  const m = title.match(/^\[([^\],]+)/)
  if (m) {
    const name = m[1].trim()
    return { id: zoneId(name), name }
  }
  return { id: 'wilds', name: 'The Wilds' }
}

function zoneId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'zone'
}

// ── Node id generation ────────────────────────────────────────────────────────
// Internal ids are content-derived + a short salt so re-imports/re-recordings of
// the same room collide (dedupe) rather than duplicate. The salt disambiguates
// the rare true collision of two distinct rooms with identical signatures.
export function makeNodeId(sig: string): string {
  return 'n' + fnv1a(sig)
}
