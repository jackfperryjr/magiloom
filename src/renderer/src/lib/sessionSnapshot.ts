/**
 * Session snapshot — carry the panels across a reload.
 *
 * Most of what the panels show is pushed by the game exactly once, when it
 * changes. The room arrives when you MOVE, hands when you swap something, exp
 * when a skill ticks. That is fine until the client restarts underneath a live
 * session: on web, applying an update reloads the page while the server keeps
 * the game connection, so nothing reconnects and the game never re-announces
 * anything. Re-asking doesn't rescue it either — LOOK returns the "you also see"
 * line, not a room feed, and nothing but real movement emits `<nav rm>` for the
 * map. Sit still through an update mid-hunt and the room, map position and exp
 * stay blank until the next time you walk, which can be the better part of an
 * hour.
 *
 * So we keep the last known state in localStorage (synchronous, so it survives an
 * abrupt reload) and put it back when a resumed session comes up empty.
 *
 * Deliberately NOT snapshotted:
 *   • map position — restoring the ROOM is enough. The automapper re-evaluates on
 *     every prompt while it doesn't know where it is (see useAutomapper's fold
 *     effect), so a restored room re-anchors the position within a prompt or two,
 *     through the path it already uses to find itself.
 *   • the inventory tree — it is a photograph of one room including what's on the
 *     ground, the Item Manager already invalidates it when the room changes, and
 *     it re-walks itself on open. A restored tree would be worth less than no
 *     tree at all.
 *
 * The types are imported type-only, so this module pulls in nothing at runtime
 * and stays testable on its own.
 */

import type { RoomState, ExpState } from '../store/game'

export interface SessionSnapshot {
  /** Whose session this is. A snapshot is only ever restored for the same character. */
  char:  string
  /** When it was written, for the staleness check. */
  at:    number
  room:  RoomState
  exp:   ExpState
  hands: { left: string; right: string }
}

const KEY = 'magiloom-session-snapshot'

/**
 * How old a snapshot may be and still be worth restoring. This is not about the
 * data decaying on a shelf — it's that the further back it was written, the more
 * likely the character has been moved since by something that wasn't us (a Lich
 * script, a GM, a death). An update takes seconds; anything measured in hours is
 * a different session wearing the same name.
 */
export const SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000  // 2 hours

/** A snapshot with nothing in it would only overwrite live state with blanks. */
export function isWorthSaving(s: SessionSnapshot): boolean {
  return Boolean(s.char) && Boolean(s.room.name || s.room.description || s.exp.skills.length)
}

export function saveSnapshot(s: SessionSnapshot): void {
  if (!isWorthSaving(s)) return
  try { localStorage.setItem(KEY, JSON.stringify(s)) } catch { /* private mode / quota — not worth failing over */ }
}

export function clearSnapshot(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}

/** Structural check: a snapshot written by an older build must not crash a newer one. */
function isSnapshot(v: unknown): v is SessionSnapshot {
  if (!v || typeof v !== 'object') return false
  const s = v as Partial<SessionSnapshot>
  return typeof s.char === 'string'
    && typeof s.at === 'number'
    && Boolean(s.room) && typeof s.room?.name === 'string' && Array.isArray(s.room?.exits)
    && Boolean(s.exp)  && Array.isArray(s.exp?.skills)
    && Boolean(s.hands) && typeof s.hands?.left === 'string'
}

/**
 * The stored snapshot, if it belongs to `char` and is recent enough. Parsing is
 * separated from storage so the decision can be tested without a DOM.
 */
export function parseSnapshot(raw: string | null, char: string, now = Date.now()): SessionSnapshot | null {
  if (!raw) return null
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (!isSnapshot(parsed)) return null
  if (parsed.char.trim().toLowerCase() !== char.trim().toLowerCase()) return null
  if (now - parsed.at > SNAPSHOT_TTL_MS || parsed.at > now) return null
  return parsed
}

export function loadSnapshot(char: string, now = Date.now()): SessionSnapshot | null {
  try { return parseSnapshot(localStorage.getItem(KEY), char, now) }
  catch { return null }
}
