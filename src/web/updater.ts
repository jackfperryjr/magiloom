// ── Web / PWA update checker ─────────────────────────────────────────────────────
// An installed iOS PWA resumes its in-memory page and has no reload button, so a
// deploy isn't picked up until a full cold launch (and even then caching can serve
// stale HTML). This gives the app the reload it lacks: bake a build id into the
// bundle, deploy a matching version.json, and — on launch + whenever the app
// returns to foreground — fetch version.json uncached; if it differs, a newer build
// is live. We drive the SAME `window.dr.updater` callbacks the desktop app uses, so
// the shared "update available" indicator lights up and one tap reloads.

// Replaced at build time by vite.web.config.ts (`define`); 'dev' in the dev server.
declare const __BUILD_ID__: string
const BUILD_ID = typeof __BUILD_ID__ !== 'undefined' ? __BUILD_ID__ : 'dev'

type ReadyCb = () => void
type AvailCb = (version: string) => void
const readyCbs = new Set<ReadyCb>()
const availCbs = new Set<AvailCb>()
let newBuild: string | null = null   // set once a newer deployed build is seen

async function check(): Promise<void> {
  if (newBuild) return   // already found one — nothing changes until reload
  try {
    // Cache-buster + no-store so neither the browser nor GitHub Pages' CDN can hand
    // back a stale answer. Same origin as the app, so it passes the CSP.
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return
    const data = (await res.json()) as { build?: string }
    if (data.build && data.build !== BUILD_ID) {
      newBuild = data.build
      availCbs.forEach(cb => cb(newBuild!))
      readyCbs.forEach(cb => cb())
    }
  } catch { /* offline / network hiccup — try again next foreground */ }
}

/** Begin checking: now, on every foreground, and on a slow poll as a fallback. */
export function startUpdateChecks(): void {
  void check()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check()
  })
  setInterval(() => { if (document.visibilityState === 'visible') void check() }, 5 * 60 * 1000)
}

// Drop-in for the stubbed `window.dr.updater` on the web build. `install()` reloads
// (fetching the fresh bundle) — the web equivalent of the desktop "restart to update".
export const webUpdater = {
  check:   () => { void check(); return Promise.resolve() },
  install: () => { window.location.reload(); return Promise.resolve() },
  onAvailable: (cb: AvailCb) => { availCbs.add(cb); if (newBuild) cb(newBuild); return () => { availCbs.delete(cb) } },
  onReady:     (cb: ReadyCb) => { readyCbs.add(cb); if (newBuild) cb();         return () => { readyCbs.delete(cb) } },
  onError:     (_cb: (m: string) => void) => () => {},
}
