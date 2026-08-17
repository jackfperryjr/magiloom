import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { roomAtom, promptCountAtom, connectionStatusAtom, roundtimeAtom, appendScriptOutputAtom, currentGameMove, clearGameMove } from '../store/game'
import { mapDbAtom, currentNodeIdAtom, autoRecordAtom, walkStateAtom } from '../store/map'
import { classifyMove, roomSignature, parseRoomUid, stripRoomTag, emptyDb, type MapDB, type Zone } from '../lib/mapModel'
import { observeRoom, locateRoom, recordArc, nodeZoneId, findRoute, findNode, matchRoom, firstUnwalkableLink } from '../lib/mapper'
import { seedFromDataset, recordedZone, reseedZone } from '../lib/mapSeed'

// A captured movement is only paired with the room change it caused if the change
// lands within this window (a move + server round-trip). Beyond it, the room
// probably changed for another reason (a script, a shove) and we don't guess an arc.
const MOVE_WINDOW_MS = 6000

// Walk executor pacing. After a step's roundtime clears we wait a short buffer
// before sending the next move; a step that produces no room change within the
// timeout is treated as stuck and the walk aborts.
const STEP_BUFFER_MS  = 250
const STEP_TIMEOUT_MS = 9000

// Commands we send that plainly can't move us. Everything else is kept as a
// last-resort LABEL for a link we're about to traverse (see rawMoveRef) — an
// unrecognised travel verb ("board the ferry", a custom alias, a script's own
// wording) is exactly the case that used to leave a link recorded but unwalkable.
const NON_MOVE = /^(?:l|look|exp|experience|inv|inventory|health|info|skills|stats|spells|prep|cast|attack|kill|say|whisper|tell|think|shout|yell|who|time|date|weather|ready|stow|get|put|drop|wear|remove|open|close|search|hide|stand|sit|kneel|lie|lay)\b/i

// Temporary: log each mapping decision to the console to diagnose duplicate nodes.
const MAP_DEBUG = (() => { try { return localStorage.getItem('magiloom-automap-debug') !== '0' } catch { return true } })()

/**
 * The automapper: folds each room the character enters (and the movement that got
 * them there) into the shared world map, and tracks the current position. Pure
 * graph work lives in lib/mapper; this hook is the live wiring — it reads room
 * state + prompts from the store, captures sent movement commands, and pushes map
 * mutations back to disk (per-zone, debounced in main).
 *
 * Returns `recordSentCommand` (pass to useGameConnection's onCommand) and
 * `provideSend` (hand it the game send fn, used by the Phase 3 walker).
 */
export function useAutomapper() {
  const [db, setDb]     = useAtom(mapDbAtom)
  const setCurrentNode  = useSetAtom(currentNodeIdAtom)
  const autoRecord      = useAtomValue(autoRecordAtom)
  const room            = useAtomValue(roomAtom)
  const promptCount     = useAtomValue(promptCountAtom)
  const status          = useAtomValue(connectionStatusAtom)
  const roundtime       = useAtomValue(roundtimeAtom)
  const setWalkState    = useSetAtom(walkStateAtom)
  const echo            = useSetAtom(appendScriptOutputAtom)

  // Latest values mirrored into refs so the prompt-driven effect (which fires only
  // on promptCount) always reads current state without re-subscribing.
  const dbRef        = useRef(db);            useEffect(() => { dbRef.current = db }, [db])
  const roomRef      = useRef(room);          useEffect(() => { roomRef.current = room }, [room])
  const autoRef      = useRef(autoRecord);    useEffect(() => { autoRef.current = autoRecord }, [autoRecord])
  const rtRef        = useRef(roundtime);     useEffect(() => { rtRef.current = roundtime }, [roundtime])

  const currentIdRef  = useRef<string | null>(null)
  const lastSigRef    = useRef<string>('')
  // Last reason we bailed out of folding a room, so the log reports a state CHANGE
  // rather than repeating itself on every prompt.
  const lastSkipRef   = useRef<string>('')
  const pendingMoveRef = useRef<{ dir: string; move: string; ts: number } | null>(null)
  // Last command that wasn't recognised as movement but might still have been one.
  // Used only to give an otherwise-unwalkable link a command to replay.
  const rawMoveRef     = useRef<{ move: string; ts: number } | null>(null)
  const sendRef       = useRef<(cmd: string) => void>(() => {})

  // Walk-executor state (imperative; the atom mirrors it for the UI).
  const routeRef   = useRef<{ nodes: string[]; moves: string[] } | null>(null)
  const stepRef    = useRef(0)
  const walkTimer  = useRef<number | null>(null)  // pacing timer (RT wait)
  const stuckTimer = useRef<number | null>(null)  // per-step arrival timeout

  // ── Load the shared map once, and merge zones other windows rewrite ──────────
  // The player's recorded map lands first so the map is usable immediately, then
  // the shipped dataset is merged UNDER it to fill in everywhere they haven't been.
  // Seeding is deliberately not awaited before the first setDb: parsing ~19k rooms
  // takes long enough to be visible, and there is no reason to hold the player's
  // own map hostage to it.
  useEffect(() => {
    let cancelled = false
    // The recorded map and the shipped dataset are INDEPENDENT sources, so the load
    // is allowed to fail without taking seeding down with it. It used to be chained
    // inside this promise with a swallowing .catch, which meant one failed call —
    // on web that is a round trip to the server — silently left the map empty with
    // nothing logged. An unreachable recorded map should cost you your own rooms,
    // not the whole world.
    void (async () => {
      let recorded = emptyDb()
      try {
        const loaded = await window.dr.map.load()
        if (loaded?.zones) recorded = loaded
      } catch (err) {
        console.warn('[map] recorded map unavailable; showing the shipped map only:', err)
      }
      if (cancelled) return
      setDb(recorded)

      try {
        const seeded = await seedFromDataset(recorded)
        if (cancelled) return
        // Seeded rooms are NOT persisted back through map.saveZone: they are
        // regenerated from the shipped file on every load, and writing them into
        // the player's own store would bloat it and blur which rooms they actually
        // walked — the distinction the merge relies on to know what wins.
        if (seeded.added) setDb(seeded.db)
        if (MAP_DEBUG) {
          console.log(`[automap] seeded ${seeded.added} rooms (${seeded.skipped} already known), ` +
            `layouts ${seeded.baked ? 'baked' : `live${seeded.staleReason ? ` — ${seeded.staleReason}` : ''}`}`)
        }
      } catch (err) {
        // Never silent: a blank map with nothing in the console is the single
        // hardest version of this to diagnose.
        console.error('[map] seeding the shipped dataset failed; only recorded rooms will show:', err)
      }
    })()
    // Another window rewrote a zone. What it wrote is only ITS player's recorded
    // rooms, so the shipped ones have to be merged back in before it replaces what
    // we're displaying — otherwise a second character walking anywhere would empty
    // that area of our map until the next launch.
    const off = window.dr.map.onZoneChanged((zone: Zone) => {
      if (!zone?.id) return
      const merged = reseedZone(zone)
      setDb(prev => ({ ...prev, zones: { ...prev.zones, [merged.id]: merged } }))
    })
    return () => { cancelled = true; off() }
  }, [setDb])

  // ── Reset position tracking on (re)connect ──────────────────────────────────
  // A fresh connection (or a character switch) starts at an unknown position, so
  // the next room must not be joined to the previous session's room by a stale arc.
  // (Defined after the walk executor below, which stopWalk depends on.)

  // ── Capture movement commands sent to the game ──────────────────────────────
  // Every command the client sends is echoed back from main via game:sent, so we
  // capture movement no matter how it was issued (typed, clicked exit link, Room
  // panel, alias, .cmd script). This is the single universal capture point.

  const recordSentCommand = useCallback((cmd: string) => {
    const mv = classifyMove(cmd)
    if (mv) { pendingMoveRef.current = { ...mv, ts: Date.now() }; rawMoveRef.current = null; return }
    const raw = cmd.trim().replace(/\s+/g, ' ')
    // Kept ONLY to label an arc after a room change actually happens. It is
    // deliberately never fed into the room-identity decision: treating an arbitrary
    // command as movement is what used to spawn a duplicate of the room you were
    // standing in whenever its exits or description refreshed.
    rawMoveRef.current = raw && !NON_MOVE.test(raw) ? { move: raw, ts: Date.now() } : null
  }, [])
  useEffect(() => window.dr.game.onSent(recordSentCommand), [recordSentCommand])

  // Let the walker send moves through the same path the mapper observes (so a
  // click-walk also confirms/records arcs just like manual movement).
  const provideSend = useCallback((send: (cmd: string) => void) => { sendRef.current = send }, [])

  // ── Walk executor ────────────────────────────────────────────────────────────
  const clearWalkTimers = useCallback(() => {
    if (walkTimer.current  !== null) { clearTimeout(walkTimer.current);  walkTimer.current  = null }
    if (stuckTimer.current !== null) { clearTimeout(stuckTimer.current); stuckTimer.current = null }
  }, [])

  const stopWalk = useCallback((reason?: string) => {
    if (!routeRef.current) return
    clearWalkTimers()
    routeRef.current = null
    stepRef.current  = 0
    setWalkState({ active: false, path: [], index: 0, targetId: null })
    if (reason) echo(`[map] ${reason}`)
  }, [clearWalkTimers, setWalkState, echo])

  // Send the next queued move, after any active roundtime clears, then arm the
  // stuck-timeout that aborts the walk if the expected room never arrives.
  const sendNextStep = useCallback(() => {
    const route = routeRef.current
    if (!route) return
    if (stepRef.current >= route.moves.length) { stopWalk(); echo('[map] arrived.'); return }
    const move = route.moves[stepRef.current]
    const wait = Math.max(0, rtRef.current - Date.now()) + STEP_BUFFER_MS
    if (walkTimer.current !== null) clearTimeout(walkTimer.current)
    walkTimer.current = window.setTimeout(() => {
      walkTimer.current = null
      if (!routeRef.current) return
      sendRef.current(move)
      if (stuckTimer.current !== null) clearTimeout(stuckTimer.current)
      stuckTimer.current = window.setTimeout(() => stopWalk('walk interrupted (stuck).'), STEP_TIMEOUT_MS)
    }, wait)
  }, [stopWalk, echo])

  // Called from the transition effect after each room change while a walk is live.
  const onWalkArrival = useCallback((arrivedId: string) => {
    const route = routeRef.current
    if (!route) return
    const expected = route.nodes[stepRef.current + 1]
    if (arrivedId === expected) {
      clearWalkTimers()   // this step landed — cancel its stuck-timeout before the next
      stepRef.current += 1
      setWalkState(s => ({ ...s, index: stepRef.current }))
      if (stepRef.current >= route.moves.length) { stopWalk(); echo('[map] arrived.') }
      else sendNextStep()
    } else {
      stopWalk('walk interrupted (off route).')
    }
  }, [setWalkState, stopWalk, sendNextStep, echo, clearWalkTimers])

  // Start walking to a target node: pathfind from the current room, then step.
  const walkTo = useCallback((targetId: string) => {
    const from = currentIdRef.current
    if (!from) { echo('[map] position unknown — move once to orient.'); return }
    if (from === targetId) return
    const route = findRoute(dbRef.current, from, targetId)
    if (!route || route.moves.length === 0) {
      const dest = findNode(dbRef.current, targetId)
      // The map can DRAW a link it can't WALK: rooms recorded while something else
      // moved us (Lich's own travel, a shove) are joined without a command to
      // replay. Say which link is missing, because walking it once by hand records
      // the command and repairs every route through it for good.
      const gap = firstUnwalkableLink(dbRef.current, from, targetId)
      echo(gap
        ? `[map] no route to ${dest?.title ?? 'there'} — the link ${gap} was recorded without a command. Walk it once and it'll be learned.`
        : `[map] no known route to ${dest?.title ?? 'there'} — nothing recorded connects them yet.`)
      return
    }
    clearWalkTimers()
    routeRef.current = route
    stepRef.current  = 0
    setWalkState({ active: true, path: route.moves, index: 0, targetId })
    sendNextStep()
  }, [echo, clearWalkTimers, setWalkState, sendNextStep])

  // ── Reset position tracking + cancel any walk on (re)connect ─────────────────
  useEffect(() => {
    if (status !== 'connected') { stopWalk(); return }
    currentIdRef.current = null
    lastSigRef.current   = ''
    lastSkipRef.current  = ''
    pendingMoveRef.current = null; rawMoveRef.current = null; clearGameMove()
    setCurrentNode(null)
    stopWalk()
  }, [status, setCurrentNode, stopWalk])

  // ── Fold each room transition into the map (fires on every prompt) ───────────
  useEffect(() => {
    const r = roomRef.current
    // Both ways out of this effect used to be silent, which is the reason a map that
    // had lost the character was so hard to tell apart from one that was working:
    // every later step logs its decision, but the two that stop us getting there said
    // nothing at all. Report the reason once when it changes — a prompt arrives every
    // few seconds, so logging each one would bury the transition that matters.
    const say = (reason: string) => {
      if (!MAP_DEBUG || reason === lastSkipRef.current) return
      lastSkipRef.current = reason
      console.log(`[automap] ${reason}`)
    }

    if (!r.name && !r.description) {
      // The room feed is not reaching us: no roomName and no roomDesc event has
      // landed. Nothing downstream can run, so position never starts.
      say(`waiting for room data (uid="${r.uid}", exits=${r.exits.length}) — no roomName/roomDesc yet`)
      return
    }
    // The uid leads the change key so that stepping between two rooms with
    // identical content (adjacent wilderness rooms are routinely byte-identical)
    // still registers as a transition instead of being swallowed as "same room".
    const sig = `${r.uid}|${roomSignature(r.name, r.description, r.exits)}`
    if (sig === lastSigRef.current) {
      say(`unchanged room signature "${stripRoomTag(r.name)}" — no transition to fold`)
      return
    }
    lastSigRef.current = sig

    const prevId   = currentIdRef.current
    const prevNode = prevId ? findNode(dbRef.current, prevId) : null
    // Prefer the native <nav rm> id; fall back to the title tag for pre-5.20.0
    // Lich and direct connections, which don't send one.
    const uid      = r.uid || parseRoomUid(r.name) || undefined
    const title    = stripRoomTag(r.name)
    const obs      = { title, description: r.description, exits: r.exits, uid }

    // Which way did we move? Prefer the GAME's own confirmation ("You go east.")
    // — it's authoritative and covers Lich `;go2` (server-side moves our outbound
    // capture never sees). Fall back to a command we sent (covers non-cardinal
    // "go gate"/"go bank", which the game doesn't confirm with a direction). A
    // null move + a room id still maps & connects (unknown-direction placement).
    const now  = Date.now()
    const gm   = currentGameMove()
    const pend = pendingMoveRef.current
    const move =
      (gm   && now - gm.ts   < MOVE_WINDOW_MS) ? { dir: gm.dir,   move: gm.move   } :
      (pend && now - pend.ts < MOVE_WINDOW_MS) ? { dir: pend.dir, move: pend.move } :
      null

    // ── Still in the same room? (room-id match, or same title with no move) ─────
    // Its content just refreshed (exits/desc, or a re-look) — update in place.
    const sameRoom = prevNode && (
      (uid && prevNode.uid === uid) ||
      (!uid && !move && normEq(prevNode.title, title))
    )
    if (sameRoom) {
      if (autoRef.current) {
        const out = refreshNodeContent(dbRef.current, prevId!, obs)
        dbRef.current = out; setDb(out); persistZoneOf(out, prevId!)
      }
      pendingMoveRef.current = null; rawMoveRef.current = null; clearGameMove()
      lastSkipRef.current = ''
      if (MAP_DEBUG) console.log(`[automap] refresh "${title}"${uid ? ' #' + uid : ''} (same room)`)
      return
    }

    // No captured direction AND no room id (e.g. a Lich `;go2` step through a
    // no-id building room like a bank teller). Try to recognize it by content;
    // if that fails but we came from a known room, still create + connect it below
    // (unknown-direction placement) so the building doesn't drop our position.
    // Only truly "lost" when there's nothing to anchor or connect from.
    if (!move && !uid) {
      const anchor = matchRoom(dbRef.current, obs)
      if (anchor) {
        // We recognized the room but had no captured direction (a gate / wilderness
        // transition). We still moved here from `prevId`, so record that connection
        // (unknown direction → draw-only link) if it's missing — otherwise the room
        // we came from stays disconnected (the west-gate → Flatlands bug).
        if (prevId && prevId !== anchor && autoRef.current) {
          const out = recordArc(dbRef.current, prevId, anchor, 'special', '')
          dbRef.current = out; setDb(out)
          persistZoneOf(out, anchor); persistZoneOf(out, prevId)
        }
        currentIdRef.current = anchor
        setCurrentNode(anchor)
        pendingMoveRef.current = null; rawMoveRef.current = null; clearGameMove()
        if (routeRef.current) onWalkArrival(anchor)
        lastSkipRef.current = ''
        if (MAP_DEBUG) console.log(`[automap] no-move/no-id "${title}" -> anchored`)
        return
      }
      if (!prevId) {
        currentIdRef.current = null
        setCurrentNode(null)
        pendingMoveRef.current = null; rawMoveRef.current = null; clearGameMove()
        if (routeRef.current) stopWalk('walk interrupted (lost track).')
        // Losing track must not be permanent. The signature was latched above, before
        // any of this ran, so leaving it set means this room can never be folded
        // again: every later prompt sees an unchanged signature and returns, and the
        // character stays unplaced until they happen to walk somewhere else. Release
        // it, so the next prompt re-evaluates the same room — by then a <nav> id or a
        // captured move may have arrived and it will anchor cleanly.
        lastSigRef.current = ''
        say(`no-move/no-id "${title}" -> position lost (retrying each prompt)`)
        return
      }
      // else fall through: connect it to the known previous room (dir 'special').
    }

    // dir/move for placement + the arc: the captured command, else unknown
    // ('special' offset placement).
    const dir     = move?.dir ?? 'special'
    // The command to replay when walking this link later. Falling back to the last
    // unclassified command we sent is what keeps the map SELF-SUFFICIENT: a link
    // recorded without one is drawn but can never be walked, and enough of those
    // shatter the route graph into islands. This only applies once a room change has
    // actually been observed, and never influences which room we think we're in.
    const rawRef  = rawMoveRef.current
    const mvCmd   = move?.move
      ?? (rawRef && now - rawRef.ts < MOVE_WINDOW_MS ? rawRef.move : '')
    const placeFrom = prevId ? { id: prevId, dir, move: mvCmd } : null

    // Auto-record off: still follow the character across the map that already
    // exists — the shipped dataset plus whatever they recorded before — but add
    // nothing to it. Position comes from the read-only lookup, never from whether
    // a recording call happened to change the db: a matched room is rewritten in
    // place (exits, uid backfill, `seed` cleared), so "the db is unchanged" was
    // false even for rooms we had recognised, and the map never located anyone
    // with recording turned off.
    if (!autoRef.current) {
      const id = locateRoom(dbRef.current, obs, placeFrom)
      currentIdRef.current = id
      setCurrentNode(id)
      pendingMoveRef.current = null; rawMoveRef.current = null; clearGameMove()
      if (routeRef.current) {
        if (id) onWalkArrival(id)
        else stopWalk('walk interrupted (unknown room).')
      }
      if (id) lastSkipRef.current = ''
      if (MAP_DEBUG) {
        console.log(id
          ? `[automap] locate "${title}"${uid ? ' #' + uid : ''} (auto-record off)`
          : `[automap] "${title}"${uid ? ' #' + uid : ''} is not on the map and auto-record is off — position unknown`)
      }
      return
    }

    const next = observeRoom(dbRef.current, obs, placeFrom)
    let out    = next.db
    if (MAP_DEBUG) {
      const matched = !!findNode(dbRef.current, next.id)
      const total   = Object.values(dbRef.current.zones).reduce((s, z) => s + Object.keys(z.nodes).length, 0)
      console.log(
        `[automap] ${matched ? 'match ' : 'NEW   '} "${title}"${uid ? ' #' + uid : ''}  ` +
        `via ${dir}/${mvCmd || '·'} from "${prevNode?.title ?? '(start)'}"  total=${matched ? total : total + 1}`,
      )
    }
    // Connect previous → current (draws the line + enables walk-to when the move
    // command is known). New rooms are placed at prev + direction offset by
    // observeRoom (Genie-style, stable); drift is corrected on demand via the map
    // overlay's "Tidy" button (relayoutZone), not per-step, to avoid jitter.
    if (prevId && prevId !== next.id) out = recordArc(out, prevId, next.id, dir, mvCmd)
    dbRef.current = out
    setDb(out)
    persistZoneOf(out, next.id)
    if (prevId && prevId !== next.id) persistZoneOf(out, prevId)

    currentIdRef.current = next.id
    setCurrentNode(next.id)
    lastSkipRef.current = ''
    pendingMoveRef.current = null; rawMoveRef.current = null; clearGameMove()
    if (routeRef.current) onWalkArrival(next.id)
  // Only re-run when a prompt arrives; all inputs are read from refs.
  }, [promptCount])  // eslint-disable-line react-hooks/exhaustive-deps

  return { provideSend, walkTo, stopWalk }
}

function persistZoneOf(db: MapDB, nodeId: string): void {
  const zid = nodeZoneId(db, nodeId)
  if (!zid || !db.zones[zid]) return
  // Only what the player recorded — the shipped rooms sharing this zone come back
  // from the packaged dataset on every load and must not be copied into their store.
  window.dr.map.saveZone(recordedZone(db.zones[zid])).catch(() => {})
}

const normEq = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Update a node's exits/description in place (a room's content changed while we
// stood in it), returning a new DB. Does not move or re-link the node.
function refreshNodeContent(
  db: MapDB, nodeId: string, obs: { exits: string[]; description: string },
): MapDB {
  const zid = nodeZoneId(db, nodeId)
  if (!zid) return db
  const zone = db.zones[zid]
  const n = zone.nodes[nodeId]
  if (!n) return db
  const descriptions = obs.description && !n.descriptions.includes(obs.description)
    ? [...n.descriptions, obs.description].slice(0, 6)
    : n.descriptions
  // `seed` is dropped for the same reason observeRoom drops it: we are standing in
  // this room, so it is one the player has mapped, not merely one we shipped them.
  const { seed: _wasShipped, ...rest } = n
  const updated = { ...rest, exits: obs.exits, descriptions }
  return { ...db, zones: { ...db.zones, [zid]: { ...zone, nodes: { ...zone.nodes, [nodeId]: updated } } } }
}
