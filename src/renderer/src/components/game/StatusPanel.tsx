import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { indicatorsAtom } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'
import { PostureSprite, PostureFrame, CONDITIONS, currentPosture } from './StatusIcons'
import { useIsMobile } from '../../hooks/useIsMobile'

// ── Status panel (posture + condition icons, beside the command line) ─────────
// A posture stick-figure that changes with your body position, plus one icon per
// danger/state condition — dimmed when clear, lit (red, or green for Hidden) when
// active. Icons carry tooltips instead of text badges.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Posture + condition icons, embedded on the right of the command input (like the
// roundtime badge). Inline icon group — no card of its own.
export function StatusPanel({ status }: { status: ConnectionStatus }) {
  const indicators = useAtomValue(indicatorsAtom)
  const isMobile = useIsMobile()
  const [showConds, setShowConds] = useState(false)
  if (status !== 'connected') return null
  const posture = currentPosture(indicators)
  const hasDanger = CONDITIONS.some(c => c.danger && indicators[c.id])
  return (
    <div className="status-icons">
      {/* Posture sprite. On mobile the conditions collapse into a popup, so the sprite
          is a button that opens it; on desktop/web the conditions show inline (below),
          so it's just a static indicator — no click-for-status affordance. */}
      {isMobile ? (
        <button
          className="status-icon status-posture"
          data-tooltip={cap(posture) + ' · tap for status'}
          onClick={() => setShowConds(v => !v)}
        >
          <PostureSprite />
          {hasDanger && <span className="status-posture-alert" />}
        </button>
      ) : (
        <span className="status-icon status-posture" data-tooltip={cap(posture)}>
          <PostureSprite />
          {hasDanger && <span className="status-posture-alert" />}
        </span>
      )}
      <span className="status-conds-inline">
        <span className="status-panel-sep" />
        {CONDITIONS.map(c => {
          const on = !!indicators[c.id]
          return (
            <span
              key={c.id}
              className={`status-icon status-cond-${c.id}` + (on ? (c.danger ? ' active-danger' : ' active-good') : '')}
              data-tooltip={on ? c.label : `Not ${c.label}`}
            >
              {c.icon}
            </span>
          )
        })}
      </span>
      {isMobile && showConds && <>
        <div className="status-pop-backdrop" onClick={() => setShowConds(false)} />
        <div className="status-pop">
          <span className="status-pop-posture"><PostureFrame posture={posture} /> {cap(posture)}</span>
          <div className="status-pop-grid">
            {CONDITIONS.map(c => {
              const on = !!indicators[c.id]
              return (
                <div key={c.id} className={'status-pop-row' + (on ? (c.danger ? ' active-danger' : ' active-good') : '')}>
                  <span className="status-pop-icon">{c.icon}</span>
                  <span className="status-pop-label">{on ? c.label : `Not ${c.label}`}</span>
                </div>
              )
            })}
          </div>
        </div>
      </>}
    </div>
  )
}
