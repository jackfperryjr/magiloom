import { join } from 'path'
import { mkdirSync, appendFileSync } from 'fs'

// ── Optional game-output file logging ───────────────────────────────────────────
// Off by default (toggled in Settings). When on, appends the visible game text to a
// per-character, per-day file in SHARED_DIR/logs/ (e.g. logs/refia-2026-07-09.log).
// Lich already logs when it's the proxy; this covers direct connections / users who
// want Magiloom's own log. Writes are best-effort (never throw into the game loop).
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
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'unknown'
    if (slug !== this.char) { this.char = slug; this.curFile = null }
  }

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
}

// Strip XML tags + decode the few entities DR uses, yielding plain visible lines.
export function stripToLines(rawChunk: string): string[] {
  return rawChunk
    .replace(/<[^>]+>/g, '\n')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .split('\n')
}
