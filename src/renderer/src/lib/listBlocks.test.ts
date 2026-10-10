/**
 * Copyable item lists — INVENTORY LIST and the vault reports.
 *
 * Two things are being protected here:
 *
 *   1. Only list rows are claimed. A copy button on a line that isn't part of a list
 *      is clutter in the game window, and a row that is missed splits one list into
 *      two half-copies. The lines below are from real captures, run through the real
 *      parser, so a change to either side shows up here.
 *   2. What is copied reads as the list the game printed: nested items stay nested
 *      (the parser drops an inventory row's indent, so it has to be rebuilt), and the
 *      block starts at the margin.
 *
 * Run: npm run test:tools
 */

import { parseLine, resetParser, type GameEvent } from './sge-parser'
import { listLineKind, listRowText, listBlockText } from './listBlocks'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

type TextEvent = Extract<GameEvent, { type: 'text' }>
/** Feed raw stream lines through the parser and keep the text lines it emits. */
function feed(raw: string[]): TextEvent[] {
  resetParser()
  return raw.flatMap(r => parseLine(r)).filter((e): e is TextEvent => e.type === 'text')
}

// ── 1. INVENTORY LIST ────────────────────────────────────────────────────────
{
  const lines = feed([
    '<output class="mono"/>',
    'You take a moment and rummage about your person, taking stock of your possessions...',
    'You have:',
    "  <d cmd='remove #52110553'>a rugged brown backpack</d>",
    "     -<d cmd='get #52110571 in #52110553'>a vial of ithor potion</d>",
    "     -<d cmd='get #52110555 in #52110553'>a nondescript jacket with a shadowy dragon imprinted on the sleeve</d>",
    "        -<d cmd='get #52110557 in #52110555 in #52110553'>a forbidding dragon-skull mask</d>",
    "  <d cmd='remove #52110552'>a low-cut zerarin wool bodice</d>",
    '<output class=""/>',
    "[Use <d cmd='inventory help'>INVENTORY HELP</d> for more options.]",
    'Roundtime: 3 sec.',
  ])
  const kinds = lines.map(listLineKind)
  eq('the preamble is not a row', kinds[0], null)
  eq('"You have:" is not a row', kinds[1], null)
  check('every item is a row', kinds.slice(2, 7).every(k => k === 'inv'), JSON.stringify(kinds))
  eq('the help footer is not a row', kinds[7], null)
  eq('Roundtime is not a row', kinds[8], null)

  const rows = lines.slice(2, 7).map(l => listRowText('inv', l))
  eq('a worn item sits at the game’s two spaces', rows[0], '  a rugged brown backpack')
  eq('a contained item is indented and dashed', rows[1], '     -a vial of ithor potion')
  eq('two levels down is indented again', rows[3], '        -a forbidding dragon-skull mask')
  eq('the block is pulled back to the margin', listBlockText(rows), [
    'a rugged brown backpack',
    '   -a vial of ithor potion',
    '   -a nondescript jacket with a shadowy dragon imprinted on the sleeve',
    '      -a forbidding dragon-skull mask',
    'a low-cut zerarin wool bodice',
  ].join('\n'))
}

// ── 2. Vault reports ─────────────────────────────────────────────────────────
{
  const lines = feed([
    'She returns and hands you a sheet of paper with some words on it...',
    '<output class="mono"/>',
    ' ~*~  RUNDMOLEN BROS. STORAGE CO.  ~*~',
    '           Crossing Branch',
    'Vault Inventory:',
    '     (1)  a forest-green jaalmin carryall adorned with a rivertear clasp',
    '          (2)  some twilight sapphire cabochons',
    '     (6)  a mottled green leather weapon harness intricately beaded in shades of gold',
    '          (10) a rockwood bo staff',
    '               (108) a pair of dark suede ankle boots with voidfrost brocade panels',
    'The last note indicates that your vault contains 110 items -- but as hurried as it was written, you can\'t be certain.',
    '<output class=""/>',
    'Roundtime: 5 sec.',
  ])
  const kinds = lines.map(listLineKind)
  check('the letterhead is not a row', kinds.slice(0, 4).every(k => k === null), JSON.stringify(kinds))
  check('every numbered line is a row', kinds.slice(4, 9).every(k => k === 'vault'), JSON.stringify(kinds))
  eq('the closing note is not a row', kinds[9], null)
  eq('Roundtime is not a row', kinds[10], null)

  const rows = lines.slice(4, 9).map(l => listRowText('vault', l))
  eq('a vault block keeps its numbers and its nesting', listBlockText(rows), [
    '(1)  a forest-green jaalmin carryall adorned with a rivertear clasp',
    '     (2)  some twilight sapphire cabochons',
    '(6)  a mottled green leather weapon harness intricately beaded in shades of gold',
    '     (10) a rockwood bo staff',
    '          (108) a pair of dark suede ankle boots with voidfrost brocade panels',
  ].join('\n'))
}

// ── 3. Things that look similar and are not lists ────────────────────────────
{
  // LOOK IN a container: the same `get #id in #id` links, but in one sentence.
  const [lookIn] = feed([
    "In the backpack you see <d cmd='get #1 in #2'>a vial</d> and <d cmd='get #3 in #2'>a shirt</d>.",
  ])
  eq('LOOK IN a container is not a list row', listLineKind(lookIn), null)

  // One item link, but inside a sentence.
  const [tap] = feed(["You tap <d cmd='get #1 in #2'>a vial of ithor potion</d> inside your backpack."])
  eq('a sentence about one item is not a row', listLineKind(tap), null)

  // A numbered line outside a monospaced block.
  const [prose] = feed(['     (1)  is the first option, he says.'])
  eq('a numbered line that is not monospaced is not a vault row', listLineKind(prose), null)

  // A monospaced line that isn't numbered (an ASCII table, a map).
  const [table] = feed(['<output class="mono"/>', '     Name          Rank'])
  eq('an unnumbered monospaced line is not a vault row', listLineKind(table), null)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ listBlocks: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ listBlocks: ${passed} passed`)
