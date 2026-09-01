// Parses the human-readable "EXP" command report text, e.g.
//   "Climbing:    34  50%  Mind lock [340/900]    Forging:     5   0%  clear [0/10]"
// Shared by the main-output renderer and the side-panel store so both agree on one format.
export interface ParsedExpSkill { name: string; rank: string; pct: string; mind: string; frac: string }

// Ranks are matched with commas allowed — DR groups four-digit ranks ("1,305"), and
// a bare \d+ both truncated the number and left the "%"-anchored tail unmatched, so
// a capped skill dropped out of the report entirely.
export const EXP_SKILL_RE = /(\w[\w\s-]*?):\s+([\d,]+)\s+(\d+)%\s+(?:([a-zA-Z][a-zA-Z ]*?)\s+)?[[(](\d+\/\d+)[\])]/g

export function parseExpSkills(text: string): ParsedExpSkill[] {
  EXP_SKILL_RE.lastIndex = 0
  const skills: ParsedExpSkill[] = []
  let m: RegExpExecArray | null
  while ((m = EXP_SKILL_RE.exec(text)) !== null) {
    skills.push({ name: m[1].trim(), rank: m[2].replace(/,/g, ''), pct: m[3], mind: m[4]?.trim() ?? '', frac: m[5] })
  }
  return skills
}

// ── Rested experience ────────────────────────────────────────────────────────
// The report's rested-exp line:
//
//   "Rested EXP Stored: 4:21 hours  Usable This Cycle: 4:07 hours  Cycle Refreshes: 17:59 hours"
//
// It lives here, with the rest of the report, because the report text is the only
// place it actually arrives. DR declares a `<component id='exp rexp'>` that is
// plainly meant to carry it — Lich parses that component and nothing else — but
// in this client it comes through empty every time (81 of them in one logged
// session, not one with a body). The component is still read as a second source
// in case a future DR fills it; the text line is what feeds the panel today.
const REXP_RE = /Rested EXP Stored:\s*(.*?)\s*Usable This Cycle:\s*(.*?)\s*Cycle Refreshes:\s*(.*)$/i

export interface ParsedRestedExp { stored: number; usable: number; refresh: number }

/**
 * One rested-exp duration as seconds. Every figure is prose rather than a number
 * — "6 hours", "4:21 hours", "1:41 hour", "43 minutes", "less than a minute",
 * "none" — the colon form carries its own minutes, and the noun isn't reliably
 * pluralised. "less than a minute" counts as zero, as it does in Lich: the game
 * can sit on that phrasing for a long time and it isn't a usable amount.
 */
export function restedSeconds(raw: string): number {
  const t = raw.trim().toLowerCase()
  if (!t || t.includes('none') || t.includes('less than a minute')) return 0
  let secs = 0
  const hm = t.match(/(\d+)(?::(\d+))?\s*hour/)
  if (hm) {
    secs += +hm[1] * 3600
    if (hm[2]) return secs + +hm[2] * 60
  }
  const mm = t.match(/(\d+)\s*minute/)
  if (mm) secs += +mm[1] * 60
  return secs
}

/** The three figures, or null if this isn't the rested-exp line. */
export function parseRestedExp(text: string): ParsedRestedExp | null {
  const m = text.match(REXP_RE)
  if (!m) return null
  return { stored: restedSeconds(m[1]), usable: restedSeconds(m[2]), refresh: restedSeconds(m[3]) }
}
