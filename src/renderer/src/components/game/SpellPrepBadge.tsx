import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { activeSpellAtom, castTimeAtom, tickAtom } from '../../store/game'
import { useIsMobile } from '../../hooks/useIsMobile'

/** True while a spell is prepared (DR sends "None" once it's cast or released). */
export const isPreparing = (name: string): boolean => !!name && name !== 'None'

// Spell-prep timer, embedded in the command line just left of the RT badge. Two
// states: counting down while the pattern forms, then "ready" until DR sends
// <spell>None</spell> (cast or release) — holding a finished prep is the moment
// that matters mid-fight, so it stays up rather than vanishing at zero. On mobile
// the badge drops the spell name for room (tap to peek).
export function SpellPrepBadge() {
  const name    = useAtomValue(activeSpellAtom)
  const readyAt = useAtomValue(castTimeAtom)
  useAtomValue(tickAtom)   // re-render every second so the countdown ticks
  const isMobile = useIsMobile()
  const [peek, setPeek] = useState(false)

  // Collapse the peeked name again on its own, and whenever the prep changes.
  useEffect(() => {
    if (!peek) return
    const t = setTimeout(() => setPeek(false), 2500)
    return () => clearTimeout(t)
  }, [peek])
  useEffect(() => setPeek(false), [name])

  if (!isPreparing(name)) return null

  const known = readyAt > 0                       // castTime can trail the name by a line
  const left  = known ? Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)) : 0
  const ready = known && left === 0

  const status  = !known ? '…' : ready ? '✓' : `${left}s`
  const tooltip = ready ? `${name} — ready to cast` : `Preparing ${name}`
  const cls     = 'command-prep' + (ready ? ' prep-ready' : '') + (isMobile ? ' prep-compact' : '')

  return (
    <span
      className={cls}
      data-tooltip={isMobile ? undefined : tooltip}
      onClick={isMobile ? () => setPeek(p => !p) : undefined}
    >
      <span className="command-prep-label">
        {isMobile && !peek ? '✦' : name} {status}
      </span>
    </span>
  )
}
