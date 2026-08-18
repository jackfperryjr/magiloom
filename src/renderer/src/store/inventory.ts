import { atom } from 'jotai'
import { InvAssembler, type InvSnapshot } from '../lib/inventory'
import type { InvEnvelope } from '../lib/sge-parser'

/**
 * Drives one `_inventory manager` walk and holds its result.
 *
 * The server answers a request by id, and a big inventory answers across several
 * envelopes — each `<continuation>` names a branch to ask for separately. So a walk
 * is a small state machine: send the opening request, feed every envelope into the
 * assembler, request whatever branches it reports, and publish the snapshot only
 * once the tree is whole and validates.
 *
 * Deliberately imports nothing from store/game.ts — game.ts feeds envelopes in here,
 * and a dependency back the other way would be a module cycle. Anything needing the
 * current room (to tell whether a snapshot has gone stale) compares roomAtom against
 * `snapshot.room` at the point of use.
 */

const MAX_IN_FLIGHT = 4       // matches what the official client asks of the server
const RESPONSE_TIMEOUT = 12_000

export type InvStatus = 'idle' | 'loading' | 'ready' | 'error'

export const invStatusAtom   = atom<InvStatus>('idle')
export const invSnapshotAtom = atom<InvSnapshot | null>(null)
export const invErrorAtom    = atom<string | null>(null)
/** Branches still outstanding — shown while a large inventory pages in. */
export const invPendingAtom  = atom(0)

interface Walk {
  asm:     InvAssembler
  pending: Set<string>                              // request ids awaiting an envelope
  timer:   ReturnType<typeof setTimeout> | null
  retried: boolean                                  // whether the silent retry has been used
  onSilence: () => void                             // what to do when the clock runs out
}

// One walk at a time. A response whose id isn't in `pending` belongs to a walk that
// was abandoned (a second Refresh, a disconnect) and is dropped on the floor.
let _walk: Walk | null = null
let _seq = 0

function nextRequestId(): string {
  _seq = (_seq + 1) % 46_655
  return `lan${Date.now().toString(36)}${_seq.toString(36)}`
}

function send(cmd: string): void {
  window.dr?.game?.send(cmd)
}

function endWalk(): void {
  if (_walk?.timer) clearTimeout(_walk.timer)
  _walk = null
}

/** (Re)start the silence clock. Any progress on a walk should push it back. */
function armClock(walk: Walk): void {
  if (walk.timer) clearTimeout(walk.timer)
  walk.timer = setTimeout(() => { if (_walk === walk) walk.onSilence() }, RESPONSE_TIMEOUT)
}

/** Start (or restart) a walk. `keepSnapshot` leaves the old tree visible while reloading. */
export const refreshInventoryAtom = atom(null, (_get, set, keepSnapshot = true) => {
  endWalk()

  const walk: Walk = {
    asm: new InvAssembler(), pending: new Set(), timer: null, retried: false,
    onSilence: () => {},
  }
  _walk = walk

  set(invStatusAtom, 'loading')
  set(invErrorAtom, null)
  if (!keepSnapshot) set(invSnapshotAtom, null)

  const ask = (): void => {
    const id = nextRequestId()
    walk.pending.add(id)
    set(invPendingAtom, walk.pending.size)
    armClock(walk)
    send(`_inventory manager ${id}`)
  }

  // The command is fire-and-forget over the game socket — no ack, no error reply — so
  // a request that gets lost to a busy moment is indistinguishable from a broken
  // feature. Retry once, silently, before saying anything: that turns most of those
  // into a slightly slow refresh rather than an alarming "the game did not answer".
  walk.onSilence = () => {
    if (!walk.retried) {
      walk.retried = true
      walk.pending.clear()   // abandon the first request; a late reply is ignored
      ask()
      return
    }
    endWalk()
    set(invStatusAtom, 'error')
    set(invPendingAtom, 0)
    set(invErrorAtom, 'The game hasn’t answered. Refresh to try again — if it keeps happening, check that you’re still connected.')
  }

  ask()
})

/** Fold in one `<inventoryManager>` envelope. Called from the game event stream. */
export const receiveInvEnvelopeAtom = atom(null, (_get, set, env: InvEnvelope) => {
  const walk = _walk
  if (!walk || !env.id || !walk.pending.has(env.id)) return   // not ours — ignore
  walk.pending.delete(env.id)

  const state = walk.asm.take(env)

  if (state.status === 'failed' || state.status === 'stale') {
    endWalk()
    set(invStatusAtom, 'error')
    set(invPendingAtom, 0)
    set(invErrorAtom, state.status === 'stale'
      ? 'The game restarted the inventory walk. Refresh to try again.'
      : `Inventory data did not make sense: ${state.error}`)
    return
  }

  if (state.status === 'ready') {
    endWalk()
    set(invSnapshotAtom, state.snapshot)
    set(invStatusAtom, 'ready')
    set(invErrorAtom, null)
    set(invPendingAtom, 0)
    return
  }

  // Still collecting: ask for as many outstanding branches as we're willing to have
  // in flight at once, and restart the clock — progress means the server is alive.
  for (const cursor of walk.asm.drain(MAX_IN_FLIGHT - walk.pending.size)) {
    const id = nextRequestId()
    walk.pending.add(id)
    send(`_inventory manager ${id} continue ${cursor.room} ${cursor.root} ${cursor.last}`)
  }

  // Past the first envelope the server has clearly heard us, so a stall here is a
  // different failure from silence at the start — say so, and don't re-ask (a repeated
  // opening request would start a second walk against a half-built tree).
  walk.onSilence = () => {
    endWalk()
    set(invStatusAtom, 'error')
    set(invPendingAtom, 0)
    set(invErrorAtom, 'The inventory stopped arriving part-way through. Refresh to try again.')
  }
  armClock(walk)

  set(invPendingAtom, walk.pending.size)
})

/** Drop everything — on disconnect or a character switch the tree is meaningless. */
export const clearInventoryAtom = atom(null, (_get, set) => {
  endWalk()
  set(invSnapshotAtom, null)
  set(invStatusAtom, 'idle')
  set(invErrorAtom, null)
  set(invPendingAtom, 0)
})
