import type { SettingsStore } from './settings-store'

// Client half of the avatar service. All network lives here in the main process
// (not the renderer) so the bearer token never touches the window and the
// renderer's `img-src 'self' data:` CSP is respected — reads are returned as
// data URLs.
//
// Everything derives from the Supabase project URL:
//   • reads  → the public Storage bucket (CDN, no function invocation)
//   • writes → the `avatars` Edge Function, authorized with our own TOFU token
//     in the `x-avatar-token` header.
// The URL is public (not a secret), so it's baked in as a default and shipped
// builds work without configuration; MAGILOOM_SUPABASE_URL overrides it for dev
// or self-hosting. Set the default to '' to disable the feature entirely, in
// which case callers fall back to identicons.

const DEFAULT_SUPABASE_URL = 'https://wyzmtzccdgcmxecdpfhw.supabase.co'
const SUPABASE_URL = (process.env.MAGILOOM_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '')
const FN_BASE      = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/avatars` : ''
const STORAGE_BASE = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/avatars` : ''

export function isAvatarServiceEnabled(): boolean {
  return SUPABASE_URL.length > 0
}

const normName = (name: string) => name.trim().toLowerCase()

// Read cache with negative caching: `null` means "known to have no custom image"
// so we don't refetch it every time a name is spoken.
interface CacheEntry { dataUrl: string | null; at: number }
const readCache = new Map<string, CacheEntry>()
const TTL_MS = 5 * 60 * 1000

export async function getAvatar(name: string): Promise<string | null> {
  if (!STORAGE_BASE) return null
  const key = normName(name)
  const hit = readCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.dataUrl
  try {
    const res = await fetch(`${STORAGE_BASE}/${encodeURIComponent(key)}`)
    if (!res.ok) { readCache.set(key, { dataUrl: null, at: Date.now() }); return null }
    const type = res.headers.get('content-type') || 'image/png'
    const buf = Buffer.from(await res.arrayBuffer())
    const dataUrl = `data:${type};base64,${buf.toString('base64')}`
    readCache.set(key, { dataUrl, at: Date.now() })
    return dataUrl
  } catch {
    return hit?.dataUrl ?? null
  }
}

// Ensure we hold a token for the given account, minting one on first use (TOFU).
// Tokens are bound to the Simutronics account server-side and persisted per
// account so re-launches (and other characters on the same account) reuse them.
async function ensureToken(settings: SettingsStore, account: string): Promise<string | null> {
  const tokens = settings.get('avatarTokens') ?? {}
  if (tokens[account]) return tokens[account]
  try {
    const res = await fetch(`${FN_BASE}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ account }),
    })
    if (!res.ok) return null
    const { token } = await res.json() as { token?: string }
    if (!token) return null
    settings.patch({ avatarTokens: { ...tokens, [account]: token } })
    return token
  } catch {
    return null
  }
}

export async function publishAvatar(
  settings: SettingsStore, charName: string, dataUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!FN_BASE) return { ok: false, error: 'Avatar sharing is not configured.' }
  const account = settings.get('lastAccount')
  if (!account) return { ok: false, error: 'Not signed in.' }
  const token = await ensureToken(settings, account)
  if (!token) return { ok: false, error: 'Could not register with the avatar service.' }

  const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
  if (!m) return { ok: false, error: 'Unsupported image.' }
  const [, type, b64] = m
  const key = normName(charName)
  try {
    const res = await fetch(`${FN_BASE}/avatar/${encodeURIComponent(key)}`, {
      method: 'PUT',
      headers: { 'x-avatar-token': token, 'content-type': type },
      body: Buffer.from(b64, 'base64'),
    })
    if (!res.ok) return { ok: false, error: `Avatar service returned ${res.status}.` }
    readCache.set(key, { dataUrl, at: Date.now() })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function deleteAvatar(
  settings: SettingsStore, charName: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!FN_BASE) return { ok: true }
  const account = settings.get('lastAccount')
  const token = account ? (settings.get('avatarTokens') ?? {})[account] : undefined
  const key = normName(charName)
  readCache.set(key, { dataUrl: null, at: Date.now() })
  if (!token) return { ok: true }
  try {
    await fetch(`${FN_BASE}/avatar/${encodeURIComponent(key)}`, {
      method: 'DELETE',
      headers: { 'x-avatar-token': token },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
