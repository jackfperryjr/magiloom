import { atom } from 'jotai'
import { emptyDb, type MapDB, type MapNode } from '../lib/mapModel'

// ── Automapper live state ───────────────────────────────────────────────────────
// The whole world map (all zones) lives in one atom, loaded once from the shared
// map-store on mount and mutated as the character walks. Persistence is pushed back
// down per-zone (debounced in main) by useAutomapper.
export const mapDbAtom = atom<MapDB>(emptyDb())

// The node id of the room the character is currently standing in (null until the
// first room is recorded after connect).
export const currentNodeIdAtom = atom<string | null>(null)

// The current room's mapped node, or null when it isn't on the map yet. Zones hold
// nodes in per-zone records with no global index, so this scans — but only when the
// db or the current room actually changes, which is once per move at most, and it
// saves every consumer writing the same loop. The ambient overlay reads the baked
// locale/ambience off it (see store/game).
export const currentNodeAtom = atom<MapNode | null>(get => {
  const id = get(currentNodeIdAtom)
  if (!id) return null
  for (const z of Object.values(get(mapDbAtom).zones)) {
    const n = z.nodes[id]
    if (n) return n
  }
  return null
})

// Auto-record toggle. Persisted per-window in localStorage (a quick, no-IPC store
// mirroring linkMode); the Settings "Maps" tab surfaces it. When off, the mapper
// still tracks position against the existing map but never adds nodes/arcs.
const LS_AUTORECORD = 'magiloom-automap-record'
const _autoRecord = atom<boolean>((() => {
  try { return localStorage.getItem(LS_AUTORECORD) !== '0' } catch { return true }
})())
export const autoRecordAtom = atom(
  get => get(_autoRecord),
  (_get, set, v: boolean) => {
    set(_autoRecord, v)
    try { localStorage.setItem(LS_AUTORECORD, v ? '1' : '0') } catch { /* ignore */ }
  },
)

// ── Walk-to state (populated in Phase 3) ────────────────────────────────────────
// active = a walk is in progress; path = remaining/full move list; index = the next
// step; targetId = destination node. Consumers show a Stop control while active.
export interface WalkState {
  active:   boolean
  path:     string[]
  index:    number
  targetId: string | null
}
export const walkStateAtom = atom<WalkState>({ active: false, path: [], index: 0, targetId: null })
