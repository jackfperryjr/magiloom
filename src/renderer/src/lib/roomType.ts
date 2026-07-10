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
  { type: 'healer', re: /\bempath\b|house of the healer/ },
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

export function roomType(n: TypeableRoom): RoomType | null {
  const titleish = `${n.title} ${n.note ?? ''} ${n.tag ?? ''}`.toLowerCase()
  for (const { type, re } of TITLE_RULES) if (re.test(titleish)) return type
  const body = (n.descriptions?.[0] ?? '').toLowerCase()
  for (const { type, re } of BODY_RULES) if (re.test(body)) return type
  return null
}

// The fill colour for a node: an explicit user colour wins, else the derived
// room-type colour, else undefined (default node style).
export function nodeFill(n: TypeableRoom & { color?: string }): string | undefined {
  if (n.color) return n.color
  const t = roomType(n)
  return t ? ROOM_TYPE_META[t].color : undefined
}
