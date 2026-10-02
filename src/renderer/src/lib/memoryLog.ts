// Memory flight recorder + watchdog policy.
//
// The web client in Edge occasionally dies with "Error code: Out of Memory" — once
// or twice a week, cured by a refresh. A 12-minute soak at days' worth of game
// volume stayed flat at ~40 MB of JS heap, so the cause is either slow growth over
// days of an open tab or a sudden spike, and neither shows up in a short test. So
// the app keeps its own record: a sample every few minutes, in localStorage so it
// survives the crash, plus a marker at every page load noting whether the previous
// one ended cleanly. After the next crash the history says which it was, and when.
//
// performance.memory is Chromium-only and coarse (Chrome quantizes it and refreshes
// it lazily outside cross-origin isolation), so it's good for trends, not exact
// readings, and `heap` is null where it doesn't exist. It also only sees the JS
// heap; the DOM node count is recorded alongside as the cheapest proxy for the rest.

export interface MemSample {
  at:     number          // epoch ms
  heap:   number | null   // used JS heap, MB
  limit:  number | null   // JS heap limit, MB
  dom:    number          // element count
  hidden: boolean         // tab was in the background
}

export type MemEvent =
  /** A page load. `unclean` = the previous page never reached pagehide: a crash,
   *  a killed tab, or the browser closing hard. */
  | { at: number; kind: 'boot'; unclean: boolean }
  /** The watchdog reloaded the page because the heap crossed its threshold. */
  | { at: number; kind: 'watchdog'; heap: number }

export interface MemLog { samples: MemSample[]; events: MemEvent[] }

export const SAMPLE_EVERY_MS = 5 * 60_000
// A week at one sample per five minutes. ~80 bytes each in JSON → ~160 KB.
export const MAX_SAMPLES = 7 * 24 * 12
export const MAX_EVENTS  = 300

export const emptyLog = (): MemLog => ({ samples: [], events: [] })

export function appendSample(log: MemLog, s: MemSample): MemLog {
  const samples = log.samples.length >= MAX_SAMPLES ? log.samples.slice(-(MAX_SAMPLES - 1)) : log.samples.slice()
  samples.push(s)
  return { ...log, samples }
}

export function appendEvent(log: MemLog, e: MemEvent): MemLog {
  const events = log.events.length >= MAX_EVENTS ? log.events.slice(-(MAX_EVENTS - 1)) : log.events.slice()
  events.push(e)
  return { ...log, events }
}

/** Tolerant read: a corrupt or foreign value yields an empty log, never a throw. */
export function parseLog(raw: string | null): MemLog {
  if (!raw) return emptyLog()
  try {
    const v = JSON.parse(raw) as Partial<MemLog>
    const samples = Array.isArray(v.samples) ? v.samples.filter(s => s && typeof s.at === 'number') : []
    const events  = Array.isArray(v.events)  ? v.events.filter(e => e && typeof e.at === 'number')  : []
    return { samples, events }
  } catch { return emptyLog() }
}

/** Bytes → MB, one decimal. */
export const toMB = (bytes: number): number => Math.round(bytes / 1e5) / 10

// ── Watchdog ────────────────────────────────────────────────────────────────────
// A healthy session sits around 40 MB of JS heap. The trigger is set far above that
// but well under the point a tab dies (Edge's limit is ~4 GB): 1 GB, or half the
// limit on a device that reports a smaller one. Over it, the page reloads the next
// time it's in the background — the same reload-without-reconnect a web update
// does, so the game session and the room/exp/hands snapshot carry straight over.
// It never reloads in front of the player; if it's critical while they're looking,
// they get told instead.

export const WATCHDOG_MB      = 1024
/** No watchdog reload this soon after a page load — a guard against reload loops. */
export const WATCHDOG_GRACE_MS = 20 * 60_000

export type WatchdogAction = 'ok' | 'reload' | 'defer' | 'warn'

export function watchdogThreshold(limitMB: number | null): number {
  return limitMB ? Math.min(WATCHDOG_MB, limitMB * 0.5) : WATCHDOG_MB
}

export function watchdogDecision(
  heapMB: number | null, limitMB: number | null, hidden: boolean, sinceBootMs: number,
): WatchdogAction {
  if (heapMB === null || heapMB < watchdogThreshold(limitMB)) return 'ok'
  if (sinceBootMs < WATCHDOG_GRACE_MS) return 'defer'
  if (hidden) return 'reload'
  // Visible and still climbing toward the edge: say so rather than yank the page.
  const critical = limitMB ? limitMB * 0.75 : WATCHDOG_MB * 1.5
  return heapMB >= critical ? 'warn' : 'defer'
}

// ── Plain-text export (the Copy button) ─────────────────────────────────────────

const stamp = (at: number): string => {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function describeEvent(e: MemEvent): string {
  if (e.kind === 'watchdog') return `auto-refresh (heap ${e.heap} MB)`
  return e.unclean ? 'page load — previous page did NOT close cleanly (crash?)' : 'page load'
}

/** One chronological list of samples and events, for pasting into a bug report. */
export function formatLog(log: MemLog, ua = ''): string {
  type Row = { at: number; text: string }
  const rows: Row[] = [
    ...log.samples.map(s => ({ at: s.at, text:
      `heap ${s.heap === null ? 'n/a' : s.heap + ' MB'}${s.limit ? ` / ${Math.round(s.limit)}` : ''}  dom ${s.dom}${s.hidden ? '  (background)' : ''}` })),
    ...log.events.map(e => ({ at: e.at, text: `** ${describeEvent(e)}` })),
  ].sort((a, b) => a.at - b.at)
  const head = `Lantern memory log — ${log.samples.length} samples, ${log.events.length} events${ua ? `\n${ua}` : ''}`
  return [head, ...rows.map(r => `${stamp(r.at)}  ${r.text}`)].join('\n')
}

/**
 * Split samples into runs for drawing: a gap of more than three sample intervals
 * means the tab was closed or asleep, and a line drawn across it would invent data.
 */
export function segments(samples: MemSample[], gapMs = SAMPLE_EVERY_MS * 3): MemSample[][] {
  const out: MemSample[][] = []
  let cur: MemSample[] = []
  for (const s of samples) {
    if (cur.length && s.at - cur[cur.length - 1].at > gapMs) { out.push(cur); cur = [] }
    cur.push(s)
  }
  if (cur.length) out.push(cur)
  return out
}
