// Icons for the status cluster embedded in the command line: an animated posture
// sprite (the emoji-ragdoll spritesheet, changes + animates with the character's
// posture) and the danger/state conditions (SVG glyphs, coloured via currentColor
// so the active-state colour swap just works).
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react'
import { useAtomValue } from 'jotai'
import { indicatorsAtom, roomAtom } from '../../store/game'

// Filled wrapper — used for the condition glyphs (default fill = currentColor).
function FilledSvg({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      {children}
    </svg>
  )
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
export function PostureSprite({ size = 24 }: { size?: number }) {
  const indicators = useAtomValue(indicatorsAtom)
  const room       = useAtomValue(roomAtom)
  const posture    = currentPosture(indicators)
  const [frame, setFrame] = useState(() => REST[posture])
  const seqTimers   = useRef<number[]>([])       // one-shot posture-transition timeouts
  const walkLoop    = useRef<number | null>(null) // interval driving the walk cycle
  const walkStop    = useRef<number | null>(null) // idle timer that ends the walk
  const waveLoop    = useRef<number | null>(null) // interval driving the hover wave
  const hovering    = useRef(false)               // pointer currently over the sprite
  const prevPosture = useRef(posture)
  const prevRoom    = useRef(room.name)

  const clearSeq  = () => { seqTimers.current.forEach(clearTimeout); seqTimers.current = [] }
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

  useEffect(() => () => { clearSeq(); clearWalk(); clearWave() }, [])

  return <span
    className="posture-sprite" style={frameStyle(frame, size)}
    onMouseEnter={onEnter} onMouseLeave={onLeave} aria-hidden
  />
}

// Spider-web path (webbed) — 8 spokes + 3 concentric rings, generated so the
// geometry stays clean at small sizes.
const WEB_D = (() => {
  const cx = 12, cy = 12, spokes = 8, rings = [3.4, 6.3, 9.3]
  const P = (r: number, i: number) => {
    const a = ((-90 + (i * 360) / spokes) * Math.PI) / 180
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
  }
  let d = ''
  for (let i = 0; i < spokes; i++) { const [x, y] = P(9.3, i); d += `M${cx} ${cy}L${x.toFixed(1)} ${y.toFixed(1)}` }
  for (const r of rings) {
    for (let i = 0; i <= spokes; i++) { const [x, y] = P(r, i % spokes); d += (i ? 'L' : 'M') + `${x.toFixed(1)} ${y.toFixed(1)}` }
    d += 'Z'
  }
  return d
})()

export interface Condition { id: string; label: string; danger: boolean; icon: ReactNode }

export const CONDITIONS: Condition[] = [
  // Hidden — incognito: a detective hat above a popped collar with a tie.
  { id: 'hidden', label: 'Hidden', danger: false, icon:
    <FilledSvg>
      <path d="M12 2.6c-2.7 0-4.4 2.1-4.4 4.7 0 .5.05 1 .16 1.45C6.4 8.5 4.3 8.9 4.3 9.7c0 1 3.4 1.8 7.7 1.8s7.7-.8 7.7-1.8c0-.8-2.1-1.2-3.46-.95.11-.46.16-.95.16-1.45 0-2.6-1.7-4.7-4.4-4.7z" />
      <path d="M12 12.7c-1.9 0-3.7.35-5.1.95L4.6 19.4c2.1-1 4.6-1.55 7.4-1.55s5.3.55 7.4 1.55l-2.3-5.75c-1.4-.6-3.2-.95-5.1-.95zm0 1.5 1.3 1-1.3 4-1.3-4z" />
    </FilledSvg> },
  // Stunned — seeing stars: Heroicons-style sparkles (matches the app icon set).
  { id: 'stunned', label: 'Stunned', danger: true, icon:
    <FilledSvg>
      <path d="M9 2.4a.7.7 0 0 1 .67.5l.76 2.64a3.5 3.5 0 0 0 2.4 2.4l2.64.76a.7.7 0 0 1 0 1.34l-2.64.76a3.5 3.5 0 0 0-2.4 2.4l-.76 2.64a.7.7 0 0 1-1.34 0l-.76-2.64a3.5 3.5 0 0 0-2.4-2.4l-2.64-.76a.7.7 0 0 1 0-1.34l2.64-.76a3.5 3.5 0 0 0 2.4-2.4l.76-2.64A.7.7 0 0 1 9 2.4z" />
      <path d="M17.5 13.2a.65.65 0 0 1 .62.44l.44 1.32c.14.42.47.75.89.89l1.32.44a.65.65 0 0 1 0 1.24l-1.32.44c-.42.14-.75.47-.89.89l-.44 1.32a.65.65 0 0 1-1.24 0l-.44-1.32a1.4 1.4 0 0 0-.89-.89l-1.32-.44a.65.65 0 0 1 0-1.24l1.32-.44c.42-.14.75-.47.89-.89l.44-1.32a.65.65 0 0 1 .62-.44z" />
    </FilledSvg> },
  // Bleeding — two blood drops, a large one and a small one.
  { id: 'bleeding', label: 'Bleeding', danger: true, icon:
    <FilledSvg>
      <path d="M10.5 7.5c2.6 3.2 4.3 5.5 4.3 7.6a4.3 4.3 0 0 1-8.6 0c0-2.1 1.7-4.4 4.3-7.6z" />
      <path d="M17.2 3.2c1.2 1.5 2 2.6 2 3.6a2 2 0 0 1-4 0c0-1 .8-2.1 2-3.6z" />
    </FilledSvg> },
  // Poisoned — a poison bottle with a knocked-out skull.
  { id: 'poisoned', label: 'Poisoned', danger: true, icon:
    <FilledSvg>
      <rect x="9.6" y="2.2" width="4.8" height="1.7" rx="0.85" />
      <rect x="9.6" y="4.5" width="4.8" height="1.7" rx="0.85" />
      <path fillRule="evenodd" clipRule="evenodd" d="M9.5 6.7h5v1.4c0 .5.2 1 .6 1.3a5.6 5.6 0 0 1 2 4.3v3A2.6 2.6 0 0 1 14.5 20.6h-5A2.6 2.6 0 0 1 6.9 18v-3a5.6 5.6 0 0 1 2-4.3c.4-.4.6-.8.6-1.3V6.7zM12 10.4a3 3 0 0 0-3 3c0 1 .5 1.8 1.2 2.4v.9a.75.75 0 0 0 .75.75h2.1a.75.75 0 0 0 .75-.75v-.9c.7-.6 1.2-1.4 1.2-2.4a3 3 0 0 0-3-3zm-1.1 2.7a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4zm2.2 0a.7.7 0 1 1 0 1.4.7.7 0 0 1 0-1.4z" />
    </FilledSvg> },
  // Diseased — a germ/virus: outline body, inner dots, knobbed stalks.
  { id: 'diseased', label: 'Diseased', danger: true, icon:
    <FilledSvg>
      <g stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 7.8V4.9M12 16.2v2.9M7.8 12H4.9M16.2 12h2.9M9 9 6.9 6.9M15 15l2.1 2.1M15 9l2.1-2.1M9 15l-2.1 2.1" />
      </g>
      <g stroke="none">
        <circle cx="12" cy="3.6" r="1.2" /><circle cx="12" cy="20.4" r="1.2" /><circle cx="3.6" cy="12" r="1.2" /><circle cx="20.4" cy="12" r="1.2" />
        <circle cx="6.1" cy="6.1" r="1.1" /><circle cx="17.9" cy="17.9" r="1.1" /><circle cx="17.9" cy="6.1" r="1.1" /><circle cx="6.1" cy="17.9" r="1.1" />
        <circle cx="10.8" cy="11" r="0.85" /><circle cx="13.2" cy="12.5" r="0.95" /><circle cx="11.2" cy="13.4" r="0.6" />
      </g>
    </FilledSvg> },
  // Webbed — a spider web (outline).
  { id: 'webbed', label: 'Webbed', danger: true, icon:
    <FilledSvg><path d={WEB_D} stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinejoin="round" strokeLinecap="round" /></FilledSvg> },
  // Dead — skull & crossbones.
  { id: 'dead', label: 'Dead', danger: true, icon:
    <FilledSvg>
      <g stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" fill="none">
        <path d="M7.6 15 16.4 20.2M16.4 15 7.6 20.2" />
      </g>
      <g stroke="none">
        <circle cx="6.9" cy="14.7" r="1.4" /><circle cx="6.9" cy="20.4" r="1.4" /><circle cx="17.1" cy="14.7" r="1.4" /><circle cx="17.1" cy="20.4" r="1.4" />
      </g>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 3A5 5 0 0 0 7 8c0 1.7.8 2.9 1.7 3.7.3.3.5.6.5 1v.6a.9.9 0 0 0 .9.9h.15v-.85a.6.6 0 0 1 1.2 0v.85h1.1v-.85a.6.6 0 0 1 1.2 0v.85h.15a.9.9 0 0 0 .9-.9v-.6c0-.4.2-.7.5-1C16.2 10.9 17 9.7 17 8A5 5 0 0 0 12 3zM9.9 7.2a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7zm4.2 0a1.35 1.35 0 1 1 0 2.7 1.35 1.35 0 0 1 0-2.7zM12 10.4l1 1.9h-2z" />
    </FilledSvg> },
]

// Map DR posture indicator ids → the four poses we draw ('lying' → prone).
const POSTURE_ORDER: [string, Posture][] = [
  ['prone', 'prone'], ['lying', 'prone'], ['kneeling', 'kneeling'], ['sitting', 'sitting'], ['standing', 'standing'],
]
export function currentPosture(indicators: Record<string, boolean>): Posture {
  for (const [id, pose] of POSTURE_ORDER) if (indicators[id]) return pose
  return 'standing'
}
