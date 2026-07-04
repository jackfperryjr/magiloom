import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'
import {
  roomAtom, activeSpellAtom, inventoryLinesAtom,
  expAtom, combatLinesAtom, atmoLinesAtom, convLinesAtom, deathsAtom,
  avatarsAtom, selfNameAtom, serverAvatarsAtom,
  type OutputLine,
} from '../../store/game'
import { resolveAvatarSrc } from '../../lib/avatar'
import { useEnsureAvatars } from '../../hooks/useAvatars'
import { Tooltip } from '../ui/Tooltip'

// ── Auto-scroll helper ─────────────────────────────────────────────────────────
// The actual scrollable box is the parent .panel-content-scroll (which has the
// real height cap); this wrapper itself can't be height-constrained via a %
// height since its parent's height is intrinsic, so we scroll the parent instead.
function ScrollPanel({ children, deps }: { children: React.ReactNode; deps: unknown[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current?.parentElement
    if (el) el.scrollTop = el.scrollHeight
  }, [deps])  // eslint-disable-line react-hooks/exhaustive-deps
  return <div ref={ref}>{children}</div>
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
  const activeSkills = exp.skills.filter(s => s.pct > 0)

  if (exp.skills.length === 0) {
    return <div className="panel-empty">Type EXP to load experience data</div>
  }
  if (activeSkills.length === 0) {
    return <div className="panel-empty">No skills have field experience</div>
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
          {activeSkills.map(s => (
            <tr key={s.name} className="exp-row">
              <td className="exp-skill">{s.name}</td>
              <td className="exp-rank">{s.rank}</td>
              <td className="exp-pct">{s.pct}%</td>
              <td className="exp-mind" style={{ color: mindColor(s.mindWord) }}>
                {s.mind}
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
// The speaker/verb prefix ("SoAndSo says") keeps its preset color; the quoted
// text is toned down to a soft (non-bright) white so the speech itself reads
// calmly while the colored prefix still identifies who's talking and how.
const convColor = (preset?: string) => {
  switch (preset) {
    case 'speech':  return 'var(--color-speech)'
    case 'whisper': return 'var(--color-whisper)'
    case 'thought': return 'var(--color-thought)'
    default:        return 'var(--text-main)'
  }
}

function ConvLine({ line }: { line: OutputLine }) {
  const color = convColor(line.styles[0]?.preset)
  const q = line.text.indexOf('"')
  if (q === -1) return <div className="conv-line" style={{ color }}>{line.text}</div>
  return (
    <div className="conv-line">
      <span style={{ color }}>{line.text.slice(0, q)}</span>
      <span style={{ color: 'var(--text-main)' }}>{line.text.slice(q)}</span>
    </div>
  )
}

// Group consecutive lines from the same speaker so the avatar shows once per
// turn (chat-app style) rather than on every line. Lines with no detected
// speaker stand on their own.
function groupBySpeaker(lines: OutputLine[]): { speaker?: string; lines: OutputLine[] }[] {
  const groups: { speaker?: string; lines: OutputLine[] }[] = []
  for (const l of lines) {
    const prev = groups[groups.length - 1]
    if (prev && prev.speaker && prev.speaker === l.speaker) prev.lines.push(l)
    else groups.push({ speaker: l.speaker, lines: [l] })
  }
  return groups
}

export function ConversationPanel() {
  const lines   = useAtomValue(convLinesAtom)
  const avatars = useAtomValue(avatarsAtom)
  const server  = useAtomValue(serverAvatarsAtom)
  const self    = useAtomValue(selfNameAtom)
  const groups  = groupBySpeaker(lines)
  useEnsureAvatars(groups.map(g => g.speaker).filter((s): s is string => !!s))
  if (lines.length === 0) return <div className="panel-empty">No conversation yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {groups.map(group => (
        <div key={group.lines[0].id} className={group.speaker ? 'conv-group' : undefined}>
          {group.speaker && (
            <Tooltip text={group.speaker}>
              <img className="conv-avatar" src={resolveAvatarSrc(group.speaker, avatars, server, self)} alt="" />
            </Tooltip>
          )}
          <div className="conv-group-body">
            {group.lines.map((l: OutputLine) => <ConvLine key={l.id} line={l} />)}
          </div>
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
