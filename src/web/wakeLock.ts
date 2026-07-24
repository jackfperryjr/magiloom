// Screen Wake Lock for the PWA — keeps a phone/tablet display from dimming or
// locking while a game session is connected, so you can watch the output panel
// hands-off. Web-only (wired from main.tsx); the desktop app manages power
// differently. Gated behind the "Keep screen awake" setting (default on) and only
// held while actually connected — a wake lock on the login screen would just burn
// battery for nothing.
//
// The Wake Lock API auto-releases its sentinel whenever the page is hidden (tab
// switch, app backgrounded, OS screen lock), so we re-acquire on visibilitychange
// whenever we're visible and still want it. acquire()/release() are idempotent, so
// sync() can be called freely on any state change.

type WakeLockSentinelLike = {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: 'release', cb: () => void) => void
}
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
}

let sentinel: WakeLockSentinelLike | null = null
let enabled = true       // the "Keep screen awake" setting (undefined defaults on)
let connected = false    // is the game session live?

const wakeLockApi = (): WakeLockNavigator['wakeLock'] | undefined =>
  (typeof navigator !== 'undefined' ? (navigator as WakeLockNavigator).wakeLock : undefined)

// Whether we should be holding the lock right now.
const wanted = (): boolean => enabled && connected && document.visibilityState === 'visible'

async function acquire(): Promise<void> {
  const api = wakeLockApi()
  if (!api || !wanted() || (sentinel && !sentinel.released)) return
  try {
    sentinel = await api.request('screen')
    // The browser fires 'release' when it drops the lock on its own (e.g. the page
    // was hidden) — clear our handle so a later re-acquire isn't skipped as a no-op.
    sentinel.addEventListener('release', () => { sentinel = null })
  } catch {
    // Rejected — low battery, blocked by permissions policy, or not a user-active
    // document. Harmless; we retry on the next visibility/connection/setting change.
    sentinel = null
  }
}

async function release(): Promise<void> {
  const s = sentinel
  sentinel = null
  if (s && !s.released) { try { await s.release() } catch { /* already gone */ } }
}

// Reconcile the actual lock with what we want.
function sync(): void {
  if (wanted()) void acquire()
  else void release()
}

// Re-read the "Keep screen awake" setting (undefined defaults to on), then reconcile.
async function refreshSetting(): Promise<void> {
  try {
    const s = await window.dr.settings.getAll()
    enabled = s.keepScreenOn !== false
  } catch { /* keep prior value */ }
  sync()
}

export function setupWakeLock(): void {
  if (!wakeLockApi()) return   // unsupported browser — nothing to do

  // Track connection state — mirror the same events the renderer's game hook uses.
  // The session can already be connected on load (resumed across a reload), so seed
  // from getStatus rather than waiting for an onConnected that already fired.
  window.dr.game.getStatus().then(s => { connected = s === 'connected'; sync() }).catch(() => {})
  window.dr.game.onConnected(() => { connected = true; sync() })
  window.dr.game.onDisconnected(() => { connected = false; sync() })
  window.dr.game.onError(() => { connected = false; sync() })

  // The lock is auto-dropped when the page hides; re-acquire when it comes back.
  document.addEventListener('visibilitychange', sync)

  // Pick up the toggle from the Settings modal (it dispatches this on save).
  window.addEventListener('settings:saved', () => { void refreshSetting() })

  void refreshSetting()
}
