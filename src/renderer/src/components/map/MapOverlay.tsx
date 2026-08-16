import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAtom, useAtomValue } from 'jotai'
import { mapDbAtom, currentNodeIdAtom, walkStateAtom, autoRecordAtom } from '../../store/map'
import { nodeZoneId, areaLayout, listAreas } from '../../lib/mapper'
import { emptyDb, type MapNode, type Zone } from '../../lib/mapModel'
import { reseed, hasSeed, recordedZone, clearRecorded } from '../../lib/mapSeed'
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
  // Web uses the shared server map; desktop uses a local per-user one. A few
  // destructive affordances differ between the two (see "Clear all" below).
  const isWeb = window.dr.app.platform === 'web'
  const [autoRecord, setAutoRecord] = useAtom(autoRecordAtom)

  // The "browse maps" list: one entry per walkable area, largest first. This is not
  // the same as db.zones — DR's title-derived zones are far finer-grained (a single
  // shop is its own zone), so listing them made a 200-entry dropdown of mostly
  // one-room stubs. An area merges the zones a town's streets are split across.
  const areas = useMemo(() => listAreas(db), [db])

  const [query, setQuery]   = useState('')
  const [focusId, setFocusId] = useState<string | null>(null)
  // One area at a time, rooted on the focused/searched room, else the current one.
  const rootId = focusId ?? currentNodeId ?? null
  const area = useMemo(() => areaLayout(db, rootId), [db, rootId])
  const zone: Zone = area.zone
  const zoneId = nodeZoneId(db, rootId ?? '') ?? null
  // Which area entry is showing — matched by membership, since any of its rooms
  // roots the same layout.
  const areaKey = useMemo(
    () => areas.find(a => zone.nodes[a.id])?.id ?? '',
    [areas, zone],
  )
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
        // Region and forageables are searchable too, which is what turns the box
        // into "where can I pick jadice flowers" rather than only room-name lookup.
        const hit = n.title.toLowerCase().includes(q)
          || (n.note ?? '').toLowerCase().includes(q)
          || (n.tag ?? '').toLowerCase().includes(q)
          || (n.region ?? '').toLowerCase().includes(q)
          || (n.forage ?? []).some(f => f.toLowerCase().includes(q))
        if (hit) {
          out.push({ id: n.id, title: n.title, zoneId: z.id, zoneName: n.region || z.name })
          if (out.length >= 40) return out
        }
      }
    }
    return out
  }, [query, db.zones])

  // ── DB mutation helpers (persist the touched zone) ──────────────────────────
  // recordedZone keeps the shipped rooms out of the player's store; a shipped room
  // they annotated counts as theirs and is kept, so notes and labels survive.
  const persist = (z: Zone) => window.dr.map.saveZone(recordedZone(z)).catch(() => {})

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

  // ── Clear ───────────────────────────────────────────────────────────────────
  // Strip the zone back to its shipped rooms (see clearRecorded). Their file for
  // the zone holds only their own rooms and annotations (see recordedZone), so once
  // those are gone there is nothing left to store.
  const clearRecordedInZone = (zid: string) => {
    setDb(prev => {
      const z = prev.zones[zid]
      if (!z) return prev
      window.dr.map.deleteZone(zid).catch(() => {})
      const kept = clearRecorded(z)
      const zones = { ...prev.zones }
      if (kept) zones[zid] = kept
      else delete zones[zid]
      return { ...prev, zones }
    })
    setFocusId(null)
  }

  // Destructive actions go through an inline confirm bar (no native confirm()).
  const runConfirm = () => {
    if (confirmState?.kind === 'zone' && zoneId) {
      clearRecordedInZone(zoneId)
      flash('Cleared the rooms you recorded in this zone.')
    } else if (confirmState?.kind === 'all') {
      // "Clear all" still goes through the whole-db path: the shipped rooms are not
      // the player's to delete, so they are put straight back, and the map after a
      // clear is the map you get on restart rather than an empty view that silently
      // repopulates later.
      window.dr.map.clear().catch(() => {})
      setDb(reseed(emptyDb()).db)
      flash(hasSeed() ? 'Your recorded mapping was cleared.' : 'World map cleared.')
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
          <select className="map-zone-select" value={areaKey}
                  onChange={e => setFocusId(e.target.value || null)}>
            {areas.length === 0 && <option value="">No maps yet</option>}
            {areas.map(a => (
              <option key={a.id} value={a.id}>{a.name} ({a.rooms})</option>
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
          <button className="map-tb-btn map-text-btn" onClick={() => zoneId && setConfirmState({ kind: 'zone', label: `Clear the rooms you recorded in "${db.zones[zoneId]?.name ?? 'this zone'}"? Rooms from the shipped map are kept.` })} disabled={!zoneId}>Clear zone</button>
          {/* "Clear all" wipes the WHOLE map. On the web client that map is the shared
              server DB, and the server refuses a remote wipe (operator-only) — so the
              button would do nothing there. Desktop's map is the user's own local DB,
              where clearing is legitimate, so it's shown only there. */}
          {!isWeb && (
            <button className="map-tb-btn map-text-btn" onClick={() => setConfirmState({ kind: 'all', label: 'Delete the ENTIRE recorded world map? This cannot be undone.' })} disabled={areas.length === 0}>Clear all</button>
          )}
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        {status && <div className="map-status-bar">{status}</div>}
        {confirmState && (
          <div className="map-confirm-bar">
            <span className="map-confirm-text">{confirmState.label}</span>
            <button className="map-tb-btn map-text-btn map-confirm-yes" onClick={runConfirm}>
              {confirmState.kind === 'zone' ? 'Clear' : 'Delete'}
            </button>
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
            exits={area.exits}
        labels={area.labels}
            onExitClick={id => setFocusId(id)}   // step through to the next area
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
              {editing ? (() => {
                const hasValue = edit!.field === 'tag' ? !!node?.tag : !!node?.note
                const removeField = () => {
                  patchNode(edit!.id, edit!.field === 'tag' ? { tag: undefined } : { note: undefined })
                  setEdit(null); setCtx(null)
                }
                return (
                  <div className="map-ctx-edit">
                    <input
                      autoFocus className="map-ctx-input"
                      placeholder={edit!.field === 'tag' ? 'Label — shown in the legend (first 3 chars on the node)' : 'Note'}
                      value={edit!.value}
                      onChange={e => setEdit({ ...edit!, value: e.target.value })}
                      onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEdit(null) }}
                    />
                    <div className="map-ctx-edit-actions">
                      <button className="map-tb-btn map-text-btn" onClick={commitEdit}>Save</button>
                      {hasValue && <button className="map-tb-btn map-text-btn map-ctx-danger" onClick={removeField}>Remove</button>}
                      <button className="map-tb-btn map-text-btn" onClick={() => setEdit(null)}>Cancel</button>
                    </div>
                  </div>
                )
              })() : (
                <>
                  <div className="map-ctx-item" onClick={() => { onWalkTo(ctx.id); setCtx(null) }}>Walk here</div>
                  <div className="map-ctx-item" onClick={() => setEdit({ id: ctx.id, field: 'tag', value: node?.tag ?? '' })}>{node?.tag ? 'Edit label…' : 'Set label…'}</div>
                  <div className="map-ctx-item" onClick={() => setEdit({ id: ctx.id, field: 'note', value: node?.note ?? '' })}>{node?.note ? 'Edit note…' : 'Add note…'}</div>
                  <div className="map-ctx-colors">
                    {NODE_COLORS.map(c => (
                      <button key={c || 'none'} className="map-ctx-swatch" data-tooltip={c || 'default (plain)'}
                              style={{ background: c || 'var(--panel-border, #444)' }}
                              onClick={() => patchNode(ctx.id, { color: c || 'none' })} />
                    ))}
                    <input type="color" className="map-ctx-colorpick" data-tooltip="Custom colour"
                           value={node?.color && node.color !== 'none' ? node.color : '#9a95ff'}
                           onChange={e => patchNode(ctx.id, { color: e.target.value })} />
                  </div>
                  <div className="map-ctx-hint">Give a room a colour + a label to add your own category to the legend. The first swatch resets to plain (no colour, even if auto-classified).</div>
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
