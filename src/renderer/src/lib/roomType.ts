/**
 * Heuristic room-type classification for map colouring. DR room titles alone rarely
 * say what a room is, so we scan the title + first description + user note/tag for
 * distinctive keywords. Purely cosmetic (colours + legend); a manually-set node
 * colour always wins over the derived type. Kept conservative to limit false hits.
 */

export type RoomType = 'bank' | 'shop' | 'guild' | 'healer' | 'inn' | 'travel'

export const ROOM_TYPE_META: Record<RoomType, { label: string; color: string }> = {
  bank:   { label: 'Bank',    color: '#e0b050' },
  shop:   { label: 'Shop',    color: '#6bc5a0' },
  guild:  { label: 'Guild',   color: '#7b8fe8' },
  healer: { label: 'Healer',  color: '#e06060' },
  inn:    { label: 'Inn',     color: '#c78bd8' },
  travel: { label: 'Travel',  color: '#5fbcd4' },
}

// Ambiguous words (bank/shop/inn) only count in the room TITLE or a user note/tag —
// matching them in prose descriptions mis-tags rooms ("the west bank of the river").
// Ordered so more-specific types win when several could match.
const TITLE_RULES: { type: RoomType; re: RegExp }[] = [
  { type: 'bank',   re: /\bbank\b/ },
  { type: 'healer', re: /\bhealer\b|\bempath\b|infirmary/ },
  { type: 'guild',  re: /\bguild\b/ },
  { type: 'inn',    re: /\binn\b|\btavern\b|alehouse/ },
  { type: 'travel', re: /\bdocks?\b|\bpiers?\b|\bstables?\b|shipyard|\bwagon\b|\bcarriage\b|\bferry\b|caravan/ },
  { type: 'shop',   re: /\bshop\b|\bstore\b|emporium|pawnshop|\bwares\b|\bsmithy\b|\bforge\b/ },
]
// Strong, unambiguous signals that are safe to detect anywhere (incl. description).
const BODY_RULES: { type: RoomType; re: RegExp }[] = [
  { type: 'bank',   re: /\btellers?\b|money[- ]?changer/ },
  // NOT a bare "empath": auditing showed prose mentions of an empath colouring
  // ordinary rooms as infirmaries. Only the named building counts.
  { type: 'healer', re: /house of the healer|healer's? (?:house|hall|cave|hut)/ },
  { type: 'guild',  re: /guildleader|guild ?master/ },
  { type: 'inn',    re: /taproom/ },
  { type: 'travel', re: /shipyard/ },
]

export interface TypeableRoom {
  title:        string
  descriptions?: string[]
  note?:        string
  tag?:         string
}

// Thoroughfares are routinely NAMED for what stands on them — "Bank Street",
// "Smithy Lane", "Asemath Walk", "Theren Way". Auditing the classifier over the
// whole shipped room corpus, these were most of its mistakes: a street would take
// the colour of the business it is named after, so a town read as a row of banks.
// A room whose title ends in a road word is a place you walk THROUGH, so it never
// takes an establishment type from its name.
//
// The user's own note/tag is deliberately still honoured below: if someone labels
// a stretch of road, that is a deliberate statement about their map, not a guess.
const THOROUGHFARE = /\b(?:street|lane|way|walk|road|avenue|alley|path|boulevard|bridge|stair(?:s|way)?|steps|trail|pike|row)\s*\]?\s*$/

// The other half of the same problem, and the one the bank rule was always at risk
// of: a "bank" is as often the edge of water as a place that holds coin. Auditing
// turned up "[Stream Bank]" and "[Northern Trade Road, River's Bank]" wearing the
// bank colour. Water context disqualifies the money reading.
const WATER_BANK = /\b(?:river|stream|creek|brook|lake|pond|shore|canal|water)(?:'s)?[- ]?bank\b|\bbank of the\b/

export function roomType(n: TypeableRoom): RoomType | null {
  const title = n.title.toLowerCase()
  const marks = `${n.note ?? ''} ${n.tag ?? ''}`.toLowerCase().trim()
  // A user mark always wins — it is an explicit claim about this room.
  if (marks) for (const { type, re } of TITLE_RULES) if (re.test(marks)) return type

  if (!THOROUGHFARE.test(title)) {
    for (const { type, re } of TITLE_RULES) {
      if (!re.test(title)) continue
      if (type === 'bank' && WATER_BANK.test(title)) continue   // a riverbank, not a vault
      return type
    }
  }

  // Description matching stays for the unambiguous signals only, and never for a
  // thoroughfare: prose is where false positives hide (a road that merely mentions
  // an empath was typed as a healer).
  if (THOROUGHFARE.test(title)) return null
  const body = (n.descriptions?.[0] ?? '').toLowerCase()
  for (const { type, re } of BODY_RULES) if (re.test(body)) return type
  return null
}

// The fill colour for a node: an explicit user colour wins, else the derived
// room-type colour, else undefined (default node style). The sentinel 'none' is an
// explicit "plain" override that suppresses the auto room-type colour too.
export function nodeFill(n: TypeableRoom & { color?: string }): string | undefined {
  if (n.color === 'none') return undefined
  if (n.color) return n.color
  const t = roomType(n)
  return t ? ROOM_TYPE_META[t].color : undefined
}
