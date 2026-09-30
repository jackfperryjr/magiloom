// Wealth, debt and active purchases, read from the game's own report text.
//
// Two commands print it. WEALTH prints just the coin section; INFO prints the
// same section followed by Debt and active purchases. Both are plain lines inside
// an <output class="mono"/> block (shapes below copied from real logs):
//
//   Wealth:
//     No Kronars.
//     1 gold, 6 silver, 5 bronze, and 68 copper Lirums (1718 copper Lirums).
//     2 platinum, 56 gold, 288 silver, 425 bronze, and 382 copper Dokoras (109432 copper Dokoras).
//   Debt:
//     You owe 1 gold, 2 silver, 3 bronze, and 4 copper Dokoras to the Domain of Ilithi. (1234 copper Dokoras)
//     [You can pay off this debt in person at the respective provincial debt office or ...]
//   You have 2 active purchases:
//     Urchin Runners (limited use), charges remaining: 1
//     Urchin Guides, charges remaining: 9
//
// Denominations are omitted when zero, the Oxford comma comes and goes ("N silver
// and N bronze"), and the parenthesised copper total is occasionally missing, so
// the total is recomputed from the coins when it is.

export const CURRENCIES = ['Kronars', 'Lirums', 'Dokoras'] as const
export type Currency = typeof CURRENCIES[number]

export const DENOMS = ['platinum', 'gold', 'silver', 'bronze', 'copper'] as const
export type Denom = typeof DENOMS[number]
export type Coins = Record<Denom, number>

/** Value of one coin of each denomination, in coppers. */
const COPPER: Coins = { platinum: 10_000, gold: 1_000, silver: 100, bronze: 10, copper: 1 }

export interface Holding { coins: Coins; copper: number }
export interface DebtEntry { to: string; currency: Currency; coins: Coins; copper: number }
export interface Purchase { name: string; charges: number | null }

export interface WealthReport {
  /** Every currency the report listed; "No Kronars." is a zero holding. */
  currencies: Partial<Record<Currency, Holding>>
  /** null = this report had no Debt section (a WEALTH, not an INFO). */
  debt: DebtEntry[] | null
  /** null = this report had no purchases section. */
  purchases: Purchase[] | null
}

const emptyCoins = (): Coins => ({ platinum: 0, gold: 0, silver: 0, bronze: 0, copper: 0 })

/** "2 platinum, 56 gold, …, and 382 copper" → coins. Unrecognised text yields all zeros. */
export function parseCoins(text: string): Coins {
  const coins = emptyCoins()
  for (const m of text.matchAll(/(\d[\d,]*)\s+(platinum|gold|silver|bronze|copper)\b/gi)) {
    coins[m[2].toLowerCase() as Denom] += parseInt(m[1].replace(/,/g, ''), 10)
  }
  return coins
}

export const coinsToCopper = (c: Coins): number =>
  DENOMS.reduce((sum, d) => sum + c[d] * COPPER[d], 0)

const CUR = '(Kronars|Lirums|Dokoras)'
const HEADER_RE    = /^Wealth:\s*$/
const NONE_RE      = new RegExp(`^No ${CUR}\\.$`)
const HOLDING_RE   = new RegExp(`^(.+?)\\s+${CUR}(?:\\s+\\((\\d[\\d,]*) copper \\2\\))?\\.$`)
const DEBT_HEAD_RE = /^Debt:\s*$/
const NO_DEBT_RE   = /^No debt\.$/i
const OWE_RE       = new RegExp(`^You owe (.+?)\\s+${CUR} to (?:the )?(.+?)\\.\\s*(?:\\((\\d[\\d,]*) copper \\2\\))?$`)
const PURCH_HEAD_RE = /^You have (\d+|no) active purchases?[:.]\s*$/i
const CHARGES_RE   = /^(.+?),\s*charges remaining:\s*(\d+)$/i

type Section = 'wealth' | 'debt' | 'purchases'

/**
 * Line-at-a-time reader. Call `start()` when a line is the "Wealth:" header, then
 * `feed()` every following line until it returns false; `report` is the result.
 * Blank lines are accepted and skipped, so a stray one inside the block can't end it.
 */
export class WealthReader {
  report: WealthReport = { currencies: {}, debt: null, purchases: null }
  private section: Section = 'wealth'

  static isHeader(line: string): boolean { return HEADER_RE.test(line.trim()) }

  /** True if the line belonged to the block (and was consumed). */
  feed(raw: string): boolean {
    const line = raw.trim()
    if (!line) return true
    if (DEBT_HEAD_RE.test(line)) { this.section = 'debt'; this.report.debt = []; return true }
    const ph = PURCH_HEAD_RE.exec(line)
    if (ph) { this.section = 'purchases'; this.report.purchases = []; return true }

    // Every entry line is indented under its heading; an unindented line that
    // isn't a heading is the next thing the game printed.
    if (!/^\s/.test(raw)) return false

    switch (this.section) {
      case 'wealth': {
        const none = NONE_RE.exec(line)
        if (none) { this.report.currencies[none[1] as Currency] = { coins: emptyCoins(), copper: 0 }; return true }
        const h = HOLDING_RE.exec(line)
        if (!h) return false
        const coins = parseCoins(h[1])
        const copper = h[3] ? parseInt(h[3].replace(/,/g, ''), 10) : coinsToCopper(coins)
        this.report.currencies[h[2] as Currency] = { coins, copper }
        return true
      }
      case 'debt': {
        if (NO_DEBT_RE.test(line) || line.startsWith('[')) return true   // the "pay it off" hint
        const o = OWE_RE.exec(line)
        if (!o) return false
        const coins = parseCoins(o[1])
        const copper = o[4] ? parseInt(o[4].replace(/,/g, ''), 10) : coinsToCopper(coins)
        this.report.debt!.push({ to: o[3], currency: o[2] as Currency, coins, copper })
        return true
      }
      case 'purchases': {
        const c = CHARGES_RE.exec(line)
        this.report.purchases!.push(c ? { name: c[1], charges: parseInt(c[2], 10) } : { name: line, charges: null })
        return true
      }
    }
  }
}

/**
 * Fold a new report into the last one. A WEALTH carries no Debt or purchases
 * section, so those keep whatever the last INFO said rather than blanking.
 */
export function mergeWealth(prev: WealthReport | null, next: WealthReport): WealthReport {
  return {
    currencies: { ...(prev?.currencies ?? {}), ...next.currencies },
    debt:       next.debt      ?? prev?.debt      ?? null,
    purchases:  next.purchases ?? prev?.purchases ?? null,
  }
}

/** "2p 56g 288s 425b 382c" — the compact form players write. Zero shows as "none". */
export function formatCoins(c: Coins): string {
  const parts = DENOMS.filter(d => c[d] > 0).map(d => `${c[d].toLocaleString()}${d[0]}`)
  return parts.length ? parts.join(' ') : 'none'
}

/** Headline figure for a tile: the value in platinum, e.g. 109432 copper → "10.9". */
export function platLabel(copper: number): string {
  if (copper <= 0) return '—'
  const p = copper / COPPER.platinum
  if (p >= 100) return Math.round(p).toLocaleString()
  if (p >= 10)  return p.toFixed(1)
  return p.toFixed(2)
}
