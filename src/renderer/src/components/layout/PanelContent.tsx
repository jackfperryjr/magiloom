import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import {
  vitalsAtom, roomAtom, activeSpellAtom, roundtimeSecondsAtom,
  indicatorsAtom, inventoryLinesAtom,
  expAtom, combatLinesAtom, atmoLinesAtom, convLinesAtom, deathsAtom,
  type OutputLine,
} from '../../store/game'

// ── Auto-scroll helper ─────────────────────────────────────────────────────────
function ScrollPanel({ children, deps }: { children: React.ReactNode; deps: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [deps])  // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref} style={{ overflow: 'auto', maxHeight: '100%' }}>{children}</div>
}

export function RoomPanel() {
  const room = useAtomValue(roomAtom)
  const alsoHere = room.playerNames.length > 0 ? `Also here: ${room.playerNames.join(', ')}` : ''

  return (
    <div className="room-panel">
      <div className="room-name">Room: {room.name || '—'}</div>
      {room.description && <div className="room-desc">{room.description}</div>}
      {alsoHere && <div className="room-players">{alsoHere}</div>}
      {room.objs && <div className="room-objs">{room.objs}</div>}
      {room.exits.length > 0 && (
        <div className="room-exits">
          <span className="room-exits-label">Exits: </span>
          {room.exits.map((dir, i) => (
            <span key={dir}>
              <span
                className="game-link"
                onClick={() => window.dr.game.send(dir)}
                title={'go ' + dir}
              >
                {dir}
              </span>
              {i < room.exits.length - 1 && <span className="room-exits-sep">, </span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Vitals Panel ───────────────────────────────────────────────────────────────
function VitalRow({ label, value, max, cls }: {
  label: string; value: number; max: number; cls: string
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="vital-row">
      <span className="vital-label">{label}</span>
      <div className="vital-track">
        <div className={`vital-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="vital-value">{pct}%</span>
    </div>
  )
}

export function VitalsPanel() {
  const vitals     = useAtomValue(vitalsAtom)
  const rt         = useAtomValue(roundtimeSecondsAtom)
  const indicators = useAtomValue(indicatorsAtom)
  const active     = Object.entries(indicators).filter(([, v]) => v)

  return (
    <div className="vitals-panel">
      <VitalRow label="Health"  {...vitals.health}  cls="vital-health"  />
      <VitalRow label="Mana"  {...vitals.mana}    cls="vital-mana"    />
      <VitalRow label="Stamina"  {...vitals.stamina} cls="vital-stamina" />
      <VitalRow label="Spirit"  {...vitals.spirit}  cls="vital-spirit"  />
      {(rt > 0 || active.length > 0) && (
        <div className="vitals-status-row">
          {rt > 0 && <div className="roundtime-badge">RT: {rt}s</div>}
          {active.length > 0 && (
            <div className="indicators">
              {active.map(([id]) => <span key={id} className="indicator-badge">{id}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Experience Panel ───────────────────────────────────────────────────────────
const MIND_COLORS: Record<string, string> = {
  'clear':      'var(--text-dim)',
  'dabbling':   '#6bc5a0',
  'perusing':   '#5fbcd4',
  'learning':   '#6badd0',
  'absorbing':  '#7b8fe8',
  'mind lock':  '#e06060',
  'mind  lock': '#e06060',
}

function mindColor(word?: string): string {
  if (!word) return 'var(--text-dim)'
  return MIND_COLORS[word.toLowerCase()] ?? 'var(--text-main)'
}

export function ExperiencePanel() {
  const exp = useAtomValue(expAtom)

  if (exp.skills.length === 0) {
    return <div className="panel-empty">Type EXP to load experience data</div>
  }

  return (
    <div className="exp-panel">
      {(exp.tdps > 0 || exp.favors > 0) && (
        <div className="exp-meta">
          {exp.tdps   > 0 && <span className="exp-meta-item">TDPs: <b>{exp.tdps}</b></span>}
          {exp.favors > 0 && <span className="exp-meta-item">Favors: <b>{exp.favors}</b></span>}
        </div>
      )}
      <table className="exp-table">
        <tbody>
          {exp.skills.map(s => (
            <tr key={s.name} className="exp-row">
              <td className="exp-skill">{s.name}</td>
              <td className="exp-rank">{s.rank}</td>
              <td className="exp-pct">{s.pct}%</td>
              <td className="exp-mind" style={{ color: mindColor(s.mindWord) }}>
                {s.mindWord ?? s.mind}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Spells Panel ───────────────────────────────────────────────────────────────
export function SpellsPanel() {
  const spell = useAtomValue(activeSpellAtom)
  return spell
    ? <div className="active-spell">{spell}</div>
    : <div className="panel-empty">No active spell</div>
}

// ── Combat Panel ───────────────────────────────────────────────────────────────
export function CombatPanel() {
  const lines = useAtomValue(combatLinesAtom)
  if (lines.length === 0) return <div className="panel-empty">No combat yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map((l: OutputLine) => (
        <div key={l.id} className="combat-line">{l.text}</div>
      ))}
    </ScrollPanel>
  )
}

// ── Atmo Panel ─────────────────────────────────────────────────────────────────
export function AtmoPanel() {
  const lines = useAtomValue(atmoLinesAtom)
  if (lines.length === 0) return <div className="panel-empty">No atmospheric messages yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map((l: OutputLine) => (
        <div key={l.id} className="atmo-line">{l.text}</div>
      ))}
    </ScrollPanel>
  )
}

// ── Conversation Panel ─────────────────────────────────────────────────────────
const convColor = (preset?: string) => {
  switch (preset) {
    case 'speech':  return 'var(--color-speech)'
    case 'whisper': return 'var(--color-whisper)'
    case 'thought': return 'var(--color-thought)'
    default:        return 'var(--text-main)'
  }
}

export function ConversationPanel() {
  const lines = useAtomValue(convLinesAtom)
  if (lines.length === 0) return <div className="panel-empty">No conversation yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map((l: OutputLine) => (
        <div key={l.id} className="conv-line" style={{ color: convColor(l.styles[0]?.preset) }}>
          {l.text}
        </div>
      ))}
    </ScrollPanel>
  )
}

// ── Inventory Panel ────────────────────────────────────────────────────────────
export function InventoryPanel() {
  const lines = useAtomValue(inventoryLinesAtom)
  return lines.length === 0
    ? <div className="panel-empty">Type INV to see inventory</div>
    : <div>{lines.map((line, i) => <div key={i} className="inv-line">{line}</div>)}</div>
}

// ── Deaths Panel ───────────────────────────────────────────────────────────────
export function DeathsPanel() {
  const lines = useAtomValue(deathsAtom)
  if (lines.length === 0) return <div className="panel-empty">No deaths recorded</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map((l: OutputLine) => (
        <div key={l.id} className="death-line">{l.text}</div>
      ))}
    </ScrollPanel>
  )
}
