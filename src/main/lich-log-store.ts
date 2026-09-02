import { join, sep } from 'path'
import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, unlinkSync } from 'fs'

// ── Reading the Lich logs a session produced ────────────────────────────────────
// Lich keeps its own logs, separate from Magiloom's, inside its home — on desktop
// that's the directory holding lich.rbw; on the server it's the user's isolated home
// (magiserver/src/lich-home.ts). Either way the layout is per character and date:
//
//     DR-Refia/2026/07/2026-07-02_11-41-01.xml     ← the raw game stream
//     DR-Refia/2026/07/2026-07-02_11-41-01.log     ← the same session, flattened
//
// The .xml is the best record of a session that exists anywhere: nothing has been
// flattened out of it, so room names and full skill names survive, and `<prompt
// time=…>` gives it a real clock. That makes it worth exposing alongside Magiloom's
// own logs rather than leaving it stranded on disk.
//
// SAFETY. Magiloom's own log dir is flat, so a filename pattern was jail enough. This
// tree is nested, so the whole RELATIVE PATH is validated against one exact shape
// instead — character directory, year, month, Lich's timestamped filename. Nothing
// else is representable: no separators beyond the three, no traversal, no absolute
// paths, no extensions but .xml/.log. As with the flat store, the root is derived
// from the caller's account, never from anything they send.

/** The only path shape Lich writes, and therefore the only one we will read. */
const LICH_PATH_RE =
  /^(?:DR|GS)-[A-Za-z][A-Za-z'-]{0,30}\/\d{4}\/\d{2}\/\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.(?:xml|log)$/

/** Pull the character out of the leading directory. */
const CHAR_RE = /^(?:DR|GS)-([A-Za-z][A-Za-z'-]*)\//

export interface LichLogEntry {
  /** Relative path within the Lich logs dir — the handle for reading it back. */
  path:  string
  char:  string   // lowercased character name
  day:   string   // YYYY-MM-DD
  time:  string   // HH:MM:SS, since Lich rotates several times a day
  size:  number
  mtime: number
  /** True for the raw-stream .xml, which is the one worth analyzing. */
  xml:   boolean
}

export interface LichLogRead {
  path: string; content: string; size: number; truncated: boolean
}

/** Where Lich keeps its logs inside a user's home. */
export function lichLogsDir(lichHome: string): string {
  return join(lichHome, 'logs')
}

export interface ListLichOptions {
  limit?: number
  /**
   * Only the raw-stream `.xml`, which is the default and what the analyzer wants.
   * The `.log` beside it is the same session flattened with no per-line timestamps,
   * so nothing can be measured from it — and on a real install it's the MAJORITY of
   * the files (2,464 files, only 466 of them .xml), so including them would spend
   * most of the response budget on entries no caller can use.
   */
  xmlOnly?: boolean
}

/**
 * List a user's Lich logs, newest first.
 *
 * `limit` matters more here than for the flat store: Lich rotates a new file every
 * time it reconnects, so an active account accumulates thousands, and neither the
 * response nor the picker wants all of them.
 */
export function listLichLogs(lichHome: string, opts: ListLichOptions = {}): LichLogEntry[] {
  const { limit = 500, xmlOnly = true } = opts
  const root = lichLogsDir(lichHome)
  if (!existsSync(root)) return []

  const out: LichLogEntry[] = []

  // Walk exactly three levels — char / year / month — rather than recursing blindly.
  // The shape is fixed, so anything else in there isn't ours and isn't followed.
  for (const charDir of safeList(root)) {
    if (!/^(?:DR|GS)-/.test(charDir)) continue
    for (const year of safeList(join(root, charDir))) {
      if (!/^\d{4}$/.test(year)) continue
      for (const month of safeList(join(root, charDir, year))) {
        if (!/^\d{2}$/.test(month)) continue
        for (const file of safeList(join(root, charDir, year, month))) {
          const rel = `${charDir}/${year}/${month}/${file}`
          if (!LICH_PATH_RE.test(rel)) continue
          if (xmlOnly && !file.toLowerCase().endsWith('.xml')) continue
          try {
            const st = statSync(join(root, charDir, year, month, file))
            if (!st.isFile()) continue
            const m = /(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})\./.exec(file)
            out.push({
              path: rel,
              char: (CHAR_RE.exec(rel)?.[1] ?? 'unknown').toLowerCase(),
              day:  m?.[1] ?? '',
              time: m ? `${m[2]}:${m[3]}:${m[4]}` : '',
              size: st.size,
              mtime: st.mtimeMs,
              xml: file.toLowerCase().endsWith('.xml'),
            })
          } catch { /* skip unreadable */ }
        }
      }
    }
  }

  out.sort((a, b) => b.mtime - a.mtime)
  return out.slice(0, limit)
}

function safeList(dir: string): string[] {
  try { return readdirSync(dir) } catch { return [] }
}

/**
 * Read one Lich log. A busy session's .xml runs to several MB, so this returns at
 * most `maxBytes` from the END and says so — the same tail-read the flat store uses.
 * Starting mid-stream costs the extractor nothing: it resyncs at the next tag.
 */
export function readLichLog(lichHome: string, relPath: string, maxBytes = 8 * 1024 * 1024): LichLogRead {
  // Reject before touching the filesystem. Backslashes are normalised first so a
  // Windows-style path can't sidestep the pattern.
  const rel = relPath.replace(/\\/g, '/')
  if (!LICH_PATH_RE.test(rel)) throw new Error('Not a Lich log path: ' + relPath)

  const abs = join(lichLogsDir(lichHome), ...rel.split('/'))
  // Belt and braces: after joining, the result must still sit under the logs dir.
  const root = lichLogsDir(lichHome)
  if (!abs.startsWith(root + sep)) throw new Error('Outside the log directory')
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('Not found: ' + rel)

  const size = statSync(abs).size
  const start = Math.max(0, size - maxBytes)
  const len = size - start
  const buf = Buffer.alloc(len)
  const fd = openSync(abs, 'r')
  try { readSync(fd, buf, 0, len, start) } finally { closeSync(fd) }
  let content = buf.toString('utf8')
  if (start > 0) content = content.slice(content.indexOf('\n') + 1)
  return { path: rel, content, size, truncated: start > 0 }
}

/**
 * Delete one Lich log. Same jail as readLichLog — the relative path must match the
 * only shape Lich writes, and the resolved path must still sit under this user's
 * logs dir — because the consequence of a bad path here is worse than a bad read.
 *
 * Deleting the .xml also drops the .log beside it (and vice versa): they are one
 * session in two shapes, so removing half would leave a partial record that reads
 * as a complete one.
 */
export function deleteLichLog(lichHome: string, relPath: string): { removed: string[] } {
  const rel = relPath.replace(/\\/g, '/')
  if (!LICH_PATH_RE.test(rel)) throw new Error('Not a Lich log path: ' + relPath)

  const root = lichLogsDir(lichHome)
  const abs = join(root, ...rel.split('/'))
  if (!abs.startsWith(root + sep)) throw new Error('Outside the log directory')

  const removed: string[] = []
  for (const ext of ['.xml', '.log']) {
    const p = abs.replace(/\.(?:xml|log)$/i, ext)
    try {
      if (existsSync(p) && statSync(p).isFile()) { unlinkSync(p); removed.push(ext) }
    } catch { /* leave what we can't remove */ }
  }
  if (!removed.length) throw new Error('Not found: ' + rel)
  return { removed }
}
