import { Tooltip } from './Tooltip'
import { IconPopOut, IconPopIn } from './Icons'

/**
 * The pop-out control, the same icon everywhere it's offered. `popped` flips it to
 * the put-it-back glyph for a panel that is already in its own window. Styling is
 * the caller's — it sits in toolbars that each have their own button look — plus
 * `popout-btn`, which only centres the icon.
 */
export function PopoutButton({ onClick, label, popped = false, className = '' }: {
  onClick:    () => void
  label:      string
  popped?:    boolean
  className?: string
}) {
  return (
    <Tooltip text={label}>
      <button className={`popout-btn ${className}`.trim()} onClick={onClick} aria-label={label}>
        {popped ? <IconPopIn /> : <IconPopOut />}
      </button>
    </Tooltip>
  )
}
