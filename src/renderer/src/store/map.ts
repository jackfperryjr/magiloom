import { atom } from 'jotai'
import { emptyDb, type MapDB } from '../lib/mapModel'

// ── Automapper live state ───────────────────────────────────────────────────────
// The whole world map (all zones) lives in one atom, loaded once from the shared
// map-store on mount and mutated as the character walks. Persistence is pushed back
// down per-zone (debounced in main) by useAutomapper.
export const mapDbAtom = atom<MapDB>(emptyDb())

// The node id of the room the character is currently standing in (null until the
// first room is recorded after connect).
export const currentNodeIdAtom = atom<string | null>(null)

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
