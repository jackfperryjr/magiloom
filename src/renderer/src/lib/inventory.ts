/**
 * The structured inventory model.
 *
 * `_inventory manager <id>` answers with the character's whole item tree: one `<i/>`
 * per item, each naming its parent by exist id. This module turns those raw
 * attributes into typed items, assembles the envelopes into one snapshot, and
 * refuses anything that doesn't describe a sane tree. Nothing here touches XML or
 * the store, so it can be tested directly (inventory.test.ts).
 *
 * A response is only trustworthy as a whole: half a tree is worse than none, because
 * the panel would show items sitting in containers they've already left. So every
 * check below is fatal to the whole snapshot rather than skipping the odd item.
 */

import type { InvEnvelope } from './sge-parser'

/** Where an item sits relative to its parent. */
export type InvRelation =
  | 'in' | 'on' | 'behind' | 'underneath'          // inside/against a container
  | 'worn' | 'righthand' | 'lefthand' | 'atfeet' | 'reserved'   // directly on the character

const CONTAINER_RELATIONS = new Set(['in', 'on', 'behind', 'underneath'])
const PLAYER_RELATIONS    = new Set(['worn', 'righthand', 'lefthand', 'atfeet', 'reserved'])

/** `parent` is an exist id, or one of these two roots. */
export type InvParent = string
export const PLAYER = 'player'
export const ROOM   = 'room'

export interface InvItem {
  id:       string        // exist id — what commands address as #id
  parent:   InvParent
  relation: InvRelation
  /** Full display name, e.g. "a rugged brown backpack". */
  name:     string
  /** The server's three comma-separated name fields, kept for command building. */
  article:  string
  adjective: string
  noun:     string
  /** Longer description where the server sends one; falls back to `name`. */
  long?:    string
  /** Raw server units — NOT pounds. See weightOf(). -1 means unknown. */
  weight:   number
  encum?:   number
  /** Capacity for things put in / on this item. Absent or 0 = holds nothing. */
  inMax?:   number
  onMax?:   number
  inEncum?: number
  /** Server-supplied noun phrase for addressing this container in a command. */
  inSelector?: string
  flags:    Set<string>
  locker?:      boolean
  familyVault?: boolean
}

export interface InvSnapshot {
  /** Room the snapshot was taken in — it is only valid for that room. */
  room:  string
  items: Map<string, InvItem>
  at:    number
}

// ── Field parsing ─────────────────────────────────────────────────────────────

/**
 * The server sends three comma-separated name fields. They are NOT strictly
 * article/adjective/noun: everything before the second-to-last comma lands in the
 * first field, so "a rugged,brown,backpack" means article="a rugged". Only the last
 * field is reliably the bare noun. Joining all three reproduces the display name.
 */
function parseName(raw: string | undefined): Pick<InvItem, 'article' | 'adjective' | 'noun' | 'name'> {
  if (raw == null) throw new Error('item is missing name')
  const first = raw.indexOf(',')
  const second = first < 0 ? -1 : raw.indexOf(',', first + 1)
  if (first < 0 || second < 0) throw new Error(`name is not three comma-separated fields: "${raw}"`)
  const article   = raw.slice(0, first).trim()
  const adjective = raw.slice(first + 1, second).trim()
  const noun      = raw.slice(second + 1).trim()
  if (!noun) throw new Error(`name has no noun: "${raw}"`)
  return { article, adjective, noun, name: [article, adjective, noun].filter(Boolean).join(' ') }
}

/** `loc` is either the bare root "room", or "<relation>,<parentExistId>". */
function parseLoc(raw: string | undefined, id: string): Pick<InvItem, 'parent' | 'relation'> {
  if (!raw) throw new Error(`item ${id} is missing loc`)
  if (raw === ROOM) return { parent: ROOM, relation: 'in' }

  const comma = raw.indexOf(',')
  if (comma <= 0 || comma === raw.length - 1 || raw.indexOf(',', comma + 1) >= 0) {
    throw new Error(`item ${id} has invalid loc "${raw}"`)
  }
  const relation = raw.slice(0, comma)
  const parent   = raw.slice(comma + 1)
  const ok = parent === PLAYER ? PLAYER_RELATIONS.has(relation) : CONTAINER_RELATIONS.has(relation)
  if (!ok) throw new Error(`item ${id} has invalid relation "${relation}" for parent "${parent}"`)
  return { parent, relation: relation as InvRelation }
}

/** Integers only. -1 is the server's "unknown"; other negatives are corruption. */
function parseInt_(raw: string | undefined, id: string, field: string, allowUnknown = false): number | undefined {
  if (raw == null) return undefined
  const n = Number(raw)
  if (!raw.trim() || !Number.isInteger(n) || (n < 0 && !(allowUnknown && n === -1))) {
    throw new Error(`item ${id} has invalid ${field} "${raw}"`)
  }
  return n
}

/** One `<i/>`'s attributes → a typed item. Throws on anything malformed. */
export function parseInvItem(attrs: Record<string, string>): InvItem {
  const id = attrs['id']
  if (!id) throw new Error('item is missing id')

  const weight = parseInt_(attrs['weight'], id, 'weight', true)
  if (weight === undefined) throw new Error(`item ${id} is missing weight`)

  const flags = new Set(
    (attrs['flags'] ?? '').split(',').map(f => f.trim()).filter(Boolean),
  )
  const long  = attrs['long']?.replace(/\$_/g, '').trim()
  const inSel = attrs['in_selector']?.trim()

  return {
    id,
    ...parseLoc(attrs['loc'], id),
    ...parseName(attrs['name']),
    ...(long  ? { long } : {}),
    weight,
    ...(attrs['encum']    != null ? { encum:   parseInt_(attrs['encum'],    id, 'encum', true)! } : {}),
    ...(attrs['in_max']   != null ? { inMax:   parseInt_(attrs['in_max'],   id, 'in_max')!     } : {}),
    ...(attrs['on_max']   != null ? { onMax:   parseInt_(attrs['on_max'],   id, 'on_max')!     } : {}),
    ...(attrs['in_encum'] != null ? { inEncum: parseInt_(attrs['in_encum'], id, 'in_encum')!   } : {}),
    ...(inSel ? { inSelector: inSel } : {}),
    flags,
    ...(attrs['locker']      === '1' ? { locker: true }      : {}),
    ...(attrs['familyvault'] === '1' ? { familyVault: true } : {}),
  }
}

// ── Item questions ────────────────────────────────────────────────────────────

export const isContainer = (i: InvItem): boolean => (i.inMax ?? 0) > 0 || (i.onMax ?? 0) > 0
export const isClosed    = (i: InvItem): boolean => i.flags.has('closed')
/** The server's "you can't pick this up" marker. */
export const isFixed     = (i: InvItem): boolean => (i.encum ?? i.weight) === -1

/**
 * Weight and capacity arrive as raw integers whose scale is not yet pinned down for
 * DragonRealms — the sample tree reads sensibly as tenths of a pound for `weight`
 * and hundredths for `in_max`, but that is inference from four items, not a
 * measurement. Everything funnels through these two so there is exactly one place
 * to fix once we've compared a container against what the game reports.
 */
export const weightOf   = (i: InvItem): number | null => (i.weight === -1 ? null : i.weight)
export const capacityOf = (i: InvItem, side: 'in' | 'on' = 'in'): number | null => {
  const raw = side === 'in' ? i.inMax : i.onMax
  return raw == null || raw === 0 ? null : raw
}

/** Root-first chain of containers above an item, e.g. [jacket] for a ring in a jacket. */
export function pathTo(snapshot: InvSnapshot, item: InvItem): InvItem[] {
  const chain: InvItem[] = []
  const seen = new Set([item.id])
  let parent = item.parent
  while (parent !== PLAYER && parent !== ROOM) {
    const next = snapshot.items.get(parent)
    if (!next || seen.has(next.id)) break
    chain.push(next)
    seen.add(next.id)
    parent = next.parent
  }
  return chain.reverse()
}

/** How deeply an item is nested — 0 for anything worn/held/on the ground. */
export const depthOf = (snapshot: InvSnapshot, item: InvItem): number => pathTo(snapshot, item).length

/** True when any container between the item and the character is shut. */
export const isBuried = (snapshot: InvSnapshot, item: InvItem): boolean =>
  pathTo(snapshot, item).some(isClosed)

/** Direct children of a container, in server order. */
export function childrenOf(snapshot: InvSnapshot, parentId: string): InvItem[] {
  const out: InvItem[] = []
  for (const item of snapshot.items.values()) if (item.parent === parentId) out.push(item)
  return out
}

// ── Assembly ──────────────────────────────────────────────────────────────────

export interface Cursor { room: string; root: string; last: string }

export type AssemblyState =
  | { status: 'collecting'; pending: Cursor[] }   // more envelopes to request
  | { status: 'ready';   snapshot: InvSnapshot }
  | { status: 'stale' }                           // server invalidated the walk; start over
  | { status: 'failed';  error: string }

/**
 * Accumulates the envelopes of one `_inventory manager` walk.
 *
 * A large inventory answers in pieces: each `<continuation>` names a branch that has
 * to be asked for separately. The caller owns sending those requests (this module
 * stays free of the game socket); `take()` reports which cursors are outstanding
 * after each envelope, and returns `ready` only once every branch has landed and the
 * assembled tree validates.
 */
export class InvAssembler {
  private items    = new Map<string, InvItem>()
  private queue: Cursor[] = []
  private seen     = new Set<string>()   // cursor keys, so a loop can't re-request forever
  private room     = ''
  private started  = false

  /** Fold in one envelope and report what the walk needs next. */
  take(env: InvEnvelope): AssemblyState {
    if (env.state === 'stale')     return { status: 'stale' }
    if (env.state != null)         return { status: 'failed', error: `unexpected state "${env.state}"` }
    if (!env.room)                 return { status: 'failed', error: 'envelope is missing room' }

    if (!this.started) {
      // The first envelope opens the walk and fixes the room every later one must match.
      if (env.root != null || env.after != null) {
        return { status: 'failed', error: 'first envelope carries continuation fields' }
      }
      this.room    = env.room
      this.started = true
    } else if (env.room !== this.room) {
      return { status: 'failed', error: `envelope room ${env.room} does not match ${this.room}` }
    }

    try {
      for (const raw of env.items) {
        const item = parseInvItem(raw)
        if (this.items.has(item.id)) throw new Error(`duplicate item ${item.id}`)
        // Depth-first order is the server's promise; relying on it means a missing
        // parent is caught here rather than surfacing as an orphan in the panel.
        if (item.parent !== PLAYER && item.parent !== ROOM && !this.items.has(item.parent)) {
          throw new Error(`item ${item.id} arrived before its parent ${item.parent}`)
        }
        this.items.set(item.id, item)
      }
      for (const raw of env.continuations) this.queueCursor(raw)
    } catch (err) {
      return { status: 'failed', error: err instanceof Error ? err.message : String(err) }
    }

    if (this.queue.length > 0) return { status: 'collecting', pending: this.queue.slice() }

    const problem = validateTree(this.items)
    if (problem) return { status: 'failed', error: problem }
    return { status: 'ready', snapshot: { room: this.room, items: this.items, at: Date.now() } }
  }

  /** Cursors not yet requested, oldest first. The caller marks them sent via drain(). */
  drain(max: number): Cursor[] {
    return this.queue.splice(0, max)
  }

  private queueCursor(raw: Record<string, string>): void {
    const root = raw['root']
    const last = raw['last']
    if (!root || !last) throw new Error('continuation is missing root/last')
    const key = `${this.room} ${root} ${last}`
    if (this.seen.has(key)) throw new Error(`repeated continuation cursor ${root}/${last}`)
    this.seen.add(key)
    this.queue.push({ room: this.room, root, last })
  }
}

/** Structural check over a finished tree. Returns the problem, or null when sound. */
export function validateTree(items: Map<string, InvItem>): string | null {
  for (const item of items.values()) {
    if (item.parent !== PLAYER && item.parent !== ROOM && !items.has(item.parent)) {
      return `item ${item.id} has missing parent ${item.parent}`
    }
    const seen = new Set([item.id])
    let parent = item.parent
    while (parent !== PLAYER && parent !== ROOM) {
      if (seen.has(parent)) return `inventory contains a cycle at ${parent}`
      seen.add(parent)
      const next = items.get(parent)
      if (!next) break
      parent = next.parent
    }
  }
  return null
}
