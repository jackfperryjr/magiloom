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
