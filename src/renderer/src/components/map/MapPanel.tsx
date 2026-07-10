import { useMemo } from 'react'
import { useAtomValue } from 'jotai'
import { mapDbAtom, currentNodeIdAtom, walkStateAtom } from '../../store/map'
import { componentLayout } from '../../lib/mapper'
import { MapView } from './MapView'

export function MapPanel({ onNodeClick, onStopWalk, onExpand }: {
  onNodeClick?: (id: string) => void
  onStopWalk?:  () => void
  onExpand?:    () => void
}) {
  const db            = useAtomValue(mapDbAtom)
  const currentNodeId = useAtomValue(currentNodeIdAtom)
  const walk          = useAtomValue(walkStateAtom)
  // Render the connected map around the current room as one unified, tidy layout,
  // spanning zone boundaries (DR fragments areas across title-derived zones).
  const zone = useMemo(() => componentLayout(db, currentNodeId), [db, currentNodeId])

  return (
    <div className="map-panel">
      {onExpand && (
        <button className="map-expand-btn" data-tooltip="Open full map" onClick={onExpand}>⤢</button>
      )}
      <MapView
        db={db}
        zone={zone}
        currentNodeId={currentNodeId}
        selectedId={walk.active ? walk.targetId : null}
        onNodeClick={onNodeClick}
        walkActive={walk.active}
        onStopWalk={onStopWalk}
      />
    </div>
  )
}
