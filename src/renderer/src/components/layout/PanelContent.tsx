import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState, Fragment } from 'react'
import { createPortal } from 'react-dom'
import {
  roomAtom, activeSpellAtom, activeSpellsAtom, inventoryLinesAtom, handsAtom,
  expAtom, combatLinesAtom, atmoLinesAtom, convLinesAtom, thoughtLinesAtom, deathsAtom,
  avatarsAtom, selfNameAtom, serverAvatarsAtom, tickAtom, logonLinesAtom,
  type OutputLine,
} from '../../store/game'
import { invSnapshotAtom, invStatusAtom, refreshInventoryAtom } from '../../store/inventory'
import { isClosed, summarizeCarried } from '../../lib/inventory'
import { resolveAvatarSrc } from '../../lib/avatar'
import { groupExpSkills } from '../../lib/expGroups'
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
          {groupExpSkills(activeSkills).map(group => (
            <Fragment key={group.name}>
              <tr className="exp-group-head"><td colSpan={4}>{group.name}</td></tr>
              {group.skills.map(s => (
                <tr key={s.name} className="exp-row">
                  <td className="exp-skill">{s.name}</td>
                  <td className="exp-rank">{s.rank}</td>
                  <td className="exp-pct">{s.pct}%</td>
                  <td className="exp-mind" style={{ color: mindColor(s.mindWord) }}>
                    {s.mind}
                  </td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Spells Panel ───────────────────────────────────────────────────────────────
// Active buffs (name + expiry) come from DR's percWindow — see activeSpellsAtom.
// One roisaen ≈ one minute, so each row runs a live mm:ss countdown (driven by
// tickAtom) toward its `expires` time. The bar is relative to the longest-
// remaining spell; the final minutes turn amber/red so expiring buffs stand out.
// Colors: expiring (≤3 min) red, soon (≤8 min) amber, otherwise accent.
function spellDurColor(sec: number): string {
  if (sec <= 180) return 'var(--color-warning, #e06060)'
  if (sec <= 480) return '#e0b050'
  return 'var(--accent)'
}

// Gradient fill: darker at the base, brightening toward the leading edge for a
// subtle glow. color-mix keeps it in step with whichever expiry color is active.
function spellBarFill(color: string): string {
  return `linear-gradient(90deg, color-mix(in oklab, ${color} 35%, transparent) 0%, ${color} 100%)`
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function SpellsPanel() {
  const spells   = useAtomValue(activeSpellsAtom)
  const prepared = useAtomValue(activeSpellAtom)
  useAtomValue(tickAtom)   // re-render every second so the countdowns tick down

  if (spells.length === 0) {
    return prepared && prepared !== 'None'
      ? <div className="active-spell">Preparing: {prepared}</div>
      : <div className="panel-empty">No active spells</div>
  }

  const now = Date.now()
  const secLeft = (s: { expires: number }) => Math.max(0, Math.ceil((s.expires - now) / 1000))
  const max = Math.max(...spells.map(secLeft), 1)
  return (
    <div className="spells-panel">
      {spells.map(s => {
        const sec   = secLeft(s)
        const color = spellDurColor(sec)
        return (
          <div key={s.name} className="spell-row">
            <div className="spell-row-head">
              <span className="spell-name">{s.name}</span>
              <span className="spell-dur" style={{ color }}>{fmtDur(sec)}</span>
            </div>
            <div className="spell-bar-track">
              <div className="spell-bar-fill"
                   style={{ width: `${Math.min(100, (sec / max) * 100)}%`, background: spellBarFill(color) }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Combat Panel ───────────────────────────────────────────────────────────────
export function CombatPanel() {
  const lines = useAtomValue(combatLinesAtom)
  if (lines.length === 0) return <div className="panel-empty">No combat yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map((l: OutputLine) => (
        <div key={l.id} className="combat-line">
          <span className="panel-line-time">{convTime(l.timestamp)}</span>{l.text}
        </div>
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
        <div key={l.id} className="atmo-line">
          <span className="panel-line-time">{convTime(l.timestamp)}</span>{l.text}
        </div>
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

// ── Thoughts Panel ─────────────────────────────────────────────────────────────
// The ESP/amunet network, kept apart from the Conversation panel: it's a different
// room's worth of talk and on a busy network it buries what's actually being said
// in front of you.
//
// A networked thought reads "[General]-Prime:Someone: "text"" — a channel, the
// instance it came from, the sender, then the message. Splitting those out lets the
// channel become a chip and the sender a name, so the feed scans like a chat log
// instead of a wall of brackets. Anything that doesn't fit (a local "You think…",
// a system notice, an unfamiliar network format) falls back to the whole line, so
// nothing is ever hidden just because it wasn't recognised.
const THOUGHT_RE = /^\s*\[([^\]]+)\](?:\s*-\s*([A-Za-z]+))?\s*:\s*([A-Za-z][\w'-]*)\s*:\s*(.*)$/

interface ParsedThought { channel?: string; sender?: string; body: string }

function parseThought(l: OutputLine): ParsedThought {
  const m = THOUGHT_RE.exec(l.text)
  if (m) return { channel: m[1].trim(), sender: m[3], body: m[4].trim() }
  return { sender: l.speaker, body: l.text }
}

export function ThoughtsPanel() {
  const lines = useAtomValue(thoughtLinesAtom)
  if (lines.length === 0) return <div className="panel-empty">No thoughts yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map((l: OutputLine) => {
        const t = parseThought(l)
        return (
          <div key={l.id} className="thought-line">
            <span className="panel-line-time">{convTime(l.timestamp)}</span>
            <span className="thought-msg">
              {t.channel && <span className="thought-channel">{t.channel}</span>}
              {t.sender  && <span className="thought-sender">{t.sender}</span>}
              <span className="thought-text">{t.body}</span>
            </span>
          </div>
        )
      })}
    </ScrollPanel>
  )
}

// ── Inventory Panel ────────────────────────────────────────────────────────────
// A carry summary rather than a text dump: what's in each hand, what you're hauling,
// and one line per thing you're wearing or holding. It reads the structured snapshot
// (`_inventory manager`), so unlike the old INV capture it can't be silently wrong —
// the full tree, and anything actionable, lives in the item manager.
//
// The inv text stream is still shown as a fallback when no snapshot has been taken,
// so a character who typed INV isn't left staring at nothing.
const INV_HEADER_RE = /^\s*(?:your worn items are|you are wearing)\s*:?\s*$/i

/**
 * An empty hand. handsAtom stores '' for one (the game's own "Empty" is normalised
 * away in the store), so this is the single placeholder — one spelling, one style.
 * Lived in HudBar until the HUD's hands slot was removed as a duplicate of the two
 * rows below; this panel is the only place hands are shown now.
 */
function EmptyHand() {
  return <span className="hand-empty">empty</span>
}

export function InventoryPanel({ onManage }: { onManage?: () => void } = {}) {
  const lines    = useAtomValue(inventoryLinesAtom).filter(l => !INV_HEADER_RE.test(l))
  const snapshot = useAtomValue(invSnapshotAtom)
  const status   = useAtomValue(invStatusAtom)
  const hands    = useAtomValue(handsAtom)
  const refresh  = useSetAtom(refreshInventoryAtom)

  // Everything hanging off the character — what you'd actually be carrying. Items on
  // the ground are in the snapshot too, and are not your problem.
  //
  // This panel is the at-a-glance view, so it deliberately does NOT list what you're
  // wearing: that's a dozen-odd rows of jewellery and armour that change maybe once a
  // session, and it pushed the parts that DO change (hands, containers) off screen.
  // Worn items collapse to a single count here and live in full in the pop-out
  // manager. What's left is what you'd actually act on mid-session.
  const carried = useMemo(() => snapshot ? summarizeCarried(snapshot) : null, [snapshot])

  return (
    <div className="inv-sum">
      <div className="inv-sum-tools">
        {onManage && (
          <button className="inv-mgr-btn" onClick={onManage}>Manage items…</button>
        )}
        <button
          className="inv-mgr-btn"
          disabled={status === 'loading'}
          onClick={() => refresh(true)}
        >{status === 'loading' ? 'Reading…' : 'Refresh'}</button>
      </div>

      <div className="inv-sum-hands">
        <div><span className="inv-sum-label">Right</span><span>{hands.right || <EmptyHand />}</span></div>
        <div><span className="inv-sum-label">Left</span><span>{hands.left || <EmptyHand />}</span></div>
      </div>

      {snapshot && carried ? (
        <>
          {/* Three numbers, one row: what you're hauling, how many things that is,
              and how much of it is worn (the list this panel used to spell out). */}
          <div className="inv-sum-stats">
            <div className="inv-sum-stat" data-tooltip="Total weight of everything on you, in the game's raw units.">
              <span className="inv-sum-stat-n">{carried.weight}</span>
              <span className="inv-sum-stat-k">load</span>
            </div>
            <div className="inv-sum-stat" data-tooltip="Every item on you, including things inside containers.">
              <span className="inv-sum-stat-n">{carried.items}</span>
              <span className="inv-sum-stat-k">items</span>
            </div>
            <div className="inv-sum-stat" data-tooltip="Items you're wearing. Open the manager to see them.">
              <span className="inv-sum-stat-n">{carried.worn}</span>
              <span className="inv-sum-stat-k">worn</span>
            </div>
          </div>

          {/* Containers, with how many things are directly inside each. Capacity is
              deliberately not shown as a ratio: the server's weight and capacity
              figures are on different raw scales (see weightOf/capacityOf), so any
              "7/12" here would be invented. */}
          {carried.containers.length === 0
            ? <div className="panel-empty">Your containers are empty.</div>
            : carried.containers.map(({ item, count }) => (
                <div key={item.id} className="inv-sum-row" onClick={onManage}>
                  <span className="inv-sum-name">{item.name}</span>
                  {isClosed(item) && <span className="inv-sum-tag">closed</span>}
                  <span className="inv-sum-count">{count}</span>
                </div>
              ))}
        </>
      ) : lines.length > 0 ? (
        lines.map((line, i) => <div key={i} className="inv-line">{line}</div>)
      ) : (
        <div className="panel-empty">
          {status === 'loading' ? 'Reading your inventory…' : 'Refresh to read your inventory.'}
        </div>
      )}
    </div>
  )
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

// ── Connections Panel (logons / logoffs / disconnects) ──────────────────────────
export function ConnectionsPanel() {
  const lines = useAtomValue(logonLinesAtom)
  if (lines.length === 0) return <div className="panel-empty">No logons or logoffs yet</div>
  return (
    <ScrollPanel deps={[lines.length]}>
      {lines.map(l => (
        <div key={l.id} className={'conn-line conn-' + l.kind}>
          <span className="panel-line-time">{convTime(l.timestamp)}</span>
          <span className="conn-dot" />
          <span className="conn-text">{l.text}</span>
        </div>
      ))}
    </ScrollPanel>
  )
}
