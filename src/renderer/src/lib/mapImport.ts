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

  for (const zb of zoneBlocks) {
    const zoneTag  = zb.match(/<zone\b[^>]*>/i)?.[0] ?? ''
    const zoneName = attr(zoneTag, 'name') || 'Imported'
    // Prefer a zone id derived from a room name so imported + walked maps share a
    // zone key; fall back to the file's own zone name.
    const firstRoomName = zb.match(/<node\b[^>]*\bname\s*=\s*["']([^"']+)/i)?.[1] ?? zoneName
    const zInfo = deriveZone(firstRoomName).id !== 'wilds'
      ? deriveZone(firstRoomName)
      : { id: zoneName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'imported', name: zoneName }
    const zone = emptyZone(zInfo.id, zInfo.name)
    const nsId = (gid: string) => `g-${zone.id}-${gid}`

    const nodeBlocks = zb.match(/<node\b[\s\S]*?<\/node>/gi) ?? []
    // Also support self-closing / no-body nodes (rare).
    const selfNodes  = zb.match(/<node\b[^>]*\/>/gi) ?? []

    for (const nb of [...nodeBlocks, ...selfNodes]) {
      const nodeTag = nb.match(/<node\b[^>]*>/i)?.[0] ?? nb
      const gid   = attr(nodeTag, 'id', 'num') ?? String(Object.keys(zone.nodes).length + 1)
      const title = attr(nodeTag, 'name', 'title') ?? ''
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
        const hidden = /^(true|1|yes)$/i.test(attr(at, 'hidden') ?? '')
        if (!dest || !move) continue
        const dir = CANON_DIRS.has(exit) ? exit : 'special'
        if (CANON_DIRS.has(exit) && !hidden) exits.push(exit)
        arcs.push({ move, dir, dest: nsId(dest), hidden })
        arcTotal++
      }

      const id = nsId(gid)
      const node: MapNode = {
        id, zoneId: zone.id, title,
        descHash: roomSignature(title, desc, exits).split('|')[1] ?? '',
        descriptions: desc ? [desc] : [],
        exits, x: px / GENIE_SCALE, y: py / GENIE_SCALE, z: pz,
        note: note || undefined, tag: tag || undefined, color: color || undefined,
      }
      zone.nodes[id] = node
      for (const a of arcs) zone.arcs.push({ from: id, to: a.dest, dir: a.dir, move: a.move, hidden: a.hidden })
      nodeTotal++
    }

    // Drop arcs pointing at nodes that weren't in the file.
    zone.arcs = zone.arcs.filter(a => zone.nodes[a.to])
    if (Object.keys(zone.nodes).length) zones.push(zone)
  }

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
  for (const z of zones) {
    lines.push(`  <zone name="${encodeXml(z.name)}" id="${encodeXml(z.id)}">`)
    // Stable short numeric ids per zone for portability.
    const idMap = new Map<string, number>()
    Object.keys(z.nodes).forEach((id, i) => idMap.set(id, i + 1))
    for (const n of Object.values(z.nodes)) {
      const gid = idMap.get(n.id)!
      const attrs = [`id="${gid}"`, `name="${encodeXml(n.title)}"`]
      if (n.color) attrs.push(`color="${encodeXml(n.color)}"`)
      if (n.note)  attrs.push(`note="${encodeXml(n.note)}"`)
      if (n.tag)   attrs.push(`tag="${encodeXml(n.tag)}"`)
      lines.push(`    <node ${attrs.join(' ')}>`)
      if (n.descriptions[0]) lines.push(`      <description>${encodeXml(n.descriptions[0])}</description>`)
      lines.push(`      <position x="${Math.round(n.x * GENIE_SCALE)}" y="${Math.round(n.y * GENIE_SCALE)}" z="${n.z}" />`)
      for (const a of z.arcs.filter(a => a.from === n.id)) {
        const dest = idMap.get(a.to)
        if (dest === undefined) continue
        lines.push(`      <arc exit="${encodeXml(a.dir === 'special' ? a.move : a.dir)}" move="${encodeXml(a.move)}" destination="${dest}" hidden="${a.hidden ? 'True' : 'False'}" />`)
      }
      lines.push('    </node>')
    }
    lines.push('  </zone>')
  }
  lines.push('</maps>')
  return lines.join('\n')
}
