import { useAtomValue, useSetAtom } from 'jotai'
import { createPortal } from 'react-dom'
import { useEffect, useRef, useState, useLayoutEffect, useCallback } from 'react'
import { outputLinesAtom, avatarsAtom, serverAvatarsAtom, aiAvatarsAtom, selfNameAtom, connectionStatusAtom, type OutputLine } from '../../store/game'
import { parseExpSkills, type ParsedExpSkill } from '../../lib/exp-parser'
import type { LinkSpan } from '../../lib/sge-parser'
import { resolveAvatarSrc } from '../../lib/avatar'
import { promptFromLook } from '../../lib/lookPortrait'
import { useEnsureAvatars } from '../../hooks/useAvatars'
import type { Highlight } from '../ui/HighlightsModal'

// ── Exp skill line helpers ────────────────────────────────────────────────────
interface ParsedInfoPair  { label: string; value: string }

const MIND_COLORS_OUTPUT: Record<string, string> = {
  'clear':      'var(--text-dim)',
  'dabbling':   '#6bc5a0',
  'perusing':   '#5fbcd4',
  'learning':   '#6badd0',
  'absorbing':  '#7b8fe8',
  'mind lock':  '#e06060',
}

function mindColorOutput(word: string): string {
  return MIND_COLORS_OUTPUT[word.toLowerCase()] ?? 'var(--text-main)'
}

const INFO_PAIR_RE  = /([A-Za-z][A-Za-z]*?)\s*:\s+(.+?)(?=\s{3,}[A-Za-z]|\s*$)/g

function parseInfoPairs(text: string): ParsedInfoPair[] {
  INFO_PAIR_RE.lastIndex = 0
  const pairs: ParsedInfoPair[] = []
  let m: RegExpExecArray | null
  while ((m = INFO_PAIR_RE.exec(text)) !== null) {
    pairs.push({ label: m[1].trim(), value: m[2].trim() })
  }
  return pairs
}

// ── Preset class map ──────────────────────────────────────────────────────────
const PRESET_CLASS: Record<string, string> = {
  echo:           'preset-echo',
  'echo-script':  'preset-echo-script',
  roomname:       'preset-roomname',
  roomdesc:       'preset-roomdesc',
  roomexits:      'preset-roomexits',
  // DR's flowing room render uses camelCase preset ids for name/desc:
  roomName:       'preset-roomname',
  roomDesc:       'preset-roomdesc',
  whisper:        'preset-whisper',
  speech:         'preset-speech',
  thought:        'preset-thought',
  bonus:          'preset-bonus',
  penalty:        'preset-penalty',
  warning:        'preset-warning',
  mono:           'preset-mono',
}

function matchHighlight(text: string, highlights: Highlight[]): Highlight | null {
  for (const hl of highlights) {
    if (!hl.enabled || !hl.pattern) continue
    try {
      const match = hl.isRegex
        ? new RegExp(hl.pattern, 'i').test(text)
        : text.toLowerCase().includes(hl.pattern.toLowerCase())
      if (match) return hl
    } catch { /* invalid regex */ }
  }
  return null
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const h24 = d.getHours()
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  const ampm = h24 < 12 ? 'AM' : 'PM'
  return `[${h12}:${String(d.getMinutes()).padStart(2,'0')} ${ampm}] `
}

// Splice inline bold substrings (and any clickable links) into `text`, returning
// a mix of plain text, <span.game-link> and <span.text-bold> nodes. Links and
// bold spans are assumed not to overlap; a span starting inside an earlier one
// is skipped defensively.
function buildSpans(text: string, links: LinkSpan[], bolds: string[]): React.ReactNode[] {
  type Mark =
    | { start: number; end: number; kind: 'link'; link: LinkSpan }
    | { start: number; end: number; kind: 'bold' }
  const marks: Mark[] = []
  for (const l of links) {
    if (!l.text) continue
    const idx = text.indexOf(l.text)
    if (idx >= 0) marks.push({ start: idx, end: idx + l.text.length, kind: 'link', link: l })
  }
  for (const b of bolds) {
    if (!b) continue
    const idx = text.indexOf(b)
    if (idx >= 0) marks.push({ start: idx, end: idx + b.length, kind: 'bold' })
  }
  marks.sort((a, b) => a.start - b.start)

  const parts: React.ReactNode[] = []
  let pos = 0, key = 0
  for (const m of marks) {
    if (m.start < pos) continue  // overlaps an earlier span — skip
    if (m.start > pos) parts.push(<span key={key++}>{text.slice(pos, m.start)}</span>)
    if (m.kind === 'link') {
      const link = m.link
      parts.push(
        <span key={key++} className="game-link" onClick={() => _sendFn?.(expandCmd(link.cmd))} data-tooltip={link.cmd}>
          {text.slice(m.start, m.end)}
        </span>
      )
    } else {
      parts.push(<span key={key++} className="text-bold">{text.slice(m.start, m.end)}</span>)
    }
    pos = m.end
  }
  if (pos < text.length) parts.push(<span key={key++}>{text.slice(pos)}</span>)
  return parts
}

// LOOK-at-player portrait card: avatar on the left, description text on the right.
// Uses hooks (so only this rare card re-renders when avatars load); ensures the
// server-backed avatar for the name is fetched, then resolves custom → letter.
function LookCard({ name, lines }: { name: string; lines: string[] }) {
  const avatars       = useAtomValue(avatarsAtom)
  const serverAvatars = useAtomValue(serverAvatarsAtom)
  const aiAvatars     = useAtomValue(aiAvatarsAtom)
  const setAiAvatars  = useSetAtom(aiAvatarsAtom)
  const self          = useAtomValue(selfNameAtom)
  const status        = useAtomValue(connectionStatusAtom)
  useEnsureAvatars([name])

  const key       = name.trim().toLowerCase()
  const custom    = avatars[key] || serverAvatars[key]       // real upload / bucket image
  const realImage = custom || aiAvatars[key] || null         // a photo/portrait (not the letter)
  // Precedence: real image → AI-generated portrait → letter avatar.
  const src       = realImage || resolveAvatarSrc(name, avatars, serverAvatars, self)

  const [zoomed, setZoomed] = useState(false)
  useEffect(() => {
    if (!zoomed) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setZoomed(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zoomed])

  // Generate a portrait from the LOOK text when the character has no real avatar.
  // Cached server-side, so this fires at most once per character.
  useEffect(() => {
    if (status !== 'connected' || custom || aiAvatars[key] !== undefined) return
    let cancelled = false
    window.dr.portrait.generate(name, promptFromLook(lines))
      .then(url => { if (!cancelled) setAiAvatars(prev => ({ ...prev, [key]: url })) })
    return () => { cancelled = true }
  }, [key, name, lines, custom, aiAvatars, status, setAiAvatars])

  return (
    <div className="game-line look-card" data-copy-text={lines.join('\n')}>
      <img
        className={'look-avatar' + (realImage ? ' look-avatar-zoomable' : '')}
        src={src} alt={name}
        onClick={realImage ? () => setZoomed(true) : undefined}
        data-tooltip={realImage ? 'Click to enlarge' : undefined}
      />
      <div className="look-card-text">
        {lines.map((l, i) => <div key={i} className="look-card-line">{l}</div>)}
      </div>
      {zoomed && realImage && createPortal(
        <div className="modal-overlay look-lightbox" onClick={() => setZoomed(false)}>
          <img className="look-lightbox-img" src={realImage} alt={name} />
        </div>,
        document.body,
      )}
    </div>
  )
}

function GameLine({ line, highlights }: { line: OutputLine; highlights: Highlight[] }) {
  // LOOK-at-player block: portrait (avatar) beside the description text
  if (line.look) return <LookCard name={line.look.name} lines={line.look.lines} />

  // Chunk separator — a blank line's worth of space between command responses
  if (line.separator) return <div className="game-separator" aria-hidden />

  // Labeled divider (e.g. the "Disconnected" line): centered date+time on the
  // line, terminating into a red arrow badge with the white label.
  if (line.divider) {
    const stamp = new Date(line.timestamp).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
    return (
      <div className="game-divider game-divider-error">
        <span className="game-divider-line" />
        <span className="game-divider-time">{stamp}</span>
        <span className="game-divider-line" />
        <span className="game-divider-badge">{line.divider}</span>
      </div>
    )
  }

  const hl = matchHighlight(line.text, highlights)
  const isMention = _playerRe ? _playerRe.test(line.text) : false
  // Hover timestamp chip — only when the always-on timestamp setting is off.
  const hoverTime = _showTimestamps ? undefined : fmtTime(line.timestamp).trim()
  const isShopLine = Boolean(
    line.links?.some(l => l.cmd.startsWith('shop')) ||
    /\b(shop|goods for sale|you see:|shop window)\b/i.test(line.text)
  )
  const isShopHeader = /goods for sale|you see:|shop window/i.test(line.text)
  const isShopSurface = Boolean(line.links?.some(l => /^shop\s+#\d+$/i.test(l.cmd)))
  const isShopItem = Boolean(line.links?.some(l => /^shop\s+#\d+\s+on\s+#\d+$/i.test(l.cmd)))
  const isShopFooter = /\[type shop/i.test(line.text)
  const isShopDetail = /^(Short|Tap|Worn|Cost|Look|Read):/i.test(line.text.trim())

  const isExpLine = /\w[\w\s]*?:\s+\d+\s+\d+%\s+(?:[a-zA-Z][a-zA-Z ]*?\s+)?[\[\(]\d+\/\d+[\]\)]/.test(line.text)
  const isExpHeader = /Circle:|Showing all skills|SKILL:.*Rank|Total Ranks|Time Development|Overall state|EXP HELP/i.test(line.text)
  const isExpMeta = /Favors:|TDPs:|Deaths:|Departs:|Rested EXP|Cycle Refreshes/i.test(line.text)

  const isInfoLine = /^(Name|Race|Guild|Gender|Age|Circle|Strength|Reflex|Agility|Charisma|Discipline|Wisdom|Intelligence|Stamina|Concentration|Favors|TDPs|Encumbrance|Luck|Wealth|Debt|Max)\s*:/i.test(line.text.trim()) ||
                    /^You (were born|have \d+ active)/i.test(line.text.trim()) ||
                    /^\[You can pay/i.test(line.text.trim())

  const classList = ['game-line',
    ...line.styles.map(s => s.preset ? (PRESET_CLASS[s.preset] ?? '') : s.bold ? 'text-bold' : ''),
    isShopLine ? 'shop-line' : '',
    isShopHeader ? 'shop-header' : '',
    isShopSurface ? 'shop-surface' : '',
    isShopItem ? 'shop-item' : '',
    isShopDetail ? 'shop-detail' : '',
    isShopFooter ? 'shop-footer' : '',
    isExpLine ? 'exp-line' : '',
    isExpHeader ? 'exp-header' : '',
    isExpMeta ? 'exp-meta' : '',
    isInfoLine ? 'info-line' : '',
    isMention ? 'mention' : ''
  ].filter(Boolean)

  const style: React.CSSProperties = {}
  if (hl) {
    if (hl.color)   style.color      = hl.color
    if (hl.bgcolor) style.background = hl.bgcolor
    if (hl.bold)    style.fontWeight = 'bold'
  } else if (line.styles[0]?.color) {
    style.color = line.styles[0].color
  } else if (line.styles[0]?.bold) {
    style.fontWeight = 'bold'
  }

  // Inline bold spans (optionally alongside links) — splice them into the text
  // so emphasized words stay on the same line as their surrounding sentence.
  if (line.bolds && line.bolds.length > 0) {
    return (
      <div className={classList.join(' ')} style={style} data-copy-text={line.text} data-time={hoverTime}>
        {_showTimestamps && <span className="game-timestamp">{fmtTime(line.timestamp)}</span>}
        {buildSpans(line.text, line.links ?? [], line.bolds)}
      </div>
    )
  }

  // Render with clickable link spans if line has <d cmd> links
  if (line.links && line.links.length > 0) {
    const isExits = line.links.every(l => l.cmd.startsWith('go '))

    if (isExits) {
      const dirs = line.links.map(l => expandCmd(l.cmd))
      return (
        <div className={classList.join(' ')} style={style} data-copy-text={line.text} data-time={hoverTime}>
          <span style={{ color: 'var(--text-dim)' }}>Obvious paths: </span>
          {dirs.map((dir, i) => (
            <span key={dir}>
              <span className="game-link" onClick={() => _sendFn?.(dir)}>{dir}</span>
              {i < dirs.length - 1 && <span style={{ color: 'var(--text-dim)' }}>, </span>}
            </span>
          ))}
        </div>
      )
    }

    // Generic link rendering — splice links into surrounding text
    let remaining = line.text
    const parts: React.ReactNode[] = []
    let key = 0
    for (const link of line.links) {
      const idx = remaining.indexOf(link.text)
      if (idx === -1) continue
      if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>)
      parts.push(
        <span
          key={key++}
          className="game-link"
          onClick={() => _sendFn?.(expandCmd(link.cmd))}
          data-tooltip={link.cmd}
        >
          {link.text}
        </span>
      )
      remaining = remaining.slice(idx + link.text.length)
    }
    if (remaining) parts.push(<span key={key++}>{remaining}</span>)
    return <div className={classList.join(' ')} style={style} data-copy-text={line.text} data-time={hoverTime}>{parts}</div>
  }

  // Info attribute lines: parse Label: Value pairs into a 2-column grid
  if (isInfoLine) {
    const pairs = parseInfoPairs(line.text)
    if (pairs.length > 0) {
      return (
        <div className="game-line info-data-line" data-copy-text={line.text} data-time={hoverTime}>
          {_showTimestamps && <span className="game-timestamp">{fmtTime(line.timestamp)}</span>}
          <InfoPairHalf pair={pairs[0]} />
          {pairs[1] && (
            <>
              <div className="info-data-sep" />
              <InfoPairHalf pair={pairs[1]} />
            </>
          )}
        </div>
      )
    }
  }

  // Exp skill lines: parse and render in a 2-column grid so spaces don't collapse
  if (isExpLine) {
    const skills = parseExpSkills(line.text)
    if (skills.length > 0) {
      return (
        <div className="game-line exp-data-line" data-copy-text={line.text} data-time={hoverTime}>
          {_showTimestamps && <span className="game-timestamp">{fmtTime(line.timestamp)}</span>}
          <ExpSkillHalf s={skills[0]} />
          {skills[1] && (
            <>
              <div className="exp-data-sep" />
              <ExpSkillHalf s={skills[1]} />
            </>
          )}
        </div>
      )
    }
  }

  return (
    <div className={classList.join(' ')} style={style} data-copy-text={line.text} data-time={hoverTime}>
      {_showTimestamps && <span className="game-timestamp">{fmtTime(line.timestamp)}</span>}
      {line.text}
    </div>
  )
}

function ExpSkillHalf({ s }: { s: ParsedExpSkill }) {
  return (
    <div className="exp-data-half">
      <span className="exp-data-name">{s.name}</span>
      <span className="exp-data-rank">{s.rank}</span>
      <span className="exp-data-pct">{s.pct}%</span>
      <span className="exp-data-mind" style={{ color: mindColorOutput(s.mind) }}>
        {s.mind ? `${s.mind} (${s.frac})` : s.frac}
      </span>
    </div>
  )
}

function InfoPairHalf({ pair }: { pair: ParsedInfoPair }) {
  return (
    <div className="info-data-half">
      <span className="info-data-label">{pair.label}</span>
      <span className="info-data-value">{pair.value}</span>
    </div>
  )
}


// Strip "go " prefix — DR accepts bare directions: sw, n, northeast, etc.
function expandCmd(cmd: string): string {
  return cmd.replace(/^go\s+/, '')
}

let _highlights:      Highlight[] = []
export function setHighlights(h: Highlight[]) { _highlights = h }

let _sendFn: ((cmd: string) => void) | null = null
export function setSendFn(fn: (cmd: string) => void) { _sendFn = fn }

let _showTimestamps = false
export function setShowTimestamps(v: boolean) { _showTimestamps = v }

// Player name — used to flag lines that mention the current character (@mention).
let _playerRe: RegExp | null = null
export function setPlayerName(name: string) {
  const n = name.trim()
  _playerRe = n ? new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : null
}

let _outputBuffer = 5000
export function setOutputBuffer(v: number) { _outputBuffer = v }
export function getOutputBuffer() { return _outputBuffer }

export function GameOutput() {
  const lines        = useAtomValue(outputLinesAtom)
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef    = useRef<HTMLDivElement>(null)
  // Track whether user has scrolled up — use ref not state to avoid re-renders
  const userScrolled = useRef(false)
  const [showJump, setShowJump] = useState(false)

  // Use layoutEffect so scroll happens synchronously after DOM update,
  // preventing the flash of un-scrolled content. Keyed on `lines` so it only
  // auto-follows when new content arrives — otherwise an unrelated re-render
  // (e.g. hiding the jump button) would fire an instant scroll that clobbers
  // the smooth scroll from jumpToPresent.
  useLayoutEffect(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  }, [lines])

  // While a smooth jump-to-present is animating, onScroll fires at intermediate
  // (not-yet-at-bottom) positions; ignore those so the button doesn't flicker
  // back on. A real user scroll (wheel/touch) cancels the guard immediately.
  const isJumping = useRef(false)

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    if (isJumping.current) {
      if (atBottom) isJumping.current = false
      return
    }
    userScrolled.current = !atBottom
    setShowJump(prev => (prev === !atBottom ? prev : !atBottom))
  }

  const cancelJump = () => { isJumping.current = false }

  const jumpToPresent = () => {
    userScrolled.current = false
    isJumping.current = true
    setShowJump(false)
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleCopy = useCallback((e: React.ClipboardEvent<HTMLDivElement>) => {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !containerRef.current) return
    const range = selection.getRangeAt(0)
    const parts: string[] = []
    for (const el of containerRef.current.querySelectorAll<HTMLElement>('.game-line')) {
      if (!range.intersectsNode(el)) continue
      const elRange = document.createRange()
      elRange.selectNodeContents(el)
      const startsBefore = range.compareBoundaryPoints(Range.START_TO_START, elRange) <= 0
      const endsAfter    = range.compareBoundaryPoints(Range.END_TO_END, elRange) >= 0
      if (startsBefore && endsAfter) {
        // Whole line is selected — use the canonical formatted text (grid-laid-out
        // lines like exp/info rows lose their spacing if read from raw DOM text).
        parts.push(el.dataset.copyText ?? el.textContent ?? '')
      } else {
        // Only part of this line is selected — copy exactly that part, clamped
        // to the line's bounds, instead of falling back to the whole line.
        const clamped = document.createRange()
        clamped.setStart(startsBefore ? elRange.startContainer : range.startContainer,
                          startsBefore ? elRange.startOffset    : range.startOffset)
        clamped.setEnd(endsAfter ? elRange.endContainer : range.endContainer,
                        endsAfter ? elRange.endOffset    : range.endOffset)
        parts.push(clamped.toString())
      }
    }
    if (parts.length === 0) return
    e.clipboardData.setData('text/plain', parts.join('\n'))
    e.preventDefault()
  }, [])

  return (
    <>
      <div ref={containerRef} className="game-output" onScroll={handleScroll} onWheel={cancelJump} onTouchStart={cancelJump} onCopy={handleCopy}>
        {lines.map(line => (
          <GameLine key={line.id} line={line} highlights={_highlights} />
        ))}
        <div ref={bottomRef} />
      </div>
      {showJump && (
        <button className="jump-present" onClick={jumpToPresent}>
          Jump to present ↓
        </button>
      )}
    </>
  )
}
