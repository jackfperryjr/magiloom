// Deterministic Elanthian clock.
//
// The Elanthian day is EXACTLY 6 Earth hours: 12 anlaen of 30 real minutes each
// (30 roisaen; 1 roisan = 1 Earth minute). So once we know where "now" sits in
// the cycle, time of day / day-night is pure math from the system clock — no
// polling, no roundtime. We seed the anchor by parsing one `TIME` report (a
// free, RT-less command) on connect, then never touch the game again.
//
// Reference: https://elanthipedia.play.net/Elanthian_time
// See [[project-dr-stream-routing]] for how these report lines reach us.

// The 12 anlaen in order (index 0 = start of the Elanthian day). Names as they
// appear in `TIME` ("...after the Anlas of Hodierna's Blessing.").
export const ANLAEN = [
  "Anduwen",            // 0  night
  "Starwatch",          // 1  night
  "Asketi's Hunt",      // 2  day (summer sunrise)
  "Berengaria's Touch", // 3  day
  "Hodierna's Blessing",// 4  day (winter sunrise)
  "Peri'el's Watch",    // 5  day
  "Dergati's Bane",     // 6  day
  "Firulf's Flame",     // 7  day
  "Tamsine's Toil",     // 8  day (winter sunset)
  "Meraud's Cloak",     // 9  night
  "Phelim's Vigil",     // 10 night (summer sunset)
  "Revelfae",           // 11 night
] as const

const ANLAS_MS = 30 * 60_000          // 30 Earth minutes
const DAY_MS   = 12 * ANLAS_MS         // 6 Earth hours

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'
export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night'

// Daylight is season-dependent: winter days are short, summer days long. Values
// are minutes-into-the-Elanthian-day for sunrise/sunset, derived from the anlas
// at which the wiki says the sun rises/sets each season (winter rise@anlas5 /
// set@anlas9; summer rise@anlas3 / set@anlas11; spring/autumn interpolate).
const DAYLIGHT: Record<Season, { rise: number; set: number }> = {
  winter: { rise: 120, set: 270 },   // anlas 5 → end of anlas 9
  spring: { rise:  90, set: 300 },   // anlas 4 → end of anlas 10
  autumn: { rise:  90, set: 300 },
  summer: { rise:  60, set: 330 },   // anlas 3 → end of anlas 11
}
const TWILIGHT = 30                    // one anlas of dawn glow / dusk fade

export interface SkyCalibration {
  // Real epoch-ms at which anlas index 0 (Anduwen) began. The cycle repeats every
  // DAY_MS, so this single anchor + the system clock gives the full state forever.
  dayStartMs: number
  season: Season
}

export interface SkyState {
  season: Season
  anlasName: string
  anlasIndex: number
  roisan: number          // 0–29, roisaen into the current anlas
  phase: SkyPhase
  isDay: boolean
  daylight: number        // 0 = deep night, 1 = full day (smooth across twilight)
  dayProgress: number     // 0 at sunrise → 1 at sunset (positions the sun on its arc);
                          // <0 before sunrise / >1 after sunset (sun below the horizon)
}

function normSeason(s: string): Season {
  const t = s.trim().toLowerCase()
  if (t === 'fall') return 'autumn'
  if (t === 'winter' || t === 'spring' || t === 'summer' || t === 'autumn') return t
  return 'summer'   // neutral fallback (longest, most forgiving daylight window)
}

// Matches the anlas line of a TIME report, tolerating the varying confidence
// prefix ("You're positive", "You think", …) and both "N roisaen after/before"
// and the bare "the Anlas of X" (exactly on the anlas). Handles singular "roisan"
// and plural "roisaen" (roisae?n), apostrophes in names, and the fancy ’.
const ANLAS_RE  = /(?:(\d+)\s+roisae?n\s+(after|before)\s+)?the Anlas of ([A-Za-z'’ ]+?)\.?\s*$/i
const SEASON_RE = /It is currently (\w+) and it is ([\w '-]+?)\.?\s*$/i

// True for any of the four lines a TIME report prints — used to suppress the
// silent connect-time seed from the main output.
const TIME_REPORT_RE = /since the Victory of Lanival|It is the .*month of|It is currently \w+ and it is|the Anlas of /i
export function isTimeReportLine(text: string): boolean {
  return TIME_REPORT_RE.test(text)
}

// A TIME report spans four lines; the season and the anlas arrive on separate
// ones, so we remember the most-recent season while scanning. `feedTimeLine`
// returns a fresh calibration only when it has just seen the anlas line (with a
// season already in hand), otherwise null.
let _pendingSeason: Season | null = null
export function feedTimeLine(text: string, now = Date.now()): SkyCalibration | null {
  const sm = text.match(SEASON_RE)
  if (sm) { _pendingSeason = normSeason(sm[1]); return null }

  const am = text.match(ANLAS_RE)
  if (!am) return null
  const idx = ANLAEN.findIndex(n => n.toLowerCase() === am[3].trim().toLowerCase().replace(/’/g, "'"))
  if (idx < 0) return null
  const roisaen = am[1] ? parseInt(am[1], 10) * (am[2].toLowerCase() === 'before' ? -1 : 1) : 0
  const minutesIntoDay = idx * 30 + roisaen
  return {
    dayStartMs: now - minutesIntoDay * 60_000,
    season: _pendingSeason ?? 'summer',
  }
}

// Piecewise-linear daylight curve: 0 at night, ramps 0→1 over the first anlas of
// day (dawn), holds at 1, ramps 1→0 over the last anlas of day (dusk).
function daylightAt(min: number, season: Season): number {
  const { rise, set } = DAYLIGHT[season]
  if (min < rise || min >= set) return 0
  if (min < rise + TWILIGHT) return (min - rise) / TWILIGHT
  if (min > set - TWILIGHT)  return (set - min) / TWILIGHT
  return 1
}

export function computeSky(now: number, cal: SkyCalibration): SkyState {
  let off = (now - cal.dayStartMs) % DAY_MS
  if (off < 0) off += DAY_MS
  const minutesIntoDay = off / 60_000
  const anlasIndex = Math.floor(minutesIntoDay / 30) % 12
  const roisan = Math.floor(minutesIntoDay % 30)
  const daylight = daylightAt(minutesIntoDay, cal.season)

  const { rise, set } = DAYLIGHT[cal.season]
  let phase: SkyPhase
  if (daylight <= 0) phase = 'night'
  else if (minutesIntoDay < rise + TWILIGHT) phase = 'dawn'
  else if (minutesIntoDay > set - TWILIGHT)  phase = 'dusk'
  else phase = 'day'

  return {
    season: cal.season,
    anlasName: ANLAEN[anlasIndex],
    anlasIndex,
    roisan,
    phase,
    isDay: daylight > 0,
    daylight,
    dayProgress: (minutesIntoDay - rise) / (set - rise),
  }
}
