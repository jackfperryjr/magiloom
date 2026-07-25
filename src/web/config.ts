// Web-client runtime config. The server URL + auth token come from build-time env
// (VITE_MAGILOOM_*), overridable at runtime via localStorage for quick testing.
//
// The per-user data bucket is a random device id stored locally, so each browser
// gets its own private settings/accounts/passwords on the server (the desktop app
// is likewise per-install). It doubles as the `?user=` isolation key — unguessable,
// which is the v1 stand-in until the server issues real per-user auth tokens.

function env(key: string): string {
  return (import.meta.env as Record<string, string | undefined>)[key] ?? ''
}

/** WebSocket origin, e.g. wss://magiserver.up.railway.app (no trailing /). */
function serverBase(): string {
  const base =
    localStorage.getItem('magiloom-server') ||
    env('VITE_MAGILOOM_SERVER') ||
    'wss://magiserver.up.railway.app'
  return base.replace(/\/+$/, '')
}

/** HTTP(S) origin of the server, for the /push/* REST endpoints. */
export function httpBase(): string {
  return serverBase().replace(/^ws(s?):\/\//, 'http$1://')
}

function token(): string {
  return localStorage.getItem('magiloom-token') || env('VITE_MAGILOOM_TOKEN') || ''
}

// Whether a signed-in Magiloom account is required to use the app. Mirrors the
// server's MAGILOOM_REQUIRE_ACCOUNT: set BOTH together — this flag makes the client
// show a mandatory sign-in gate, the server flag enforces it (rejects anonymous
// connections). localStorage override for quick local testing, else the build env.
export function requireAccount(): boolean {
  return (localStorage.getItem('magiloom-require-account') || env('VITE_MAGILOOM_REQUIRE_ACCOUNT')) === '1'
}

export function deviceId(): string {
  let id = localStorage.getItem('magiloom-device-id')
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('magiloom-device-id', id)
  }
  return id
}

// Whether this client should hold ONE persistent, resumable session or an isolated
// session PER TAB. Mobile / installed PWA → persistent: the phone only ever watches a
// single session, and iOS kills the page, so we must resume the SAME session on reopen.
// Desktop browser → per-tab: sharing localStorage across windows would collapse every
// window onto one session (they'd hijack each other), which breaks running multiple DR
// accounts side by side. Decided once and cached so it can't flip mid-session.
let _persistent: boolean | null = null
function persistentSession(): boolean {
  if (_persistent !== null) return _persistent
  let result = false
  try {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    const phoneSized =
      window.matchMedia?.('(pointer: coarse)')?.matches === true &&
      window.matchMedia?.('(max-width: 900px)')?.matches === true
    result = standalone || phoneSized
  } catch { /* non-browser / no matchMedia → default to per-tab */ }
  _persistent = result
  return result
}

// A connection id, distinct from the (also per-install) device id. It names THIS
// client's server-side session, so a reconnect — a network blip, a backgrounded PWA,
// an auto-update reload, or a full reopen after iOS kills the page — reattaches to the
// SAME running session instead of starting a new one and dropping the character.
//
// WHERE it lives decides the sharing model (see persistentSession above):
//  • mobile/PWA → localStorage: survives a full close, so you resume/"watch" the still-
//    running DR connection when you come back.
//  • desktop browser → sessionStorage: unique per tab, so each window runs its own DR
//    account without hijacking the others. Survives a reload (same tab), not a close.
export function connId(): string {
  const store: Storage = persistentSession() ? localStorage : sessionStorage
  let id = store.getItem('magiloom-conn-id')
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    store.setItem('magiloom-conn-id', id)
  }
  return id
}

// Magiloom-account auth token + id, if the user has signed in. Kept separate from
// the shared bearer `token()`. When present, the server keys this client's DATA
// bucket (and, for paid, its live session) to the account instead of the device.
export function authToken(): string { return localStorage.getItem('magiloom-auth-token') || '' }
export function accountId(): string { return localStorage.getItem('magiloom-account-id') || '' }
export function setAuth(token: string | null, id: string | null): void {
  if (token) localStorage.setItem('magiloom-auth-token', token); else localStorage.removeItem('magiloom-auth-token')
  if (id)    localStorage.setItem('magiloom-account-id', id);    else localStorage.removeItem('magiloom-account-id')
}

// The push subscription must land in the SAME bucket the server routes the session
// to: the account when signed in (so a signed-in user's devices are pinged), else
// the device. Mirrors the gateway's `acct-<id>` scheme.
export function pushBucket(): string {
  const id = accountId()
  return id ? `acct-${id}` : deviceId()
}

// Transient "watch" target — the conn of another of this account's live sessions to
// attach to (paid watch mode). In-memory: watching is an explicit, per-session action,
// not something to persist across reloads.
let _watchConn: string | null = null
export function watchConn(): string { return _watchConn ?? '' }
export function setWatch(conn: string | null): void { _watchConn = conn }

/** Full gateway URL: wss://host/ws?user=<device>&conn=<page>&token=<token>[&auth=…][&watch=…]. */
export function wsUrl(): string {
  const params = new URLSearchParams({ user: deviceId(), conn: connId() })
  const t = token()
  if (t) params.set('token', t)
  const a = authToken()
  if (a) params.set('auth', a)   // account identity → server keys the session to it
  const w = watchConn()
  if (w) params.set('watch', w)  // attach to another of this account's sessions
  return `${serverBase()}/ws?${params.toString()}`
}
