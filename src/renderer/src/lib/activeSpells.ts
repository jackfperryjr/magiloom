// Active-spell list lines, from DR's percWindow.
//
// DR emits the list as bare lines after <clearStream id="percWindow"/>, one per
// buff, name then two spaces then a parenthesised duration. Thief khri ride the
// same list ("Khri Hasten  (12 roisaen)"), which is how Lich tracks them too. The
// duration comes in several shapes; the first two are confirmed in raw logs, the
// rest are what Lich's own parser handles (lib/common/xmlparser.rb):
//
//   Skein of Shadows  (28 roisaen)
//   Bloodthorns  (1 roisan)          ← SINGULAR in the final roisaen
//   Bloodthorns  (Fading)            ← under a minute left
//   Hydra Hex  (Indefinite)
//   Persistence of Mana  (OM)
//   Osrel Meraud  (94%)
//
// Missing any of these doesn't just hide the row: the unmatched line falls through
// into the main game window as stray text.

export type SpellDuration = 'timed' | 'fading' | 'indefinite' | 'percent'

export interface ActiveSpell {
  name: string
  kind: SpellDuration
  roisaen: number   // timed only (0 otherwise)
  percent: number   // percent only (0 otherwise)
  expires: number   // epoch-ms, stamped at commit; timed and fading only
}

const LINE_RE = /^(.+?)\s+\((?:(\d+)\s+roisae?n|(Fading)|(Indefinite|OM)|(\d+)%)\)\s*$/i

/**
 * Parse one percWindow line. `inSnapshot` is whether a percWindow refresh is in
 * progress: the roisaen and Fading shapes are specific enough to trust anywhere,
 * but "(Indefinite)", "(OM)" and "(94%)" look like ordinary text, so they only
 * count once the list has opened.
 */
export function parseActiveSpellLine(text: string, inSnapshot: boolean): ActiveSpell | null {
  const m = LINE_RE.exec(text.trim())
  if (!m) return null
  const name = m[1].trim()
  const base = { name, roisaen: 0, percent: 0, expires: 0 }
  if (m[2] !== undefined) return { ...base, kind: 'timed', roisaen: parseInt(m[2], 10) }
  if (m[3] !== undefined) return { ...base, kind: 'fading' }
  if (!inSnapshot) return null
  if (m[4] !== undefined) return { ...base, kind: 'indefinite' }
  return { ...base, kind: 'percent', percent: Math.min(100, parseInt(m[5], 10)) }
}
