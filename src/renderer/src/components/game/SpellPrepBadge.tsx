import { useEffect, useState } from 'react'
import { useAtomValue } from 'jotai'
import { activeSpellAtom, castTimeAtom, prepStartedAtom, tickAtom } from '../../store/game'
import { useIsMobile } from '../../hooks/useIsMobile'

// Spell-prep timer, embedded in the command line beside the RT badge. Two states:
// counting down while the pattern forms, then "ready" until DR sends
// <spell>None</spell> (cast or release) — holding a finished prep is the moment
// that matters mid-fight, so it stays up rather than vanishing at zero.
//
// The progress fill is a CSS animation keyed to this prep (duration = total prep,
// negative delay = time already elapsed) so it glides smoothly instead of stepping
// with the 1s tick. On mobile the badge drops the spell name for room (tap to
// peek) and the fill moves to a hairline across the top of the command pill.
export function SpellPrepBadge() {
  const name      = useAtomValue(activeSpellAtom)
  const readyAt   = useAtomValue(castTimeAtom)
  const startedAt = useAtomValue(prepStartedAtom)
  useAtomValue(tickAtom)   // re-render every second so the countdown ticks
  const isMobile  = useIsMobile()
  const [peek, setPeek] = useState(false)

  // Collapse the peeked name again on its own, and whenever the prep changes.
  useEffect(() => {
    if (!peek) return
    const t = setTimeout(() => setPeek(false), 2500)
    return () => clearTimeout(t)
  }, [peek])
  useEffect(() => setPeek(false), [name])

  if (!name || name === 'None') return null

  const now   = Date.now()
  const known = readyAt > 0                       // castTime can trail the name by a line
  const left  = known ? Math.max(0, Math.ceil((readyAt - now) / 1000)) : 0
  const ready = known && left === 0
  const total = known ? Math.max(1, readyAt - startedAt) : 0
  const fill  = known && !ready
    ? { animationDuration: `${total}ms`, animationDelay: `${-(now - startedAt)}ms` }
    : undefined

  const status  = !known ? '…' : ready ? '✓' : `${left}s`
  const tooltip = ready ? `${name} — ready to cast` : `Preparing ${name}`
  const cls     = 'command-prep' + (ready ? ' prep-ready' : '') + (isMobile ? ' prep-compact' : '')

  return (
    <>
      <span
        className={cls}
        data-tooltip={isMobile ? undefined : tooltip}
        onClick={isMobile ? () => setPeek(p => !p) : undefined}
      >
        {fill && <span key={`${startedAt}-${readyAt}`} className="command-prep-fill" style={fill} />}
        <span className="command-prep-label">
          {isMobile && !peek ? '✦' : name} {status}
        </span>
      </span>
      {isMobile && fill && (
        <span key={`${startedAt}-${readyAt}`} className="command-prep-line" style={fill} />
      )}
    </>
  )
}
