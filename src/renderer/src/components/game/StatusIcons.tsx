// Icons for the status cluster embedded in the command line: a posture
// stick-figure (stroke, changes with the character's posture) and the
// danger/state conditions (drawn to match icon_examples/*.png). 24×24,
// coloured via currentColor so the active-state colour swap just works.
import type { ReactNode } from 'react'

// Stroke wrapper — used for the posture stick figures. Heavier stroke so the
// figure reads with the same visual weight as the filled condition glyphs.
function Svg({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

// Filled wrapper — used for the condition glyphs (default fill = currentColor).
function FilledSvg({ children, size = 22 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      {children}
    </svg>
  )
}

export type Posture = 'standing' | 'kneeling' | 'sitting' | 'prone'

// Poses mirror icon_examples/{standing,kneeling,sitting,prone}.png but kept as
// the same stroke stick-figure so the four read as one character.
export function PostureIcon({ posture }: { posture: Posture }) {
  switch (posture) {
    // Every pose's forward/right arm is a separate .wave-arm path that pivots at
    // that pose's shoulder — so the figure throws up a (gloriously daft) wave on
    // hover no matter how it's sitting/kneeling/lying.
    case 'kneeling':
      // On one knee: front foot planted, back knee on the ground.
      return <Svg>
        <circle cx="10.5" cy="4" r="2.7" fill="currentColor" stroke="none" />
        <path d="M11 6.3 11.5 12M11.5 12 15.5 13.5 15.5 19M11.5 12 10 18.5 6 19.6" />
        <path className="wave-arm" style={{ transformOrigin: '11px 7.8px' }} d="M11 7.8 14.9 13.2" />
      </Svg>
    case 'sitting':
      // On the ground, knees drawn up.
      return <Svg>
        <circle cx="9.6" cy="6.1" r="2.7" fill="currentColor" stroke="none" />
        <path d="M10.3 8.3 10 16.6M10 16.6 15.2 11 15.6 17.2" />
        <path className="wave-arm" style={{ transformOrigin: '10.6px 10px' }} d="M10.6 10 15 11.2" />
      </Svg>
    case 'prone':
      // Lying on one side, propped on an elbow (which it lifts to wave).
      return <Svg>
        <circle cx="4.9" cy="12.7" r="2.7" fill="currentColor" stroke="none" />
        <path d="M6.7 13.7C9.1 14.9 10.6 16.4 14 18M14 18 20 17.6" />
        <path className="wave-arm" style={{ transformOrigin: '7.3px 14.6px' }} d="M7.3 14.6 8.9 18.6" />
      </Svg>
    default: // standing — arms at the sides
      return <Svg>
        <circle cx="12" cy="4.3" r="2.7" fill="currentColor" stroke="none" />
        <path d="M12 6.6V13M12 8.4 9.6 13M12 13 10.3 20M12 13 13.7 20" />
        <path className="wave-arm" style={{ transformOrigin: '12px 8.4px' }} d="M12 8.4 14.4 13" />
      </Svg>
  }
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
