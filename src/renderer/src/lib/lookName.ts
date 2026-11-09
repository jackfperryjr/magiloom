// Work out whose LOOK this is, so the portrait is keyed to the character's first
// name and never to a title. "You see Paintress Catheroine Rotschreck, a Human."
// must give "Catheroine", not "Paintress" (title) or "Rotschreck" (surname).

import { DR_TITLES } from './drTitles.generated'

const TITLE_SET = new Set(DR_TITLES.map(t => t.toLowerCase()))
const MAX_TITLE_WORDS = Math.max(...DR_TITLES.map(t => t.split(/\s+/).length))

// Remove a leading title ("Paintress", "Adviser to the Twelve") from `s`. Only strips
// when a capitalised word follows it: many titles are also plausible names ("Abra",
// "Alpha"), and "Abra has a soft face" must keep Abra as the name.
export function stripLeadingTitle(s: string): string {
  const words = s.trim().split(/\s+/)
  for (let n = Math.min(MAX_TITLE_WORDS, words.length - 1); n >= 1; n--) {
    const candidate = words.slice(0, n).join(' ').replace(/,$/, '').toLowerCase()
    if (TITLE_SET.has(candidate) && /^[A-Z]/.test(words[n])) return words.slice(n).join(' ')
  }
  return s.trim()
}

// Pronouns can lead a description line but are never the name.
const PRONOUN_RE = /^(?:He|She|They|It|His|Her|Their|Its)$/

function leadingName(s: string | undefined): string {
  const w = s ? stripLeadingTitle(s).match(/^([A-Z][\w'-]+)/)?.[1] ?? '' : ''
  return PRONOUN_RE.test(w) ? '' : w
}

// Name for a LOOK at another (non-hazed, non-shrouded) character. The description
// body leads with the given name ("Catheroine has …"), so it wins — it skips both
// titles and surnames and resolves abbreviated looks ("l mits" → "Mitsuri has …").
// Without one, use the "You see" line with any title stripped; then what was typed.
export function lookCharacterName(lines: string[], typedTarget = ''): string {
  const seen = (lines[0] ?? '').match(/^You see\s+(.*)$/)?.[1]
  return leadingName(lines[1])
      || leadingName(seen)
      || typedTarget
      || ''
}
