import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { MapDB, MapNode, Zone } from '../../lib/mapModel'
import { roomType, nodeFill, ROOM_TYPE_META, type RoomType } from '../../lib/roomType'
import { portalPoints, type AreaExit, type StreetLabel } from '../../lib/mapper'

// Grid spacing (px) between adjacent rooms at zoom 1, and node half-size. Rooms are
// drawn large relative to the grid (ratio ≈ 0.44) so the squares — not the wiring —
// carry the shape of the map, the way a drawn map reads.
const GRID = 50
const NODE_R = 11
const ZOOM_MIN = 0.35
const ZOOM_MAX = 2.6
const DRAG_THRESHOLD = 4   // px of movement before a node press becomes a drag
// Below this zoom, per-room lettering is unreadable and just muddies the map, so
// only the street labels survive.
const LABEL_ZOOM = 0.75

export interface MapViewProps {
  db:             MapDB
  zone:           Zone | null
  exits?:         AreaExit[]           // links leaving the area — drawn as portals
  labels?:        StreetLabel[]        // street lettering, positioned by the layout
  currentNodeId:  string | null
  selectedId?:    string | null
  focusId?:       string | null        // center on this node when it changes (search)
  onNodeClick?:   (id: string) => void
  onNodeContext?: (id: string, e: React.MouseEvent) => void
  onNodeDrag?:    (id: string, x: number, y: number) => void   // new grid coords
  onExitClick?:   (toId: string) => void   // travel/jump to the room beyond a portal
  walkActive?:    boolean
  onStopWalk?:    () => void
  className?:     string
}

/**
 * Pan/zoom SVG renderer for one zone at one z-level. Nodes sit on a grid (x,y in
 * grid units); same-level arcs draw as lines; the current room pulses. Interaction
 * is pointer-based: drag the background to pan, wheel to zoom, drag a node to
 * reposition it (when onNodeDrag is set), click a node to walk. Auto-centers on the
 * current room as the character moves. Reused by MapPanel and MapOverlay.
 */
export function MapView({
  zone, exits, labels, currentNodeId, selectedId, focusId,
  onNodeClick, onNodeContext, onNodeDrag, onExitClick, walkActive, onStopWalk, className,
}: MapViewProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 300, h: 220 })
  const [pan, setPan]   = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [level, setLevel] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const nodeById = (id: string | null | undefined) => (id && zone ? zone.nodes[id] : null)
  const currentNode = nodeById(currentNodeId)

  const centerOn = (n: MapNode | null) => {
    if (!n) return
    setLevel(n.z)
    setPan({ x: size.w / 2 - n.x * GRID * zoom, y: size.h / 2 - n.y * GRID * zoom })
  }

  // Follow the character: recenter when the current room changes.
  const followKey = currentNode ? `${currentNode.id}:${currentNode.x},${currentNode.y},${currentNode.z}` : ''
  const lastFollow = useRef('')
  useEffect(() => {
    if (followKey && followKey !== lastFollow.current && currentNode) {
      lastFollow.current = followKey
      centerOn(currentNode)
    }
  }, [followKey, size.w, size.h])  // eslint-disable-line react-hooks/exhaustive-deps

  // Center on an externally-focused node (e.g. a search result).
  const lastFocus = useRef<string | null>(null)
  useEffect(() => {
    if (focusId && focusId !== lastFocus.current) {
      lastFocus.current = focusId
      centerOn(nodeById(focusId))
    }
  }, [focusId])  // eslint-disable-line react-hooks/exhaustive-deps

  const levelNodes = useMemo(
    () => zone ? Object.values(zone.nodes).filter(n => n.z === level) : [],
    [zone, level],
  )
  // Edges. A link between neighbouring cells is a plain connector; anything longer
  // is a place the world doesn't fit a flat grid (a non-Euclidean loop, or a hop with
  // no captured direction), so it's dashed — that reads as "these connect" without
  // being mistaken for a street running across everything in between.
  const edges = useMemo(() => {
    if (!zone) return []
    const onLevel = new Set(levelNodes.map(n => n.id))
    const seen = new Set<string>()
    const out: { x1: number; y1: number; x2: number; y2: number; far: boolean }[] = []
    for (const a of zone.arcs) {
      if (!onLevel.has(a.from) || !onLevel.has(a.to)) continue
      const key = a.from < a.to ? `${a.from}|${a.to}` : `${a.to}|${a.from}`
      if (seen.has(key)) continue
      seen.add(key)
      const f = zone.nodes[a.from], t = zone.nodes[a.to]
      const far = Math.max(Math.abs(f.x - t.x), Math.abs(f.y - t.y)) > 1
      out.push({ x1: f.x * GRID, y1: f.y * GRID, x2: t.x * GRID, y2: t.y * GRID, far })
    }
    return out
  }, [zone, levelNodes])

  // Portal geometry comes from the layout so the lettering it routed around lines up
  // with what's actually drawn. Grid units in, pixels out.
  const portals = useMemo(
    () => (zone && exits?.length ? portalPoints(zone, exits, level) : []),
    [zone, exits, level],
  )
  // One-room landmark names are only worth drawing once they're readable.
  const levelLabels = useMemo(
    () => (labels ?? []).filter(l => l.z === level && (!l.minor || zoom >= LABEL_ZOOM)),
    [labels, level, zoom],
  )

  const levelLinks = useMemo(() => {
    const marks: Record<string, { up?: boolean; down?: boolean }> = {}
    if (!zone) return marks
    const onLevel = new Set(levelNodes.map(n => n.id))
    for (const a of zone.arcs) {
      if (!onLevel.has(a.from)) continue
      const t = zone.nodes[a.to]
      if (!t || t.z === level) continue
      const m = marks[a.from] ?? (marks[a.from] = {})
      if (t.z > level) m.up = true; else m.down = true
    }
    return marks
  }, [zone, levelNodes, level])

  const levels = useMemo(() => {
    if (!zone) return [0]
    return Array.from(new Set(Object.values(zone.nodes).map(n => n.z))).sort((a, b) => b - a)
  }, [zone])

  // Legend: auto-classified room types + the user's own custom categories. A node
  // with a manual colour AND a label (tag) is a custom category (label → colour);
  // nodes without a manual colour fall back to auto room-type classification.
  const legend = useMemo(() => {
    const autoSeen = new Set<RoomType>()
    const custom = new Map<string, string>()   // label → colour
    for (const n of levelNodes) {
      if (n.color === 'none') continue   // explicit plain — no colour, no auto room-type
      if (n.color) { const label = n.tag?.trim(); if (label) custom.set(label, n.color) }
      else { const t = roomType(n); if (t) autoSeen.add(t) }
    }
    const auto = (Object.keys(ROOM_TYPE_META) as RoomType[])
      .filter(t => autoSeen.has(t))
      .map(t => ({ label: ROOM_TYPE_META[t].label, color: ROOM_TYPE_META[t].color }))
    return [...auto, ...[...custom.entries()].map(([label, color]) => ({ label, color }))]
  }, [levelNodes])

  // ── Interaction (background pan + node drag/click share the pointer stream) ───
  const bgDrag   = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const nodeDrag = useRef<{ id: string; px: number; py: number; ox: number; oy: number; moved: boolean } | null>(null)

  const onBgPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    bgDrag.current = { px: e.clientX, py: e.clientY, ox: pan.x, oy: pan.y }
  }
  const onNodePointerDown = (e: React.PointerEvent, n: MapNode) => {
    if (e.button !== 0) return
    e.stopPropagation()
    ;(e.currentTarget as Element).closest('svg')?.setPointerCapture(e.pointerId)
    nodeDrag.current = { id: n.id, px: e.clientX, py: e.clientY, ox: n.x, oy: n.y, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (nodeDrag.current) {
      const nd = nodeDrag.current
      const dx = (e.clientX - nd.px) / (GRID * zoom)
      const dy = (e.clientY - nd.py) / (GRID * zoom)
      if (!nd.moved && Math.hypot(e.clientX - nd.px, e.clientY - nd.py) > DRAG_THRESHOLD) nd.moved = true
      if (nd.moved && onNodeDrag) onNodeDrag(nd.id, nd.ox + dx, nd.oy + dy)
      return
    }
    if (bgDrag.current) {
      setPan({ x: bgDrag.current.ox + (e.clientX - bgDrag.current.px), y: bgDrag.current.oy + (e.clientY - bgDrag.current.py) })
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (nodeDrag.current) {
      const nd = nodeDrag.current
      nodeDrag.current = null
      if (!nd.moved) onNodeClick?.(nd.id)   // a press without movement is a click
    }
    bgDrag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }
  const onWheel = (e: React.WheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    const cx = rect ? e.clientX - rect.left : size.w / 2
    const cy = rect ? e.clientY - rect.top  : size.h / 2
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)))
    const k = nz / zoom
    setPan(p => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }))
    setZoom(nz)
  }
  const zoomBy = (f: number) => {
    const nz = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom * f))
    const k = nz / zoom
    setPan(p => ({ x: size.w / 2 - (size.w / 2 - p.x) * k, y: size.h / 2 - (size.h / 2 - p.y) * k }))
    setZoom(nz)
  }

  const hasNodes = zone && Object.keys(zone.nodes).length > 0

  return (
    <div className={'map-view' + (className ? ' ' + className : '')} ref={wrapRef}>
      {!hasNodes && <div className="map-empty">No map here yet — walk around to record rooms.</div>}
      <svg
        className="map-svg" width="100%" height="100%"
        onPointerDown={onBgPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edges.map((e, i) => (
            <line key={i} className={'map-edge' + (e.far ? ' is-far' : '')}
                  x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />
          ))}

          {/* Street lettering sits under the rooms so a label never hides a square. */}
          {levelLabels.map((l, i) => (
            <text
              key={'lbl' + i} className={'map-street' + (l.minor ? ' is-minor' : '')}
              textAnchor="middle" dominantBaseline="middle"
              transform={`translate(${l.x * GRID} ${l.y * GRID})` + (l.vertical ? ' rotate(-90)' : '')}
            >{l.text}</text>
          ))}

          {/* Links out of this area: a ring on a short leader, labelled with where it
              goes and the command that gets you there. Clicking one opens that area. */}
          {portals.map((p, i) => (
            <g key={'px' + i} className="map-portal"
               data-tooltip={`${p.exit.title}${p.exit.area ? ' — ' + p.exit.area : ''}${p.exit.move ? ` (${p.exit.move})` : ''}`}
               onPointerDown={e => e.stopPropagation()}
               onClick={() => onExitClick?.(p.exit.toId)}>
              <line className="map-portal-leader" x1={p.ax * GRID} y1={p.ay * GRID} x2={p.x * GRID} y2={p.y * GRID} />
              <circle className="map-portal-ring" cx={p.x * GRID} cy={p.y * GRID} r={6} />
              <path className="map-portal-x" d={`M${p.x * GRID - 2.6} ${p.y * GRID - 2.6} L${p.x * GRID + 2.6} ${p.y * GRID + 2.6} M${p.x * GRID + 2.6} ${p.y * GRID - 2.6} L${p.x * GRID - 2.6} ${p.y * GRID + 2.6}`} />
              {zoom >= LABEL_ZOOM && (
                <text className="map-portal-label" x={p.x * GRID + 9} y={p.y * GRID + 3}>{p.exit.area || p.exit.title}</text>
              )}
            </g>
          ))}

          {levelNodes.map(n => {
            const isCurrent = n.id === currentNodeId
            const isSelected = n.id === selectedId
            const mark = levelLinks[n.id]
            return (
              <g
                key={n.id}
                className={'map-node' + (isCurrent ? ' is-current' : '') + (isSelected ? ' is-selected' : '')}
                transform={`translate(${n.x * GRID} ${n.y * GRID})`}
                data-tooltip={n.title + (n.note ? ' — ' + n.note : '')}
                onPointerDown={e => onNodePointerDown(e, n)}
                onContextMenu={e => { if (onNodeContext) { e.preventDefault(); onNodeContext(n.id, e) } }}
              >
                {/* Rooms are squares; the player is a circle sitting on the current room's
                    (glowing) square — see the .is-current rules in global.css. */}
                <rect className="map-node-box" x={-NODE_R} y={-NODE_R} width={NODE_R * 2} height={NODE_R * 2} rx={2}
                      style={nodeFill(n) ? { fill: nodeFill(n) } : undefined} />
                {n.tag && <text className="map-node-tag" x={0} y={3} textAnchor="middle">{n.tag.slice(0, 4)}</text>}
                {mark?.up && <text className="map-node-chev up" x={NODE_R - 1} y={-NODE_R + 8}>▲</text>}
                {mark?.down && <text className="map-node-chev down" x={NODE_R - 1} y={NODE_R - 1}>▼</text>}
                {isCurrent && <circle className="map-node-player" cx={0} cy={0} r={NODE_R - 2.5} />}
              </g>
            )
          })}
        </g>
      </svg>

      {hasNodes && (
        <div className="map-stats">
          {Object.keys(zone!.nodes).length} rooms
          {exits?.length ? ` · ${exits.length} exits` : ''}
        </div>
      )}
      {legend.length > 0 && (
        <div className="map-legend">
          {legend.map(e => (
            <span key={e.label} className="map-legend-item">
              <span className="map-legend-dot" style={{ background: e.color }} />
              {e.label}
            </span>
          ))}
        </div>
      )}

      {walkActive && (
        <button className="map-stop-btn" onClick={onStopWalk} data-tooltip="Stop walking">■ Stop</button>
      )}

      <div className="map-toolbar">
        {zone && <span className="map-zone-name" data-tooltip={zone.name}>{zone.name}</span>}
        {levels.length > 1 && (
          <span className="map-level">
            <button className="map-tb-btn" data-tooltip="Level up" onClick={() => setLevel(l => l + 1)}>▲</button>
            <span className="map-level-num" data-tooltip="Current level">{level}</span>
            <button className="map-tb-btn" data-tooltip="Level down" onClick={() => setLevel(l => l - 1)}>▼</button>
          </span>
        )}
        <button className="map-tb-btn" data-tooltip="Zoom out" onClick={() => zoomBy(1 / 1.2)}>−</button>
        <button className="map-tb-btn" data-tooltip="Zoom in" onClick={() => zoomBy(1.2)}>+</button>
        <button className="map-tb-btn" data-tooltip="Center on me" onClick={() => centerOn(currentNode)} disabled={!currentNode}>◎</button>
      </div>
    </div>
  )
}
