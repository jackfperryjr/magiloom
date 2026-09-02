import { join } from 'path'
import { mkdirSync, appendFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'fs'
import { StreamEventExtractor, toJsonl, EVENT_FORMAT_VERSION, stripToLines } from './stream-events'

// ── Optional game-output file logging ───────────────────────────────────────────
// Off by default (toggled in Settings). When on, appends the visible game text to a
// per-character, per-day file in SHARED_DIR/logs/ (e.g. logs/refia-2026-07-09.log).
// Lich already logs when it's the proxy; this covers direct connections / users who
// want Magiloom's own log. Writes are best-effort (never throw into the game loop).
//
// Alongside each text log we write a STRUCTURED SIDECAR, refia-2026-07-09.jsonl,
// holding typed events (experience, room changes, TDP totals) pulled straight from
// the XML before it's flattened. The text log is what a person reads; the sidecar is
// what a tool reads. It exists because flattening is lossy in a way that matters:
// tag-stripping splits one experience update across two lines and throws away the
// full skill name, leaving only an abbreviation, so anything computed from the text
// alone has to reconstruct and guess. The sidecar carries exact names, exact numbers
// and absolute timestamps, which is what makes an accurate experience-per-hour
// figure possible at all.
// Character name → the slug used in log filenames. Exported so callers can match
// a character against LogStore's current one (and filter the file list by it).
export function logSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown'
}

export class LogStore {
  private dir: string
  private enabled = false
  private char = 'unknown'
  private curFile: string | null = null
  private curDay = ''
  // One extractor per store, i.e. per game connection — see stream-events.ts for why
  // this is an instance rather than the renderer's module-level parser.
  private events = new StreamEventExtractor()
  private curEventFile: string | null = null

  constructor(sharedDir: string) {
    this.dir = join(sharedDir, 'logs')
    try { mkdirSync(this.dir, { recursive: true }) } catch { /* ignore */ }
  }

  setEnabled(on: boolean): void { this.enabled = on }
  isEnabled(): boolean { return this.enabled }

  setChar(name: string): void {
    const slug = logSlug(name)
    if (slug !== this.char) {
      this.char = slug
      this.curFile = null
      this.curEventFile = null
      // A different character is a different stream; half-collected component text
      // from the previous one must not bleed into this one's first event.
      this.events.reset()
    }
  }

  /** Current character slug — so callers can tell whose logging flag applies. */
  currentChar(): string { return this.char }

  /**
   * Log one raw stream chunk: the human-readable lines AND the structured sidecar.
   * The single entry point matters — writing the two from separate call sites let
   * them disagree about which day's file they were appending to.
   */
  write(rawChunk: string): void {
    if (!this.enabled) return
    this.rollDay()
    for (const line of stripToLines(rawChunk)) this.writeLine(line)
    this.writeEvents(rawChunk)
  }

  /** Point both files at today, opening a new pair when the date rolls over. */
  private rollDay(): void {
    const day = new Date().toISOString().slice(0, 10)
    if (this.curFile !== null && day === this.curDay) return
    this.curDay = day
    this.curFile      = join(this.dir, `${this.char}-${day}.log`)
    this.curEventFile = join(this.dir, `${this.char}-${day}.jsonl`)
    // Stamp a fresh sidecar so a reader can tell whose it is and which shape it's in
    // without inferring either from the filename.
    if (!existsSync(this.curEventFile)) {
      this.append(this.curEventFile, toJsonl([
        { t: Date.now(), e: 'session', char: this.char, version: EVENT_FORMAT_VERSION },
      ]))
    }
  }

  // Write one visible line (already XML-stripped) with a timestamp.
  writeLine(text: string): void {
    if (!this.enabled) return
    const t = text.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
    if (!t || t === '>' || t === 'R>') return
    this.rollDay()
    const stamp = new Date().toTimeString().slice(0, 8)
    this.append(this.curFile!, `[${stamp}] ${t}\n`)
  }

  /** Extract structured events from a raw chunk and append them to the sidecar. */
  private writeEvents(rawChunk: string): void {
    let batch: string
    try {
      const found = this.events.feed(rawChunk)
      if (!found.length) return
      batch = toJsonl(found)
    } catch {
      // Extraction must never break logging, let alone the game loop.
      return
    }
    this.append(this.curEventFile!, batch)
  }

  private append(file: string, data: string): void {
    try { appendFileSync(file, data, 'utf8') } catch { /* best effort */ }
  }

  // ── Reading back (powers Settings → Lich → Logs) ────────────────────────────
  // The log dir is flat and every file is `<charslug>-<YYYY-MM-DD>.log`, so the
  // name itself is the jail: anything not matching that shape is rejected, which
  // leaves no room for traversal (no separators are valid in the pattern).

  // Only the .log files are listed. The sidecar isn't a separate log — it's the same
  // session in another shape — so it's reported as a flag on its text log rather than
  // as a second entry a person could open and be baffled by.
  listFiles(): LogFileEntry[] {
    const out: LogFileEntry[] = []
    if (!existsSync(this.dir)) return out
    for (const name of readdirSync(this.dir)) {
      const m = LOG_NAME.exec(name)
      if (!m) continue
      try {
        const st = statSync(join(this.dir, name))
        if (!st.isFile()) continue
        out.push({
          name, char: m[1], day: m[2], size: st.size, mtime: st.mtimeMs,
          events: existsSync(join(this.dir, eventName(name))),
        })
      } catch { /* skip unreadable */ }
    }
    // Newest first — a day's play is usually what you want to look at.
    return out.sort((a, b) => b.name.localeCompare(a.name))
  }

  /**
   * Read the structured sidecar for a text log. Takes the .log name (never a path
   * and never the .jsonl name) so the same validated-name jail applies, and the
   * caller can't ask for an arbitrary file by changing the extension.
   */
  readEvents(logName: string, maxBytes = 8 * 1024 * 1024): LogFileRead {
    if (!LOG_NAME.test(logName)) throw new Error('Not a log file: ' + logName)
    return this.readByName(eventName(logName), maxBytes)
  }

  // Read a log for display/download. A long session can run to many MB, and the
  // web client pulls this over the WebSocket, so we return at most `maxBytes`
  // from the END (the recent lines are the interesting ones) and say so via
  // `truncated`; the first partial line is dropped so output starts cleanly.
  readFile(name: string, maxBytes = 2 * 1024 * 1024): LogFileRead {
    if (!LOG_NAME.test(name)) throw new Error('Not a log file: ' + name)
    return this.readByName(name, maxBytes)
  }

  /**
   * Delete a log and its event sidecar. Same validated-name jail as readFile — the
   * name must match `<charslug>-<YYYY-MM-DD>.log`, so no path can be expressed — and
   * the sidecar name is DERIVED from it rather than accepted, so a caller can never
   * name an arbitrary second file to remove.
   *
   * If the file being deleted is the one currently open, the next write reopens it:
   * rollDay() only re-derives on a date change, so curFile is cleared here too.
   */
  deleteFile(name: string): { removed: string[] } {
    if (!LOG_NAME.test(name)) throw new Error('Not a log file: ' + name)
    const removed: string[] = []
    for (const n of [name, eventName(name)]) {
      const p = join(this.dir, n)
      try {
        if (existsSync(p) && statSync(p).isFile()) { unlinkSync(p); removed.push(n) }
      } catch { /* leave what we can't remove */ }
    }
    if (!removed.length) throw new Error('Not found: ' + name)
    if (this.curFile && removed.includes(name)) { this.curFile = null; this.curEventFile = null }
    return { removed }
  }

  private readByName(name: string, maxBytes: number): LogFileRead {
    const abs = join(this.dir, name)
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('Not found: ' + name)
    const size = statSync(abs).size
    const start = Math.max(0, size - maxBytes)
    const len = size - start
    const buf = Buffer.alloc(len)
    const fd = openSync(abs, 'r')
    try { readSync(fd, buf, 0, len, start) } finally { closeSync(fd) }
    let content = buf.toString('utf8')
    if (start > 0) content = content.slice(content.indexOf('\n') + 1)
    return { name, content, size, truncated: start > 0 }
  }
}

const LOG_NAME = /^([a-z0-9]+)-(\d{4}-\d{2}-\d{2})\.log$/

/** Sidecar filename for a text log. Only ever applied to a LOG_NAME-validated name. */
export function eventName(logName: string): string {
  return logName.replace(/\.log$/, '.jsonl')
}

export interface LogFileEntry {
  name:  string   // full filename, e.g. refia-2026-07-09.log
  char:  string   // character slug
  day:   string   // YYYY-MM-DD
  size:  number
  mtime: number
  /** Whether a structured sidecar was written alongside this log. */
  events: boolean
}

export interface LogFileRead {
  name:      string
  content:   string
  size:      number   // full on-disk size, even when truncated
  truncated: boolean
}

// Re-exported from stream-events, where it now lives. It is pure string handling with
// no filesystem in sight, and THIS module imports fs and path — so anything in a
// browser bundle that wanted stripToLines (the Lich log reader does) was dragging all
// of node's built-ins in behind it. Kept exported here because callers already import
// it from this module.
export { stripToLines } from './stream-events'
