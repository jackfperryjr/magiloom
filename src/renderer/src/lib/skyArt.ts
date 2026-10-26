/**
 * Which painted backdrop the Calendar panel shows, and how two of them blend.
 *
 * The paintings (assets/calendar-art/) come in sets of three lights: day,
 * twilight and night. One valley set per season, plus a season-less city set for
 * when the character is in town. The panel crossfades between two paintings as
 * the daylight changes, exactly the way the old gradient interpolated its
 * keyframes: night → twilight over the first half of the daylight range,
 * twilight → day over the second.
 *
 * Twilight is painted as a dusk, glowing on the right where the sun sets on the
 * panel's arc. Mirrored, the same painting is the dawn, glowing on the left.
 */
import type { Season } from './elanthianTime'
import type { RoomLocale } from './roomLocale'

export type ArtLight = 'day' | 'twilight' | 'night'
export type ArtSet   = Season | 'city'

export interface ArtLayer {
  light:   ArtLight
  opacity: number
  /** Mirror horizontally: twilight in the morning, so the glow sits in the east. */
  flip:    boolean
}

/**
 * The two paintings to stack, bottom first. The bottom one is always fully
 * opaque so nothing behind it ever shows through; the top one fades in.
 */
export function skyArtLayers(daylight: number, morning: boolean): [ArtLayer, ArtLayer] {
  const d = Math.max(0, Math.min(1, daylight))
  const tw = (opacity: number): ArtLayer => ({ light: 'twilight', opacity, flip: morning })
  if (d <= 0.5) return [{ light: 'night', opacity: 1, flip: false }, tw(d / 0.5)]
  return [tw(1), { light: 'day', opacity: (d - 0.5) / 0.5, flip: false }]
}

// ── Geometry ─────────────────────────────────────────────────────────────────
// The panel draws in a 200×104 viewBox (the "core": the sun/moon arc lives in it).
// The paintings are 1376×768 and their painted horizon sits where the panel's
// horizon line is (y = 62 of the core) when the image covers the core.

export interface Box { x: number; y: number; w: number; h: number }

export const CORE: Box = { x: 0, y: 0, w: 200, h: 104 }
export const ART_HORIZON = 62
const ART_ASPECT = 1376 / 768
// Where the horizon falls down the painting, as a fraction of its height: the
// covering image is 200 wide, so ~111.6 tall, centred on the 104-tall core.
const BASE_H = CORE.w / ART_ASPECT
const HORIZON_FRAC = (ART_HORIZON - (CORE.h - BASE_H) / 2) / BASE_H

/**
 * The viewBox for a box of this pixel size. In the sidebar the panel's height
 * follows its width, so this is just the core. In a pop-out the window decides
 * both, so the view grows around the core instead of letterboxing: wider shows
 * more of the painting at the sides, taller shows more sky above (the land stays
 * at the bottom, where the painting has it).
 */
export function fillViewBox(width: number, height: number): Box {
  if (!(width > 0) || !(height > 0)) return CORE
  const ratio = width / height, core = CORE.w / CORE.h
  if (ratio >= core) {
    const w = CORE.h * ratio
    return { x: (CORE.w - w) / 2, y: 0, w, h: CORE.h }
  }
  const h = CORE.w / ratio
  return { x: 0, y: CORE.h - h, w: CORE.w, h }
}

/**
 * Where to draw a painting so it covers `view` with its horizon pinned to the
 * panel's horizon line, so the sun and moons still set behind the painted hills
 * however the view is stretched. Centred horizontally on the core.
 */
export function paintingBox(view: Box): Box {
  const h = Math.max(
    (ART_HORIZON - view.y) / HORIZON_FRAC,                    // reaches the top of the view
    (view.y + view.h - ART_HORIZON) / (1 - HORIZON_FRAC),     // reaches the bottom
    view.w / ART_ASPECT,                                      // reaches both sides
  )
  const w = h * ART_ASPECT
  return { x: CORE.w / 2 - w / 2, y: ART_HORIZON - HORIZON_FRAC * h, w, h }
}

/**
 * The set for this room. Streets and squares are the city; woods, shores, villages,
 * mountains, desert and named open country are the valley for the season. Anywhere the classifier
 * can't place, or where there's no sky to see (indoors, underground), keeps the
 * previous set: stepping into a shop shouldn't swap the city for open country.
 */
export function skyArtSet(locale: RoomLocale, season: Season, previous: ArtSet | null): ArtSet {
  if (locale === 'urban') return 'city'
  if (locale === 'forest' || locale === 'water' || locale === 'village' ||
      locale === 'mountain' || locale === 'desert') return season
  if (previous === 'city') return 'city'
  return season
}
