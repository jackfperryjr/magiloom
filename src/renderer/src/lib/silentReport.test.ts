/**
 * Silent report window — the background EXP poll's reply must stay out of the game
 * window, and nothing else may be hidden on its account.
 *
 * The cases here are the two ways the old flag-until-next-prompt approach failed:
 * a stray prompt before the reply let the whole report print, and any unrelated
 * line arriving while the flag was up was swallowed.
 *
 * The report text is a real one, as DR sends it:
 *
 *   Circle: 100
 *   Showing all skills with field experience.
 *             SKILL: Rank/Percent towards next rank/Amount learning/Mindstate Fraction
 *       Shield Usage:    324 17% learning       (9/34)
 *   Total Ranks Displayed: 324
 *   Time Development Points: 31777  Favors: 75  Deaths: 4  Departs: 0
 *   Rested EXP Stored: 3:59 hours  Usable This Cycle: 3:50 hours  Cycle Refreshes: 8:40 hours
 *   Overall state of mind: clear
 *   EXP HELP for more information
 *
 * Run: npm run test:tools
 */

import { SilentReport } from './silentReport'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean): void {
  if (cond) passed++
  else failures.push(name)
}

const START = /^Circle:\s*\d+$/
const REPORT = [
  'Circle: 100',
  'Showing all skills with field experience.',
  '          SKILL: Rank/Percent towards next rank/Amount learning/Mindstate Fraction',
  '    Shield Usage:    324 17% learning       (9/34)',
  'Total Ranks Displayed: 324',
  'Time Development Points: 31777  Favors: 75  Deaths: 4  Departs: 0',
  'Rested EXP Stored: 3:59 hours  Usable This Cycle: 3:50 hours  Cycle Refreshes: 8:40 hours',
  'Overall state of mind: clear',
  'EXP HELP for more information',
]
/** Feed a whole report; true when every line of it was hidden. */
const hidesAll = (r: SilentReport): boolean => REPORT.every(l => r.line(l, true))
/** Feed a whole report; true when none of it was hidden. */
const showsAll = (r: SilentReport): boolean => REPORT.every(l => !r.line(l, true))

// ── 1. The ordinary poll ─────────────────────────────────────────────────────
{
  const r = new SilentReport(START)
  r.begin()
  check('the whole report is hidden', hidesAll(r))
  check('the closing prompt ends the window', r.prompt() === true)
  check('the next report is the player\'s, and shows', showsAll(r))
}

// ── 2. A prompt lands before the reply (the leak) ────────────────────────────
{
  const r = new SilentReport(START)
  r.begin()
  check('a stray prompt closes nothing', r.prompt() === false)
  check('nor does a second', r.prompt() === false)
  check('the report is still hidden when it arrives', hidesAll(r))
  check('and its own prompt ends the window', r.prompt() === true)
}

// ── 3. Other text arrives while waiting (the swallow) ────────────────────────
{
  const r = new SilentReport(START)
  r.begin()
  check('speech before the reply is shown', !r.line('Mirelle says, "Hello."', false))
  check('so is another monospaced block', !r.line('Name: Jackreous   Race: Human', true))
  check('the report is still hidden after them', hidesAll(r))
  // Mid-report, a line that is not part of the block (it isn't monospaced).
  check('a non-report line inside the window is shown', !r.line('A bell tolls in the distance.', false))
  r.prompt()
}

// ── 4. The reply never comes ─────────────────────────────────────────────────
{
  const r = new SilentReport(START, 3)
  r.begin()
  r.prompt(); r.prompt(); r.prompt()
  check('after the budget, a later report is shown', showsAll(r))
}
{
  const r = new SilentReport(START, 3)
  r.begin()
  r.prompt(); r.prompt()
  check('inside the budget it is still hidden', hidesAll(r))
}

// ── 5. The player asks for it themselves ─────────────────────────────────────
{
  const r = new SilentReport(START)
  r.begin()
  r.cancel()
  check('a typed EXP cancels the pending poll', showsAll(r))
}
{
  const r = new SilentReport(START)
  check('with no poll pending, a report shows', showsAll(r))
  check('and a prompt closes nothing', r.prompt() === false)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ silentReport: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ silentReport: ${passed} passed`)
