/**
 * Wealth report reader tests.
 *
 * Every report line is copied verbatim from real DR logs (Jackreous, Penello,
 * Refia; 2026-07), including the irregular ones: no Oxford comma, no parenthesised
 * total, a denomination list with gaps. The INFO fixture is a real INFO tail.
 *
 * Run: npm run test:tools
 */

import { WealthReader, mergeWealth, parseCoins, coinsToCopper, formatCoins, platLabel, type WealthReport } from './wealth'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

/** Feed a block (header first) and return the report plus the first line it rejected. */
function read(lines: string[]): { report: WealthReport; stoppedAt: string | null } {
  const [head, ...rest] = lines
  check(`header recognised: ${head}`, WealthReader.isHeader(head))
  const r = new WealthReader()
  for (const l of rest) if (!r.feed(l)) return { report: r.report, stoppedAt: l }
  return { report: r.report, stoppedAt: null }
}

// ── A standalone WEALTH ──────────────────────────────────────────────────────
{
  const { report, stoppedAt } = read([
    'Wealth:',
    '  50476 platinum, 1926 gold, 1897 silver, 1875 bronze, and 1843 copper Kronars (506896293 copper Kronars).',
    '  1 gold, 6 silver, 5 bronze, and 68 copper Lirums (1718 copper Lirums).',
    '  1 gold, 9 silver, 4 bronze, and 49 copper Dokoras (1989 copper Dokoras).',
    'You go out.',
  ])
  eq('WEALTH: kronars total from the parenthesis', report.currencies.Kronars?.copper, 506896293)
  eq('WEALTH: lirum coins', report.currencies.Lirums?.coins, { platinum: 0, gold: 1, silver: 6, bronze: 5, copper: 68 })
  eq('WEALTH: dokoras', report.currencies.Dokoras?.copper, 1989)
  eq('WEALTH: no debt section → null (keep the last INFO\'s)', report.debt, null)
  eq('WEALTH: no purchases section → null', report.purchases, null)
  eq('WEALTH: block ends at the next unindented game line', stoppedAt, 'You go out.')
}

// ── An INFO tail: none-lines, debt, purchases ────────────────────────────────
{
  const { report, stoppedAt } = read([
    'Wealth:',
    '  No Kronars.',
    '  No Lirums.',
    '  2 platinum, 56 gold, 288 silver, 425 bronze, and 382 copper Dokoras (109432 copper Dokoras).',
    'Debt:',
    '  No debt.',
    'You have 2 active purchases:',
    '  Urchin Runners (limited use), charges remaining: 1',
    '  Urchin Guides, charges remaining: 9',
    'Account Info for ZANARKAND:',
  ])
  eq('INFO: "No Kronars." is a zero holding', report.currencies.Kronars?.copper, 0)
  eq('INFO: dokoras', report.currencies.Dokoras?.copper, 109432)
  eq('INFO: "No debt." → empty list', report.debt, [])
  eq('INFO: purchases with charges', report.purchases, [
    { name: 'Urchin Runners (limited use)', charges: 1 },
    { name: 'Urchin Guides', charges: 9 },
  ])
  eq('INFO: stops at the next command\'s output', stoppedAt, 'Account Info for ZANARKAND:')
}

// ── Debt owed ────────────────────────────────────────────────────────────────
{
  const { report } = read([
    'Wealth:',
    '  No Dokoras.',
    'Debt:',
    '  You owe 1 gold, 2 silver, 3 bronze, and 4 copper Dokoras to the Domain of Ilithi. (1234 copper Dokoras)',
    '  [You can pay off this debt in person at the respective provincial debt office or by calling for an urchin runner with BANK DEBT.]',
    'You have 1 active purchase:',
    '  Urchin Runners (limited use), charges remaining: 1',
  ])
  eq('debt entry', report.debt, [{ to: 'Domain of Ilithi', currency: 'Dokoras',
    coins: { platinum: 0, gold: 1, silver: 2, bronze: 3, copper: 4 }, copper: 1234 }])
  eq('singular "1 active purchase"', report.purchases?.length, 1)
}

// ── Irregular coin lines ─────────────────────────────────────────────────────
{
  const one = (l: string) => { const r = new WealthReader(); r.feed(l); return r.report.currencies }
  eq('no Oxford comma', one('  12 gold, 3 silver and 4 bronze Dokoras (12340 copper Dokoras).').Dokoras?.copper, 12340)
  eq('missing parenthesised total → recomputed', one('  1 platinum, 2 gold, 3 silver, 4 bronze, and 5 copper Kronars.').Kronars?.copper, 12345)
  eq('single denomination', one('  7 gold Dokoras (7000 copper Dokoras).').Dokoras?.coins.gold, 7)
  eq('gaps in the list', one('  3 platinum, 1 gold, 2 bronze, and 9 copper Dokoras (31029 copper Dokoras).').Dokoras?.coins,
    { platinum: 3, gold: 1, silver: 0, bronze: 2, copper: 9 })
}

// ── Not part of a block ──────────────────────────────────────────────────────
{
  const r = new WealthReader()
  check('blank lines are skipped, not a terminator', r.feed(''))
  check('an unindented prose line ends the block', !r.feed('The clerk counts out 12 gold Dokoras and hands them over, making a notation in her ledger.'))
  check('"Wealth" in prose is not a header', !WealthReader.isHeader('Wealth: 12 gold'))
}

// ── Merge: a WEALTH keeps the last INFO's debt/purchases ─────────────────────
{
  const info: WealthReport = { currencies: { Dokoras: { coins: parseCoins('5 gold'), copper: 5000 } },
    debt: [], purchases: [{ name: 'Urchin Guides', charges: 9 }] }
  const wealth: WealthReport = { currencies: { Dokoras: { coins: parseCoins('6 gold'), copper: 6000 } },
    debt: null, purchases: null }
  const m = mergeWealth(info, wealth)
  eq('merge: coins take the newer report', m.currencies.Dokoras?.copper, 6000)
  eq('merge: debt survives a WEALTH', m.debt, [])
  eq('merge: purchases survive a WEALTH', m.purchases?.[0]?.charges, 9)
}

// ── Formatting ───────────────────────────────────────────────────────────────
eq('coinsToCopper', coinsToCopper(parseCoins('2 platinum, 56 gold, 288 silver, 425 bronze, and 382 copper')), 109432)
eq('formatCoins', formatCoins(parseCoins('2 platinum, 56 gold, 425 bronze')), '2p 56g 425b')
eq('formatCoins none', formatCoins(parseCoins('')), 'none')
eq('platLabel small', platLabel(1989), '0.20')
eq('platLabel mid', platLabel(109432), '10.9')
eq('platLabel large', platLabel(506896293), (50690).toLocaleString())
eq('platLabel zero', platLabel(0), '—')

if (failures.length) {
  console.error(`✗ wealth: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ wealth: ${passed} passed`)
