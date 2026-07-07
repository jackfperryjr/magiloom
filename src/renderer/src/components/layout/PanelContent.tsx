import { useAtomValue } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  roomAtom, activeSpellAtom, inventoryLinesAtom,
  expAtom, combatLinesAtom, atmoLinesAtom, convLinesAtom, deathsAtom,
  avatarsAtom, selfNameAtom, serverAvatarsAtom,
  type OutputLine,
} from '../../store/game'
import { resolveAvatarSrc } from '../../lib/avatar'
import { useEnsureAvatars } from '../../hooks/useAvatars'
import { useProfile } from '../../hooks/useProfile'
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
                data-tooltip={'go ' + dir}
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

// Third-person verb for the message-type label; "You" uses the base form.
const CONV_VERB: Record<string, [string, string]> = {
  speech:  ['says', 'say'],
  whisper: ['whispers', 'whisper'],
  thought: ['thinks', 'think'],
}
const convVerb = (preset: string | undefined, isYou: boolean): string => {
  const pair = preset ? CONV_VERB[preset] : undefined
  return pair ? pair[isYou ? 1 : 0] : ''
}

// Just the spoken part: from the first quote onward, dropping the "Name says,"
// lead-in (which now lives in the message header instead).
const convBody = (text: string): string => {
  const q = text.indexOf('"')
  return q === -1 ? text : text.slice(q)
}

// A directed message ("You whisper to Refia, ...", "Elanthys says to you, ...")
// names its target between the verb and the quote. Parse only the well-formed
// prefix before the quote so message bodies can't false-match.
const convTarget = (text: string): string | undefined => {
  const q = text.indexOf('"')
  if (q === -1) return undefined
  return text.slice(0, q).match(/\bto\s+([A-Z][a-z'-]+|you)\b/)?.[1]
}

const convTime = (ts: number): string => {
  const d = new Date(ts)
  const h = d.getHours() % 12 === 0 ? 12 : d.getHours() % 12
  const ampm = d.getHours() < 12 ? 'AM' : 'PM'
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`
}

// Group consecutive lines from the same speaker AND message type into one chat
// bubble, so the avatar + header show once per turn (Discord-style). Lines with
// no detected speaker stand on their own as plain system text.
function groupConversation(lines: OutputLine[]): { speaker?: string; preset?: string; target?: string; lines: OutputLine[] }[] {
  const groups: { speaker?: string; preset?: string; target?: string; lines: OutputLine[] }[] = []
  for (const l of lines) {
    const preset = l.styles[0]?.preset
    const target = convTarget(l.text)
    const prev = groups[groups.length - 1]
    if (prev && prev.speaker && prev.speaker === l.speaker && prev.preset === preset && prev.target === target) prev.lines.push(l)
    else groups.push({ speaker: l.speaker, preset, target, lines: [l] })
  }
  return groups
}

// Popup card shown when a conversation avatar is clicked — the same larger
// avatar + PROFILE summary as the character menu's header, for other players.
function ProfileCard({ name, src, x, y, onClose }: {
  name: string; src: string; x: number; y: number; onClose: () => void
}) {
  const profile = useProfile(name, true)
  return createPortal(
    <>
      <div className="profile-card-backdrop" onClick={onClose} />
      <div className="profile-card" style={{ left: x, top: y }} onClick={e => e.stopPropagation()}>
        <img className="profile-card-avatar" src={src} alt="" />
        <div className="profile-card-body">
          <div className="char-menu-name">{profile?.name || name}</div>
          <div className="char-menu-field"><span className="char-menu-k">Spouse</span><span className="char-menu-v">{profile?.spouse ?? '—'}</span></div>
          <div className="char-menu-field"><span className="char-menu-k">Roleplay</span><span className="char-menu-v">{profile?.roleplay ?? '—'}</span></div>
          <div className="char-menu-field"><span className="char-menu-k">PvP</span><span className="char-menu-v">{profile?.pvp ?? '—'}</span></div>
        </div>
      </div>
    </>,
    document.body,
  )
}

export function ConversationPanel() {
  const lines   = useAtomValue(convLinesAtom)
  const avatars = useAtomValue(avatarsAtom)
  const server  = useAtomValue(serverAvatarsAtom)
  const self    = useAtomValue(selfNameAtom)
  const groups  = groupConversation(lines)
  const [card, setCard] = useState<{ name: string; src: string; x: number; y: number } | null>(null)
  useEnsureAvatars(groups.map(g => g.speaker).filter((s): s is string => !!s))

  // Open the profile popup for a clicked avatar, positioned beside it (to the
  // left since the panel sits on the right edge), clamped to the viewport.
  const openCard = (e: React.MouseEvent, speaker: string, src: string) => {
    const name = speaker === 'You' ? self : speaker
    if (!name) return
    const r = e.currentTarget.getBoundingClientRect()
    const CARD_W = 290, CARD_H = 150
    let x = r.left - CARD_W - 10
    if (x < 8) x = Math.min(r.right + 10, window.innerWidth - CARD_W - 8)
    const y = Math.max(8, Math.min(r.top - 6, window.innerHeight - CARD_H - 8))
    setCard({ name, src, x, y })
  }

  if (lines.length === 0) return <div className="panel-empty">No conversation yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {groups.map(group => {
        // Lines with no detected speaker render as plain system text.
        if (!group.speaker) {
          return (
            <div key={group.lines[0].id} className="conv-msg conv-msg-plain">
              {group.lines.map(l => <div key={l.id} className="conv-msg-text">{l.text}</div>)}
            </div>
          )
        }
        const speaker = group.speaker
        const src   = resolveAvatarSrc(speaker, avatars, server, self)
        const color = convColor(group.preset)
        const verb  = convVerb(group.preset, speaker === 'You')
        const label = verb && group.target ? `${verb} to ${group.target}` : verb
        return (
          <div key={group.lines[0].id} className="conv-msg">
            <Tooltip text={`View ${speaker}`}>
              <img className="conv-avatar" src={src} alt=""
                onClick={e => openCard(e, speaker, src)} />
            </Tooltip>
            <div className="conv-msg-main">
              <div className="conv-msg-header">
                <span className="conv-msg-name" style={{ color }}>{speaker}</span>
                {label && <span className="conv-msg-verb">{label}</span>}
                <span className="conv-msg-time">{convTime(group.lines[0].timestamp)}</span>
              </div>
              {group.lines.map(l => (
                <div key={l.id} className="conv-msg-text">{convBody(l.text)}</div>
              ))}
            </div>
          </div>
        )
      })}
      {card && <ProfileCard {...card} onClose={() => setCard(null)} />}
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
        <div key={l.id} className="death-line">
          <span className="death-time">{convTime(l.timestamp)}</span>
          <span className="death-text">{l.text}</span>
        </div>
      ))}
    </ScrollPanel>
  )
}
