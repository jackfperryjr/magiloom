/**
 * Account inventory — capture off the stream, the store, and search.
 *
 * Three things are being protected here:
 *
 *   1. A report is captured whole, and only a real one is. The store REPLACES a
 *      character's list with whatever is captured, so mistaking something else for
 *      a report (plain INVENTORY, a LOOK IN a bag) silently deletes what was known.
 *   2. Reports land where they belong: per character, the family vault per account,
 *      and one character's write never disturbs another's.
 *   3. Search says which bag. Finding that someone has the thing is half an answer.
 *
 * The stream text is from real captures, run through the real parser.
 *
 * Run: npm run test:tools
 */

import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { parseLine, resetParser, type GameEvent } from './sge-parser'
import {
  HoldingsReader, holdingsView, searchSnapshot, ageLabel, holdingsText, holdingsFileName, stamp,
  type HoldingsCapture,
} from './holdings'
import { HoldingsStore } from '../../../main/holdings-store'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

type TextEvent = Extract<GameEvent, { type: 'text' }>
/** Run raw stream lines through the parser into a reader, as the store does. */
function read(reader: HoldingsReader, raw: string[]): HoldingsCapture | null {
  let got: HoldingsCapture | null = null
  for (const r of raw) {
    for (const e of parseLine(r)) {
      if (e.type === 'text') reader.line(e as TextEvent)
      if (e.type === 'prompt') got = reader.prompt() ?? got
    }
  }
  return got
}

const INV_LIST = [
  '<output class="mono"/>',
  'You take a moment and rummage about your person, taking stock of your possessions...',
  'You have:',
  "  <d cmd='remove #1'>a rugged brown backpack</d>",
  "     -<d cmd='get #2 in #1'>a vial of ithor potion</d>",
  "     -<d cmd='get #3 in #1'>a nondescript jacket</d>",
  "        -<d cmd='get #4 in #3 in #1'>a forbidding dragon-skull mask</d>",
  "  <d cmd='remove #5'>a low-cut zerarin wool bodice</d>",
  '<output class=""/>',
  "[Use <d cmd='inventory help'>INVENTORY HELP</d> for more options.]",
  'Roundtime: 3 sec.',
  '<prompt time="1">&gt;</prompt>',
]
const VAULT = [
  'She returns and hands you a sheet of paper with some words on it...',
  '<output class="mono"/>',
  ' ~*~  RUNDMOLEN BROS. STORAGE CO.  ~*~',
  'Vault Inventory:',
  '     (1)  a forest-green jaalmin carryall',
  '          (2)  some twilight sapphire cabochons',
  '     (6)  a mottled green leather weapon harness',
  '          (10) a rockwood bo staff',
  '               (11) a steel dire mace with a tempered head',
  'The last note indicates that your vault contains 110 items.',
  '<output class=""/>',
  'Roundtime: 5 sec.',
  '<prompt time="2">R&gt;</prompt>',
]

// ── 1. Capture ───────────────────────────────────────────────────────────────
{
  resetParser()
  const r = new HoldingsReader()
  const inv = read(r, INV_LIST)
  eq('inv list: captured as the character’s person', inv?.kind, 'inv')
  eq('inv list: every item, with its nesting', inv?.items, [
    { name: 'a rugged brown backpack', depth: 0 },
    { name: 'a vial of ithor potion', depth: 1 },
    { name: 'a nondescript jacket', depth: 1 },
    { name: 'a forbidding dragon-skull mask', depth: 2 },
    { name: 'a low-cut zerarin wool bodice', depth: 0 },
  ])

  const vault = read(r, VAULT)
  eq('vault: with no command seen, it is the standard vault', vault?.kind, 'vault')
  eq('vault: numbers dropped, nesting kept', vault?.items, [
    { name: 'a forest-green jaalmin carryall', depth: 0 },
    { name: 'some twilight sapphire cabochons', depth: 1 },
    { name: 'a mottled green leather weapon harness', depth: 0 },
    { name: 'a rockwood bo staff', depth: 1 },
    { name: 'a steel dire mace with a tempered head', depth: 2 },
  ])

  check('a prompt with no report open returns nothing', r.prompt() === null)
}

// Which vault it was comes from the command.
{
  resetParser()
  const r = new HoldingsReader()
  r.command('vault family')
  eq('vault family: typed command', read(r, VAULT)?.kind, 'family')
  eq('and the next one is standard again', read(r, VAULT)?.kind, 'vault')

  r.command('VAULT FAM')
  eq('vault family: abbreviated, any case', read(r, VAULT)?.kind, 'family')

  eq('vault family: from a script’s echo in the stream',
    read(r, ['[afk2]>vault family', ...VAULT])?.kind, 'family')

  // A family request that came to nothing must not label a later standard report.
  r.command('vault family')
  for (let i = 0; i < 4; i++) r.prompt()
  eq('a family request that never arrived is forgotten', read(r, VAULT)?.kind, 'vault')

  // ...but one stray prompt before the sheet arrives doesn't lose it.
  r.command('vault family')
  r.prompt()
  eq('a stray prompt before the sheet keeps it', read(r, VAULT)?.kind, 'family')
}

// Things that must NOT be captured.
{
  resetParser()
  const r = new HoldingsReader()
  // Plain INVENTORY: the same rows, without INVENTORY LIST's opening line.
  eq('plain INVENTORY is not a report', read(r, [
    'You are wearing:',
    "  <d cmd='remove #1'>a rugged brown backpack</d>",
    '<prompt time="3">&gt;</prompt>',
  ]), null)
  eq('LOOK IN a bag is not a report', read(r, [
    "In the backpack you see <d cmd='get #2 in #1'>a vial</d> and <d cmd='get #3 in #1'>a jacket</d>.",
    '<prompt time="4">&gt;</prompt>',
  ]), null)

  // An empty vault is still a report: it says the vault is empty.
  const emptyVault = read(r, ['<output class="mono"/>', 'Vault Inventory:', '<output class=""/>', '<prompt time="5">&gt;</prompt>'])
  eq('an empty vault is captured as empty', emptyVault, { kind: 'vault', items: [] })
}

// ── 2. The store ─────────────────────────────────────────────────────────────
{
  const dir = mkdtempSync(join(tmpdir(), 'lantern-holdings-'))
  try {
    const store = new HoldingsStore(dir)
    eq('a new store is empty', store.get(), { version: 1, accounts: {} })

    store.put({ account: 'JACKP', character: 'Refia', kind: 'inv', items: [{ name: 'a cloak', depth: 0 }] })
    store.put({ account: 'JACKP', character: 'Penello', kind: 'vault', items: [{ name: 'a staff', depth: 0 }] })
    store.put({ account: 'jackp', character: 'refia', kind: 'vault', items: [{ name: 'a ring', depth: 0 }] })
    store.put({ account: 'JACKP', character: 'Refia', kind: 'family', items: [{ name: 'a chest', depth: 0 }] })

    // A second instance on the same directory is what a second desktop window is.
    const other = new HoldingsStore(dir).get()
    const acct = other.accounts['jackp']
    eq('accounts are keyed without regard to case', Object.keys(other.accounts), ['jackp'])
    eq('both characters are there', Object.keys(acct.characters).sort(), ['penello', 'refia'])
    eq('a second report adds to a character rather than replacing it',
      [acct.characters['refia'].inv?.items[0].name, acct.characters['refia'].vault?.items[0].name], ['a cloak', 'a ring'])
    eq('the family vault belongs to the account', acct.family?.items[0].name, 'a chest')
    eq('and records who looked', acct.family?.by, 'Refia')
    check('a snapshot is stamped with a time', (acct.characters['refia'].inv?.at ?? 0) > 0)

    // Re-running a report replaces that report and only that one.
    store.put({ account: 'JACKP', character: 'Refia', kind: 'inv', items: [{ name: 'a hat', depth: 0 }] })
    const again = store.get().accounts['jackp'].characters['refia']
    eq('a re-run replaces the old list', again.inv?.items.map(i => i.name), ['a hat'])
    eq('and leaves the other report alone', again.vault?.items[0].name, 'a ring')

    // A character seen before its account was known moves to it once it is.
    store.put({ account: '', character: 'Charleah', kind: 'inv', items: [{ name: 'a lute', depth: 0 }] })
    check('an unknown account files under ""', !!store.get().accounts['']?.characters['charleah'])
    store.put({ account: 'OTHER', character: 'Charleah', kind: 'inv', items: [{ name: 'a lute', depth: 0 }] })
    check('and the orphan is dropped once the account is known',
      !store.get().accounts[''] && !!store.get().accounts['other'].characters['charleah'])

    // What arrives is not trusted.
    store.put({ account: 'JACKP', character: 'Refia', kind: 'inv', items: [
      { name: '  a wand  ', depth: 2.4 }, { name: '', depth: 0 }, { name: 'x', depth: -3 }, null, 'junk',
    ] as never })
    eq('items are cleaned on the way in', store.get().accounts['jackp'].characters['refia'].inv?.items,
      [{ name: 'a wand', depth: 2 }, { name: 'x', depth: 0 }])
    let threw = false
    try { store.put({ account: 'JACKP', character: '  ', kind: 'inv', items: [] }) } catch { threw = true }
    check('a report with no character is refused', threw)

    // Forgetting.
    store.remove('jackp', 'Penello')
    eq('a character can be forgotten', Object.keys(store.get().accounts['jackp'].characters), ['refia'])
    store.remove('JACKP')
    check('and a family vault', store.get().accounts['jackp'].family === undefined)
    store.remove('other', 'charleah')
    check('an account left empty goes with it', store.get().accounts['other'] === undefined)

    let events = 0
    store.on('changed', () => events++)
    store.put({ account: 'JACKP', character: 'Refia', kind: 'inv', items: [] })
    eq('a write announces itself', events, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ── 3. Display order and search ──────────────────────────────────────────────
{
  const snap = (names: [string, number][]) => ({ at: 1, items: names.map(([name, depth]) => ({ name, depth })) })
  const doc = {
    version: 1 as const,
    accounts: {
      zeta:  { name: 'ZETA',  characters: { anna: { name: 'Anna', inv: snap([['a hat', 0]]) } } },
      alpha: { name: 'ALPHA', family: snap([['a chest', 0]]), characters: {
        penello: { name: 'Penello', vault: snap([['a staff', 0]]) },
        refia:   { name: 'Refia', inv: snap([['a cloak', 0]]), vault: snap([['a ring', 0]]) },
        ghost:   { name: 'Ghost' },
      } },
    },
  }
  const view = holdingsView(doc, 'refia')
  eq('accounts A–Z', view.map(a => a.name), ['ALPHA', 'ZETA'])
  eq('the character being played leads its account', view[0].characters.map(c => c.name), ['Refia', 'Penello'])
  eq('a character with no reports is left out', view[0].characters.some(c => c.name === 'Ghost'), false)
  eq('sections in a fixed order', view[0].characters[0].sections.map(s => s.label), ['On person', 'Vault'])
  eq('the family vault hangs off the account', view[0].family?.label, 'Family vault')
  eq('the played character’s account comes first', holdingsView(doc, 'Anna').map(a => a.name), ['ZETA', 'ALPHA'])

  const bag = snap([
    ['a rugged brown backpack', 0], ['a vial of ithor potion', 1], ['a nondescript jacket', 1],
    ['a steel dragon-skull mask', 2], ['a steel ring', 0],
  ])
  eq('search: finds by any word, any case', searchSnapshot(bag, 'ITHOR').map(m => m.item.name), ['a vial of ithor potion'])
  eq('search: every word must match', searchSnapshot(bag, 'steel mask').map(m => m.item.name), ['a steel dragon-skull mask'])
  eq('search: says which containers it is in',
    searchSnapshot(bag, 'mask')[0].within, ['a rugged brown backpack', 'a nondescript jacket'])
  eq('search: a top-level item is in nothing', searchSnapshot(bag, 'ring')[0].within, [])
  eq('search: nothing typed, nothing found', searchSnapshot(bag, '  ').length, 0)

  const now = 10 * 24 * 3600_000
  eq('age: fresh', ageLabel(now - 20_000, now), 'just now')
  eq('age: minutes', ageLabel(now - 12 * 60_000, now), '12 min ago')
  eq('age: hours', ageLabel(now - 3 * 3600_000, now), '3 hr ago')
  eq('age: one day', ageLabel(now - 30 * 3600_000, now), '1 day ago')
  eq('age: days', ageLabel(now - 5 * 24 * 3600_000, now), '5 days ago')
}

// ── 4. Saving to a file ──────────────────────────────────────────────────────
{
  // Built from local-time parts, so the expected text holds in any time zone.
  const taken = new Date(2026, 9, 9, 8, 5).getTime()
  const saved = new Date(2026, 9, 10, 14, 32).getTime()
  eq('stamp: local, zero-padded, sortable', stamp(taken), '2026-10-09 08:05')

  const doc = {
    version: 1 as const,
    accounts: {
      jackp: { name: 'JACKP',
        family: { at: taken, by: 'Penello', items: [{ name: 'an ironwood chest', depth: 0 }] },
        characters: {
          refia: { name: 'Refia',
            inv:   { at: taken, items: [{ name: 'a backpack', depth: 0 }, { name: 'a vial', depth: 1 }, { name: 'a cork', depth: 2 }] },
            vault: { at: taken, items: [] } },
          penello: { name: 'Penello', inv: { at: taken, items: [{ name: 'a staff', depth: 0 }] } },
        } },
    },
  }
  const view = holdingsView(doc, 'Refia')
  eq('file: everything, nested, each list dated when it was taken', holdingsText(view, saved), [
    'Lantern — Account inventory',
    'Saved 2026-10-10 14:32',
    '', '',
    'JACKP',
    '=====',
    '',
    'Refia',
    '-----',
    '',
    'On person — 3 items, as of 2026-10-09 08:05',
    '  a backpack',
    '    a vial',
    '      a cork',
    '',
    'Vault — 0 items, as of 2026-10-09 08:05',
    '  (empty)',
    '',
    'Penello',
    '-------',
    '',
    'On person — 1 item, as of 2026-10-09 08:05',
    '  a staff',
    '',
    'Family vault',
    '------------',
    '',
    'Seen by Penello — 1 item, as of 2026-10-09 08:05',
    '  an ironwood chest',
    '',
  ].join('\n'))

  // One character: the same document, cut down to them.
  const one = view.map(a => ({ ...a, family: undefined, characters: a.characters.filter(c => c.name === 'Penello') }))
  const text = holdingsText(one, saved)
  check('file: one character has only that character', text.includes('Penello') && !text.includes('Refia') && !text.includes('ironwood'))

  eq('file name: a character', holdingsFileName('Refia', saved), 'lantern-inventory-refia-2026-10-10.txt')
  eq('file name: everything', holdingsFileName('', saved), 'lantern-inventory-all-2026-10-10.txt')
  eq('file name: nothing a file system objects to', holdingsFileName('Family vault (JACKP)', saved),
    'lantern-inventory-family-vault-jackp-2026-10-10.txt')
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ holdings: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ holdings: ${passed} passed`)
