// The live half of the memory recorder (policy and storage format are in
// memoryLog.ts): sample on a timer, mark each page load, and run the watchdog.
//
// Web build on a computer only. The crash it exists for is the desktop-browser
// web client's; the Electron app keeps its game session in the main process (a
// self-reload there isn't the free action it is on the web), and phones are out by
// request. "Phone" is judged by the device — a coarse pointer on a small SCREEN —
// not by the viewport, so a desktop window dragged narrow still counts as desktop.
//
// Started once per page load from App. Everything here is best-effort — storage
// can throw (private mode, quota), performance.memory may not exist — and none of
// it may ever take the client down, so every touch of the outside world is guarded.

import {
  appendEvent, appendSample, parseLog, toMB, watchdogDecision, SAMPLE_EVERY_MS,
  type MemLog, type MemSample,
} from './memoryLog'

const LOG_KEY   = 'magiloom-memlog-v1'
// "This tab's page is alive." Set on load, cleared on pagehide; finding it already
// set at the next load means the previous page never got to pagehide — it crashed
// or was killed. sessionStorage, not localStorage: it's per tab (a second Lantern
// tab can't clear the first one's flag) and it survives the reload of a crashed tab.
const ALIVE_KEY = 'magiloom-mem-alive'
const CHECK_EVERY_MS = 60_000

interface ChromeMemory { usedJSHeapSize: number; jsHeapSizeLimit: number }

export function readMemLog(): MemLog {
  try { return parseLog(localStorage.getItem(LOG_KEY)) } catch { return parseLog(null) }
}
function writeMemLog(log: MemLog): void {
  try { localStorage.setItem(LOG_KEY, JSON.stringify(log)) } catch { /* full or blocked — skip */ }
}
export function clearMemLog(): void {
  try { localStorage.removeItem(LOG_KEY) } catch { /* ignore */ }
}

/** A reading right now (also what the Memory tab shows as "current"). */
export function currentSample(): MemSample {
  const mem = (performance as unknown as { memory?: ChromeMemory }).memory
  return {
    at:     Date.now(),
    heap:   mem ? toMB(mem.usedJSHeapSize) : null,
    limit:  mem ? toMB(mem.jsHeapSizeLimit) : null,
    dom:    document.getElementsByTagName('*').length,
    hidden: document.visibilityState === 'hidden',
  }
}

/** Whether the recorder, watchdog and Settings → Memory exist on this device. */
export function memoryWatchSupported(): boolean {
  if (window.dr?.app?.platform !== 'web') return false
  const phone = window.matchMedia?.('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 600
  return !phone
}

let started = false

/**
 * @param onWarn  called once per page load if the heap is critical while the
 *                player is looking, so they can choose when to refresh
 */
export function startMemoryWatch({ onWarn }: { onWarn: (heapMB: number) => void }): void {
  if (started || !memoryWatchSupported()) return   // one recorder per page load; web/computer only
  started = true
  const bootAt = Date.now()
  let warned = false

  let unclean = false
  try {
    unclean = sessionStorage.getItem(ALIVE_KEY) === '1'
    sessionStorage.setItem(ALIVE_KEY, '1')
  } catch { /* no sessionStorage — can't tell, assume clean */ }
  const markClosed = (): void => { try { sessionStorage.removeItem(ALIVE_KEY) } catch { /* ignore */ } }
  const markAlive  = (): void => { try { sessionStorage.setItem(ALIVE_KEY, '1') } catch { /* ignore */ } }
  window.addEventListener('pagehide', markClosed)
  window.addEventListener('pageshow', markAlive)   // restored from the back/forward cache

  writeMemLog(appendSample(appendEvent(readMemLog(), { at: bootAt, kind: 'boot', unclean }), currentSample()))

  window.setInterval(() => writeMemLog(appendSample(readMemLog(), currentSample())), SAMPLE_EVERY_MS)

  const check = (): void => {
    const s = currentSample()
    const action = watchdogDecision(s.heap, s.limit, s.hidden, Date.now() - bootAt)
    if (action === 'reload' && s.heap !== null) {
      // A web reload keeps the game session (it lives on the server) and the
      // room/exp/hands snapshot flushes on pagehide — the same reload an update does.
      writeMemLog(appendSample(appendEvent(readMemLog(), { at: s.at, kind: 'watchdog', heap: s.heap }), s))
      window.location.reload()
    } else if (action === 'warn' && !warned && s.heap !== null) {
      warned = true
      onWarn(s.heap)
    }
  }
  window.setInterval(check, CHECK_EVERY_MS)
  // A deferred reload should happen the moment the player looks away, not up to a
  // minute later — by then the tab may already be gone.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') check() })
}
