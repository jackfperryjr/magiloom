// Magiloom LOOK-portrait service — Supabase Edge Function (the trusted server).
//
// Generates a character portrait from a client-supplied prompt via Google AI
// Studio's Gemini image models ("Nano Banana"), and stores it once for everyone
// in the public `portraits` bucket. This is the ONLY place the Gemini key lives
// (set as a function secret); it never ships in the desktop app.
//
//   • POST { name, prompt }
//       → if an owner-uploaded avatar exists (avatars bucket): {ok, source:"owner"}
//       → if a portrait already exists (first-writer-wins):     {ok, source:"cache"}
//       → else generate, store under `portraits/<name>`:         {ok, source:"generated"}
//   • Reads are NOT handled here — the client fetches the public object directly.
//
// Secrets: GEMINI_API_KEY (required). SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
// injected by Supabase. Deploy with JWT verification off (the client calls it
// without a Supabase JWT, matching the `avatars` function):
//   supabase secrets set GEMINI_API_KEY=<your key>
//   supabase functions deploy portrait --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const GEMINI_KEY   = Deno.env.get('GEMINI_API_KEY') ?? ''
const MODEL        = Deno.env.get('PORTRAIT_MODEL') ?? 'gemini-3.1-flash-lite-image'

const OWNER_BUCKET = 'avatars'
const GEN_BUCKET   = 'portraits'
const NAME_RE = /^[a-z0-9][a-z0-9'-]{1,30}$/
// Client picks the aspect ratio (1:1 = tight bust crop); default if unset/invalid.
const ALLOWED_AR = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'])

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } })

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
}
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } })

async function exists(bucket: string, name: string): Promise<boolean> {
  const { data } = await admin.storage.from(bucket).list('', { search: name, limit: 100 })
  return !!data?.some(o => o.name === name)
}

async function generate(prompt: string, aspectRatio: string): Promise<Uint8Array | null> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } },
    }),
  })
  if (!res.ok) { console.error(`gemini ${res.status}: ${(await res.text()).slice(0, 300)}`); return null }
  const j = await res.json() as {
    candidates?: { content?: { parts?: { inlineData?: { data?: string } }[] } }[]
  }
  const b64 = j.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data)?.inlineData?.data
  if (!b64) { console.error('gemini: no image in response'); return null }
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST')    return json({ error: 'method not allowed' }, 405)
  if (!GEMINI_KEY)              return json({ error: 'not configured' }, 503)

  let name = '', prompt = '', aspectRatio = '1:1'
  try {
    const body = await req.json() as { name?: unknown; prompt?: unknown; aspectRatio?: unknown }
    name   = String(body.name ?? '').trim().toLowerCase()
    prompt = String(body.prompt ?? '')
    if (ALLOWED_AR.has(String(body.aspectRatio))) aspectRatio = String(body.aspectRatio)
  } catch { return json({ error: 'bad json' }, 400) }
  if (!NAME_RE.test(name))                       return json({ error: 'bad name' }, 400)
  if (prompt.length < 10 || prompt.length > 4000) return json({ error: 'bad prompt' }, 400)

  // Owner-uploaded avatar wins — never spend a generation on it.
  if (await exists(OWNER_BUCKET, name)) return json({ ok: true, source: 'owner' })
  // First-writer-wins: already generated for this character.
  if (await exists(GEN_BUCKET, name))   return json({ ok: true, source: 'cache' })

  const bytes = await generate(prompt, aspectRatio)
  if (!bytes) return json({ ok: false, error: 'generation failed' }, 502)

  const { error } = await admin.storage.from(GEN_BUCKET).upload(name, bytes, {
    contentType: 'image/png', upsert: false,
  })
  // A concurrent writer winning the race is fine — the image is stored either way.
  if (error && !/exist|duplicate|already/i.test(error.message)) {
    return json({ ok: false, error: 'store failed' }, 500)
  }
  return json({ ok: true, source: 'generated' })
})
