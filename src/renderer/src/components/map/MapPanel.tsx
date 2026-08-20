import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { mapDbAtom, currentNodeIdAtom, walkStateAtom } from '../../store/map'
import { areaLayout } from '../../lib/mapper'
import { MapView } from './MapView'

export function MapPanel({ onNodeClick, onStopWalk, onExpand }: {
  onNodeClick?: (id: string) => void
  onStopWalk?:  () => void
  onExpand?:    () => void
}) {
  const db            = useAtomValue(mapDbAtom)
  const currentNodeId = useAtomValue(currentNodeIdAtom)
  const walk          = useAtomValue(walkStateAtom)
  // Just the area you're standing in — the town's street grid, this stretch of road,
  // this building. Everywhere it leads shows as a portal on the edge rather than
  // being inlined, which is what keeps the panel readable at a glance.
  const area = useMemo(() => areaLayout(db, currentNodeId), [db, currentNodeId])

  // No position yet — say so instead of drawing a map. areaLayout falls back to an
  // arbitrary first room when it has no root, which rendered a real room from
  // somewhere else in the world as though you were standing in it: the map looked
  // stuck on one place forever rather than looking like it had lost track of you.
  if (!currentNodeId) {
    return (
      <div className="map-panel">
        {onExpand && (
          <button className="map-expand-btn" data-tooltip="Open full map" onClick={onExpand}>⤢</button>
        )}
        <div className="map-nopos">
          <div className="map-nopos-title">Locating you…</div>
          <div className="map-nopos-hint">
            The map is watching for a room it recognises and will pick you up on its own.
            If it stays lost, this room isn't on the map yet — walk to a known one, or turn
            on auto-record to add it.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="map-panel">
      {onExpand && (
        <button className="map-expand-btn" data-tooltip="Open full map" onClick={onExpand}>⤢</button>
      )}
      <MapView
        db={db}
        zone={area.zone}
        exits={area.exits}
        labels={area.labels}
        currentNodeId={currentNodeId}
        selectedId={walk.active ? walk.targetId : null}
        onNodeClick={onNodeClick}
        onExitClick={onNodeClick}
        walkActive={walk.active}
        onStopWalk={onStopWalk}
        // The wheel belongs to the sidebar here — scrolling past the map shouldn't
        // zoom it. Use the toolbar +/− to zoom, or the popout, which keeps the wheel.
        wheelZoom={false}
        // The sidebar is a narrow column, so the full-map default zoom only ever
        // showed a couple of rooms around you. Start two toolbar clicks further out
        // so the surrounding block fits; the popout keeps the 1:1 default.
        initialZoom={1 / (1.2 * 1.2)}
      />
    </div>
  )
}
