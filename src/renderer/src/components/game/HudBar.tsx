import { useAtomValue } from 'jotai'
import { vitalsAtom } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'

// ── Vitals (compact bars) ─────────────────────────────────────────────────────
const VITALS: { key: 'health' | 'mana' | 'stamina' | 'spirit'; label: string; color: string }[] = [
  { key: 'health',  label: 'HP', color: 'var(--health-color)' },
  { key: 'mana',    label: 'MP', color: 'var(--mana-color)' },
  { key: 'stamina', label: 'ST', color: 'var(--stamina-color)' },
  { key: 'spirit',  label: 'SP', color: 'var(--spirit-color)' },
]

function VitalsGroup() {
  const vitals = useAtomValue(vitalsAtom)
  return (
    <div className="hud-vitals">
      {VITALS.map(v => {
        const st  = vitals[v.key]
        const pct = st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 0
        return (
          <div className="vital-mini" key={v.key} data-tooltip={`${v.label} ${Math.round(pct)}%`}>
            <span className="vital-mini-label" style={{ color: v.color }}>{v.label}</span>
            <div className="vital-mini-track">
              <div className={`vital-mini-fill vital-${v.key}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="vital-mini-num">{Math.round(pct)}</span>
          </div>
        )
      })}
    </div>
  )
}

// ── HUD bar — one thin strip directly above the command line ──────────────────
// Just the vitals, filling the width. Hands used to be pinned to a slot on the
// right; the Inventory panel now shows both hands (and always did on mobile, where
// the HUD slot was hidden), so the duplicate is gone. Posture and conditions live
// in the StatusPanel beside the command line; roundtime in it.
export function HudBar({ status }: { status: ConnectionStatus }) {
  if (status !== 'connected') return null
  return (
    <div className="hud-bar">
      <VitalsGroup />
    </div>
  )
}
