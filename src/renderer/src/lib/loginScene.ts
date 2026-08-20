/**
 * Chooses which login scene to show, from the real-world calendar and clock.
 *
 * Deliberately NOT the Elanthian calendar: the login screen has no game session,
 * so it cannot know the world's season or weather. This is the app's own identity;
 * the game's sky takes over the moment you are connected (see AmbientOverlay).
 *
 * Order of precedence:
 *   1. Holidays win outright, and the random pick can never override one.
 *   2. Otherwise a 1-in-4 wildcard from the two seasonless scenes that suit this
 *      season, so a season doesn't become monotonous over the three months it owns.
 *   3. Otherwise the season's own scene.
 * Finally, anything that can only be daylight is swapped for the plain night sky
 * after dark (and vice versa) — holidays excepted, since Yule at noon is still Yule.
 *
 * The roll is an argument rather than a Math.random() call inside, so the app can
 * feed it a per-day seed (dailyRoll) and the tests can feed it fixed values. One
 * scene per day, not one per visit: see dailyRoll.
 *
 * Pure and dependency-free so it can be tested in plain node.
 */

import type { HatKind } from './loginScenes'

/** Index into the array returned by buildScenes(). */
export const SCENE = {
  downpour: 0, snowfall: 1, clearDay: 2, moons: 3, grove: 4, forge: 5, deep: 6,
  blossom: 7, harvest: 8, hallows: 9, yule: 10, fireworks: 11, clearNight: 12,
} as const

export type SceneIndex = (typeof SCENE)[keyof typeof SCENE]

export type SceneTag = 'anytime' | 'winter' | 'spring' | 'summer' | 'autumn' | 'holiday' | 'night'
export type SceneLight = 'day' | 'night' | 'any'

export interface SceneMeta {
  index: SceneIndex
  /** Stable id, used by the "pin a scene" setting so saved prefs survive reorders. */
  key:   string
  name:  string
  tag:   SceneTag
  /** When this scene can legitimately be on screen. */
  light: SceneLight
}

export const SCENES: SceneMeta[] = [
  { index: SCENE.downpour,   key: 'downpour',   name: 'Downpour',    tag: 'anytime', light: 'any'   },
  { index: SCENE.snowfall,   key: 'snowfall',   name: 'Snowfall',    tag: 'winter',  light: 'any'   },
  { index: SCENE.clearDay,   key: 'clearDay',   name: 'Clear Day',   tag: 'summer',  light: 'day'   },
  { index: SCENE.moons,      key: 'moons',      name: 'Three Moons', tag: 'anytime', light: 'night' },
  { index: SCENE.grove,      key: 'grove',      name: 'Grove',       tag: 'autumn',  light: 'any'   },
  { index: SCENE.forge,      key: 'forge',      name: 'Forge',       tag: 'anytime', light: 'any'   },
  { index: SCENE.deep,       key: 'deep',       name: 'Deep Water',  tag: 'anytime', light: 'any'   },
  { index: SCENE.blossom,    key: 'blossom',    name: 'Blossom',     tag: 'spring',  light: 'day'   },
  { index: SCENE.harvest,    key: 'harvest',    name: 'Harvest',     tag: 'holiday', light: 'any'   },
  { index: SCENE.hallows,    key: 'hallows',    name: 'Hallows',     tag: 'holiday', light: 'night' },
  { index: SCENE.yule,       key: 'yule',       name: 'Yule',        tag: 'holiday', light: 'night' },
  { index: SCENE.fireworks,  key: 'fireworks',  name: 'Fireworks',   tag: 'holiday', light: 'night' },
  { index: SCENE.clearNight, key: 'clearNight', name: 'Clear Night', tag: 'night',   light: 'night' },
]

/** Loomy's hat when a holiday scene is shown outside its own occasion. */
export const SCENE_HAT: Partial<Record<number, HatKind>> = {
  [SCENE.harvest]:   'pilgrim',
  [SCENE.hallows]:   'witch',
  [SCENE.yule]:      'santa',
  [SCENE.fireworks]: 'sam',
}

export type PickRule = 'holiday' | 'season' | 'random' | 'clock' | 'pinned'

export interface ScenePick {
  scene: number
  /** Why this scene: a holiday name, a season, 'wildcard', or the time of day. */
  why:  string
  rule: PickRule
  hat?: HatKind
}

/** Nth weekday of a month, 1-indexed. `weekday` is 0=Sunday. month is 0-11. */
export function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(year, month, 1)
  const shift = (weekday - first.getDay() + 7) % 7
  return 1 + shift + (n - 1) * 7
}

interface Holiday { scene: number; why: string; hat: HatKind }

/**
 * Fixed date windows, plus one nth-weekday rule for Thanksgiving.
 *
 * Deliberately no Easter: the computus is a lot of machinery for a single movable
 * date that the spring scene already covers.
 */
export function holidayFor(date: Date): Holiday | null {
  const y = date.getFullYear(), m = date.getMonth(), d = date.getDate()
  if (m === 11 && d >= 18 && d <= 26) return { scene: SCENE.yule, why: 'Yule', hat: 'santa' }
  if ((m === 11 && d >= 30) || (m === 0 && d <= 2)) {
    return { scene: SCENE.fireworks, why: 'New Year', hat: 'party' }
  }
  if (m === 9 && d >= 25) return { scene: SCENE.hallows, why: 'Hallows', hat: 'witch' }
  // Independence Day reuses the fireworks; only the hat changes.
  if (m === 6 && d >= 3 && d <= 5) return { scene: SCENE.fireworks, why: 'Fourth of July', hat: 'sam' }
  const thanks = nthWeekday(y, 10, 4, 4)
  if (m === 10 && d >= thanks - 2 && d <= thanks + 1) {
    return { scene: SCENE.harvest, why: 'Harvest', hat: 'pilgrim' }
  }
  return null
}

/** Rough local clock. A background doesn't need real sunrise tables. */
export function isNight(date: Date): boolean {
  const hr = date.getHours()
  return hr < 6 || hr >= 19
}

/**
 * Approximate astronomical seasons. They wobble a day either way by year, which
 * does not matter for a background. Northern hemisphere — a southern-hemisphere
 * option is a known gap.
 */
export function seasonOf(date: Date): 'spring' | 'summer' | 'autumn' | 'winter' {
  const m = date.getMonth(), d = date.getDate()
  if ((m === 2 && d >= 20) || m === 3 || m === 4 || (m === 5 && d < 21)) return 'spring'
  if ((m === 5 && d >= 21) || m === 6 || m === 7 || (m === 8 && d < 22)) return 'summer'
  if ((m === 8 && d >= 22) || m === 9 || m === 10 || (m === 11 && d < 21)) return 'autumn'
  return 'winter'
}

const SEASON_SCENE = {
  winter: SCENE.snowfall, spring: SCENE.blossom,
  summer: SCENE.clearDay, autumn: SCENE.grove,
} as const

/**
 * The scenes that belong to no season, and which seasons will have them anyway.
 *
 * Each is a mood the season can plausibly be in rather than a picture of it: the
 * forge is somewhere to be when it's cold out, deep water reads as spring melt
 * and summer swimming, rain belongs to the shoulder seasons, and a clear moonlit
 * sky suits the long nights at either end of the year. Two per season, so a
 * wildcard day still feels like a coin toss rather than a fixed alternate.
 */
const SEASON_WILDCARDS = {
  spring: [SCENE.deep,  SCENE.downpour],
  summer: [SCENE.deep,  SCENE.moons],
  autumn: [SCENE.forge, SCENE.downpour],
  winter: [SCENE.forge, SCENE.moons],
} as const

/** Chance of showing the season's wildcard instead of the season's own scene. */
export const WILDCARD = 0.25

/**
 * A roll that is fixed for a whole calendar day.
 *
 * The login screen used to rotate every 90 seconds, which meant the art changed
 * under anyone who left it open and made "today's scene" meaningless. Seeding the
 * roll off the date instead gives one scene per day: stable across reloads, across
 * a re-login, and across two windows open at once, and different tomorrow.
 *
 * Local calendar day, deliberately — the scene should turn over at the user's
 * midnight, not UTC's.
 */
export function dailyRoll(date: Date): number {
  const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100_000) / 100_000
}

/** Swap a scene that cannot be on screen at this hour for the plain sky. */
function forHour(sceneIndex: number, night: boolean): number {
  const meta = SCENES[sceneIndex]
  if (night && meta.light === 'day') return SCENE.clearNight
  if (!night && meta.light === 'night') return SCENE.clearDay
  return sceneIndex
}

export interface PickOptions {
  /** Show holiday scenes at all. Off means seasons and wildcards only. */
  holidays?: boolean
  /** Pin one scene by key, bypassing the calendar entirely. */
  pinned?: string | null
}

/** `roll` is 0..1 — pass Math.random() in the app; a fixed value in tests. */
export function pickScene(date: Date, roll: number, opts: PickOptions = {}): ScenePick {
  const pinnedKey = opts.pinned
  if (pinnedKey) {
    const meta = SCENES.find(s => s.key === pinnedKey)
    if (meta) return { scene: meta.index, why: meta.name, rule: 'pinned', hat: SCENE_HAT[meta.index] }
  }

  if (opts.holidays !== false) {
    const hol = holidayFor(date)
    if (hol) return { scene: hol.scene, why: hol.why, rule: 'holiday', hat: hol.hat }
  }

  const night  = isNight(date)
  const season = seasonOf(date)

  if (roll < WILDCARD) {
    const pool = SEASON_WILDCARDS[season]
    const pick = pool[Math.min(pool.length - 1, Math.floor((roll / WILDCARD) * pool.length))]
    const swapped = forHour(pick, night)
    return swapped === pick
      ? { scene: swapped, why: `${season} wildcard`, rule: 'random' }
      : { scene: swapped, why: night ? 'night' : 'day', rule: 'clock' }
  }

  const seasonScene = SEASON_SCENE[season]
  const out = forHour(seasonScene, night)
  return out === seasonScene
    ? { scene: out, why: season, rule: 'season' }
    : { scene: out, why: night ? 'night' : 'day', rule: 'clock' }
}
