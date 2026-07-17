import { EventEmitter } from 'events'
import { join } from 'path'
import {
  mkdirSync, writeFileSync, readFileSync, readdirSync,
  unlinkSync, renameSync,
} from 'fs'
import { watch } from 'fs'

// ── Shared world-map persistence ────────────────────────────────────────────────
// The automap is world geography — identical for every character — so it lives in
// the SHARED data dir (not per-instance) and every window's process reads/writes
// the same files. One JSON file per zone (`<zoneId>.json`) keeps individual writes
// small (a walk touches only the current zone) and lets the file listing serve as
// the zone index.
//
// Writes are atomic (temp + rename) so a concurrent reader never sees a half file.
// A directory watcher lets a second character's exploration flow into an already-
// open window: when another process rewrites a zone file, we reload it and emit
// 'zoneChanged'. Self-writes are ignored via a short-lived suppression set (Windows
// fs.watch is noisy — mirrors the BroadcastBus approach).

interface StoredZone { id: string; name: string; nodes: Record<string, unknown>; arcs: unknown[] }
interface StoredDb   { version: number; zones: Record<string, StoredZone> }

const WRITE_DEBOUNCE_MS = 700
const SELF_SUPPRESS_MS  = 1_500
const DB_VERSION        = 1

export class MapStore extends EventEmitter {
  private dir: string
  private timers   = new Map<string, NodeJS.Timeout>()
  private pending  = new Map<string, StoredZone>()
  private selfWrote = new Map<string, number>()   // filename → ts of our last write
  private watcher: ReturnType<typeof watch> | null = null

  constructor(sharedDir: string) {
    super()
    this.dir = join(sharedDir, 'maps')
    mkdirSync(this.dir, { recursive: true })
    try { this.watcher = watch(this.dir, (_e, file) => { if (file) this.onExternalChange(file) }) }
    catch { /* watch unsupported — cross-window live sync degrades gracefully */ }
  }

  // Read every zone file into a single DB snapshot (loaded once on startup).
  loadAll(): StoredDb {
    const zones: Record<string, StoredZone> = {}
    let files: string[] = []
    try { files = readdirSync(this.dir) } catch { return { version: DB_VERSION, zones } }
    for (const f of files) {
      if (!f.endsWith('.json')) continue
      const z = this.readZoneFile(f)
      if (z?.id) zones[z.id] = z
    }
    return { version: DB_VERSION, zones }
  }

  // Persist one zone (debounced — a walk fires many rapid updates to the same zone).
  saveZone(zone: StoredZone): void {
    if (!zone?.id) return
    this.pending.set(zone.id, zone)
    const existing = this.timers.get(zone.id)
    if (existing) clearTimeout(existing)
    this.timers.set(zone.id, setTimeout(() => this.flushZone(zone.id), WRITE_DEBOUNCE_MS))
  }

  // Delete a zone file (used by "clear map").
  deleteZone(zoneId: string): void {
    const file = zoneId + '.json'
    this.selfWrote.set(file, Date.now())
    try { unlinkSync(join(this.dir, file)) } catch { /* already gone */ }
    this.pending.delete(zoneId)
    const t = this.timers.get(zoneId); if (t) { clearTimeout(t); this.timers.delete(zoneId) }
  }

  clearAll(): void {
    let files: string[] = []
    try { files = readdirSync(this.dir) } catch { return }
    for (const f of files) if (f.endsWith('.json')) {
      this.selfWrote.set(f, Date.now())
      try { unlinkSync(join(this.dir, f)) } catch { /* ignore */ }
    }
    this.pending.clear()
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  dispose(): void {
    // Flush any debounced writes synchronously so nothing is lost on quit.
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    for (const id of Array.from(this.pending.keys())) this.flushZone(id)
    this.watcher?.close()
    this.watcher = null
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private flushZone(zoneId: string): void {
    const zone = this.pending.get(zoneId)
    this.pending.delete(zoneId)
    this.timers.delete(zoneId)
    if (!zone) return
    const file = zoneId + '.json'
    const path = join(this.dir, file)
    const tmp  = path + '.tmp'
    this.selfWrote.set(file, Date.now())
    try {
      writeFileSync(tmp, JSON.stringify(zone), 'utf8')
      renameSync(tmp, path)   // atomic publish
    } catch { try { unlinkSync(tmp) } catch { /* ignore */ } }
  }

  private readZoneFile(file: string): StoredZone | null {
    try { return JSON.parse(readFileSync(join(this.dir, file), 'utf8')) as StoredZone }
    catch { return null }
  }

  private onExternalChange(file: string): void {
    if (!file.endsWith('.json') || file.endsWith('.tmp')) return
    const stamp = this.selfWrote.get(file)
    if (stamp && Date.now() - stamp < SELF_SUPPRESS_MS) return   // our own write echoing back
    const z = this.readZoneFile(file)
    if (z?.id) this.emit('zoneChanged', z)
  }
}

export type { StoredZone, StoredDb }
