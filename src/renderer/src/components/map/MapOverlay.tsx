import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAtom, useAtomValue } from 'jotai'
import { mapDbAtom, currentNodeIdAtom, walkStateAtom, autoRecordAtom } from '../../store/map'
import { nodeZoneId, componentLayout } from '../../lib/mapper'
import { emptyDb, type MapNode, type Zone } from '../../lib/mapModel'
import { parseGenieMap, mergeZones, exportGenieMap } from '../../lib/mapImport'
import { MapView } from './MapView'

const NODE_COLORS = ['', '#e0b050', '#6bc5a0', '#5fbcd4', '#7b8fe8', '#e06060', '#c78bd8']

export function MapOverlay({ onClose, onWalkTo, onStopWalk }: {
  onClose:    () => void
  onWalkTo:   (id: string) => void
  onStopWalk: () => void
}) {
  const [db, setDb]   = useAtom(mapDbAtom)
  const currentNodeId = useAtomValue(currentNodeIdAtom)
  const walk          = useAtomValue(walkStateAtom)
  const [autoRecord, setAutoRecord] = useAtom(autoRecordAtom)

  const zones = useMemo(
    () => Object.values(db.zones).sort((a, b) => a.name.localeCompare(b.name)),
    [db.zones],
  )
  const [query, setQuery]   = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)
  // The map is drawn as one unified connected component around a "root" room —
  // the focused/searched room, else the current room, else anything. This spans
  // zone boundaries so a contiguous area isn't split into disconnected clusters.
  const rootId = focusId ?? currentNodeId ?? null
  const zone: Zone = useMemo(() => componentLayout(db, rootId), [db, rootId])
  const zoneId = nodeZoneId(db, rootId ?? '') ?? null
  const [ctx, setCtx] = useState<{ id: string; x: number; y: number } | null>(null)
  // Custom (non-native) replacements for prompt()/confirm()/alert():
  const [status, setStatus]   = useState('')                                   // transient header notice
  const [confirmState, setConfirmState] = useState<{ kind: 'zone' | 'all'; label: string } | null>(null)
  const [edit, setEdit] = useState<{ id: string; field: 'tag' | 'note'; value: string } | null>(null)

  // Auto-clear the transient status notice.
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = (msg: string) => {
    setStatus(msg)
    if (statusTimer.current) clearTimeout(statusTimer.current)
    statusTimer.current = setTimeout(() => setStatus(''), 4000)
  }
  useEffect(() => () => { if (statusTimer.current) clearTimeout(statusTimer.current) }, [])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: { id: string; title: string; zoneId: string; zoneName: string }[] = []
    for (const z of Object.values(db.zones)) {
      for (const n of Object.values(z.nodes)) {
        if (n.title.toLowerCase().includes(q) || (n.note ?? '').toLowerCase().includes(q) || (n.tag ?? '').toLowerCase().includes(q)) {
          out.push({ id: n.id, title: n.title, zoneId: z.id, zoneName: z.name })
          if (out.length >= 40) return out
        }
      }
    }
    return out
  }, [query, db.zones])

  // ── DB mutation helpers (persist the touched zone) ──────────────────────────
  const persist = (z: Zone) => window.dr.map.saveZone(z).catch(() => {})

  const patchNode = (nodeId: string, patch: Partial<MapNode>) => {
    const zid = nodeZoneId(db, nodeId)
    if (!zid) return
    setDb(prev => {
      const z = prev.zones[zid]; if (!z) return prev
      const z2: Zone = { ...z, nodes: { ...z.nodes, [nodeId]: { ...z.nodes[nodeId], ...patch } } }
      persist(z2)
      return { ...prev, zones: { ...prev.zones, [zid]: z2 } }
    })
  }

  const deleteNode = (nodeId: string) => {
    const zid = nodeZoneId(db, nodeId)
    if (!zid) return
    setDb(prev => {
      const z = prev.zones[zid]; if (!z) return prev
      const nodes = { ...z.nodes }; delete nodes[nodeId]
      const z2: Zone = { ...z, nodes, arcs: z.arcs.filter(a => a.from !== nodeId && a.to !== nodeId) }
      persist(z2)
      return { ...prev, zones: { ...prev.zones, [zid]: z2 } }
    })
  }

  // Drag-to-place stores a manual `pin` on the room (grid-snapped); Tidy clears the
  // pins of the currently-shown rooms so they snap back to the auto layout.
  const hasPins = Object.values(zone.nodes).some(n => n.pin)
  const tidy = () => {
    const shown = Object.keys(zone.nodes)
    setDb(prev => {
      const zones = { ...prev.zones }
      const touched = new Set<string>()
      for (const id of shown) {
        const zid = nodeZoneId(prev, id); if (!zid) continue
        const z = zones[zid]; const n = z?.nodes[id]
        if (!n?.pin) continue
        const { pin: _drop, ...rest } = n
        zones[zid] = { ...z, nodes: { ...z.nodes, [id]: rest } }
        touched.add(zid)
      }
      if (touched.size === 0) return prev
      for (const zid of touched) persist(zones[zid])
      return { ...prev, zones }
    })
  }

  // ── Import / export / clear ─────────────────────────────────────────────────
  const doImport = async () => {
    const file = await window.dr.app.openTextFile([{ name: 'Map', extensions: ['xml', 'map'] }])
    if (!file?.content) return
    const { zones: imported, summary } = parseGenieMap(file.content)
    if (!imported.length) { flash('No zones found in that file.'); return }
    setDb(prev => {
      const merged = mergeZones(prev.zones, imported)
      for (const z of imported) persist(merged[z.id])
      return { ...prev, zones: merged }
    })
    setFocusId(Object.keys(imported[0].nodes)[0] ?? null)   // view the imported area
    flash(`Imported ${summary.zones} zone(s), ${summary.nodes} rooms, ${summary.arcs} connections.`)
  }

  const doExport = async () => {
    const content = exportGenieMap(Object.values(db.zones))
    const res = await window.dr.map.export(content, 'magiloom-map.xml')
    if (res.ok) flash('Map exported.')
  }

  // Destructive actions go through an inline confirm bar (no native confirm()).
  const runConfirm = () => {
    if (confirmState?.kind === 'zone' && zoneId) {
      window.dr.map.deleteZone(zoneId).catch(() => {})
      setDb(prev => { const zones = { ...prev.zones }; delete zones[zoneId]; return { ...prev, zones } })
      setFocusId(null)
      flash('Zone map cleared.')
    } else if (confirmState?.kind === 'all') {
      window.dr.map.clear().catch(() => {})
      setDb(emptyDb())
      flash('World map cleared.')
    }
    setConfirmState(null)
  }

  const focusResult = (r: { id: string; zoneId: string }) => {
    setFocusId(r.id)   // re-roots the component view around the searched room
    setQuery('')
  }

  return createPortal(
    <div className="map-overlay-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="map-overlay">
        <div className="map-overlay-head">
          <span className="map-overlay-title">World Map</span>
          <select className="map-zone-select" value={zoneId ?? ''}
                  onChange={e => setFocusId(Object.keys(db.zones[e.target.value]?.nodes ?? {})[0] ?? null)}>
            {zones.length === 0 && <option value="">No zones yet</option>}
            {zones.map(z => (
              <option key={z.id} value={z.id}>{z.name} ({Object.keys(z.nodes).length})</option>
            ))}
          </select>
          <input
            className="map-search" placeholder="Search rooms…"
            value={query} onChange={e => setQuery(e.target.value)}
          />
          <div className="map-overlay-spacer" />
          <label className="map-autorec" data-tooltip="Record new rooms as you walk">
            <input type="checkbox" checked={autoRecord} onChange={e => setAutoRecord(e.target.checked)} />
            Auto-record
          </label>
          <button className="map-tb-btn map-text-btn" data-tooltip="Snap dragged rooms back to the auto layout" onClick={tidy} disabled={!hasPins}>Tidy</button>
          <button className="map-tb-btn map-text-btn" onClick={doImport}>Import</button>
          <button className="map-tb-btn map-text-btn" onClick={doExport} disabled={zones.length === 0}>Export</button>
          <button className="map-tb-btn map-text-btn" onClick={() => zoneId && setConfirmState({ kind: 'zone', label: `Delete the recorded map for "${db.zones[zoneId]?.name ?? 'this zone'}"?` })} disabled={!zoneId}>Clear zone</button>
          <button className="map-tb-btn map-text-btn" onClick={() => setConfirmState({ kind: 'all', label: 'Delete the ENTIRE recorded world map? This cannot be undone.' })} disabled={zones.length === 0}>Clear all</button>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {status && <div className="map-status-bar">{status}</div>}
        {confirmState && (
          <div className="map-confirm-bar">
            <span className="map-confirm-text">{confirmState.label}</span>
            <button className="map-tb-btn map-text-btn map-confirm-yes" onClick={runConfirm}>Delete</button>
            <button className="map-tb-btn map-text-btn" onClick={() => setConfirmState(null)}>Cancel</button>
          </div>
        )}

        {results.length > 0 && (
          <div className="map-search-results">
            {results.map(r => (
              <div key={r.id} className="map-search-item" onClick={() => focusResult(r)}>
                <span className="map-search-room">{r.title || '(unnamed)'}</span>
                <span className="map-search-zone">{r.zoneName}</span>
                <button className="map-search-walk" data-tooltip="Walk here"
                        onClick={e => { e.stopPropagation(); onWalkTo(r.id); setQuery('') }}>▸ walk</button>
              </div>
            ))}
          </div>
        )}

        <div className="map-overlay-body" onClick={() => setCtx(null)}>
          <MapView
            db={db}
            zone={zone}
            currentNodeId={currentNodeId}
            selectedId={focusId ?? (walk.active ? walk.targetId : null)}
            focusId={focusId}
            onNodeClick={id => { setFocusId(id); setCtx(null) }}
            onNodeContext={(id, e) => setCtx({ id, x: e.clientX, y: e.clientY })}
            onNodeDrag={(id, x, y) => patchNode(id, { pin: { x: Math.round(x), y: Math.round(y) } })}
            walkActive={walk.active}
            onStopWalk={onStopWalk}
            className="map-view-large"
          />
        </div>

        {ctx && (() => {
          const node = zone?.nodes[ctx.id]
          const editing = edit && edit.id === ctx.id
          const commitEdit = () => {
            if (!edit) return
            const v = edit.value.trim() || undefined
            patchNode(edit.id, edit.field === 'tag' ? { tag: v } : { note: v })
            setEdit(null); setCtx(null)
          }
          return (
            <div className="map-ctx-menu" style={{ left: ctx.x, top: ctx.y }} onClick={e => e.stopPropagation()}>
              <div className="map-ctx-title">{node?.title || 'Room'}</div>
              {editing ? (
                <div className="map-ctx-edit">
                  <input
                    autoFocus className="map-ctx-input"
                    placeholder={edit!.field === 'tag' ? 'Label — shown in the legend (first 3 chars on the node)' : 'Note'}
                    value={edit!.value}
                    onChange={e => setEdit({ ...edit!, value: e.target.value })}
                    onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEdit(null) }}
                  />
                  <button className="map-tb-btn map-text-btn" onClick={commitEdit}>Save</button>
                </div>
              ) : (
                <>
                  <div className="map-ctx-item" onClick={() => { onWalkTo(ctx.id); setCtx(null) }}>Walk here</div>
                  <div className="map-ctx-item" onClick={() => setEdit({ id: ctx.id, field: 'tag', value: node?.tag ?? '' })}>Set label…</div>
                  <div className="map-ctx-item" onClick={() => setEdit({ id: ctx.id, field: 'note', value: node?.note ?? '' })}>Edit note…</div>
                  <div className="map-ctx-colors">
                    {NODE_COLORS.map(c => (
                      <button key={c || 'none'} className="map-ctx-swatch" data-tooltip={c || 'default'}
                              style={{ background: c || 'var(--panel-border, #444)' }}
                              onClick={() => patchNode(ctx.id, { color: c || undefined })} />
                    ))}
                    <input type="color" className="map-ctx-colorpick" data-tooltip="Custom colour"
                           value={node?.color ?? '#9a95ff'}
                           onChange={e => patchNode(ctx.id, { color: e.target.value })} />
                  </div>
                  <div className="map-ctx-hint">Give a room a colour + a label to add your own category to the legend.</div>
                  <div className="map-ctx-item map-ctx-danger" onClick={() => { deleteNode(ctx.id); setCtx(null) }}>Delete room</div>
                </>
              )}
            </div>
          )
        })()}
      </div>
    </div>,
    document.body,
  )
}
