import { crestArt } from '../../lib/artAssets'
import { crestKey } from '../../lib/artKeys'

// "Guild" row with the guild's crest, for the character menu and the conversation
// profile card. Renders nothing when the guild is unknown, so a profile without one
// doesn't grow an empty row.
export function GuildRow({ guild }: { guild?: string | null }): React.JSX.Element | null {
  if (!guild) return null
  const key = crestKey(guild)
  const src = key ? crestArt(key) : undefined
  return (
    <div className="char-menu-field guild-row">
      <span className="char-menu-k">Guild</span>
      <span className="char-menu-v guild-row-v">
        {src && <img className="guild-crest" src={src} alt="" draggable={false} />}
        {guild}
      </span>
    </div>
  )
}
