/**
 * Genie-format map import/export (pure, testable).
 *
 * Genie's automapper stores one zone per XML file, roughly:
 *   <zone name="Town" id="1">
 *     <node id="1" name="Square" color="#fff" note="bank">
 *       <description>A wide cobbled square.</description>
 *       <position x="300" y="200" z="0" />
 *       <arc exit="north" move="north" destination="2" hidden="False" />
 *     </node>
 *   </zone>
 * Attribute names vary a little between Genie versions, so the parser is tolerant
 * (accepts destination/dest/to, move/cmd, etc.) and never throws — mirroring the
 * Genie config importer in lib/genieImport.ts. It uses regex rather than DOMParser
 * so it stays runnable in a plain-node test harness.
 */

import {
  type Zone, type MapNode, type MapArc,
  emptyZone, roomSignature, deriveZone,
} from './mapModel'

// Genie coords are pixels (~30px between adjacent rooms); our layout is in grid
// units (~1 per room), so scale imported coordinates down to match.
const GENIE_SCALE = 30

export interface ImportSummary {
  zones: number
  nodes: number
  arcs:  number
}

function attr(tag: string, ...names: string[]): string | undefined {
  for (const n of names) {
    const m = tag.match(new RegExp(`\\b${n}\\s*=\\s*"([^"]*)"|\\b${n}\\s*=\\s*'([^']*)'`, 'i'))
    if (m) return decodeXml(m[1] ?? m[2] ?? '')
  }
  return undefined
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&')
}

function encodeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CANON_DIRS = new Set([
  'north','south','east','west','northeast','northwest','southeast','southwest','up','down','out','in',
])

/**
 * Parse Genie map XML into zones in our model. Genie node ids are per-file, so we
 * namespace them (`g-<zoneId>-<genieId>`) to keep them globally unique while still
 * resolving arc destinations within the import. Matching auto-recorded rooms to
 * these nodes happens later by content signature (matchRoom), not by id.
 */
export function parseGenieMap(xml: string): { zones: Zone[]; summary: ImportSummary } {
  const zones: Zone[] = []
  let nodeTotal = 0, arcTotal = 0

  // Split into <zone>…</zone> blocks; a file with a single unnamed root still works.
  const zoneBlocks = xml.match(/<zone\b[\s\S]*?<\/zone>/gi)
    ?? (/<node\b/i.test(xml) ? [xml] : [])

  // Genie addresses an arc's destination by a number that only means anything inside
  // its own zone, so a link that LEAVES the zone can't be written down at all. Our own
  // exports therefore add `ref="<zone id>/<node id>"`, and resolving those needs every
  // zone parsed first — hence two passes. This maps the zone id as WRITTEN in the file
  // to the zone id we derive on the way in (which comes from the room titles, so the
  // two don't always agree).
  const zoneIdByFileId = new Map<string, string>()
  const pending: { zone: Zone; from: string; ref: string; dir: string; move: string; hidden: boolean }[] = []

  for (const zb of zoneBlocks) {
    const zoneTag  = zb.match(/<zone\b[^>]*>/i)?.[0] ?? ''
    const zoneName = attr(zoneTag, 'name') || 'Imported'
    // Prefer a zone id derived from a room name so imported + walked maps share a
    // zone key; fall back to the file's own zone name.
    const firstRoomName = zb.match(/<node\b[^>]*\bname\s*=\s*["']([^"']+)/i)?.[1] ?? zoneName
    const fileZoneId = attr(zoneTag, 'id')
    // Genie numbers its zones ("1"); ours are slugs ("the-crossing"). A slug is our
    // own key and is authoritative — deriving one from the first room's title instead
    // is only a guess for real Genie files, and a wrong guess is destructive here:
    // a zone holds rooms titled for OTHER areas, so two zones can guess the same key
    // and then silently overwrite each other's rooms on the way in.
    const ownId = fileZoneId && !/^\d+$/.test(fileZoneId) ? fileZoneId : null
    const derived = deriveZone(firstRoomName)
    const zInfo = ownId
      ? { id: ownId, name: zoneName }
      : derived.id !== 'wilds'
        ? derived
        : { id: zoneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported', name: zoneName }
    const zone = emptyZone(zInfo.id, zInfo.name)
    const nsId = (gid: string) => `g-${zone.id}-${gid}`
    if (fileZoneId) zoneIdByFileId.set(fileZoneId, zone.id)

    const nodeBlocks = zb.match(/<node\b[\s\S]*?<\/node>/gi) ?? []
    // Also support self-closing / no-body nodes (rare).
    const selfNodes  = zb.match(/<node\b[^>]*\/>/gi) ?? []

    for (const nb of [...nodeBlocks, ...selfNodes]) {
      const nodeTag = nb.match(/<node\b[^>]*>/i)?.[0] ?? nb
      const gid   = attr(nodeTag, 'id', 'num') ?? String(Object.keys(zone.nodes).length + 1)
      const title = attr(nodeTag, 'name', 'title') ?? ''
      // DragonRealms' own room number. It's the definitive identity — observeRoom
      // matches on it before any heuristic — so an import that drops it can never be
      // reconciled with rooms you subsequently walk, and you'd collect duplicates of
      // everything. Genie files won't carry one; ours always do when the game gave it.
      const uid   = attr(nodeTag, 'uid', 'roomid', 'rnum')
      const color = attr(nodeTag, 'color')
      const note  = attr(nodeTag, 'note', 'notes')
      const tag   = attr(nodeTag, 'tag', 'label')
      const desc  = decodeXml((nb.match(/<description\b[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? '').trim())

      const posTag = nb.match(/<position\b[^>]*\/?>/i)?.[0] ?? nodeTag
      const px = parseFloat(attr(posTag, 'x') ?? attr(nodeTag, 'x') ?? '0') || 0
      const py = parseFloat(attr(posTag, 'y') ?? attr(nodeTag, 'y') ?? '0') || 0
      const pz = parseInt(attr(posTag, 'z') ?? attr(nodeTag, 'z') ?? '0', 10) || 0

      const arcTags = nb.match(/<arc\b[^>]*\/?>/gi) ?? []
      const exits: string[] = []
      const arcs: { move: string; dir: string; dest: string; hidden: boolean }[] = []
      for (const at of arcTags) {
        const exit = (attr(at, 'exit', 'dir') ?? '').toLowerCase().trim()
        const move = attr(at, 'move', 'cmd', 'command') ?? exit
        const dest = attr(at, 'destination', 'dest', 'to', 'destid')
        const ref  = attr(at, 'ref')
        const hidden = /^(true|1|yes)$/i.test(attr(at, 'hidden') ?? '')
        // An empty move is meaningful, not missing: it's a link we watched someone
        // take without ever seeing the command. Dropping those (the old `!move`
        // guard) silently threw away most of a recorded map's connectivity on a
        // round-trip, because they're exactly the links the game never announced.
        if (!dest && !ref) continue
        const dir = attr(at, 'kind') === 'special' || !CANON_DIRS.has(exit) ? 'special' : exit
        if (dir !== 'special' && !hidden) exits.push(exit)
        if (ref) pending.push({ zone, from: nsId(gid), ref, dir, move, hidden })
        else arcs.push({ move, dir, dest: nsId(dest!), hidden })
        arcTotal++
      }

      const id = nsId(gid)
      const node: MapNode = {
        id, uid: uid || undefined, zoneId: zone.id, title,
        descHash: roomSignature(title, desc, exits).split('|')[1] ?? '',
        descriptions: desc ? [desc] : [],
        exits, x: px / GENIE_SCALE, y: py / GENIE_SCALE, z: pz,
        note: note || undefined, tag: tag || undefined, color: color || undefined,
      }
      zone.nodes[id] = node
      for (const a of arcs) zone.arcs.push({ from: id, to: a.dest, dir: a.dir, move: a.move, hidden: a.hidden })
      nodeTotal++
    }

    if (Object.keys(zone.nodes).length) zones.push(zone)
  }

  // Second pass: now that every zone exists, hook up the links that leave one.
  const byId = new Map<string, Zone>()
  for (const z of zones) for (const id in z.nodes) byId.set(id, z)
  for (const p of pending) {
    const slash = p.ref.lastIndexOf('/')
    if (slash < 0) continue
    const zid = zoneIdByFileId.get(p.ref.slice(0, slash)) ?? p.ref.slice(0, slash)
    const to  = `g-${zid}-${p.ref.slice(slash + 1)}`
    if (!byId.has(to)) continue
    p.zone.arcs.push({ from: p.from, to, dir: p.dir, move: p.move, hidden: p.hidden })
  }

  // Drop arcs pointing at rooms that weren't in the file at all. Cross-zone links are
  // kept, so this checks the whole import rather than one zone.
  for (const z of zones) z.arcs = z.arcs.filter(a => byId.has(a.to))

  return { zones, summary: { zones: zones.length, nodes: nodeTotal, arcs: arcTotal } }
}

/**
 * Merge imported zones into the live DB. Same-id nodes are replaced (idempotent
 * re-import); new ones are added; arcs union with dedupe. Zones are merged, not
 * overwritten, so an imported zone augments anything already recorded there.
 */
export function mergeZones(base: Record<string, Zone>, incoming: Zone[]): Record<string, Zone> {
  const out: Record<string, Zone> = { ...base }
  for (const zin of incoming) {
    const cur = out[zin.id]
    if (!cur) { out[zin.id] = zin; continue }
    const nodes = { ...cur.nodes, ...zin.nodes }
    const arcKey = (a: MapArc) => `${a.from}|${a.to}|${a.move}`
    const have = new Set(cur.arcs.map(arcKey))
    const arcs = [...cur.arcs]
    for (const a of zin.arcs) if (!have.has(arcKey(a))) { arcs.push(a); have.add(arcKey(a)) }
    out[zin.id] = { id: cur.id, name: cur.name || zin.name, nodes, arcs }
  }
  return out
}

/** Serialize zones back to Genie-style XML (one <zone> each) for sharing/backup. */
export function exportGenieMap(zones: Zone[]): string {
  const lines: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', '<maps>']
  // Stable short numeric ids per zone for portability — but recorded maps are full of
  // links that LEAVE their zone (every shop door), and Genie's per-zone `destination`
  // number can't name a room in another zone. Those used to be dropped on the way out,
  // which quietly cost an export most of its connectivity, so each arc also carries a
  // `ref="<zone>/<node>"` that our importer resolves across the whole file.
  const gidOf  = new Map<string, number>()
  const zoneOf = new Map<string, string>()
  for (const z of zones) {
    Object.keys(z.nodes).forEach((id, i) => { gidOf.set(id, i + 1); zoneOf.set(id, z.id) })
  }
  for (const z of zones) {
    lines.push(`  <zone name="${encodeXml(z.name)}" id="${encodeXml(z.id)}">`)
    for (const n of Object.values(z.nodes)) {
      const gid = gidOf.get(n.id)!
      const attrs = [`id="${gid}"`, `name="${encodeXml(n.title)}"`]
      if (n.uid) attrs.push(`uid="${encodeXml(n.uid)}"`)   // DR's own room number
      if (n.color) attrs.push(`color="${encodeXml(n.color)}"`)
      if (n.note)  attrs.push(`note="${encodeXml(n.note)}"`)
      if (n.tag)   attrs.push(`tag="${encodeXml(n.tag)}"`)
      lines.push(`    <node ${attrs.join(' ')}>`)
      if (n.descriptions[0]) lines.push(`      <description>${encodeXml(n.descriptions[0])}</description>`)
      lines.push(`      <position x="${Math.round(n.x * GENIE_SCALE)}" y="${Math.round(n.y * GENIE_SCALE)}" z="${n.z}" />`)
      for (const a of z.arcs.filter(a => a.from === n.id)) {
        const dest = gidOf.get(a.to)
        if (dest === undefined) continue
        // `exit` must never be blank: a link recorded with no command still has to
        // come back as a link, so it exports as "special" rather than as nothing.
        const exit = a.dir === 'special' ? (a.move || 'special') : a.dir
        // `exit` carries the command, the way Genie writes it — but a non-compass move
        // can read like a direction ("out"), which would come back as a compass link.
        // `kind` says plainly that it has no bearing; other readers just ignore it.
        const kind = a.dir === 'special' ? ' kind="special"' : ''
        lines.push(
          `      <arc exit="${encodeXml(exit)}" move="${encodeXml(a.move)}"${kind} destination="${dest}"` +
          ` ref="${encodeXml(zoneOf.get(a.to)!)}/${dest}" hidden="${a.hidden ? 'True' : 'False'}" />`)
      }
      lines.push('    </node>')
    }
    lines.push('  </zone>')
  }
  lines.push('</maps>')
  return lines.join('\n')
}
