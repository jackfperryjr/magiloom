/**
 * Report cards — which lines of the game output land in an EXP / INFO / SPELLS /
 * KHRI card. The lines are from real captures. Two failure modes matter:
 *
 *   1. A card that swallows what follows it — the prompt must close it.
 *   2. Two reports with no prompt between them (INFO then EXP at login) running
 *      together as one card.
 *
 * Run: npm run test:tools
 */

import { CardTracker, cardOpener, type CardTag } from './outputCards'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

/** Feed lines through a tracker; '>' stands for the prompt (separator). */
function run(lines: string[]): (CardTag | null | '>')[] {
  const t = new CardTracker()
  return lines.map(l => {
    if (l === '>') { t.end(); return '>' }
    return t.line(l)
  })
}

// ── Openers ──────────────────────────────────────────────────────────────────
eq('EXP Circle line', cardOpener('Circle: 200'), 'exp')
eq('EXP <skill> header', cardOpener('          SKILL: Rank/Percent towards next rank/Amount learning/Mindstate Fraction'), 'exp')
eq('INFO name row', cardOpener('Name: Refia Highwind, Woodland Princess of Ilithi   Race: Human   Guild: Ranger'), 'info')
eq('INFO gender row is not an opener', cardOpener('Gender: Female   Age: 42   Circle: 200'), null)
eq('PROFILE name row is not INFO', cardOpener('              Name: Refia Highwind'), null)
eq('SPELLS', cardOpener('You recall the spells you have learned from your training.'), 'spells')
eq('KHRI', cardOpener('From the Subtlety tree, you know the following khri: Darken (Aug), Dampen (Util/Ward)'), 'khri')
eq('ordinary prose', cardOpener('You recall the face of an old friend.'), null)

// ── SPELLS: the whole response, closed by the prompt ─────────────────────────
{
  const got = run([
    'You recall the spells you have learned from your training.',
    'Analogous Patterns:',
    '     maf  Manifest Force                  Slot(s): 1   Min Prep: 1     Max Prep: 100',
    'You have 13 spell slots available.',
    '>',
    'Penello just arrived.',
  ])
  eq('SPELLS opens', got[0], { card: 'spells', cardStart: true })
  eq('SPELLS category joins', got[1], { card: 'spells' })
  eq('SPELLS footer joins', got[3], { card: 'spells' })
  eq('the prompt closes the card', got[5], null)
}

// ── EXP: Circle then SKILL header is ONE card ────────────────────────────────
{
  const got = run(['Circle: 200', 'Showing all skills that you have skill in.',
    '          SKILL: Rank/Percent towards next rank/Amount learning/Mindstate Fraction',
    'EXP HELP for more information'])
  eq('EXP opens', got[0], { card: 'exp', cardStart: true })
  eq('EXP SKILL header continues', got[2], { card: 'exp' })
  eq('EXP footer joins', got[3], { card: 'exp' })
}

// ── Login: INFO, EXP, SPELLS, KHRI with no prompts between them ──────────────
{
  const got = run([
    'Name: Refia Highwind   Race: Human   Guild: Ranger',
    'Date formats are MM/DD/YYYY.',
    'Circle: 200',
    'Overall state of mind: clear',
    'You recall the spells you have learned from your training.',
    'From the Subtlety tree, you know the following khri: Darken (Aug)',
    'From the Finesse tree, you know the following khri: Hasten (Util)',
    'You have 31 available slots.',
  ])
  eq('INFO tail stays in INFO', got[1], { card: 'info' })
  eq('EXP starts its own card', got[2], { card: 'exp', cardStart: true })
  eq('SPELLS starts its own card', got[4], { card: 'spells', cardStart: true })
  eq('KHRI starts its own card', got[5], { card: 'khri', cardStart: true })
  eq('a second khri tree stays in the same card', got[6], { card: 'khri' })
  eq('KHRI footer joins', got[7], { card: 'khri' })
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ outputCards: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ outputCards: ${passed} passed`)
