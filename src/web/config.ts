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

// A per-page-load connection id, distinct from the (persisted, per-install) device
// id. The device id names the shared DATA bucket (settings/accounts) — several
// clients can legitimately share it — while this id names THIS running client so
// the server never routes one character's game stream to another. Deliberately
// in-memory: a reconnect from the same live page (network blip, backgrounded PWA)
// keeps the id and resumes its session; a full reload starts fresh. See the
// magiserver gateway's session keying.
const CONN_ID =
  crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)

export function connId(): string { return CONN_ID }

/** Full gateway URL: wss://host/ws?user=<device>&conn=<page>&token=<token>. */
export function wsUrl(): string {
  const params = new URLSearchParams({ user: deviceId(), conn: connId() })
  const t = token()
  if (t) params.set('token', t)
  return `${serverBase()}/ws?${params.toString()}`
}
