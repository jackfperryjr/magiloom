import { useState } from 'react'
import { useAtomValue } from 'jotai'
import { indicatorsAtom } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'
import { PostureIcon, CONDITIONS, currentPosture } from './StatusIcons'

// ── Status panel (posture + condition icons, beside the command line) ─────────
// A posture stick-figure that changes with your body position, plus one icon per
// danger/state condition — dimmed when clear, lit (red, or green for Hidden) when
// active. Icons carry tooltips instead of text badges.
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Posture + condition icons, embedded on the right of the command input (like the
// roundtime badge). Inline icon group — no card of its own.
export function StatusPanel({ status }: { status: ConnectionStatus }) {
  const indicators = useAtomValue(indicatorsAtom)
  const [showConds, setShowConds] = useState(false)
  if (status !== 'connected') return null
  const posture = currentPosture(indicators)
  const hasDanger = CONDITIONS.some(c => c.danger && indicators[c.id])
  return (
    <div className="status-icons">
      {/* Posture stick-figure — click to pop up the full condition list. On mobile
          this is the only status shown inline (conditions collapse into the popup). */}
      <button
        className="status-icon status-posture"
        data-tooltip={cap(posture) + ' · click for status'}
        onClick={() => setShowConds(v => !v)}
      >
        <PostureIcon posture={posture} />
        {hasDanger && <span className="status-posture-alert" />}
      </button>
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
      {showConds && <>
        <div className="status-pop-backdrop" onClick={() => setShowConds(false)} />
        <div className="status-pop">
          <span className="status-pop-posture"><PostureIcon posture={posture} /> {cap(posture)}</span>
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
