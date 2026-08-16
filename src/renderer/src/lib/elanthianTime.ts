// Deterministic Elanthian clock and calendar.
//
// Elanthian time is a pure function of the wall clock, so everything here — time
// of day, season, and the full date — is closed-form arithmetic on `Date.now()`.
// No polling, no roundtime, and correct the instant the panel mounts:
//
//   1 roisan  = 1 Earth minute        1 anlas = 30 roisaen (30 Earth minutes)
//   1 day     = 12 anlaen             = 360 roisaen = 6 Earth hours
//   1 month   = 40 days               = 10 weeks of 4 days
//   1 year    = 10 months = 400 days, named on a 7-year cycle
//
// The one number that can't be derived is the EPOCH — where "now" sits in the
// cycle. We carry a constant for it, and because a wrong epoch would be invisible
// (a plausible-looking but wrong date), `correctionFromTimeLine` re-derives it from
// a TIME report and folds any disagreement into a correction offset. So the clock
// is right immediately on the constant, and self-heals if the constant ever drifts.
//
// Reference: https://elanthipedia.play.net/Elanthian_time
// See [[project-dr-stream-routing]] for how TIME's report lines reach us.

// ── Units ────────────────────────────────────────────────────────────────────────
const MS_PER_ROISAN     = 60_000
const ROISAEN_PER_ANLAS = 30
export const MINUTES_PER_DAY = 360   // 12 anlaen × 30 — and so also DEGREES of
                                     // planetary rotation per day, which is what
                                     // lets lib/moons.ts add the two directly.
const DAYS_PER_MONTH  = 40
const DAYS_PER_WEEK   = 4
const DAYS_PER_YEAR   = 400
const YEAR_ONE        = 250          // year number at Elanthian day zero

// Roisaen to add to the Unix clock to land at Elanthian day zero, anlas zero. This
// is the epoch anchor described above — the single unverifiable constant, kept
// honest by the TIME-report correction.
export const EPOCH_OFFSET_MIN = 80_895

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

// The 10 months, in order. Each is 40 days.
export const MONTHS = [
  'Akroeg the Ram',
  "Ka'len the Sea Drake",
  'Lirisa the Archer',
  'Shorka the Cobra',
  'Uthmor the Giant',
  'Arhat the Fire Lion',
  'Moliko the Balance',
  'Skullcleaver the Dwarven Axe',
  'Dolefaren the Brigantine',
  'Nissa the Maiden',
] as const

// The 10 weeks within a month, each 4 days long.
export const WEEKS = [
  'Kertandu', 'Hodandu', 'Evandu', 'Truffandu', 'Havrandu',
  'Elandu', 'Chandu', 'Glythandu', 'Faeandu', 'Tamsandu',
] as const

// Years are named on a repeating 7-name cycle.
export const YEAR_NAMES = [
  'Silver Unicorn', 'Bronze Wyvern', 'Golden Panther', 'Amber Phoenix',
  'Iron Toad', 'Emerald Dolphin', 'Crystal Snow Hare',
] as const

// Finer-grained than `phase`: the wording the game itself uses for where you are in
// the day. Index 0 is deep night; the rest march from pre-dawn to late evening.
export const SEGMENTS = [
  'night', 'approaching sunrise', 'dawn', 'early morning', 'mid-morning',
  'late morning', 'midday', 'early afternoon', 'mid-afternoon', 'late afternoon',
  'dusk', 'sunset', 'early evening', 'evening', 'late evening',
] as const

export type Season = 'winter' | 'spring' | 'summer' | 'autumn'
export type SkyPhase = 'dawn' | 'day' | 'dusk' | 'night'

// One anlas of dawn glow / dusk fade, used to ramp `daylight` rather than snapping.
const TWILIGHT = 30

export interface SkyState {
  // ── time of day ──
  season: Season
  anlasName: string
  anlasIndex: number
  roisan: number          // 0–29, roisaen into the current anlas
  minutesIntoDay: number  // 0–359
  phase: SkyPhase
  segment: string         // e.g. "mid-morning" (see SEGMENTS)
  isDay: boolean
  daylight: number        // 0 = deep night, 1 = full day (smooth across twilight)
  dayProgress: number     // 0 at sunrise → 1 at sunset (positions the sun on its arc);
                          // <0 before sunrise / >1 after sunset (sun below the horizon)
  sunrise: number         // minutes into the day
  sunset: number
  dayLength: number       // 120 (midwinter) … 240 (midsummer)
  // ── calendar ──
  dayOfYear: number       // 0–399
  monthIndex: number      // 0–9
  monthName: string
  dayOfMonth: number      // 1–40
  weekIndex: number       // 0–9
  weekName: string
  year: number
  yearName: string
}

const mod = (a: number, b: number): number => ((a % b) + b) % b

// Seasons are 100 days each, offset so that day 0 sits at midwinter — which is also
// where the sun model puts its shortest day, so the two agree by construction.
function seasonOf(dayOfYear: number): Season {
  if (dayOfYear < 50)  return 'winter'
  if (dayOfYear < 150) return 'spring'
  if (dayOfYear < 250) return 'summer'
  if (dayOfYear < 350) return 'autumn'
  return 'winter'
}

// Sun geometry for a given day of the year. Day length swings sinusoidally between
// 120 and 240 minutes, symmetric about solar noon at minute 180 — so sunrise and
// sunset step apart from midday together as the year turns.
function sunAt(dayOfYear: number): { sunrise: number; sunset: number; dayLength: number } {
  const angle = ((dayOfYear / DAYS_PER_YEAR) * 360 - 90) * (Math.PI / 180)
  const offset = Math.round(60 * Math.sin(angle))   // ±60 minutes about a 180 baseline
  const half = Math.round(offset / 2)
  const sunrise = 90 - half
  const sunset = 270 + half
  return { sunrise, sunset, dayLength: sunset - sunrise }
}

// Piecewise-linear daylight curve: 0 at night, ramps 0→1 over the first anlas after
// sunrise, holds at 1, ramps 1→0 over the last anlas before sunset.
function daylightAt(min: number, sunrise: number, sunset: number): number {
  if (min < sunrise || min >= sunset) return 0
  if (min < sunrise + TWILIGHT) return (min - sunrise) / TWILIGHT
  if (min > sunset - TWILIGHT)   return (sunset - min) / TWILIGHT
  return 1
}

// Which of the 15 day segments a minute falls in. The thresholds are proportional to
// the current day/night lengths, so the wording tracks the season rather than sitting
// on fixed clock positions.
function segmentAt(min: number, sunrise: number, sunset: number, dayLength: number): number {
  const night = MINUTES_PER_DAY - dayLength
  let s = 0
  if (min >= sunrise - night / 8)      s = 1
  if (min >= sunrise)                  s = 2
  if (min >= sunrise + dayLength / 8)  s = 3
  if (min >= 180 - dayLength / 4)      s = 4
  if (min >= 180 - dayLength / 8)      s = 5
  if (min >= 180)                      s = 6
  if (min >= 180 + dayLength / 8)      s = 7
  if (min >= 180 + dayLength / 4)      s = 8
  if (min >= sunset - dayLength / 8)   s = 9
  if (min >= sunset - dayLength / 9)   s = 10
  if (min >= sunset)                   s = 11
  if (min >= sunset + night / 9)       s = 12
  if (min >= MINUTES_PER_DAY - night / 4) s = 13
  if (min >= MINUTES_PER_DAY - night / 8) s = 14
  return s
}

// Elanthian minutes since the epoch — the single value every field below derives
// from. `correctionMin` is the learned offset (see correctionFromTimeLine).
export function elanthianMinutes(now: number, correctionMin = 0): number {
  return Math.floor(now / MS_PER_ROISAN) + EPOCH_OFFSET_MIN + correctionMin
}

export function computeSky(now: number, correctionMin = 0): SkyState {
  const t = elanthianMinutes(now, correctionMin)

  const minutesIntoDay = mod(t, MINUTES_PER_DAY)
  const anlasIndex = Math.floor(minutesIntoDay / ROISAEN_PER_ANLAS)
  const roisan = minutesIntoDay % ROISAEN_PER_ANLAS

  const dayOfYear = mod(Math.floor(t / MINUTES_PER_DAY), DAYS_PER_YEAR)
  const year = Math.floor(t / (MINUTES_PER_DAY * DAYS_PER_YEAR)) + YEAR_ONE
  const monthIndex = Math.floor(dayOfYear / DAYS_PER_MONTH)
  const dayOfMonth = (dayOfYear % DAYS_PER_MONTH) + 1
  const weekIndex = Math.floor((dayOfYear % DAYS_PER_MONTH) / DAYS_PER_WEEK)

  const { sunrise, sunset, dayLength } = sunAt(dayOfYear)
  const daylight = daylightAt(minutesIntoDay, sunrise, sunset)

  let phase: SkyPhase
  if (daylight <= 0) phase = 'night'
  else if (minutesIntoDay < sunrise + TWILIGHT) phase = 'dawn'
  else if (minutesIntoDay > sunset - TWILIGHT)  phase = 'dusk'
  else phase = 'day'

  return {
    season: seasonOf(dayOfYear),
    anlasName: ANLAEN[anlasIndex],
    anlasIndex,
    roisan,
    minutesIntoDay,
    phase,
    segment: SEGMENTS[segmentAt(minutesIntoDay, sunrise, sunset, dayLength)],
    isDay: daylight > 0,
    daylight,
    dayProgress: (minutesIntoDay - sunrise) / (sunset - sunrise),
    sunrise,
    sunset,
    dayLength,
    dayOfYear,
    monthIndex,
    monthName: MONTHS[monthIndex],
    dayOfMonth,
    weekIndex,
    weekName: WEEKS[weekIndex],
    year,
    yearName: YEAR_NAMES[year % YEAR_NAMES.length],
  }
}

// "11 Ka'len the Sea Drake, 457" — the long form for the panel.
export function formatDate(sky: SkyState): string {
  return `${sky.dayOfMonth} ${sky.monthName}, ${sky.year}`
}

// "11 Ka'len 457" — the compact form, month shortened to its proper name.
export function formatDateShort(sky: SkyState): string {
  return `${sky.dayOfMonth} ${sky.monthName.replace(/\s+the\b.*$/i, '')} ${sky.year}`
}

// ── TIME-report calibration ──────────────────────────────────────────────────────
// The clock above needs nothing from the game, but a TIME report is free and RT-less,
// so we use one to verify the epoch and correct it if it disagrees.

function normSeason(s: string): Season {
  const t = s.trim().toLowerCase()
  if (t === 'fall') return 'autumn'
  if (t === 'winter' || t === 'spring' || t === 'summer' || t === 'autumn') return t
  return 'summer'
}

// Matches the anlas line of a TIME report, tolerating the varying confidence
// prefix ("You're positive", "You think", …) and both "N roisaen after/before"
// and the bare "the Anlas of X" (exactly on the anlas). Handles singular "roisan"
// and plural "roisaen" (roisae?n), apostrophes in names, and the fancy ’.
const ANLAS_RE  = /(?:(\d+)\s+roisae?n\s+(after|before)\s+)?the Anlas of ([A-Za-z'’ ]+?)\.?\s*$/i
const SEASON_RE = /It is currently (\w+) and it is ([\w '-]+?)\.?\s*$/i
// The date line's exact phrasing varies, so rather than pin one sentence shape we
// pull the pieces independently: an ordinal day, any known month name, and the year
// that precedes "years since". A line that yields day + month is enough to place the
// date; the year is taken when present.
const DAY_RE   = /\b(\d{1,2})(?:st|nd|rd|th)?\s+day\b/i
const YEAR_RE  = /\b(\d{1,5})\s+years?\s+since\b/i

// True for any of the four lines a TIME report prints — used to suppress the
// silent connect-time seed from the main output.
const TIME_REPORT_RE = /since the Victory of Lanival|It is the .*month of|It is currently \w+ and it is|the Anlas of /i
export function isTimeReportLine(text: string): boolean {
  return TIME_REPORT_RE.test(text)
}

// Wrap a signed difference into ±half of `span`, so "off by 359 of 360" reads as
// "off by -1" rather than a near-full-cycle jump.
function wrapSigned(diff: number, span: number): number {
  return mod(diff + span / 2, span) - span / 2
}

// A TIME report spans several lines and the pieces arrive separately, so we hold the
// most recent season and date while scanning. Returns a correction (in roisaen) only
// once it has just seen the anlas line — the piece that pins the time of day.
//
// The anlas alone constrains the clock within a day, so its correction is wrapped to
// ±half a day. When the date line was also seen, we correct against the full year
// instead, which can also fix a whole-day error.
let _pendingSeason: Season | null = null
let _pendingDate: { dayOfYear: number; year?: number } | null = null

export function correctionFromTimeLine(text: string, now = Date.now(), correctionMin = 0): number | null {
  const sm = text.match(SEASON_RE)
  if (sm) { _pendingSeason = normSeason(sm[1]); return null }

  // Date line: needs a day number and a recognizable month name.
  const dm = text.match(DAY_RE)
  if (dm && /\bday\b/i.test(text)) {
    const mi = MONTHS.findIndex(m => text.includes(m) || text.includes(m.replace(/\s+the\b.*$/i, '')))
    if (mi >= 0) {
      const dayOfMonth = parseInt(dm[1], 10)
      if (dayOfMonth >= 1 && dayOfMonth <= DAYS_PER_MONTH) {
        const ym = text.match(YEAR_RE)
        _pendingDate = {
          dayOfYear: mi * DAYS_PER_MONTH + (dayOfMonth - 1),
          year: ym ? parseInt(ym[1], 10) : undefined,
        }
      }
      return null
    }
  }

  const am = text.match(ANLAS_RE)
  if (!am) return null
  const idx = ANLAEN.findIndex(n => n.toLowerCase() === am[3].trim().toLowerCase().replace(/’/g, "'"))
  if (idx < 0) return null

  const roisaen = am[1] ? parseInt(am[1], 10) * (am[2].toLowerCase() === 'before' ? -1 : 1) : 0
  const observedMinutesIntoDay = mod(idx * ROISAEN_PER_ANLAS + roisaen, MINUTES_PER_DAY)

  const model = computeSky(now, correctionMin)
  const date = _pendingDate
  _pendingDate = null

  let diff: number
  if (date) {
    const observed = date.dayOfYear * MINUTES_PER_DAY + observedMinutesIntoDay
    const modelled = model.dayOfYear * MINUTES_PER_DAY + model.minutesIntoDay
    diff = wrapSigned(observed - modelled, DAYS_PER_YEAR * MINUTES_PER_DAY)
  } else {
    diff = wrapSigned(observedMinutesIntoDay - model.minutesIntoDay, MINUTES_PER_DAY)
  }

  // Sub-roisan noise isn't worth re-anchoring for; the report itself is only
  // accurate to the roisan, and the confidence-prefixed forms round.
  if (Math.abs(diff) < 2) return null
  return correctionMin + diff
}

// The season the game just told us, if a report is mid-flight. Only used to sanity-
// check the computed season; the clock does not depend on it.
export function lastReportedSeason(): Season | null {
  return _pendingSeason
}

export function resetTimeCalibration(): void {
  _pendingSeason = null
  _pendingDate = null
}
