/**
 * Serves the prebaked map dataset to the renderer.
 *
 * The dataset (rooms.json) and its precomputed coordinates (layouts.json) are
 * generated offline by scripts/build-rooms.js + scripts/bake-layouts.js and ship
 * with the app. They are read-only and identical for every user; the renderer's
 * own recorded map lives separately in MapStore and is the only part that changes.
 *
 * The files are handed over as raw JSON TEXT rather than parsed objects. Sending a
 * parsed 19k-room graph across IPC means structured-cloning tens of thousands of
 * nested objects, which is far slower than shipping one large string and letting
 * the renderer call JSON.parse once. It also keeps the main process from holding a
 * second copy of a graph it never looks at.
 */

import { join } from 'path'
import { existsSync, readFileSync, statSync } from 'fs'
import { app } from 'electron'

/** The instance we ship data for. DR Prime is the only curated set today. */
const INSTANCE = 'dr-prime'

export interface RawDataset {
  /** rooms.json as text; null when the app was packaged without a dataset. */
  rooms:   string | null
  /** layouts.json as text; null when layouts were never baked. */
  layouts: string | null
}

/**
 * Where map-data lands differs between a packaged app and a dev run: packaging
 * copies resources/map-data to <resources>/map-data (see extraResources), while
 * `npm run dev` runs straight out of the repo.
 */
function dataDir(): string | null {
  const candidates = [
    join(process.resourcesPath ?? '', 'map-data', INSTANCE),
    join(app.getAppPath(), 'resources', 'map-data', INSTANCE),
    join(process.cwd(), 'resources', 'map-data', INSTANCE),
  ]
  return candidates.find(d => existsSync(join(d, 'rooms.json'))) ?? null
}

// Read once and hold the text. It is a fixed cost paid on first map open, and the
// alternative — re-reading ~11 MB whenever a window reloads — is worse.
let cached: RawDataset | null = null

export function loadRawDataset(): RawDataset {
  if (cached) return cached

  const dir = dataDir()
  if (!dir) {
    console.warn('[map] no prebaked dataset found; the map will build itself from live play only')
    return (cached = { rooms: null, layouts: null })
  }

  const read = (name: string): string | null => {
    const file = join(dir, name)
    if (!existsSync(file)) return null
    try {
      return readFileSync(file, 'utf8')
    } catch (err) {
      // A missing or unreadable dataset is degraded, not fatal — live mapping
      // still works, so log and carry on rather than failing the map entirely.
      console.error(`[map] failed to read ${name}:`, err)
      return null
    }
  }

  const rooms = read('rooms.json')
  const layouts = read('layouts.json')
  if (rooms) {
    const mb = (statSync(join(dir, 'rooms.json')).size / 1048576).toFixed(1)
    console.log(`[map] dataset ${INSTANCE} loaded (${mb} MB${layouts ? ' + baked layouts' : ', no baked layouts'})`)
  }
  return (cached = { rooms, layouts })
}
