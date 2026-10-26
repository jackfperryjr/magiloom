import { emptyArt, type EmptyArtKind } from '../../lib/artAssets'

/**
 * A panel's "nothing here yet" message with Loomy acting it out above it. Falls
 * back to the plain message if the vignette is missing. `compact` is for a message
 * inside a panel section (no coins, under the wealth tiles) rather than an empty panel.
 */
export function EmptyState({ art, compact = false, children }: {
  art: EmptyArtKind
  compact?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const src = emptyArt(art)
  return (
    <div className={'panel-empty panel-empty-art' + (compact ? ' is-compact' : '')}>
      {src && <img className="empty-art-img" src={src} alt="" draggable={false} />}
      <div className="empty-art-text">{children}</div>
    </div>
  )
}
