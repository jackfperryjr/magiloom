// Resolve a DR EXPERIENCE-window skill ABBREVIATION back to its canonical skill name.
//
// Why this exists: the live stream carries the full skill name in the tag
// (`<component id='exp Augmentation'>`) but only the ABBREVIATION in the visible
// text ("Aug:  305 66%  [ 1/34]"). Anything reading stripped/plain text — most
// importantly the log analyzer, which reads logs written after XML was stripped —
// sees only "Aug" and has to get back to "Augmentation".
//
// Deliberately NOT a hardcoded abbreviation table: DR's exact short forms are not
// documented anywhere authoritative and inventing one would silently mis-attribute
// experience. Instead we score the abbreviation against the canonical skill list
// (see expGroups.ts) using the two schemes DR actually uses — per-word prefixes
// ("L Armor" → Light Armor, "Aug" → Augmentation) and initials ("TM" → Targeted
// Magic) — and return null when the answer is ambiguous rather than guessing.
// Callers keep the raw abbreviation when we return null, so nothing is ever
// attributed to the wrong skill.
//
// If a real log turns up a short form neither scheme catches, add it to OVERRIDES
// rather than loosening the matcher.

import { EXP_GROUPS } from './expGroups'

/** Known-odd abbreviations that neither prefix nor initials matching resolves.
 *  Seeded empty on purpose — populate from real logs, not from guesswork. */
const OVERRIDES: Record<string, string> = {}

const ALL_SKILLS: string[] = EXP_GROUPS.flatMap(g => g.skills)

const norm = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

const EXACT = new Map<string, string>(ALL_SKILLS.map(s => [norm(s), s]))

// "Targeted Magic" → "tm". Only meaningful for multi-word skills.
const INITIALS = (() => {
  const m = new Map<string, string[]>()
  for (const s of ALL_SKILLS) {
    const words = norm(s).split(' ')
    if (words.length < 2) continue
    const key = words.map(w => w[0]).join('')
    const arr = m.get(key) ?? m.set(key, []).get(key)!
    arr.push(s)
  }
  return m
})()

/** Every word of `abbr` is a prefix of the corresponding word of `skill`, in order.
 *  "l armor" ⊑ "light armor"; "aug" ⊑ "augmentation"; "armor" ⊄ "light armor"
 *  (word counts must match, so a bare "armor" can't claim a two-word skill). */
function prefixMatches(abbr: string, skill: string): boolean {
  const a = abbr.split(' ')
  const s = norm(skill).split(' ')
  if (a.length !== s.length) return false
  return a.every((w, i) => s[i].startsWith(w))
}

/** How specific a prefix match is — total abbreviation characters matched. Used to
 *  break ties like "for" against Forging only (Foraging isn't a DR skill), and to
 *  prefer the tighter of two candidates when one abbreviation is a prefix of another. */
function specificity(abbr: string): number {
  return abbr.replace(/ /g, '').length
}

/**
 * Resolve an abbreviation to a canonical skill name, or null when unknown/ambiguous.
 * Full skill names pass through unchanged, so callers can feed either form.
 */
export function resolveSkillAbbrev(abbr: string): string | null {
  const key = norm(abbr)
  if (!key) return null

  if (OVERRIDES[key]) return OVERRIDES[key]

  const exact = EXACT.get(key)
  if (exact) return exact

  // Prefix scheme first — it's how most of the exp window reads. A single letter is
  // never enough evidence (a bare "L" would otherwise resolve to Locksmithing purely
  // because it happens to be the only one-word L skill, while the reader plainly
  // meant one of Light Armor / Light Edged / …), so require at least two characters.
  if (specificity(key) >= 2) {
    const byPrefix = ALL_SKILLS.filter(s => prefixMatches(key, s))
    if (byPrefix.length === 1) return byPrefix[0]
    if (byPrefix.length > 1) return null   // genuinely ambiguous
  }

  // Initials scheme ("tm", "ml"). Single-word abbreviations only; a multi-word
  // abbreviation that failed the prefix test is not going to be initials.
  if (!key.includes(' ')) {
    const byInitials = INITIALS.get(key)
    if (byInitials?.length === 1) return byInitials[0]
  }

  return null
}

/** True when `name` is a skill DR actually has (canonical name, not abbreviation). */
export function isKnownSkill(name: string): boolean {
  return EXACT.has(norm(name))
}

export { ALL_SKILLS }
export const _internals = { prefixMatches, specificity, norm }
