// Is a Lich install behind the latest lich-5 release? Desktop checks the user's own
// install. magiserver keeps a copy of this file (src/lib/lich-version.ts) to check its
// shared install, and answers only admins — players can't update the server's Lich.

import { readFile } from 'fs/promises'
import { dirname, join } from 'path'

export interface LichUpdateInfo {
  installed: string   // "5.20.0"
  latest:    string   // "5.24.0"
  url:       string   // release notes page
  // Set by the server: Lich there is shared and updated through magiserver's
  // Dockerfile pin, so the banner points the admin at the pending bump PR instead
  // of the in-game update command.
  managed?:  { prsUrl: string }
}

const RELEASES = 'https://api.github.com/repos/elanthia-online/lich-5/releases/latest'

// "LICH_VERSION = '5.20.0' # x-release-please-version" in lib/version.rb.
export function parseLichVersion(src: string): string {
  return src.match(/LICH_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1] ?? ''
}

// Numeric compare of dotted versions; a leading "v" and any "-beta" style suffix
// are ignored. Returns true only when `latest` is strictly newer.
export function isNewer(latest: string, installed: string): boolean {
  const parts = (v: string) => v.replace(/^v/i, '').split(/[-+]/)[0].split('.').map(n => parseInt(n, 10) || 0)
  const a = parts(latest), b = parts(installed)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d) return d > 0
  }
  return false
}

// Cache the GitHub lookup for a few hours: the unauthenticated API allows 60/hour,
// and the server copy of this module runs for days, so it must expire.
const TTL_MS = 6 * 60 * 60 * 1000
let latestCache: { at: number; value: Promise<{ tag: string; url: string } | null> } | null = null

function fetchLatest(): Promise<{ tag: string; url: string } | null> {
  if (latestCache && Date.now() - latestCache.at < TTL_MS) return latestCache.value
  const value = fetch(RELEASES, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lantern' } })
    .then(r => r.ok ? r.json() as Promise<{ tag_name?: string; html_url?: string }> : null)
    .then(j => j?.tag_name ? { tag: j.tag_name.replace(/^v/i, ''), url: j.html_url ?? '' } : null)
    .catch(() => null)
    .then(v => { if (!v) latestCache = null; return v })   // retry next time after a failure
  latestCache = { at: Date.now(), value }
  return value
}

// `lichPath` is lich.rbw; the version sits in lib/version.rb beside it. Null when
// there's no install, it can't be read, GitHub can't be reached, or it's current.
export async function checkLichUpdate(lichPath: string): Promise<LichUpdateInfo | null> {
  if (!lichPath) return null
  let installed = ''
  try { installed = parseLichVersion(await readFile(join(dirname(lichPath), 'lib', 'version.rb'), 'utf8')) }
  catch { return null }
  if (!installed) return null
  const latest = await fetchLatest()
  if (!latest || !isNewer(latest.tag, installed)) return null
  return { installed, latest: latest.tag, url: latest.url }
}
