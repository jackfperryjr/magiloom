// Magiloom account + log access for the tools site.
//
// Small and standalone rather than importing src/web/config.ts: that module carries
// the game client's whole runtime (per-tab vs persistent session policy, device
// buckets, WebSocket URL building) and none of it applies to a static tools page.
// What we DO share is the storage key — `magiloom-auth-token` is the same key the
// web app writes on sign-in, and docs/app and docs/tools are the same origin, so
// someone already signed in at magiloom.com/app arrives here signed in. That is the
// intended behaviour, not an accident: one sign-in for the whole site.

const TOKEN_KEY = 'magiloom-auth-token'
const ID_KEY    = 'magiloom-account-id'

function env(key: string): string {
  return (import.meta.env as Record<string, string | undefined>)[key] ?? ''
}

/** HTTP origin of the Magiloom server. Same default and override the app uses. */
export function httpBase(): string {
  const base =
    localStorage.getItem('magiloom-server') ||
    env('VITE_MAGILOOM_SERVER') ||
    'wss://magiserver.up.railway.app'
  return base.replace(/\/+$/, '').replace(/^ws(s?):\/\//, 'http$1://')
}

export function authToken(): string { return localStorage.getItem(TOKEN_KEY) || '' }

function setAuth(token: string | null, id: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token); else localStorage.removeItem(TOKEN_KEY)
  if (id)    localStorage.setItem(ID_KEY, id);       else localStorage.removeItem(ID_KEY)
}

export type AccountTier = 'free' | 'paid'
export interface Account { id: string; email: string; tier: AccountTier }

interface AuthOk  { ok: true;  account: Account; token: string }
interface AuthErr { ok: false; error: string }

async function post(path: string, body: unknown): Promise<AuthOk | AuthErr> {
  try {
    const res = await fetch(`${httpBase()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => null)) as AuthOk | AuthErr | null
    if (data && 'ok' in data) return data
    // A 404 here means the server has accounts switched off, which is a different
    // problem from bad credentials and deserves to say so.
    if (res.status === 404) return { ok: false, error: 'Accounts are not enabled on this server yet.' }
    return { ok: false, error: `Request failed (${res.status}).` }
  } catch {
    return { ok: false, error: unreachableMessage() }
  }
}

/**
 * A rejected fetch can't tell us WHY — the browser deliberately hides whether it was
 * a dead host or a blocked cross-origin response, so both arrive here identically.
 * From a dev origin the overwhelmingly likely cause is the server's allowed-origins
 * list not including it, so say so there rather than reporting a server outage that
 * isn't happening. On the deployed site, plain unreachability is the likely cause and
 * the extra detail would only be noise.
 */
function unreachableMessage(): string {
  const devOrigin = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
  return devOrigin
    ? `Could not reach the Magiloom server at ${httpBase()}. If it's running, check that its `
      + `MAGILOOM_ALLOW_ORIGIN includes ${location.origin} — a blocked origin looks exactly like this.`
    : 'Could not reach the Magiloom server.'
}

export async function login(email: string, password: string): Promise<AuthOk | AuthErr> {
  const r = await post('/auth/login', { email, password })
  if (r.ok) setAuth(r.token, r.account.id)
  return r
}

export async function register(email: string, password: string): Promise<AuthOk | AuthErr> {
  const r = await post('/auth/register', { email, password })
  if (r.ok) setAuth(r.token, r.account.id)
  return r
}

export function logout(): void { setAuth(null, null) }

/** Resolve the signed-in account, or null when there's no valid token. */
export async function currentAccount(): Promise<Account | null> {
  const t = authToken()
  if (!t) return null
  try {
    const res = await fetch(`${httpBase()}/auth/me`, { headers: { authorization: `Bearer ${t}` } })
    if (!res.ok) return null
    const data = await res.json() as { ok: boolean; account?: Account }
    return data.ok && data.account ? data.account : null
  } catch { return null }
}

// ── Logs ────────────────────────────────────────────────────────────────────────

export interface LogFileEntry {
  name:  string   // refia-2026-07-09.log
  char:  string   // refia
  day:   string   // 2026-07-09
  size:  number
  mtime: number
  /** A structured sidecar exists for this log, so its experience figures are exact. */
  events: boolean
}

export interface LogFileRead {
  name: string; content: string; size: number; truncated: boolean
}

async function authedGet<T>(path: string): Promise<T> {
  const t = authToken()
  if (!t) throw new Error('Not signed in.')
  const res = await fetch(`${httpBase()}${path}`, { headers: { authorization: `Bearer ${t}` } })
  if (res.status === 401) throw new Error('Your session expired — sign in again.')
  if (!res.ok) throw new Error(`Request failed (${res.status}).`)
  const data = await res.json() as { ok: boolean; error?: string } & T
  if (!data.ok) throw new Error(data.error ?? 'Request failed.')
  return data
}

/**
 * A log Lich wrote during a server session, living in this account's isolated Lich
 * home. The `.xml` ones are the raw stream and give exact results.
 */
export interface LichLogEntry {
  path:  string   // DR-Refia/2026/07/2026-07-02_11-41-01.xml
  char:  string
  day:   string
  time:  string
  size:  number
  mtime: number
  xml:   boolean
}

/** Both kinds of log this account has on the server, newest first. */
export async function listLogs(): Promise<{ files: LogFileEntry[]; lich: LichLogEntry[] }> {
  const data = await authedGet<{ files: LogFileEntry[]; lich?: LichLogEntry[] }>('/logs')
  return { files: data.files, lich: data.lich ?? [] }
}

/** Read one Lich log from the server by its relative path. */
export async function readLichLog(path: string): Promise<LogFileRead & { path: string }> {
  return authedGet<LogFileRead & { path: string }>(`/logs/lich?path=${encodeURIComponent(path)}`)
}

export async function readLog(name: string): Promise<LogFileRead> {
  return authedGet<LogFileRead>(`/logs/read?name=${encodeURIComponent(name)}`)
}

/**
 * Read a log's structured sidecar. Takes the .log name — the server derives the
 * sidecar's own name — and returns null when there isn't one, since an older log
 * predating the sidecar is a normal situation and not an error.
 */
export async function readLogEvents(name: string): Promise<LogFileRead | null> {
  try {
    return await authedGet<LogFileRead>(`/logs/events?name=${encodeURIComponent(name)}`)
  } catch {
    return null
  }
}
