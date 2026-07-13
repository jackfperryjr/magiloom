import { httpBase, authToken, setAuth } from './config'

// ── Magiloom account client (dormant infrastructure) ────────────────────────────
// Talks to the server's /auth/* endpoints (which only exist when the server has
// MAGILOOM_ACCOUNTS_ENABLED=1) to register / sign in / resolve the current account
// for the paid "watch mode" feature. Nothing in the UI calls this yet — it's the
// ready-to-wire half of the account layer. On success it persists the auth token
// via setAuthToken(), after which config.wsUrl() attaches it as ?auth= and the
// server keys this client to its account's cross-device session.

export type AccountTier = 'free' | 'paid'
export interface Account { id: string; email: string; tier: AccountTier }

interface AuthOk  { ok: true;  account: Account; token: string }
interface AuthErr { ok: false; error: string }
type AuthResult = AuthOk | AuthErr

async function post(path: string, body: unknown): Promise<AuthResult> {
  try {
    const res = await fetch(`${httpBase()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => null)) as AuthResult | null
    if (data && 'ok' in data) return data
    return { ok: false, error: `Request failed (${res.status}).` }
  } catch {
    return { ok: false, error: 'Could not reach the server.' }
  }
}

export async function register(email: string, password: string): Promise<AuthResult> {
  const r = await post('/auth/register', { email, password })
  if (r.ok) setAuth(r.token, r.account.id)
  return r
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const r = await post('/auth/login', { email, password })
  if (r.ok) setAuth(r.token, r.account.id)
  return r
}

export function logout(): void { setAuth(null, null) }

export function isSignedIn(): boolean { return !!authToken() }

/** Resolve the signed-in account, or null (invalid/expired token, or disabled). */
export async function currentAccount(): Promise<Account | null> {
  const t = authToken()
  if (!t) return null
  try {
    const res = await fetch(`${httpBase()}/auth/me`, { headers: { authorization: `Bearer ${t}` } })
    if (!res.ok) return null
    const data = await res.json() as { ok: boolean; account?: Account }
    return data.ok && data.account ? data.account : null
  } catch {
    return null
  }
}
