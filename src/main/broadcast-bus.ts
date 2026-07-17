import { EventEmitter } from 'events'
import { join } from 'path'
import {
  existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync,
  unlinkSync, renameSync, statSync, watch,
} from 'fs'

// ── Cross-process command bus (multi-boxing / "link") ──────────────────────────
// Magiloom runs one OS process per character window (see claimInstanceDir in
// index.ts), so windows can't share an in-process channel. To broadcast a command
// to your other characters, a sender drops a small JSON message file into a shared
// directory; every running instance watches that directory and runs new messages
// that aren't its own — provided it has opted in to receive.
//
// Writes are atomic (temp file + rename) so a reader never sees a half-written
// message. Delivery uses fs.watch for low latency with a short polling fallback,
// since fs.watch is unreliable on Windows (missed and duplicated events). A `seen`
// set makes duplicate events harmless.

interface BusMessage { id: string; fromPid: number; ts: number; cmd: string }

// Messages older than this are ignored (and swept) — a window that was closed
// mid-broadcast shouldn't replay ancient commands when the slot is reused.
const MSG_TTL_MS   = 10_000
const POLL_MS      = 400
const SELF_CLEANUP_MS = 3_000

export class BroadcastBus extends EventEmitter {
  private dir: string
  private seen = new Set<string>()
  private poll: NodeJS.Timeout | null = null
  private watcher: ReturnType<typeof watch> | null = null
  private receive = false

  constructor(sharedDir: string) {
    super()
    this.dir = join(sharedDir, 'bus')
    mkdirSync(this.dir, { recursive: true })
    this.purgeStale()
    // Treat everything already present as seen so we don't replay a backlog on
    // startup — only messages that arrive after we start listening should run.
    try { for (const f of readdirSync(this.dir)) this.seen.add(this.idOf(f)) } catch { /* ignore */ }
    try { this.watcher = watch(this.dir, () => this.scan()) } catch { /* fall back to poll */ }
    this.poll = setInterval(() => this.scan(), POLL_MS)
  }

  // Opt this instance in/out of executing broadcasts from other windows.
  setReceive(on: boolean): void { this.receive = on }

  // Broadcast a command to the OTHER instances. The originating window runs its
  // own copy locally (the caller decides that), so the bus only carries to peers.
  send(cmd: string): void {
    if (!cmd.trim()) return
    const id   = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const file = join(this.dir, id + '.json')
    const tmp  = file + '.tmp'
    const payload: BusMessage = { id, fromPid: process.pid, ts: Date.now(), cmd }
    this.seen.add(id)  // never deliver our own message back to ourselves
    try {
      writeFileSync(tmp, JSON.stringify(payload), 'utf8')
      renameSync(tmp, file)  // atomic publish
    } catch { try { unlinkSync(tmp) } catch { /* ignore */ } }
    // Sweep our own message shortly after; peers only need a moment to pick it up.
    setTimeout(() => { try { unlinkSync(file) } catch { /* already gone */ } }, SELF_CLEANUP_MS)
  }

  dispose(): void {
    if (this.poll) clearInterval(this.poll)
    this.watcher?.close()
    this.poll = null
    this.watcher = null
  }

  private idOf(fileName: string): string { return fileName.replace(/\.json$/, '') }

  private purgeStale(): void {
    const now = Date.now()
    try {
      for (const f of readdirSync(this.dir)) {
        const p = join(this.dir, f)
        try { if (now - statSync(p).mtimeMs > MSG_TTL_MS) unlinkSync(p) } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }

  private scan(): void {
    let files: string[]
    try { files = readdirSync(this.dir) } catch { return }
    for (const f of files) {
      if (!f.endsWith('.json')) continue          // skip .tmp mid-write files
      const id = this.idOf(f)
      if (this.seen.has(id)) continue
      this.seen.add(id)                            // mark before running so a retry can't double-fire
      let msg: BusMessage | null = null
      try { msg = JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as BusMessage } catch { continue }
      if (!msg || msg.fromPid === process.pid) continue
      if (Date.now() - msg.ts > MSG_TTL_MS) continue
      if (!this.receive) continue                  // opted out — mark seen but don't run
      this.emit('command', msg.cmd)
    }
    // Bound memory: keep the most recent ids so long sessions don't grow unbounded.
    if (this.seen.size > 500) this.seen = new Set(Array.from(this.seen).slice(-250))
  }
}

// Re-exported for tests / callers that want the message shape.
export type { BusMessage }
export { MSG_TTL_MS }
