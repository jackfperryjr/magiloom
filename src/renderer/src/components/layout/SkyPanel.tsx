import { useAtomValue } from 'jotai'
import { skyAtom } from '../../store/game'
import type { SkyPhase, Season } from '../../lib/elanthianTime'

// Sky panel: the sun tracking its arc across the day, plus the Elanthian time of
// day. Everything here is deterministic from the clock (skyAtom, which recomputes
// each tick), so it stays live and correct without any polling. Moons are handled
// separately (parked pending research) — this panel is sun + time only.

const DAYPART: Record<SkyPhase, string> = { dawn: 'Dawn', day: 'Daytime', dusk: 'Dusk', night: 'Night' }
const SEASON: Record<Season, string> = { winter: 'Winter', spring: 'Spring', summer: 'Summer', autumn: 'Autumn' }

// Vertical sky gradient (top, horizon) per daypart — a warm day, amber twilight,
// deep-indigo night. The dome is drawn between these.
function skyStops(phase: SkyPhase): [string, string] {
  switch (phase) {
    case 'day':   return ['#3f6fae', '#a9cbe8']
    case 'dawn':  return ['#3a4a86', '#f2a860']
    case 'dusk':  return ['#39346e', '#e88a54']
    case 'night': return ['#0a0c22', '#1c2048']
  }
}

// A fixed scatter of stars, kept inside the dome (also clipped to it, so any near
// the arc edge are trimmed rather than floating above the horizon dome).
const STARS = [
  [100, 22], [80, 30], [122, 32], [62, 42], [140, 44], [45, 56],
  [158, 56], [100, 50], [36, 70], [166, 70], [116, 64], [74, 60],
]

// Dome geometry (viewBox 0 0 200 104): near-full-width semicircle, horizon at y=98.
const DOME = 'M 10,98 A 90,90 0 0 1 190,98 Z'
const ARC  = 'M 10,98 A 90,90 0 0 1 190,98'   // the sun's path (east horizon → zenith → west)

export function SkyPanel() {
  const sky = useAtomValue(skyAtom)

  if (!sky) {
    return <div className="sky-panel"><div className="sky-panel-hint">Type <b>TIME</b> to sync the sky.</div></div>
  }

  const [top, horizon] = skyStops(sky.phase)
  const starOpacity = Math.max(0, Math.min(1, 1 - sky.daylight * 1.3))
  // Sun on its arc: t=0 east horizon, t=0.5 zenith, t=1 west horizon.
  const t = sky.dayProgress
  const sunUp = sky.isDay && t >= 0 && t <= 1
  const sunX = 100 - 90 * Math.cos(Math.PI * t)
  const sunY = 98 - 90 * Math.sin(Math.PI * t)

  return (
    <div className="sky-panel">
      <svg className="sky-scene" viewBox="0 0 200 104" preserveAspectRatio="xMidYMid meet" aria-hidden>
        <defs>
          <linearGradient id="sky-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={top} />
            <stop offset="100%" stopColor={horizon} />
          </linearGradient>
          <radialGradient id="sun-grad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fff7e0" />
            <stop offset="55%" stopColor="#ffd66b" />
            <stop offset="100%" stopColor="#f6a740" />
          </radialGradient>
          <clipPath id="dome-clip"><path d={DOME} /></clipPath>
        </defs>

        {/* dome */}
        <path d={DOME} fill="url(#sky-grad)" />

        {/* stars (visible at night / twilight), clipped to the dome */}
        {starOpacity > 0.02 && (
          <g clipPath="url(#dome-clip)">
            {STARS.map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.1 : 0.7} fill="#fff" opacity={starOpacity * (0.5 + (i % 4) * 0.16)} />
            ))}
          </g>
        )}

        {/* sun path + horizon */}
        <path d={ARC} fill="none" stroke="rgba(255,255,255,.18)" strokeWidth="0.8" strokeDasharray="2 3" />
        <line x1="4" y1="98" x2="196" y2="98" stroke="rgba(255,255,255,.35)" strokeWidth="1" />

        {/* the sun (only while above the horizon) */}
        {sunUp && (
          <g>
            <circle cx={sunX} cy={sunY} r="13" fill="#ffcf6b" opacity=".28" className="sun-glow" />
            <circle cx={sunX} cy={sunY} r="7" fill="url(#sun-grad)" />
          </g>
        )}
      </svg>

      {/* Time-of-day labels tucked into the dome's empty top corners. */}
      <div className="sky-corner sky-corner-l">{DAYPART[sky.phase]}</div>
      <div className="sky-corner sky-corner-r">
        <div>{SEASON[sky.season]}</div>
        <div className="sky-anlas">{sky.anlasName}</div>
      </div>
    </div>
  )
}
