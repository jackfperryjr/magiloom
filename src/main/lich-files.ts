import { join, resolve, sep } from 'path'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync,
} from 'fs'

// ── User-editable Lich files (path-jailed) ──────────────────────────────────────
// Powers the in-app Lich file editor. ONLY two dirs under the Lich scripts dir are
// writable: profiles/ (<Char>-setup.yaml) and custom/ (personal .lic scripts). The
// engine, community library, and everything else stay read-only and unreachable.
// Mirrors the server's src/lich-files.ts; here the scripts dir is the local Lich
// install's (…/Lich5/scripts). Every path is confined to profiles/ or custom/.

export type EditableDir = 'profiles' | 'custom'
const ROOTS: EditableDir[] = ['profiles', 'custom']

export interface LichFileEntry {
  dir: EditableDir
  name: string
  size: number
  mtime: number
}

function jail(scriptsDir: string, rel: string): string {
  const target = resolve(scriptsDir, rel)
  const ok = ROOTS.some(r => {
    const root = resolve(scriptsDir, r)
    return target === root || target.startsWith(root + sep)
  })
  if (!ok) throw new Error('Path not allowed: must be within profiles/ or custom/')
  return target
}

export function listFiles(scriptsDir: string): LichFileEntry[] {
  const out: LichFileEntry[] = []
  for (const dir of ROOTS) {
    const abs = join(scriptsDir, dir)
    if (!existsSync(abs)) { try { mkdirSync(abs, { recursive: true }) } catch { /* ignore */ } continue }
    for (const name of readdirSync(abs)) {
      try {
        const st = statSync(join(abs, name))
        if (st.isFile()) out.push({ dir, name, size: st.size, mtime: st.mtimeMs })
      } catch { /* skip unreadable */ }
    }
  }
  return out
}

export function readFile(scriptsDir: string, rel: string): { path: string; content: string } {
  const abs = jail(scriptsDir, rel)
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('Not found: ' + rel)
  return { path: rel, content: readFileSync(abs, 'utf8') }
}

export function writeFile(scriptsDir: string, rel: string, content: string): { path: string } {
  const abs = jail(scriptsDir, rel)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  return { path: rel }
}

export function deleteFile(scriptsDir: string, rel: string): { path: string } {
  const abs = jail(scriptsDir, rel)
  if (existsSync(abs)) rmSync(abs)
  return { path: rel }
}
