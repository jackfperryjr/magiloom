/**
 * DragonRealms log analysis — plain text in, session statistics out.
 *
 * INPUT FORMAT. Both the desktop app (src/main/log-store.ts) and the server
 * (magiserver src/lib/log-store.ts) write the same thing: one file per character
 * per day, named `<charslug>-<YYYY-MM-DD>.log`, each line `[HH:MM:SS] <text>`,
 * where <text> is the game stream with every XML tag replaced by a newline and the
 * pieces written out as separate lines.
 *
 * WHAT THAT COSTS US, AND HOW WE GET IT BACK. Because tags become newlines, a live
 * experience update arrives split across two log lines — the abbreviation from
 * inside <d cmd='skill X'>, then the numbers:
 *
 *     [12:34:56] Aug
 *     [12:34:56] : 305 66% [ 1/34]
 *
 * so `readExpFragments` pairs them back up and `resolveSkillAbbrev` turns "Aug"
 * into "Augmentation". A typed `EXP` report survives intact as ordinary text and is
 * read separately by `readExpReports`. Between the two we recover experience over
 * time with real timestamps, which is what makes ranks/hour possible at all.
 *
 * WHAT THE TEXT CANNOT GIVE US AT ALL. Room names are worse off than experience: DR
 * sends them as an XML ATTRIBUTE (`<streamWindow subtitle=' - [Crossing, Town Square]'>`)
 * and flattening deletes attributes outright, so in a text-only log the room name was
 * never written down and no amount of cleverness recovers it. An early version matched
 * any wholly-bracketed line and produced a confident, entirely fictional "where the time
 * went" table built from Lich script tags and roundtime notices. Room stats now come
 * from the sidecar, and the text fallback demands corroboration before believing a
 * bracket (see ROOM_CANDIDATE_RE) — reporting nothing where it knows nothing.
 *
 * ON THE PATTERN TABLES BELOW. Experience shapes come straight from the parser this
 * repo already ships. Combat, death and coin messages are NOT structural: they are
 * ordinary prose, and the exact wording is the kind of thing that has to be checked
 * against real captures. They are collected in `PATTERNS` as one editable table, and
 * every count derived from them is reported with `confidence: 'heuristic'` so the UI
 * can say so rather than quietly presenting a guess as a fact. Nothing else in the
 * analysis depends on them.
 *
 * Pure: no DOM, no fetch, no React. Runs in the browser, in node, and in a test.
 */

import { parseExpSkills } from '../../renderer/src/lib/exp-parser'
import { resolveSkillAbbrev } from '../../renderer/src/lib/skillAbbrev'
import type { StreamEvent } from '../../main/stream-events'

// ── Input ───────────────────────────────────────────────────────────────────────

export interface RawLine {
  /** Epoch ms. Reconstructed from the file's day plus the line's clock time. */
  at:   number
  text: string
}

export interface ParsedLog {
  /** Character slug from the filename, or 'unknown' for a pasted/renamed file. */
  char:  string
  /** YYYY-MM-DD from the filename, or the empty string when it had none. */
  day:   string
  name:  string
  lines: RawLine[]
}

const LOG_NAME = /^([a-z0-9]+)-(\d{4}-\d{2}-\d{2})\.log$/i
const LINE_RE  = /^\[(\d{2}):(\d{2}):(\d{2})\]\s?(.*)$/

/**
 * Parse one log file. Unparseable lines are skipped rather than thrown on — a log
 * can be truncated mid-line by the server's tail-read, and half a line is not a
 * reason to lose the other ten thousand.
 */
export function parseLogFile(name: string, content: string): ParsedLog {
  const m = LOG_NAME.exec(name.trim())
  const char = m ? m[1].toLowerCase() : 'unknown'
  const day  = m ? m[2] : ''

  // No day in the filename → anchor to the epoch so intervals stay meaningful even
  // though absolute dates don't.
  const base = day ? Date.parse(`${day}T00:00:00`) : 0
  const DAY_MS = 86_400_000

  const lines: RawLine[] = []
  let prevSec = -1
  let dayOffset = 0

  for (const raw of content.split(/\r?\n/)) {
    const lm = LINE_RE.exec(raw)
    if (!lm) continue
    const sec = (+lm[1]) * 3600 + (+lm[2]) * 60 + (+lm[3])
    // Clock went backwards → the session crossed midnight. (A file is one calendar
    // day by name, but a session started at 23:58 keeps writing past 00:00.)
    if (prevSec >= 0 && sec < prevSec - 60) dayOffset += DAY_MS
    prevSec = sec
    const text = lm[4]
    if (!text) continue
    lines.push({ at: base + dayOffset + sec * 1000, text })
  }

  return { char, day, name: name.trim(), lines }
}

// ── Experience ──────────────────────────────────────────────────────────────────

export interface ExpSample {
  at:    number
  skill: string
  rank:  number
  pct:   number
  /** rank + pct/100 — a single monotonic number, so deltas are just subtraction. */
  value: number
  /**
   * How we learned it, best first: `event` from the structured sidecar (exact),
   * `tick` reconstructed from a split pair of text lines, `report` from a typed EXP.
   */
  via:   'event' | 'tick' | 'report'
}

// The numbers half of a split live update: ": 305 66% [ 1/34]". Mind-state word
// ("Mind lock", "clear") is optional and ignored here.
const EXP_FRAGMENT_RE = /^:\s*(\d+)\s+(\d+)%\s*(?:[a-zA-Z][a-zA-Z ]*?\s*)?[[(]\s*\d+\/\d+\s*[\])]\s*$/
// The abbreviation half. Short, wordy, no punctuation — "Aug", "L Armor", "TM".
const EXP_ABBREV_RE   = /^[A-Za-z][A-Za-z' ]{0,15}$/

/**
 * Recover live experience ticks from abbreviation/numbers line pairs. Only pairs
 * sharing a timestamp are accepted (they are written from one stream chunk), which
 * keeps ordinary prose from being mistaken for an abbreviation.
 */
export function readExpFragments(lines: RawLine[]): ExpSample[] {
  const out: ExpSample[] = []
  for (let i = 1; i < lines.length; i++) {
    const nm = EXP_FRAGMENT_RE.exec(lines[i].text)
    if (!nm) continue
    const prev = lines[i - 1]
    if (prev.at !== lines[i].at) continue
    if (!EXP_ABBREV_RE.test(prev.text)) continue
    const skill = resolveSkillAbbrev(prev.text)
    if (!skill) continue      // ambiguous — better absent than wrong
    const rank = +nm[1], pct = +nm[2]
    out.push({ at: lines[i].at, skill, rank, pct, value: rank + pct / 100, via: 'tick' })
  }
  return out
}

/**
 * Experience samples from the structured sidecar.
 *
 * This is the good path. The sidecar was written from the XML before it was
 * flattened, so it carries the full skill name (no abbreviation to resolve, nothing
 * dropped for being ambiguous) and an absolute timestamp per update. When a log has
 * one, its samples supersede everything scraped from the text.
 */
export function readExpEvents(events: StreamEvent[]): ExpSample[] {
  const out: ExpSample[] = []
  for (const ev of events) {
    if (ev.e !== 'exp') continue
    if (!Number.isFinite(ev.rank) || !Number.isFinite(ev.pct)) continue
    out.push({
      at: ev.t, skill: ev.skill, rank: ev.rank, pct: ev.pct,
      value: ev.rank + ev.pct / 100, via: 'event',
    })
  }
  return out
}

/** Read whole-report snapshots (the output of a typed `EXP`), which carry full names. */
export function readExpReports(lines: RawLine[]): ExpSample[] {
  const out: ExpSample[] = []
  for (const line of lines) {
    // A report row lists several skills across one line; a single match on a prose
    // line would be a false positive, so require the line to be report-shaped.
    const skills = parseExpSkills(line.text)
    if (!skills.length) continue
    for (const s of skills) {
      const rank = +s.rank, pct = +s.pct
      if (!Number.isFinite(rank) || !Number.isFinite(pct)) continue
      out.push({ at: line.at, skill: s.name, rank, pct, value: rank + pct / 100, via: 'report' })
    }
  }
  return out
}

export interface SkillProgress {
  skill:       string
  startRank:   number
  startPct:    number
  endRank:     number
  endPct:      number
  /** Fractional ranks gained across the window. Never negative. */
  ranksGained: number
  firstAt:     number
  lastAt:      number
  samples:     number
  /** Ranks per hour over this skill's own observed span (not the whole session). */
  perHour:     number
}

/**
 * Fold samples into per-skill progress. The delta is first-observed → last-observed,
 * so it measures what was gained DURING the log, not lifetime totals. A skill seen
 * only once contributes 0 gained (correct: one observation is not a delta).
 */
export function skillProgress(samples: ExpSample[]): SkillProgress[] {
  const by = new Map<string, ExpSample[]>()
  for (const s of samples) {
    const arr = by.get(s.skill) ?? by.set(s.skill, []).get(s.skill)!
    arr.push(s)
  }

  const out: SkillProgress[] = []
  for (const [skill, arr] of by) {
    arr.sort((a, b) => a.at - b.at)
    const first = arr[0], last = arr[arr.length - 1]
    // Guard against a rank that appears to go backwards (a stale report interleaved
    // with ticks); clamp at zero rather than reporting negative progress.
    const gained = Math.max(0, last.value - first.value)
    const spanH  = (last.at - first.at) / 3_600_000
    out.push({
      skill,
      startRank: first.rank, startPct: first.pct,
      endRank:   last.rank,  endPct:   last.pct,
      ranksGained: gained,
      firstAt: first.at, lastAt: last.at,
      samples: arr.length,
      perHour: spanH > 0 ? gained / spanH : 0,
    })
  }
  return out.sort((a, b) => b.ranksGained - a.ranksGained || a.skill.localeCompare(b.skill))
}

// ── Rooms ───────────────────────────────────────────────────────────────────────

/**
 * Bracketed line, the shape a room title WOULD have in a text log.
 *
 * The catch, and it's a big one: DR sends the room name as an XML attribute
 * (`<streamWindow subtitle=' - [Crossing, Town Square]'>`), and flattening the stream
 * to text deletes attributes, so in most logs the room name is simply not there. What
 * IS bracketed and does survive is other output entirely — Lich script tags, roundtime
 * notices, and similar — and matching those produced a confident, completely fictional
 * "where the time went" table.
 *
 * So a bracketed line is now only a candidate, and `roomStats` requires corroboration
 * before believing it (see CORROBORATION_RE). Logs written with a structured sidecar
 * skip all of this: the sidecar records the attribute directly and is authoritative.
 */
const ROOM_CANDIDATE_RE = /^\[([^\]]{2,80})\]$/

/**
 * DR prints the obvious paths within a few lines of entering a room, and that line
 * DOES survive flattening. A bracketed line followed closely by one is a real room
 * title; a bracketed line that is never followed by one is script noise.
 */
const CORROBORATION_RE = /^Obvious\s+(?:paths?|exits?)\s*:/i

/** How many lines after a bracketed line we'll look for corroboration. */
const CORROBORATION_WINDOW = 6

/** Script tags and other bracketed noise: lowercase, or carrying a colon. */
function looksLikeNoise(text: string): boolean {
  // "[go2: moving to town]" — a colon inside the brackets is script output, never a
  // room. Room names are Title Case; "[waggle]" and "[go2]" are not.
  if (text.includes(':')) return true
  return !/^[A-Z]/.test(text)
}

export interface RoomStat {
  room:    string
  visits:  number
  /** ACTIVE time in this room — see the accounting note on `roomStats`. */
  msSpent: number
}

/**
 * Time spent per room, measured the same way as the session's active time: walk
 * consecutive log lines and credit each gap to whichever room was current, skipping
 * any gap longer than `idleMs` entirely.
 *
 * That last rule is what stops "logged out standing in the Crossing" from being
 * reported as eight hours of Town Square, and it gives a property worth relying on:
 * **room times sum to the session's active time**, so the room table is a genuine
 * breakdown of the headline number rather than a second, differently-shaped estimate
 * of it. The trade-off is that idle minutes belong to no room at all — a room where
 * you stood still for ten quiet minutes reads as less time than the wall clock says,
 * which is the honest answer to "where did my playing time actually go".
 */
export function roomStats(
  lines: RawLine[],
  idleMs = DEFAULT_IDLE_MS,
  events?: StreamEvent[],
): RoomStat[] {
  const stats = new Map<string, RoomStat>()
  let cur: RoomStat | null = null

  const room = (name: string): RoomStat => {
    const found = stats.get(name)
    if (found) return found
    const made: RoomStat = { room: name, visits: 0, msSpent: 0 }
    stats.set(name, made)
    return made
  }

  // Which line indices are genuinely room titles. With a sidecar we don't guess at
  // all; without one we require corroboration from a nearby "Obvious paths:" line.
  const titles = events ? roomTitlesFromEvents(lines, events) : roomTitlesFromText(lines)

  for (let i = 0; i < lines.length; i++) {
    // Credit the gap BEFORE this line to the room we were standing in.
    if (i > 0 && cur) {
      const gap = lines[i].at - lines[i - 1].at
      if (gap <= idleMs) cur.msSpent += gap
    }
    const name = titles.get(i)
    if (name !== undefined) {
      cur = room(name)
      cur.visits++
    }
  }

  return [...stats.values()].sort((a, b) => b.msSpent - a.msSpent || b.visits - a.visits)
}

/**
 * Map sidecar room events onto line positions, so room time can still be measured
 * against the text log's activity timestamps. Each event is attached to the first
 * line at or after its timestamp.
 */
function roomTitlesFromEvents(lines: RawLine[], events: StreamEvent[]): Map<number, string> {
  const out = new Map<number, string>()
  const rooms = events.filter((e): e is Extract<StreamEvent, { e: 'room' }> => e.e === 'room')
  if (!rooms.length || !lines.length) return out

  let i = 0
  for (const ev of rooms) {
    while (i < lines.length - 1 && lines[i].at < ev.t) i++
    // Two rooms landing on one line (a fast run through) would otherwise overwrite
    // each other; keep the first and let the next take the following line.
    let at = i
    while (out.has(at) && at < lines.length - 1) at++
    out.set(at, ev.name)
  }
  return out
}

/** Corroborated bracketed lines only — see ROOM_CANDIDATE_RE for why. */
function roomTitlesFromText(lines: RawLine[]): Map<number, string> {
  const out = new Map<number, string>()

  // First pass: find candidates that a nearby "Obvious paths:" line vouches for, and
  // remember the names, since later visits to the same room won't always reprint them.
  const confirmed = new Set<string>()
  const candidates: { i: number; name: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const m = ROOM_CANDIDATE_RE.exec(lines[i].text)
    if (!m) continue
    const name = m[1].trim()
    if (looksLikeNoise(name)) continue
    candidates.push({ i, name })
    for (let j = i + 1; j < Math.min(i + 1 + CORROBORATION_WINDOW, lines.length); j++) {
      if (CORROBORATION_RE.test(lines[j].text)) { confirmed.add(name); break }
    }
  }

  // Second pass: accept every occurrence of a name that was confirmed at least once.
  for (const c of candidates) if (confirmed.has(c.name)) out.set(c.i, c.name)
  return out
}

// ── Prose-matched events (heuristic — see the file header) ──────────────────────

/**
 * Message patterns that are ordinary prose rather than structured output. These
 * are the ONLY guessy part of the analysis and are isolated here so they can be
 * corrected against real captures without touching anything else. Each capture
 * group 1, where present, is the creature/subject name.
 */
export const PATTERNS = {
  /** A creature dying. DR phrasings vary by creature and by killing blow. */
  kill: [
    /^(?:The|An?)\s+(.+?)\s+(?:falls to the ground and dies|collapses(?:\s+in a heap)?|dies|drops dead|is slain)\b/i,
    /^(?:The|An?)\s+(.+?)\s+(?:screams|shudders|convulses)[^.]*\band dies\b/i,
    /\bYou(?:r \w+)? (?:kill|slay)s? (?:the|an?)\s+(.+?)[.!]/i,
  ] as RegExp[],
  /** The character's own death. */
  death: [
    /^You are dead\b/i,
    /^You have been (?:killed|slain)\b/i,
    /\byour spirit (?:slips|departs|leaves)\b/i,
  ] as RegExp[],
  /** Coins gained. Capture group 1 must be the amount. */
  coins: [
    /\byou (?:pick up|gather|find|count out)\s+([\d,]+)\s+(?:copper|silver|gold|platinum)?\s*coins?\b/i,
  ] as RegExp[],
} as const

export interface HeuristicCounts {
  kills:      { name: string; count: number }[]
  totalKills: number
  deaths:     number
  deathTimes: number[]
  coins:      number
  /** Always 'heuristic' — a standing reminder to the UI to label these as estimates. */
  confidence: 'heuristic'
}

/**
 * One death produces SEVERAL matching lines — the announcement, the spirit leaving,
 * and whatever else the guild or the room adds — so matches inside this window are
 * treated as the same death. Dying twice inside a minute is not a thing that happens
 * (you can't act while dead), which makes this safe in the direction that matters.
 */
export const DEATH_DEDUPE_MS = 60_000

export function heuristicCounts(lines: RawLine[]): HeuristicCounts {
  const kills = new Map<string, number>()
  const deathTimes: number[] = []
  let coins = 0

  for (const line of lines) {
    const t = line.text

    for (const re of PATTERNS.kill) {
      const m = re.exec(t)
      if (m) {
        const name = (m[1] ?? 'creature').trim().toLowerCase()
        kills.set(name, (kills.get(name) ?? 0) + 1)
        break
      }
    }
    if (PATTERNS.death.some(re => re.test(t))) {
      const last = deathTimes[deathTimes.length - 1]
      if (last === undefined || line.at - last > DEATH_DEDUPE_MS) deathTimes.push(line.at)
    }
    for (const re of PATTERNS.coins) {
      const m = re.exec(t)
      if (m) { coins += +m[1].replace(/,/g, '') || 0; break }
    }
  }

  const list = [...kills].map(([name, count]) => ({ name, count }))
                         .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return {
    kills: list,
    totalKills: list.reduce((n, k) => n + k.count, 0),
    deaths: deathTimes.length,
    deathTimes,
    coins,
    confidence: 'heuristic',
  }
}

// ── Whole-log analysis ──────────────────────────────────────────────────────────

/** Silence longer than this ends a play session (and stops a room's clock). */
export const DEFAULT_IDLE_MS = 5 * 60_000

export interface Span { start: number; end: number }

export interface Analysis {
  char:      string
  day:       string
  name:      string
  lineCount: number
  /** Wall-clock first line → last line. */
  start:     number
  end:       number
  wallMs:    number
  /** Wall time minus every gap longer than the idle threshold — real time played. */
  activeMs:  number
  /** Contiguous stretches of play, split on idle gaps. */
  sessions:  Span[]
  skills:    SkillProgress[]
  /** Sum of fractional ranks gained across every skill. */
  totalRanks:    number
  ranksPerHour:  number
  /** True when experience came only from typed EXP reports (coarse timing). */
  expFromReportsOnly: boolean
  /** Where the experience figures came from — drives how confidently the UI states them. */
  expSource: 'events' | 'text' | 'none'
  /**
   * Where room names came from. 'text' means they were inferred from bracketed lines,
   * which for most logs finds nothing at all — DR sends the room name as an attribute
   * and flattening deletes it. Only 'events' is reliable.
   */
  roomSource: 'events' | 'text'
  rooms:     RoomStat[]
  events:    HeuristicCounts
}

export interface AnalyzeOptions {
  idleMs?: number
  /**
   * Events from this log's structured sidecar, when it has one. Supplying them
   * replaces the text-derived experience entirely — see `expSource`.
   */
  streamEvents?: StreamEvent[]
}

export function analyze(log: ParsedLog, opts: AnalyzeOptions = {}): Analysis {
  const { idleMs = DEFAULT_IDLE_MS, streamEvents } = opts
  const { lines } = log

  if (!lines.length) {
    return {
      char: log.char, day: log.day, name: log.name, lineCount: 0,
      start: 0, end: 0, wallMs: 0, activeMs: 0, sessions: [],
      skills: [], totalRanks: 0, ranksPerHour: 0,
      expFromReportsOnly: false, expSource: 'none',
      rooms: [], events: heuristicCounts([]), roomSource: 'text',
    }
  }

  const start = lines[0].at
  const end   = lines[lines.length - 1].at

  // Split on idle gaps; active time is the sum of the resulting spans. A span of
  // zero length (one isolated line surrounded by silence) contributes nothing and is
  // dropped, so "3 sessions" never means "2 sessions and a stray line".
  const spans: Span[] = []
  let spanStart = start
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].at - lines[i - 1].at > idleMs) {
      spans.push({ start: spanStart, end: lines[i - 1].at })
      spanStart = lines[i].at
    }
  }
  spans.push({ start: spanStart, end })
  const sessions = spans.filter(s => s.end > s.start)
  const activeMs = sessions.reduce((n, s) => n + (s.end - s.start), 0)

  // Source precedence. Sidecar events are exact, so when they exist the text-scraped
  // samples are DISCARDED rather than merged: mixing them would let a reconstructed
  // sample with an unresolvable abbreviation, or an hours-stale EXP report snapshot,
  // widen a skill's observed span and drag its rate the wrong way. One source of
  // truth per log.
  const fromEvents = streamEvents ? readExpEvents(streamEvents) : []
  const ticks   = fromEvents.length ? [] : readExpFragments(lines)
  const reports = fromEvents.length ? [] : readExpReports(lines)
  const samples = fromEvents.length ? fromEvents : [...ticks, ...reports]
  const skills  = skillProgress(samples)
  const totalRanks = skills.reduce((n, s) => n + s.ranksGained, 0)

  // Rate against ACTIVE time — idling in town shouldn't dilute a hunting session.
  // Fall back to wall time if every line landed in the same instant.
  const hours = (activeMs || wallMsOf(start, end)) / 3_600_000

  return {
    char: log.char, day: log.day, name: log.name,
    lineCount: lines.length,
    start, end,
    wallMs: end - start,
    activeMs,
    sessions,
    skills,
    totalRanks,
    ranksPerHour: hours > 0 ? totalRanks / hours : 0,
    expFromReportsOnly: ticks.length === 0 && reports.length > 0,
    expSource: fromEvents.length ? 'events' : samples.length ? 'text' : 'none',
    roomSource: streamEvents?.some(e => e.e === 'room') ? 'events' : 'text',
    rooms: roomStats(lines, idleMs, streamEvents),
    events: heuristicCounts(lines),
  }
}

function wallMsOf(start: number, end: number): number { return Math.max(0, end - start) }

// ── Combining several logs ──────────────────────────────────────────────────────

export interface Combined {
  logs:       Analysis[]
  chars:      string[]
  days:       string[]
  activeMs:   number
  totalRanks: number
  ranksPerHour: number
  /** Per-skill totals across every selected log. */
  skills:     { skill: string; ranksGained: number; perHour: number }[]
  rooms:      RoomStat[]
  kills:      { name: string; count: number }[]
  totalKills: number
  deaths:     number
  coins:      number
}

/**
 * Roll several analyzed logs into one view — this is what makes "every character in
 * one spot" more than a file picker. Per-skill gains ADD across logs (each log's
 * delta is independent), which is right even when the same skill appears in several.
 */
export function combine(list: Analysis[]): Combined {
  const skills = new Map<string, number>()
  const rooms  = new Map<string, RoomStat>()
  const kills  = new Map<string, number>()
  let activeMs = 0, deaths = 0, coins = 0

  for (const a of list) {
    activeMs += a.activeMs
    deaths   += a.events.deaths
    coins    += a.events.coins
    for (const s of a.skills) skills.set(s.skill, (skills.get(s.skill) ?? 0) + s.ranksGained)
    for (const r of a.rooms) {
      const cur = rooms.get(r.room) ?? rooms.set(r.room, { room: r.room, visits: 0, msSpent: 0 }).get(r.room)!
      cur.visits  += r.visits
      cur.msSpent += r.msSpent
    }
    for (const k of a.events.kills) kills.set(k.name, (kills.get(k.name) ?? 0) + k.count)
  }

  const hours = activeMs / 3_600_000
  const totalRanks = [...skills.values()].reduce((n, v) => n + v, 0)
  const killList = [...kills].map(([name, count]) => ({ name, count }))
                             .sort((a, b) => b.count - a.count)

  return {
    logs: list,
    chars: [...new Set(list.map(a => a.char))].sort(),
    days:  [...new Set(list.map(a => a.day).filter(Boolean))].sort(),
    activeMs,
    totalRanks,
    ranksPerHour: hours > 0 ? totalRanks / hours : 0,
    skills: [...skills].map(([skill, ranksGained]) => ({
      skill, ranksGained, perHour: hours > 0 ? ranksGained / hours : 0,
    })).sort((a, b) => b.ranksGained - a.ranksGained),
    rooms: [...rooms.values()].sort((a, b) => b.msSpent - a.msSpent),
    kills: killList,
    totalKills: killList.reduce((n, k) => n + k.count, 0),
    deaths,
    coins,
  }
}

// ── Formatting helpers (shared by the UI) ───────────────────────────────────────

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h ${m}m`
  // Trailing "0s" on a whole number of minutes is noise in a table of room times.
  if (m) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  return `${s}s`
}

export function fmtRanks(n: number): string {
  return n >= 10 ? n.toFixed(1) : n.toFixed(2)
}
