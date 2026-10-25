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

/**
 * The set for this room. Streets and squares are the city; woods, shores and
 * named open country are the valley for the season. Anywhere the classifier
 * can't place, or where there's no sky to see (indoors, underground), keeps the
 * previous set: stepping into a shop shouldn't swap the city for open country.
 */
export function skyArtSet(locale: RoomLocale, season: Season, previous: ArtSet | null): ArtSet {
  if (locale === 'urban') return 'city'
  if (locale === 'forest' || locale === 'water') return season
  if (previous === 'city') return 'city'
  return season
}
