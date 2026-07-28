/**
 * Reading Lich's own logs.
 *
 * Lich keeps its own record alongside whatever the front end does, at
 * `Lich5/logs/DR-<Character>/<YYYY>/<MM>/<YYYY-MM-DD_HH-MM-SS>.{log,xml}` — two files
 * per session:
 *
 *   • `.xml` — the RAW game stream, tags and all. This is the good one, and it is
 *     strictly better than anything Magiloom writes: nothing has been flattened, so
 *     room names (an XML attribute) and full skill names (a tag id) are all still
 *     there. It feeds the same StreamEventExtractor the live sidecar uses.
 *   • `.log` — the same session flattened to readable text. Useful to a person,
 *     nearly useless to a tool: see the note on `looksLikeLichText` below.
 *
 * TIMING. Lich doesn't stamp each line the way Magiloom does, which at first looks
 * fatal — active time, ranks/hour and time-per-room all hang off per-line timestamps.
 * The stream supplies it instead: `<prompt time="1783010459">` carries a real epoch
 * and arrives after every command. Each run of output is therefore stamped with the
 * time of the prompt that TERMINATES it, which is when that output finished arriving.
 * Verified against a real capture — the first prompt in a session matches both the
 * file's header line and its filename to the second.
 *
 * CHARACTER NAME. Not in the file. It lives only in the directory name (`DR-Refia`),
 * so it's taken from the path when the browser supplies one (a folder pick does) and
 * is otherwise unknown — which is why the UI offers "choose folder".
 */

import { StreamEventExtractor, stripToLines, type StreamEvent } from '../../main/stream-events'
import type { ParsedLog, RawLine } from './logAnalysis'

export type LichKind = 'xml' | 'text' | 'not-lich'

export interface LichParsed {
  kind:   LichKind
  log:    ParsedLog
  events: StreamEvent[]
}

/** `<prompt time="1783010459">` — epoch SECONDS, and the only clock in the file. */
const PROMPT_RE = /<prompt\s+time=(['"])(\d+)\1/g

/** Lich's XML logs open with a date line, then immediately start emitting tags. */
const XML_HEADER_RE = /^\s*(\d{4})-(\d{2})-(\d{2})\s+\d{1,2}:\d{2}\s*(am|pm)?/i

/** The flattened `.log` opens with a full timestamp including a UTC offset. */
const TEXT_HEADER_RE = /^\s*(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}:\d{2}\.\d+\s*[+-]\d{2}:\d{2}/

/** Filenames Lich writes: 2026-07-02_11-41-01.xml */
const LICH_NAME_RE = /(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.(xml|log)$/i

/** The character lives in the directory: .../logs/DR-Refia/2026/07/… */
const CHAR_DIR_RE = /(?:^|[\\/])(?:DR|GS)-([A-Za-z][A-Za-z'-]*)(?:[\\/]|$)/

export function looksLikeLichXml(content: string): boolean {
  // Tag-dense from the very start, unlike a Magiloom log where tags are long gone.
  const head = content.slice(0, 4000)
  return /<(streamWindow|prompt|component|pushStream|compDef)\b/i.test(head)
}

/**
 * The flattened Lich log. Recognisable, but it carries no per-line time at all — only
 * the one header stamp — so every duration this tool reports would be a fabrication.
 * Detected purely so the UI can say "use the .xml next to it" instead of failing.
 */
export function looksLikeLichText(content: string): boolean {
  return TEXT_HEADER_RE.test(content.slice(0, 200)) && !looksLikeLichXml(content)
}

/** Character name from a path like `DR-Refia/2026/07/…`, or '' when there's no path. */
export function charFromPath(path: string): string {
  const m = CHAR_DIR_RE.exec(path)
  return m ? m[1].toLowerCase() : ''
}

/** Session start from the filename, else the header line, else 0. */
function baseTime(fileName: string, content: string): { ms: number; day: string } {
  const fm = LICH_NAME_RE.exec(fileName)
  if (fm) {
    const [, y, mo, d, h, mi, s] = fm
    return { ms: Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}`), day: `${y}-${mo}-${d}` }
  }
  const hm = XML_HEADER_RE.exec(content) ?? TEXT_HEADER_RE.exec(content)
  if (hm) {
    const day = `${hm[1]}-${hm[2]}-${hm[3]}`
    return { ms: Date.parse(`${day}T00:00:00`), day }
  }
  return { ms: 0, day: '' }
}

/**
 * Parse a Lich XML log into the same shape the analyzer already consumes: timed text
 * lines plus structured events. Both come from one pass, so they agree on timing.
 */
export function parseLichXml(fileName: string, content: string, path = ''): LichParsed {
  const { ms: base, day } = baseTime(fileName, content)
  const char = charFromPath(path || fileName) || 'unknown'

  const extractor = new StreamEventExtractor()
  const events: StreamEvent[] = []
  const lines: RawLine[] = []

  const flush = (segment: string, at: number): void => {
    if (!segment) return
    try {
      events.push(...extractor.feed(segment, at))
    } catch { /* a malformed run costs its events, not the whole file */ }
    // Same flattening the text logs get, so prose matching (kills, deaths, coins)
    // behaves identically whichever kind of log it came from.
    for (const raw of stripToLines(segment)) {
      const t = raw.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
      if (!t || t === '>' || t === 'R>') continue
      lines.push({ at, text: t })
    }
  }

  PROMPT_RE.lastIndex = 0
  let pos = 0
  let last = base
  let m: RegExpExecArray | null
  while ((m = PROMPT_RE.exec(content)) !== null) {
    const at = +m[2] * 1000
    // Output is stamped with the prompt that ENDS it — that's when it finished.
    flush(content.slice(pos, m.index), at)
    pos = m.index
    last = at
  }
  flush(content.slice(pos), last)

  return {
    kind: 'xml',
    log: { char, day, name: fileName, lines },
    events,
  }
}

/**
 * Classify and parse any dropped file that might be a Lich log. Returns 'not-lich'
 * when it isn't one, so the caller can fall back to the Magiloom format.
 */
export function parseLichLog(fileName: string, content: string, path = ''): LichParsed {
  if (looksLikeLichXml(content)) return parseLichXml(fileName, content, path)
  if (looksLikeLichText(content)) {
    const { day } = baseTime(fileName, content)
    return {
      kind: 'text',
      log: { char: charFromPath(path || fileName) || 'unknown', day, name: fileName, lines: [] },
      events: [],
    }
  }
  return { kind: 'not-lich', log: { char: 'unknown', day: '', name: fileName, lines: [] }, events: [] }
}
