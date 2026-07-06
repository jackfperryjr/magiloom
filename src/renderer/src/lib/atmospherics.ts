import { ATMO_MESSAGES } from './atmospherics.generated'

// Atmospheric-item messages (https://elanthipedia.play.net/Category:Atmospheric_items)
// have no stream tag in DR — they arrive as plain narrative on the main stream —
// so the Atmo panel is fed by matching their (verbatim) text.
//
// The bulk list in ./atmospherics.generated.ts is produced by
// scripts/scrape-atmospherics.js (re-run periodically to refresh). Add anything
// the wiki is missing to MANUAL below; both are matched the same way.
const MANUAL: string[] = []

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

// Messages contain placeholders the game substitutes per emitter: <Player>,
// <Player's>, <his/her>, [Location], etc. Split on them and rejoin the literal
// parts with a wildcard so the pattern matches any owner (you or another player).
const PLACEHOLDER = /<[^>]*>|\[[^\]]*\]/
const hasPlaceholder = (s: string) => PLACEHOLDER.test(s)

function toRegex(tpl: string): RegExp {
  const literal = norm(tpl)
    .split(new RegExp(PLACEHOLDER.source, 'g'))
    .map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('.+?')
  return new RegExp('^' + literal + '$', 'i')
}

const all = [...ATMO_MESSAGES, ...MANUAL]
// Placeholder-free messages match exactly (fast Set lookup); the rest need a
// per-message regex, tested only when the exact lookup misses.
const EXACT    = new Set(all.filter(m => !hasPlaceholder(m)).map(norm))
const PATTERNS = all.filter(hasPlaceholder).map(toRegex)

export function isAtmospheric(text: string): boolean {
  const t = norm(text)
  if (EXACT.has(t)) return true
  return PATTERNS.some(re => re.test(t))
}
