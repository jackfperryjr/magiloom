/**
 * Item analyzer: find the microtransaction-event items in a pasted inventory.
 *
 * In DragonRealms the valuable things in a pile of gear aren't the ones made of rare
 * materials — at high circles agonite and lumium are ordinary. They're the ones that
 * came out of a SimuCoin event: end loot, auction and raffle prizes, and to a lesser
 * degree incidental drops. This matches each line of an INV LIST / HOME RECALL /
 * vault book paste against every item Elanthipedia lists for those events
 * (mtxItems.generated.ts) and estimates what it cost to earn AT THE EVENT, in
 * SimuCoins. That's deliberately not a resale price: player prices drift and aren't
 * recorded anywhere, event prices are.
 *
 * Pure functions, no DOM — tested in itemAnalyzer.test.ts.
 */

import type { MtxEvent, MtxKind, MtxRow } from './mtxItems.generated'

// ── Inventory parsing ─────────────────────────────────────────────────────────

export interface InvLine {
  /** The item as the game showed it, minus list punctuation: "a pale kirmiko pocket…" */
  text: string
  /** Section of the paste it came from: Carried, Home, Vault, Family vault, Pasted. */
  place: string
  /** The line it's nested under, when the paste shows nesting. */
  container: string | null
  count: number
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
}
const ITEM_START = /^(a|an|some|the|one|two|three|four|five|six|seven|eight|nine|ten)\s/i
/** A hand-written list item: "- item", "* item", "• item", "1. item", "1) item". */
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/

/**
 * Pull item lines out of a paste. Understands INV LIST (nesting by indent and "-"),
 * HOME RECALL ("Armor Stand: …" / "Attached: …") and READ VAULT BOOK. Anything that
 * doesn't start with an article is ignored, so stats, EXP and bank-book lines in the
 * same paste fall away on their own.
 *
 * Hand-written lists are the exception: people drop the article ("- matte indurium
 * sphere"), so a bulleted line counts as an item with or without one. The game never
 * puts a space after INV LIST's nesting "-" ("-an origami bolt"), so this doesn't
 * loosen what's read from game output. A trailing "(forge wand)"-style note is
 * dropped too; no event item's name ends in one.
 */
export function parseInventory(text: string): InvLine[] {
  const out: InvLine[] = []
  let place = 'Pasted'
  const stack: { indent: number; text: string }[] = []

  for (const raw of text.replace(/\r/g, '').split('\n')) {
    if (/^\s*You have:\s*$/i.test(raw) || /rummage about your person/i.test(raw)) { place = 'Carried'; stack.length = 0; continue }
    if (/The home contains:/i.test(raw)) { place = 'Home'; stack.length = 0; continue }
    if (/family vault/i.test(raw) && /inventory|contains/i.test(raw)) { place = 'Family vault'; stack.length = 0; continue }
    if (/Vault Inventory:/i.test(raw)) { place = 'Vault'; stack.length = 0; continue }
    if (/^\s*>/.test(raw)) continue

    const indent = raw.match(/^[\s-]*/)![0].length
    const bulleted = BULLET.test(raw)
    let s = raw.replace(BULLET, '').trim()
      .replace(/^-+\s*/, '')
      .replace(/^Attached:\s*/i, '')
      .replace(/^[A-Z][\w #()'/-]*?:\s+/, '')      // home furniture slot: "Armor Stand: …"
      .replace(/\s*\([^()]*\)\s*$/, '')             // "(closed)", "(forge wand)"
      .replace(/\.$/, '')
      .trim()
    if (!ITEM_START.test(s) && !(bulleted && /[a-z]/i.test(s))) continue

    let count = 1
    const n = s.match(/^(\w+)\s/)
    if (n && NUMBER_WORDS[n[1].toLowerCase()] && !/^one\b/i.test(s)) count = NUMBER_WORDS[n[1].toLowerCase()]
    s = s.replace(/\s+/g, ' ')

    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    out.push({ text: s, place, container: stack.length ? stack[stack.length - 1].text : null, count })
    stack.push({ indent, text: s })
  }
  return out
}

// ── Normalising and matching ─────────────────────────────────────────────────

const LEAD = /^(a|an|some|the|one|two|three|four|five|six|seven|eight|nine|ten)\s+/
const STOP = new Set(['a', 'an', 'some', 'the', 'of', 'with', 'and', 'in', 'on', 'to', 'by', 'from', 'its', 'their', 'his', 'her'])

/** Lowercase, drop punctuation, leading articles/counts and "pair(s) of". */
export function normalize(s: string): string {
  let t = s.toLowerCase().replace(/[^a-z0-9'\- ]/g, ' ').replace(/\s+/g, ' ').trim()
  while (LEAD.test(t)) t = t.replace(LEAD, '')
  return t.replace(/^(pairs?|sets?) of\s+/, '')
}

const tokens = (s: string): string[] => normalize(s).split(' ').filter(w => w && !STOP.has(w))

export interface Listing {
  name: string
  kind: MtxKind
  event: MtxEvent
  /** Event subpage the listing is on: "End Loot", "Incidental loot", "Raffle"… */
  source: string
  price: number | null
  /** Where the price falls among that page's prices, 0–100. */
  pct: number | null
  note: string | null
  /** Estimated SimuCoins to earn it at the event; null when the event has no rate. */
  scLo: number | null
  scHi: number | null
}

export type Tier = 'prize' | 'shop' | 'drop' | 'possible'

export const TIER_LABEL: Record<Tier, string> = {
  prize:    'Auction / raffle',
  shop:     'Event shop',
  drop:     'Event drop',
  possible: 'Possible match',
}

export interface Appraisal {
  text: string
  count: number
  /** "Carried", "Vault ×2", … */
  places: string[]
  container: string | null
  tier: Tier
  /** The listing that drives the estimate (most recent priced one, else the best). */
  best: Listing
  listings: Listing[]
  /** Fuzzy matches only: how close, 0–1. */
  similarity?: number
  /** Drops with very short names ("onyx chunk") are often ordinary items too. */
  generic: boolean
}

const KIND_RANK: Record<MtxKind, number> = { auction: 5, raffle: 4, shop: 3, bundle: 2, listed: 1, incidental: 0 }

function tierOf(listings: Listing[]): Tier {
  if (listings.some(l => l.kind === 'auction' || l.kind === 'raffle')) return 'prize'
  if (listings.some(l => l.kind === 'shop' || l.kind === 'bundle')) return 'shop'
  return 'drop'
}

/** The Elanthian year in an event name — "Drathrok's Duskruin 452" → 452. */
const yearOf = (e: MtxEvent): number => +(e.name.match(/\b(\d{3})\b/)?.[1] ?? 0)

function pickBest(listings: Listing[]): Listing {
  // Prefer something with a SimuCoin estimate, most recent event first: what it costs
  // now beats what it cost in 419. Otherwise the highest-signal kind, then percentile.
  const priced = listings.filter(l => l.scLo != null)
  if (priced.length) return priced.sort((a, b) => yearOf(b.event) - yearOf(a.event) || (b.scHi! - a.scHi!))[0]
  return [...listings].sort((a, b) => KIND_RANK[b.kind] - KIND_RANK[a.kind] || (b.pct ?? -1) - (a.pct ?? -1))[0]
}

export interface MtxIndex {
  exact: Map<string, Listing[]>
  names: { name: string; toks: string[] }[]
}

export function buildIndex(rows: MtxRow[], events: MtxEvent[]): MtxIndex {
  const exact = new Map<string, Listing[]>()
  for (const [name, kind, ev, source, price, pct, note] of rows) {
    const event = events[ev]
    const rated = price != null && event.scLo != null && (kind === 'shop' || kind === 'bundle')
    const l: Listing = {
      name, kind, event, source, price, pct, note,
      scLo: rated ? Math.round(price! * event.scLo!) : null,
      scHi: rated ? Math.round(price! * event.scHi!) : null,
    }
    const key = normalize(name)
    if (!exact.has(key)) exact.set(key, [])
    exact.get(key)!.push(l)
  }
  const names = [...exact.keys()].map(name => ({ name, toks: tokens(name) })).filter(n => n.toks.length >= 3)
  return { exact, names }
}

const FUZZY_MIN = 0.5

export function appraise(lines: InvLine[], index: MtxIndex): Appraisal[] {
  // Group identical lines, keeping where each copy lives.
  const groups = new Map<string, { text: string; count: number; places: Map<string, number>; container: string | null }>()
  for (const l of lines) {
    const key = normalize(l.text)
    const g = groups.get(key) ?? { text: l.text, count: 0, places: new Map(), container: l.container }
    g.count += l.count
    g.places.set(l.place, (g.places.get(l.place) ?? 0) + l.count)
    groups.set(key, g)
  }

  const out: Appraisal[] = []
  for (const [key, g] of groups) {
    const places = [...g.places].map(([p, n]) => (n > 1 ? `${p} ×${n}` : p))
    const base = { text: g.text, count: g.count, places, container: g.container }
    const hit = index.exact.get(key)
    if (hit) {
      const tier = tierOf(hit)
      out.push({ ...base, tier, best: pickBest(hit), listings: hit, generic: tier === 'drop' && tokens(key).length <= 2 })
      continue
    }
    const t = tokens(g.text)
    if (t.length < 4) continue
    let bestSim = 0
    let bestName: string | null = null
    for (const n of index.names) {
      let inter = 0
      for (const w of n.toks) if (t.includes(w)) inter++
      const sim = inter / (new Set([...t, ...n.toks]).size)
      if (sim > bestSim) { bestSim = sim; bestName = n.name }
    }
    if (bestName && bestSim >= FUZZY_MIN) {
      const listings = index.exact.get(bestName)!
      out.push({ ...base, tier: 'possible', best: pickBest(listings), listings, similarity: bestSim, generic: false })
    }
  }

  const TIER_ORDER: Record<Tier, number> = { prize: 0, shop: 1, possible: 2, drop: 3 }
  return out.sort((a, b) =>
    TIER_ORDER[a.tier] - TIER_ORDER[b.tier]
    || (b.best.scHi ?? -1) - (a.best.scHi ?? -1)
    || (b.best.pct ?? -1) - (a.best.pct ?? -1)
    || a.text.localeCompare(b.text))
}

// ── Display and export ────────────────────────────────────────────────────────

export const usd = (sc: number): string => `$${(sc / 100).toFixed(sc < 1000 ? 2 : 0)}`

/** "~3,500 SC" or "~1,200–6,000 SC"; null when there's no estimate. */
export function scRange(l: Listing, count = 1): string | null {
  if (l.scLo == null || l.scHi == null) return null
  const lo = l.scLo * count
  const hi = l.scHi * count
  return lo === hi ? `~${lo.toLocaleString()} SC` : `~${lo.toLocaleString()}–${hi.toLocaleString()} SC`
}

export function usdRange(l: Listing, count = 1): string | null {
  if (l.scLo == null || l.scHi == null) return null
  const lo = l.scLo * count
  const hi = l.scHi * count
  return lo === hi ? usd(lo) : `${usd(lo)}–${usd(hi)}`
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Appraisal[]): string {
  const head = [
    'Tier', 'Item', 'Count', 'Where', 'Container', 'Matched listing', 'Similarity',
    'Event', 'Source', 'Kind', 'Event price', 'Currency', 'Price percentile',
    'Est SC (low, each)', 'Est SC (high, each)', 'Est USD (low, each)', 'Est USD (high, each)',
    'Rate basis', 'Note', 'Other events',
  ]
  const lines = [head.join(',')]
  for (const a of rows) {
    const b = a.best
    const others = [...new Set(a.listings.map(l => l.event.name))].filter(n => n !== b.event.name)
    lines.push([
      TIER_LABEL[a.tier] + (a.generic ? ' (generic name)' : ''), a.text, a.count, a.places.join('; '), a.container,
      b.name, a.similarity != null ? a.similarity.toFixed(2) : '',
      b.event.name, b.source, b.kind, b.price, b.event.currency, b.pct,
      b.scLo, b.scHi, b.scLo != null ? (b.scLo / 100).toFixed(2) : '', b.scHi != null ? (b.scHi / 100).toFixed(2) : '',
      b.scLo != null ? b.event.rateHow : '', b.note, others.join('; '),
    ].map(csvCell).join(','))
  }
  return lines.join('\r\n')
}
