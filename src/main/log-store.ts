import { join } from 'path'
import { mkdirSync, appendFileSync, existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs'

// ── Optional game-output file logging ───────────────────────────────────────────
// Off by default (toggled in Settings). When on, appends the visible game text to a
// per-character, per-day file in SHARED_DIR/logs/ (e.g. logs/refia-2026-07-09.log).
// Lich already logs when it's the proxy; this covers direct connections / users who
// want Magiloom's own log. Writes are best-effort (never throw into the game loop).
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

  constructor(sharedDir: string) {
    this.dir = join(sharedDir, 'logs')
    try { mkdirSync(this.dir, { recursive: true }) } catch { /* ignore */ }
  }

  setEnabled(on: boolean): void { this.enabled = on }
  isEnabled(): boolean { return this.enabled }

  setChar(name: string): void {
    const slug = logSlug(name)
    if (slug !== this.char) { this.char = slug; this.curFile = null }
  }

  /** Current character slug — so callers can tell whose logging flag applies. */
  currentChar(): string { return this.char }

  // Write one visible line (already XML-stripped) with a timestamp.
  writeLine(text: string): void {
    if (!this.enabled) return
    const t = text.replace(/[\r\n]+/g, ' ').replace(/  +/g, ' ').trim()
    if (!t || t === '>' || t === 'R>') return
    const day = new Date().toISOString().slice(0, 10)
    if (this.curFile === null || day !== this.curDay) {
      this.curDay = day
      this.curFile = join(this.dir, `${this.char}-${day}.log`)
    }
    const stamp = new Date().toTimeString().slice(0, 8)
    try { appendFileSync(this.curFile, `[${stamp}] ${t}\n`, 'utf8') } catch { /* best effort */ }
  }

  // ── Reading back (powers Settings → Lich → Logs) ────────────────────────────
  // The log dir is flat and every file is `<charslug>-<YYYY-MM-DD>.log`, so the
  // name itself is the jail: anything not matching that shape is rejected, which
  // leaves no room for traversal (no separators are valid in the pattern).

  listFiles(): LogFileEntry[] {
    const out: LogFileEntry[] = []
    if (!existsSync(this.dir)) return out
    for (const name of readdirSync(this.dir)) {
      const m = LOG_NAME.exec(name)
      if (!m) continue
      try {
        const st = statSync(join(this.dir, name))
        if (st.isFile()) out.push({ name, char: m[1], day: m[2], size: st.size, mtime: st.mtimeMs })
      } catch { /* skip unreadable */ }
    }
    // Newest first — a day's play is usually what you want to look at.
    return out.sort((a, b) => b.name.localeCompare(a.name))
  }

  // Read a log for display/download. A long session can run to many MB, and the
  // web client pulls this over the WebSocket, so we return at most `maxBytes`
  // from the END (the recent lines are the interesting ones) and say so via
  // `truncated`; the first partial line is dropped so output starts cleanly.
  readFile(name: string, maxBytes = 2 * 1024 * 1024): LogFileRead {
    if (!LOG_NAME.test(name)) throw new Error('Not a log file: ' + name)
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

export interface LogFileEntry {
  name:  string   // full filename, e.g. refia-2026-07-09.log
  char:  string   // character slug
  day:   string   // YYYY-MM-DD
  size:  number
  mtime: number
}

export interface LogFileRead {
  name:      string
  content:   string
  size:      number   // full on-disk size, even when truncated
  truncated: boolean
}

// Strip XML tags + decode the few entities DR uses, yielding plain visible lines.
export function stripToLines(rawChunk: string): string[] {
  return rawChunk
    .replace(/<[^>]+>/g, '\n')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n')
}
