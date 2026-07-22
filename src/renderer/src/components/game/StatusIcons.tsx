// Icons for the status cluster embedded in the command line: an animated posture
// sprite (the emoji-ragdoll spritesheet, changes + animates with the character's
// posture) and the danger/state conditions (SVG glyphs, coloured via currentColor
// so the active-state colour swap just works).
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { useAtomValue } from 'jotai'
import { indicatorsAtom, roomAtom } from '../../store/game'

// Condition sprites — one ragdoll frame per state, lifted + trimmed from the status
// spritesheet (assets/emoji-ragdoll-2.png). Shown muted/greyscale while the condition
// is clear and in full colour once it's active (see .status-cond-sprite in
// styles/toasts.css). Vite bundles these imports as URLs (works desktop + web).
import hiddenSprite   from '../../assets/status/hidden.png'
import stunnedSprite  from '../../assets/status/stunned.png'
import bleedingSprite from '../../assets/status/bleeding.png'
import poisonedSprite from '../../assets/status/poisoned.png'
import diseasedSprite from '../../assets/status/diseased.png'
import webbedSprite   from '../../assets/status/webbed.png'
import deadSprite     from '../../assets/status/dead.png'
import lanternIdleSrc from '../../assets/lantern-idle.png'

function CondSprite({ src }: { src: string }) {
  return <img className="status-cond-sprite" src={src} alt="" draggable={false} />
}

export type Posture = 'standing' | 'kneeling' | 'sitting' | 'prone'

// ── Posture sprite (emoji-ragdoll spritesheet) ───────────────────────────────
// A 4×5 grid of 32px frames (see emoji-ragdoll.png). Frames 1–3 are the front-facing
// WALK cycle (frame 0 is unused); rows 1–3 animate into a posture; row 4 (16–19) is a
// hover WAVE (standing only; uses 16,17). REST is the frame a posture settles on;
// SEQ is the animation played into it (and reversed to stand back up):
//   standing → rests on 4 (neutral idle); walks via frames 1–3; waves via 16,17
//   sitting  → 4→7, rests seated
//   kneeling → 8→9, rests kneeling (stops at 9, doesn't fold all the way to 11)
//   prone    → 12→15, rests lying down
const SHEET_COLS = 4
const SHEET_ROWS = 5
const WAVE_FRAMES = [16, 17]
const REST: Record<Posture, number> = { standing: 4, sitting: 7, kneeling: 9, prone: 15 }
const SEQ:  Record<Posture, number[]> = {
  standing: [1, 2, 3],      // walk cycle (played on room change, not on posture change)
  sitting:  [4, 5, 6, 7],
  kneeling: [8, 9],
  prone:    [12, 13, 14, 15],
}

// Position the sheet so the given frame fills a `size`×`size` box. The sheet image
// itself is set in CSS (.posture-sprite), keyed per theme so each palette gets its own
// recoloured ragdoll — see styles/toasts.css. Scaling is left smooth (NOT
// image-rendering: pixelated): the 32px frames downscale to ~24px by a non-integer
// 0.75×, and nearest-neighbour at that ratio drops whole pixel rows and visibly squishes
// the figure. The art is soft-shaded (not hard pixel art) anyway, so bilinear downscaling
// keeps its proportions and reads cleanly.
function frameStyle(frame: number, size: number): CSSProperties {
  const col = frame % SHEET_COLS, row = Math.floor(frame / SHEET_COLS)
  return {
    width: size, height: size,
    backgroundSize: `${size * SHEET_COLS}px ${size * SHEET_ROWS}px`,
    backgroundPosition: `${-col * size}px ${-row * size}px`,
  }
}

// ── Idle "raise the lantern" ──────────────────────────────────────────────────
// After the player has been idle a while (standing only), the ragdoll raises its
// lantern — a separate 4-frame strip (assets/lantern-idle.png). Its frames are wider
// than a posture cell (the raised lantern), so this overrides the sheet + box inline.
// Any real input reverts to the normal posture. (Mirrors the landing-page mascot.)
const LAN_COLS = 3                 // frames 3-5 of the mascot sheet (the raised lantern)
const LAN_ASPECT = 82 / 80        // lantern-idle frame w:h
const IDLE_MS = 45000             // go idle → raise the lantern after this long, no input
const LAN_LOOP_STEP = 460         // ping-pong cadence (matches the homepage idle loop)
// The lantern-idle figure fills its whole 80px source frame, while a posture cell
// leaves ~15% headroom/foot padding around its 64px figure. Rendered at the same box
// height the lantern ragdoll therefore reads ~18% bigger. Shrink the lantern box by
// this factor so the idle mascot matches the on-screen size of the posture sprite.
const LAN_FIGURE_SCALE = 0.85
function lanternFrameStyle(frame: number, size: number): CSSProperties {
  const h = Math.round(size * LAN_FIGURE_SCALE)
  const w = Math.round(h * LAN_ASPECT)
  return {
    width: w, height: h,
    backgroundImage: `url(${lanternIdleSrc})`,
    backgroundSize: `${w * LAN_COLS}px ${h}px`,
    backgroundPosition: `${-frame * w}px 0`,
  }
}

// A single static frame — used where no animation is wanted (the status popup).
export function PostureFrame({ posture, size = 24 }: { posture: Posture; size?: number }) {
  return <span className="posture-sprite" style={frameStyle(REST[posture], size)} aria-hidden />
}

const WALK_STEP_MS = 160   // walk-cycle frame cadence — constant while moving
const WALK_IDLE_MS = 650   // keep walking until this long after the last room change
const WAVE_STEP_MS = 100   // wave-cycle frame cadence (hover, standing only)

// The animated inline posture sprite. Plays the sit/kneel/lie-down sequence when the
// posture changes (and its reverse when standing back up), a continuous walk loop
// while the character moves between rooms, and — desktop only, since it's hover-driven
// — a wave while the pointer rests over a standing character.
export function PostureSprite({ size = 32 }: { size?: number }) {
  const indicators = useAtomValue(indicatorsAtom)
  const room       = useAtomValue(roomAtom)
  const posture    = currentPosture(indicators)
  const [frame, setFrame] = useState(() => REST[posture])
  const [lantern, setLantern] = useState<number | null>(null)  // idle lantern-raise frame (null = off)
  const seqTimers   = useRef<number[]>([])       // one-shot posture-transition timeouts
  const walkLoop    = useRef<number | null>(null) // interval driving the walk cycle
  const walkStop    = useRef<number | null>(null) // idle timer that ends the walk
  const waveLoop    = useRef<number | null>(null) // interval driving the hover wave
  const hovering    = useRef(false)               // pointer currently over the sprite
  const prevPosture = useRef(posture)
  const prevRoom    = useRef(room.name)
  const lanternTimers = useRef<number[]>([])     // idle raise/bob timers
  const postureRef    = useRef(posture)          // current posture, for the idle timer

  const clearSeq  = () => { seqTimers.current.forEach(clearTimeout); seqTimers.current = [] }
  // clearTimeout also cancels intervals (shared id pool), so it clears both raise + bob.
  const clearLantern = () => { lanternTimers.current.forEach(clearTimeout); lanternTimers.current = [] }
  const clearWalk = () => {
    if (walkLoop.current != null) { clearInterval(walkLoop.current); walkLoop.current = null }
    if (walkStop.current != null) { clearTimeout(walkStop.current); walkStop.current = null }
  }
  const clearWave = () => {
    if (waveLoop.current != null) { clearInterval(waveLoop.current); waveLoop.current = null }
  }

  // Hover wave — standing only. Loops the wave frames until the pointer leaves; cancels
  // any transition/walk first so it owns the frame.
  const startWave = () => {
    clearSeq(); clearWalk()
    if (waveLoop.current != null) return
    let i = 0
    setFrame(WAVE_FRAMES[0])
    waveLoop.current = window.setInterval(() => {
      i = (i + 1) % WAVE_FRAMES.length
      setFrame(WAVE_FRAMES[i])
    }, WAVE_STEP_MS)
  }

  // One-shot posture transition: show each frame `step` ms apart, then settle on `hold`.
  const play = (frames: number[], step: number, hold: number) => {
    clearSeq(); clearWalk(); clearWave()
    frames.forEach((f, i) => seqTimers.current.push(window.setTimeout(() => setFrame(f), i * step)))
    seqTimers.current.push(window.setTimeout(() => setFrame(hold), frames.length * step))
  }

  // Movement: run the walk cycle at a CONSTANT cadence, decoupled from how fast rooms
  // arrive. Each step just (re)arms the idle timer, so rapid moves keep the same loop
  // running smoothly instead of restarting it; it settles WALK_IDLE_MS after the last
  // move. Starting a walk cancels any transition or hover wave.
  const walk = () => {
    clearSeq(); clearWave()
    if (walkLoop.current == null) {
      const cycle = SEQ.standing
      let i = 0
      setFrame(cycle[0])
      walkLoop.current = window.setInterval(() => {
        i = (i + 1) % cycle.length
        setFrame(cycle[i])
      }, WALK_STEP_MS)
    }
    if (walkStop.current != null) clearTimeout(walkStop.current)
    walkStop.current = window.setTimeout(() => {
      clearWalk()
      // If the pointer is still resting on the (standing) sprite, pick the wave back
      // up when movement stops; otherwise settle to the idle frame.
      if (hovering.current) startWave(); else setFrame(REST.standing)
    }, WALK_IDLE_MS)
  }

  const onEnter = () => {
    hovering.current = true
    if (lantern !== null) return   // don't wave while the idle lantern is raised
    // Wave only from a settled standing pose — not mid-walk or mid-transition.
    if (posture === 'standing' && walkLoop.current == null && seqTimers.current.length === 0) startWave()
  }
  const onLeave = () => {
    hovering.current = false
    if (waveLoop.current != null) { clearWave(); if (posture === 'standing') setFrame(REST.standing) }
  }

  // Posture change → animate down into the new pose, or up out of the old one.
  useEffect(() => {
    if (prevPosture.current === posture) return
    const from = prevPosture.current
    prevPosture.current = posture
    if (posture === 'standing') play([...SEQ[from]].reverse(), 90, REST.standing)
    else                        play(SEQ[posture], 90, REST[posture])
  }, [posture])

  // Room change while upright → walk. Skip the very first room (empty → name on
  // connect) so we don't "walk" just from logging in.
  useEffect(() => {
    if (prevRoom.current === room.name) return
    const hadRoom = !!prevRoom.current
    prevRoom.current = room.name
    if (hadRoom && room.name && posture === 'standing') walk()
  }, [room.name, posture])

  // Keep postureRef fresh so the idle timer (subscribed once) sees the live posture.
  useEffect(() => { postureRef.current = posture }, [posture])

  // Idle → raise the lantern (standing only). Any real input (key / click / wheel /
  // touch / a game command sent) reverts to the normal posture and re-arms the timer.
  useEffect(() => {
    let idleTimer = 0
    const raise = () => {
      if (postureRef.current !== 'standing') return
      clearSeq(); clearWalk(); clearWave(); clearLantern()
      // ping-pong frames 0↔2 (the mascot sheet's 3↔5): raises, then loops up/down —
      // same idle animation as the homepage mascot.
      let f = 0, dir = 1
      setLantern(0)
      lanternTimers.current.push(window.setInterval(() => {
        f += dir
        if (f <= 0) dir = 1; else if (f >= LAN_COLS - 1) dir = -1
        setLantern(f)
      }, LAN_LOOP_STEP))
    }
    const reset = () => {
      if (lanternTimers.current.length) { clearLantern(); setLantern(null); setFrame(REST[postureRef.current]) }
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(raise, IDLE_MS)
    }
    const evs: (keyof WindowEventMap)[] = ['keydown', 'mousedown', 'wheel', 'touchstart']
    evs.forEach(e => window.addEventListener(e, reset, { passive: true }))
    const unsub = window.dr.game.onSent(reset)
    reset()
    return () => { evs.forEach(e => window.removeEventListener(e, reset)); unsub(); window.clearTimeout(idleTimer); clearLantern() }
  }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  // Changing to a non-standing posture drops the raised lantern back to the pose.
  useEffect(() => {
    if (posture !== 'standing' && lanternTimers.current.length) { clearLantern(); setLantern(null) }
  }, [posture])

  useEffect(() => () => { clearSeq(); clearWalk(); clearWave() }, [])

  return <span
    className="posture-sprite"
    style={lantern !== null ? lanternFrameStyle(lantern, size) : frameStyle(frame, size)}
    onMouseEnter={onEnter} onMouseLeave={onLeave} aria-hidden
  />
}

export interface Condition { id: string; label: string; danger: boolean; icon: ReactNode }

export const CONDITIONS: Condition[] = [
  { id: 'hidden',   label: 'Hidden',   danger: false, icon: <CondSprite src={hiddenSprite} /> },
  { id: 'stunned',  label: 'Stunned',  danger: true,  icon: <CondSprite src={stunnedSprite} /> },
  { id: 'bleeding', label: 'Bleeding', danger: true,  icon: <CondSprite src={bleedingSprite} /> },
  { id: 'poisoned', label: 'Poisoned', danger: true,  icon: <CondSprite src={poisonedSprite} /> },
  { id: 'diseased', label: 'Diseased', danger: true,  icon: <CondSprite src={diseasedSprite} /> },
  { id: 'webbed',   label: 'Webbed',   danger: true,  icon: <CondSprite src={webbedSprite} /> },
  { id: 'dead',     label: 'Dead',     danger: true,  icon: <CondSprite src={deadSprite} /> },
]

// Map DR posture indicator ids → the four poses we draw ('lying' → prone).
const POSTURE_ORDER: [string, Posture][] = [
  ['prone', 'prone'], ['lying', 'prone'], ['kneeling', 'kneeling'], ['sitting', 'sitting'], ['standing', 'standing'],
]
export function currentPosture(indicators: Record<string, boolean>): Posture {
  for (const [id, pose] of POSTURE_ORDER) if (indicators[id]) return pose
  return 'standing'
}
