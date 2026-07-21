import {
  type BodyPart, type Injuries, type PartInjury,
  WOUND_COLOR, SCAR_COLOR, describePart, PART_LABEL,
} from '../../lib/injuries'

// ── A chibi "ragdoll" figure with color-coded wound regions ───────────────────
// Modeled on the app's emoji-ragdoll mascot: a big round head, a small rounded
// bean body, stubby arms/legs and simple dot eyes. Each visible location is an
// SVG shape whose fill tracks its wound severity (amber → orange → red); a small
// diamond marks a scar. Back and the nervous system have no place on a front
// figure, so they render as chips below. Hovering any region shows a detail
// tooltip; in the empath "patient" view the regions are clickable (onRegionClick)
// to tend a specific wound.
//
// Left/right are the CHARACTER's own (mirrored, as if you're facing them). The
// tooltips name each location explicitly so there's never any ambiguity.

const REGION_FILL = (pi?: PartInjury): string =>
  pi && pi.wound > 0 ? WOUND_COLOR[pi.wound] : 'var(--body-base)'

// Scar-marker anchor (centroid-ish) for each on-figure location.
const SCAR_ANCHOR: Partial<Record<BodyPart, [number, number]>> = {
  head: [60, 26], neck: [60, 84], leftEye: [49, 48], rightEye: [71, 48],
  chest: [60, 100], abdomen: [60, 136],
  // Limb anchors are the rotated midpoints of each capsule.
  leftArm: [22, 109], rightArm: [98, 109], leftHand: [9, 127], rightHand: [111, 127],
  leftLeg: [45, 180], rightLeg: [75, 180],
}

// The on-figure parts in paint order (back/nsys handled separately as chips).
const FIGURE_PARTS: BodyPart[] = [
  'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftHand', 'rightHand',
  'chest', 'abdomen', 'neck', 'head', 'leftEye', 'rightEye',
]

export function BodyFigure({ injuries, onRegionClick, interactive = false, tooltipFor }: {
  injuries:      Injuries
  onRegionClick?: (part: BodyPart) => void
  interactive?:  boolean
  tooltipFor?:   (part: BodyPart, pi?: PartInjury) => string
}) {
  const tipFor = tooltipFor ?? describePart
  const region = (part: BodyPart, node: React.ReactNode) => {
    const pi = injuries[part]
    return (
      <g
        key={part}
        className={'body-region' + (interactive ? ' body-region-active' : '') + (pi && pi.wound >= 3 ? ' body-region-severe' : '')}
        data-tooltip={tipFor(part, pi)}
        onClick={onRegionClick ? () => onRegionClick(part) : undefined}
        style={onRegionClick ? { cursor: 'pointer' } : undefined}
      >
        {node}
      </g>
    )
  }

  // Shape per part. Big round head, rounded bean body, stubby capsule limbs —
  // the chibi ragdoll proportions.
  const SHAPES: Record<BodyPart, React.ReactNode> = {
    // Plump capsule arms hanging at the sides, angled out just enough to clear the
    // belly (the plush idle pose, frame 4). Drawn first so the body overlaps their
    // inner ends; the hand shares the arm's rotation so it caps the lower tip.
    leftArm:  <rect x="25" y="92" width="22" height="44" rx="11" transform="rotate(38 36 92)"  fill={REGION_FILL(injuries.leftArm)} />,
    rightArm: <rect x="73" y="92" width="22" height="44" rx="11" transform="rotate(-38 84 92)" fill={REGION_FILL(injuries.rightArm)} />,
    leftHand: <circle cx="36" cy="136" r="11" transform="rotate(38 36 92)"  fill={REGION_FILL(injuries.leftHand)} />,
    rightHand:<circle cx="84" cy="136" r="11" transform="rotate(-38 84 92)" fill={REGION_FILL(injuries.rightHand)} />,
    // Plump legs nearly straight down, a touch apart.
    leftLeg:  <rect x="39" y="156" width="22" height="48" rx="11" transform="rotate(12 50 156)"  fill={REGION_FILL(injuries.leftLeg)} />,
    rightLeg: <rect x="61" y="156" width="22" height="48" rx="11" transform="rotate(-12 70 156)" fill={REGION_FILL(injuries.rightLeg)} />,
    // Chubby body: a rounded chest over a distinctly larger, rounder pot belly.
    chest:    <rect x="30" y="80" width="60" height="40" rx="18" fill={REGION_FILL(injuries.chest)} />,
    abdomen:  <rect x="26" y="112" width="68" height="48" rx="24" fill={REGION_FILL(injuries.abdomen)} />,
    neck:     <rect x="50" y="74" width="20" height="12" rx="6" fill={REGION_FILL(injuries.neck)} />,
    // Big round head.
    head:     <circle cx="60" cy="44" r="37" fill={REGION_FILL(injuries.head)} />,
    // Simple dot eyes, low on the face.
    leftEye:  <circle cx="49" cy="48" r="4" fill={injuries.leftEye?.wound  ? WOUND_COLOR[injuries.leftEye.wound]  : 'var(--body-eye)'} />,
    rightEye: <circle cx="71" cy="48" r="4" fill={injuries.rightEye?.wound ? WOUND_COLOR[injuries.rightEye.wound] : 'var(--body-eye)'} />,
    back:     null,  // rendered as a chip
    nsys:     null,  // rendered as a chip
  }

  return (
    <div className="body-figure">
      <svg className="body-svg" viewBox="-6 0 132 216" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Body">
        {/* Regions */}
        {FIGURE_PARTS.map(p => region(p, SHAPES[p]))}
        {/* Plush detailing (non-interactive): a stitched center seam down the body
            and a glossy highlight on the head — evokes the ragdoll mascot. */}
        <g className="body-detail" pointerEvents="none">
          <line className="body-seam" x1="60" y1="86" x2="60" y2="152" />
          <ellipse className="body-gloss" cx="47" cy="30" rx="13" ry="8" transform="rotate(-20 47 30)" />
        </g>
        {/* Scar markers on top */}
        {FIGURE_PARTS.map(p => {
          const pi = injuries[p]
          const a = SCAR_ANCHOR[p]
          if (!pi || pi.scar <= 0 || !a) return null
          return (
            <rect
              key={'scar-' + p}
              className="body-scar"
              x={a[0] - 3} y={a[1] - 3} width="6" height="6"
              transform={`rotate(45 ${a[0]} ${a[1]})`}
              fill={SCAR_COLOR} opacity={0.55 + pi.scar * 0.15}
              pointerEvents="none"
            />
          )
        })}
      </svg>
      <div className="body-chips">
        <BodyChip part="back"  pi={injuries.back}  onClick={onRegionClick} tip={tipFor} />
        <BodyChip part="nsys"  pi={injuries.nsys}  onClick={onRegionClick} tip={tipFor} />
      </div>
    </div>
  )
}

// Back + nervous-system don't sit on a front silhouette — show them as chips.
function BodyChip({ part, pi, onClick, tip }: {
  part: BodyPart; pi?: PartInjury; onClick?: (part: BodyPart) => void
  tip?: (part: BodyPart, pi?: PartInjury) => string
}) {
  const color = pi && pi.wound > 0 ? WOUND_COLOR[pi.wound] : 'var(--body-base)'
  return (
    <button
      className="body-chip"
      data-tooltip={(tip ?? describePart)(part, pi)}
      onClick={onClick ? () => onClick(part) : undefined}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
    >
      <span className="body-chip-dot" style={{ background: color, boxShadow: pi && pi.scar > 0 ? `0 0 0 2px ${SCAR_COLOR}` : 'none' }} />
      <span className="body-chip-label">{part === 'nsys' ? 'Nerves' : PART_LABEL[part]}</span>
    </button>
  )
}
