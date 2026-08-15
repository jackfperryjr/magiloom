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
      />
    </div>
  )
}
