import { useAtomValue } from 'jotai'
import { vitalsAtom, vitalsSeenAtom } from '../../store/game'
import type { ConnectionStatus } from '../../store/game'

// ── Vitals (compact bars) ─────────────────────────────────────────────────────
const VITALS: { key: 'health' | 'mana' | 'stamina' | 'spirit'; label: string; color: string }[] = [
  { key: 'health',  label: 'HP', color: 'var(--health-color)' },
  { key: 'mana',    label: 'MP', color: 'var(--mana-color)' },
  { key: 'stamina', label: 'ST', color: 'var(--stamina-color)' },
  { key: 'spirit',  label: 'SP', color: 'var(--spirit-color)' },
]

function VitalsGroup({ stale }: { stale: boolean }) {
  const vitals = useAtomValue(vitalsAtom)
  const when = stale ? ' when you disconnected' : ''
  return (
    <div className="hud-vitals">
      {VITALS.map(v => {
        const st  = vitals[v.key]
        const pct = st.max > 0 ? Math.max(0, Math.min(100, (st.value / st.max) * 100)) : 0
        return (
          <div className="vital-mini" key={v.key} data-tooltip={`${v.label} ${Math.round(pct)}%${when}`}>
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
//
// After a disconnect the bars STAY, frozen where they were when the connection
// dropped, for the same reason the StatusPanel keeps its icons: how much health you
// had left when a script (or the game) logged you off is the thing you want to see.
// Nothing zeroes vitalsAtom on the way out, so it still holds the last real reading
// until the next login replaces it or a character switch resets it. Tooltips say it's
// a snapshot; the drained colour of the whole idle shell already makes it look like
// one. A window that never got a reading has only the 100% placeholder — not shown.
export function HudBar({ status }: { status: ConnectionStatus }) {
  const seen  = useAtomValue(vitalsSeenAtom)
  const stale = status !== 'connected'
  if (stale && !seen) return null
  return (
    <div className="hud-bar">
      <VitalsGroup stale={stale} />
    </div>
  )
}
