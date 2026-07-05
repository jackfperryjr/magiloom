// Magiloom avatar service — Supabase Edge Function (the trusted server).
//
// This is the ONLY place the service_role key lives; it is injected by Supabase
// at runtime and never ships in the desktop app. The function enforces the
// login-tied trust model:
//   • POST /register mints a bearer token bound to a Simutronics account (TOFU).
//   • A name is claimed by the first account to publish it (first-writer-wins);
//     afterwards only that account may replace or delete it.
//   • Reads are NOT handled here — images live in a public Storage bucket and
//     are fetched straight from the CDN by the client.
//
// Deploy with JWT verification off so the client can call it with our own token:
//   supabase functions deploy avatars --no-verify-jwt
// Our token travels in the `x-avatar-token` header (not Authorization) to avoid
// any interference from Supabase's own auth handling.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const BUCKET = 'avatars'

// DR first names: a letter/digit then letters/digits/apostrophe/hyphen.
const NAME_RE = /^[a-z0-9][a-z0-9'-]{1,30}$/
const ALLOWED_TYPES = new Set(['image/png', 'image/webp', 'image/jpeg', 'image/gif'])
const MAX_BYTES = 200 * 1024

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type,x-avatar-token',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } })

function normName(raw: string): string | null {
  let n: string
  try { n = decodeURIComponent(raw) } catch { return null }
  n = n.trim().toLowerCase()
  return NAME_RE.test(n) ? n : null
}

function randomToken(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  // Supabase routes /functions/v1/avatars/* here, so the path starts with the
  // function slug; drop it to get our own sub-route.
  const seg = new URL(req.url).pathname.split('/').filter(Boolean)
  const sub = seg[0] === 'avatars' ? seg.slice(1) : seg

  // POST /register { account } → { token }
  if (req.method === 'POST' && sub[0] === 'register') {
    let account = ''
    try { account = String((await req.json() as { account?: unknown })?.account ?? '').trim() } catch { /* noop */ }
    if (!account) return json({ error: 'account required' }, 400)
    const token = randomToken()
    const { error } = await admin.from('avatar_tokens').insert({ token, account: account.toLowerCase() })
    if (error) return json({ error: 'register failed' }, 500)
    return json({ token })
  }

  // /avatar/:name  (PUT publish/replace, DELETE remove)
  if (sub[0] === 'avatar' && sub[1]) {
    const name = normName(sub[1])
    if (!name) return json({ error: 'bad name' }, 400)

    if (req.method === 'PUT' || req.method === 'DELETE') {
      const token = req.headers.get('x-avatar-token') || ''
      if (!token) return json({ error: 'unauthorized' }, 401)
      const { data: tok } = await admin.from('avatar_tokens').select('account').eq('token', token).maybeSingle()
      if (!tok) return json({ error: 'unauthorized' }, 401)
      const account = tok.account as string

      const { data: claim } = await admin.from('avatar_claims').select('account').eq('name', name).maybeSingle()
      if (claim && claim.account !== account) return json({ error: 'name owned by another account' }, 403)

      if (req.method === 'DELETE') {
        await admin.storage.from(BUCKET).remove([name])
        await admin.from('avatar_claims').delete().eq('name', name)
        return json({ ok: true })
      }

      const type = (req.headers.get('content-type') || '').split(';')[0].trim()
      if (!ALLOWED_TYPES.has(type)) return json({ error: 'unsupported type' }, 415)
      const body = new Uint8Array(await req.arrayBuffer())
      if (body.byteLength === 0 || body.byteLength > MAX_BYTES) return json({ error: 'bad size' }, 413)

      const { error: upErr } = await admin.storage.from(BUCKET).upload(name, body, { contentType: type, upsert: true })
      if (upErr) return json({ error: 'upload failed' }, 500)
      if (!claim) await admin.from('avatar_claims').insert({ name, account })
      return json({ ok: true })
    }
  }

  return json({ error: 'not found' }, 404)
})
