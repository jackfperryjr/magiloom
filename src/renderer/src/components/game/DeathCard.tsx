import { useEffect, useRef, useState } from 'react'
import { useAtomValue } from 'jotai'
import { indicatorsAtom, connectionStatusAtom, departTypedAtAtom } from '../../store/game'
import { deathCardFor, type DeathCard as Card } from '../../lib/artKeys'
import { deathArt } from '../../lib/artAssets'

/**
 * A painted card over the game text at the three turns of a death: dying, departing,
 * and being brought back. It reads the game's own dead indicator (IconDEAD, the
 * signal Lich's `dead?` uses) rather than matching death text, so it can't miss a
 * wording. Coming back to life is a depart if DEPART was typed in the last minute,
 * otherwise a resurrection.
 *
 * Shown briefly, then it fades; a click or Escape dismisses it sooner. The colour
 * drain while dead is a separate, lasting effect (AmbientOverlay's DeathWash).
 */
const CARD_MS   = 7000
const ARM_MS    = 8000    // ignore the indicator settling right after login
const DEPART_MS = 60_000

const COPY: Record<Card, { title: string; sub: string }> = {
  death:     { title: 'You have died.',        sub: 'Your spirit lingers. DEPART, or wait for someone to bring you back.' },
  depart:    { title: 'Your spirit departs.',  sub: 'It wakes again, far from where it fell.' },
  resurrect: { title: 'Life returns.',         sub: 'Someone has called you back.' },
}

export function DeathCard(): React.JSX.Element | null {
  const dead     = !!useAtomValue(indicatorsAtom).dead
  const status   = useAtomValue(connectionStatusAtom)
  const departAt = useAtomValue(departTypedAtAtom)
  const [card, setCard] = useState<Card | null>(null)
  const prev    = useRef<boolean | null>(null)
  const armedAt = useRef(Infinity)

  // A fresh connection replays the indicators; only changes after it settles count.
  useEffect(() => {
    armedAt.current = status === 'connected' ? Date.now() + ARM_MS : Infinity
    prev.current = null
    if (status !== 'connected') setCard(null)
  }, [status])

  useEffect(() => {
    const was = prev.current
    prev.current = dead
    if (was === null || Date.now() < armedAt.current) return
    const next = deathCardFor(was, dead, Date.now() - departAt < DEPART_MS)
    if (next) setCard(next)
  }, [dead, departAt])

  useEffect(() => {
    if (!card) return
    const t = window.setTimeout(() => setCard(null), CARD_MS)
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', onKey)
    return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey) }
  }, [card])

  if (!card) return null
  const src = deathArt(card)
  return (
    <div className={`death-card death-card-${card}`} role="status" onClick={() => setCard(null)}>
      {src && <img className="death-card-img" src={src} alt="" draggable={false} />}
      <div className="death-card-text">
        <div className="death-card-title">{COPY[card].title}</div>
        <div className="death-card-sub">{COPY[card].sub}</div>
      </div>
    </div>
  )
}
