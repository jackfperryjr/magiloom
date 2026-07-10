import { useCallback, useEffect, useRef } from 'react'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { roomAtom, promptCountAtom, connectionStatusAtom, roundtimeAtom, appendScriptOutputAtom, currentGameMove, clearGameMove } from '../store/game'
import { mapDbAtom, currentNodeIdAtom, autoRecordAtom, walkStateAtom } from '../store/map'
import { classifyMove, roomSignature, parseRoomUid, stripRoomTag, type MapDB, type Zone } from '../lib/mapModel'
import { observeRoom, recordArc, nodeZoneId, findRoute, findNode, matchRoom } from '../lib/mapper'

// A captured movement is only paired with the room change it caused if the change
// lands within this window (a move + server round-trip). Beyond it, the room
// probably changed for another reason (a script, a shove) and we don't guess an arc.
const MOVE_WINDOW_MS = 6000

// Walk executor pacing. After a step's roundtime clears we wait a short buffer
// before sending the next move; a step that produces no room change within the
// timeout is treated as stuck and the walk aborts.
const STEP_BUFFER_MS  = 250
const STEP_TIMEOUT_MS = 9000

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
  const pendingMoveRef = useRef<{ dir: string; move: string; ts: number } | null>(null)
  const sendRef       = useRef<(cmd: string) => void>(() => {})

  // Walk-executor state (imperative; the atom mirrors it for the UI).
  const routeRef   = useRef<{ nodes: string[]; moves: string[] } | null>(null)
  const stepRef    = useRef(0)
  const walkTimer  = useRef<number | null>(null)  // pacing timer (RT wait)
  const stuckTimer = useRef<number | null>(null)  // per-step arrival timeout

  // ── Load the shared map once, and merge zones other windows rewrite ──────────
  useEffect(() => {
    let cancelled = false
    window.dr.map.load().then((loaded: MapDB) => {
      if (!cancelled && loaded?.zones) setDb(loaded)
    }).catch(() => { /* no map yet */ })
    const off = window.dr.map.onZoneChanged((zone: Zone) => {
      if (zone?.id) setDb(prev => ({ ...prev, zones: { ...prev.zones, [zone.id]: zone } }))
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
    if (mv) pendingMoveRef.current = { ...mv, ts: Date.now() }
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
      echo(`[map] no known route to ${dest?.title ?? 'there'}.`)
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
    pendingMoveRef.current = null; clearGameMove()
    setCurrentNode(null)
    stopWalk()
  }, [status, setCurrentNode, stopWalk])

  // ── Fold each room transition into the map (fires on every prompt) ───────────
  useEffect(() => {
    const r = roomRef.current
    if (!r.name && !r.description) return               // pre-game / no room yet
    const sig = roomSignature(r.name, r.description, r.exits)
    if (sig === lastSigRef.current) return              // same room — nothing to do
    lastSigRef.current = sig

    const prevId   = currentIdRef.current
    const prevNode = prevId ? findNode(dbRef.current, prevId) : null
    const uid      = parseRoomUid(r.name) ?? undefined
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
      pendingMoveRef.current = null; clearGameMove()
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
          let out = recordArc(dbRef.current, prevId, anchor, 'special', '')
          dbRef.current = out; setDb(out)
          persistZoneOf(out, anchor); persistZoneOf(out, prevId)
        }
        currentIdRef.current = anchor
        setCurrentNode(anchor)
        pendingMoveRef.current = null; clearGameMove()
        if (routeRef.current) onWalkArrival(anchor)
        if (MAP_DEBUG) console.log(`[automap] no-move/no-id "${title}" -> anchored`)
        return
      }
      if (!prevId) {
        currentIdRef.current = null
        setCurrentNode(null)
        pendingMoveRef.current = null; clearGameMove()
        if (routeRef.current) stopWalk('walk interrupted (lost track).')
        if (MAP_DEBUG) console.log(`[automap] no-move/no-id "${title}" -> position lost`)
        return
      }
      // else fall through: connect it to the known previous room (dir 'special').
    }

    // dir/move for placement + the arc: the captured command, else unknown
    // ('special' offset placement; empty move = a draw-only, non-walkable link).
    const dir     = move?.dir ?? 'special'
    const mvCmd   = move?.move ?? ''
    const placeFrom = prevId ? { id: prevId, dir, move: mvCmd } : null

    if (!autoRef.current) {
      const { db: probe, id } = observeRoom(dbRef.current, obs, placeFrom)
      const known = probe === dbRef.current
      currentIdRef.current = known ? id : null
      setCurrentNode(known ? id : null)
      pendingMoveRef.current = null; clearGameMove()
      if (routeRef.current) known ? onWalkArrival(id) : stopWalk('walk interrupted (unknown room).')
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
    pendingMoveRef.current = null; clearGameMove()
    if (routeRef.current) onWalkArrival(next.id)
  // Only re-run when a prompt arrives; all inputs are read from refs.
  }, [promptCount])  // eslint-disable-line react-hooks/exhaustive-deps

  return { provideSend, walkTo, stopWalk }
}

function persistZoneOf(db: MapDB, nodeId: string): void {
  const zid = nodeZoneId(db, nodeId)
  if (zid && db.zones[zid]) window.dr.map.saveZone(db.zones[zid]).catch(() => {})
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
  const updated = { ...n, exits: obs.exits, descriptions }
  return { ...db, zones: { ...db.zones, [zid]: { ...zone, nodes: { ...zone.nodes, [nodeId]: updated } } } }
}
