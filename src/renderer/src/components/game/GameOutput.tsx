import { useAtomValue } from 'jotai'
import { useEffect, useRef, useLayoutEffect, useCallback } from 'react'
import { outputLinesAtom, type OutputLine } from '../../store/game'
import { parseExpSkills, type ParsedExpSkill } from '../../lib/exp-parser'
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
  whisper:        'preset-whisper',
  speech:         'preset-speech',
  thought:        'preset-thought',
  bonus:          'preset-bonus',
  penalty:        'preset-penalty',
  warning:        'preset-warning',
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
  return `[${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}] `
}

function GameLine({ line, highlights }: { line: OutputLine; highlights: Highlight[] }) {
  const hl = matchHighlight(line.text, highlights)
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
    isInfoLine ? 'info-line' : ''
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

  // Render with clickable link spans if line has <d cmd> links
  if (line.links && line.links.length > 0) {
    const isExits = line.links.every(l => l.cmd.startsWith('go '))

    if (isExits) {
      const dirs = line.links.map(l => expandCmd(l.cmd))
      return (
        <div className={classList.join(' ')} style={style} data-copy-text={line.text}>
          <span style={{ color: 'var(--text-dim)' }}>Obvious paths: </span>
          {dirs.map((dir, i) => (
            <span key={dir}>
              <span className="game-link" onClick={() => _sendFn?.(dir)} title={dir}>{dir}</span>
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
          title={link.cmd}
        >
          {link.text}
        </span>
      )
      remaining = remaining.slice(idx + link.text.length)
    }
    if (remaining) parts.push(<span key={key++}>{remaining}</span>)
    return <div className={classList.join(' ')} style={style} data-copy-text={line.text}>{parts}</div>
  }

  // Info attribute lines: parse Label: Value pairs into a 2-column grid
  if (isInfoLine) {
    const pairs = parseInfoPairs(line.text)
    if (pairs.length > 0) {
      return (
        <div className="game-line info-data-line" data-copy-text={line.text}>
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
        <div className="game-line exp-data-line" data-copy-text={line.text}>
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
    <div className={classList.join(' ')} style={style} data-copy-text={line.text}>
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

let _outputBuffer = 5000
export function setOutputBuffer(v: number) { _outputBuffer = v }
export function getOutputBuffer() { return _outputBuffer }

export function GameOutput() {
  const lines        = useAtomValue(outputLinesAtom)
  const containerRef = useRef<HTMLDivElement>(null)
  const bottomRef    = useRef<HTMLDivElement>(null)
  // Track whether user has scrolled up — use ref not state to avoid re-renders
  const userScrolled = useRef(false)

  // Use layoutEffect so scroll happens synchronously after DOM update,
  // preventing the flash of un-scrolled content
  useLayoutEffect(() => {
    if (!userScrolled.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' })
    }
  })

  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    userScrolled.current = !atBottom
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
    <div ref={containerRef} className="game-output" onScroll={handleScroll} onCopy={handleCopy}>
      {lines.map(line => (
        <GameLine key={line.id} line={line} highlights={_highlights} />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
