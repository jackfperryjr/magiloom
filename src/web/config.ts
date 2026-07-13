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

export function deviceId(): string {
  let id = localStorage.getItem('magiloom-device-id')
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('magiloom-device-id', id)
  }
  return id
}

// A stable connection id, distinct from the (also per-install) device id. It names
// THIS client's server-side session, so a reconnect — a network blip, a backgrounded
// PWA, or a full reopen after iOS kills the page — reattaches to the SAME running
// session instead of starting a new one and dropping the character. Persisted (not
// per-page) so it survives a reload/kill; that's what lets you close the app and
// resume/"watch" the still-running DR connection when you come back. Two tabs in the
// same browser share it (and the session) by design; separate devices get their own.
export function connId(): string {
  let id = localStorage.getItem('magiloom-conn-id')
  if (!id) {
    id = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)
    localStorage.setItem('magiloom-conn-id', id)
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

/** Full gateway URL: wss://host/ws?user=<device>&conn=<page>&token=<token>[&auth=…]. */
export function wsUrl(): string {
  const params = new URLSearchParams({ user: deviceId(), conn: connId() })
  const t = token()
  if (t) params.set('token', t)
  const a = authToken()
  if (a) params.set('auth', a)   // account identity → server keys the session to it
  return `${serverBase()}/ws?${params.toString()}`
}
