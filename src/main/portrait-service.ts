import { SUPABASE_URL, getAvatar } from './avatar-service'

// Client half of the shared LOOK-portrait service. Generation happens
// server-side (the `portrait` Edge Function holds the Gemini key), so a
// character is generated once for everyone and stored in the public `portraits`
// bucket. This process only reads the CDN and, on a miss, asks the function to
// generate + store. Images come back to the renderer as data URLs (allowed by
// its `img-src 'self' data:` CSP). Owner-uploaded avatars live in the separate
// `avatars` bucket and always outrank generated portraits (resolved in the UI).

const STORAGE = SUPABASE_URL ? `${SUPABASE_URL}/storage/v1/object/public/portraits` : ''
const FN      = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/portrait` : ''

// Image aspect ratio the function generates at. 1:1 (square) forces a tight
// head-and-shoulders/bust crop; a taller ratio (3:4, 2:3) lets the model drift
// down to waist/full-body. Tune here — the deployed function honors this value,
// so changing it needs no Supabase redeploy.
const ASPECT_RATIO = '1:1'

const norm = (n: string) => n.trim().toLowerCase()

interface CacheEntry { dataUrl: string | null; at: number }
const readCache = new Map<string, CacheEntry>()
const TTL_MS    = 5 * 60 * 1000
// Share one in-flight request per name so React StrictMode's double-mount (and
// two look cards for the same character) never double-generate.
const inflight  = new Map<string, Promise<string | null>>()

async function readBucket(name: string): Promise<string | null> {
  const res = await fetch(`${STORAGE}/${encodeURIComponent(name)}`)
  if (!res.ok) return null
  const type = res.headers.get('content-type') || 'image/png'
  const buf  = Buffer.from(await res.arrayBuffer())
  return `data:${type};base64,${buf.toString('base64')}`
}

export function ensurePortrait(name: string, prompt: string): Promise<string | null> {
  if (!STORAGE || !FN || !name.trim()) return Promise.resolve(null)
  const key = norm(name)

  const hit = readCache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.dataUrl)
  const existing = inflight.get(key)
  if (existing) return existing

  const run = (async (): Promise<string | null> => {
    let result: string | null = null
    try {
      // 1. Owner-uploaded avatar always wins — return it, never a generated one.
      const owner = await getAvatar(name)
      if (owner) {
        result = owner
      } else {
        // 2. Already-generated portrait in the shared bucket?
        result = await readBucket(key)
        if (!result) {
          // 3. Ask the function to generate + store (first-writer-wins server-side).
          const res = await fetch(FN, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: key, prompt, aspectRatio: ASPECT_RATIO }),
          })
          if (res.ok) {
            const j = await res.json() as { ok?: boolean; source?: string }
            // 'owner' → an avatar appeared meanwhile; leave it to the owner path.
            if (j.ok && j.source !== 'owner') result = await readBucket(key)
          } else {
            console.warn(`[portrait] function ${res.status}: ${(await res.text()).slice(0, 200)}`)
          }
        }
      }
    } catch (e) {
      console.warn('[portrait] ensure failed: ' + String(e))
    }
    readCache.set(key, { dataUrl: result, at: Date.now() })
    inflight.delete(key)
    return result
  })()

  inflight.set(key, run)
  return run
}
