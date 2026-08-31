/**
 * Quick actions + Lich `;list` parsing.
 *
 * Two things are being protected here:
 *
 *   1. A quick action sends what the user meant. The kind decides the prefix, but
 *      a user who typed the prefix themselves must not get it doubled — `;;sloot`
 *      is not a script.
 *   2. parseLichList only claims lines that really are a script list. It runs
 *      inside a short window after the Scripts panel polls `;list`, and a match
 *      SWALLOWS the line from the game output — so a false positive silently eats
 *      text the player should have seen. Every other `--- Lich:` notice in
 *      Lich5's lib/global_defs.rb must be rejected.
 *
 * The accepted shapes come from Lich5's `;list` implementation:
 *   --- Lich: no active scripts
 *   --- Lich: sloot, bigshot (paused), waggle
 *
 * Run: npm run test:tools
 */

import {
  parseLichList, quickActionCommand, quickActionLabel, newQuickAction,
} from './quickActions'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
const deepEq = (name: string, got: unknown, want: unknown): void =>
  check(name, JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── 1. Dispatch ──────────────────────────────────────────────────────────────
{
  eq('a command is sent as typed', quickActionCommand({ kind: 'command', target: 'stance defensive' }), 'stance defensive')
  eq('a .cmd script gets a dot',   quickActionCommand({ kind: 'cmd',  target: 'hunt' }), '.hunt')
  eq('a lich script gets a semi',  quickActionCommand({ kind: 'lich', target: 'sloot' }), ';sloot')

  // A user who pasted the prefix in must not get it twice.
  eq('an existing dot is kept',  quickActionCommand({ kind: 'cmd',  target: '.hunt' }), '.hunt')
  eq('an existing semi is kept', quickActionCommand({ kind: 'lich', target: ';sloot' }), ';sloot')

  eq('arguments ride along', quickActionCommand({ kind: 'cmd', target: 'hunt orc' }), '.hunt orc')
  eq('surrounding space is trimmed', quickActionCommand({ kind: 'lich', target: '  sloot  ' }), ';sloot')
  eq('an empty target sends nothing', quickActionCommand({ kind: 'command', target: '   ' }), '')
}

// ── 2. Labels ────────────────────────────────────────────────────────────────
{
  const a = { ...newQuickAction(), label: 'Hunt', kind: 'cmd' as const, target: 'hunt' }
  eq('a label is used when set', quickActionLabel(a), 'Hunt')
  eq('a blank label falls back to the command', quickActionLabel({ ...a, label: '  ' }), '.hunt')
  eq('a blank everything still renders', quickActionLabel({ ...a, label: '', target: '' }), 'unnamed')
  check('new actions get distinct ids', newQuickAction().id !== newQuickAction().id)
}

// ── 3. `;list` — the shapes it must accept ───────────────────────────────────
{
  deepEq('an empty list', parseLichList('--- Lich: no active scripts'), [])
  deepEq('an empty list with a period', parseLichList('--- Lich: no active scripts.'), [])
  deepEq('one script', parseLichList('--- Lich: sloot'), [{ name: 'sloot', paused: false }])
  deepEq('several scripts', parseLichList('--- Lich: sloot, bigshot, waggle'), [
    { name: 'sloot', paused: false },
    { name: 'bigshot', paused: false },
    { name: 'waggle', paused: false },
  ])
  deepEq('a paused script', parseLichList('--- Lich: sloot, bigshot (paused)'), [
    { name: 'sloot', paused: false },
    { name: 'bigshot', paused: true },
  ])
  // A real reply from Jack's session — six scripts, hyphens and trailing digits.
  deepEq('a real six-script reply',
    parseLichList('--- Lich: afk2, almanac, sanowret-crystal, t2, hunting-buddy2, combat-trainer2'), [
      { name: 'afk2', paused: false },
      { name: 'almanac', paused: false },
      { name: 'sanowret-crystal', paused: false },
      { name: 't2', paused: false },
      { name: 'hunting-buddy2', paused: false },
      { name: 'combat-trainer2', paused: false },
    ])
  // Script names on disk carry dots, dashes and underscores.
  deepEq('punctuated script names', parseLichList('--- Lich: go2, my-script, an_alias.lic'), [
    { name: 'go2', paused: false },
    { name: 'my-script', paused: false },
    { name: 'an_alias.lic', paused: false },
  ])
}

// ── 4. `;list` — everything it must reject ───────────────────────────────────
{
  // Real notices from Lich5 lib/global_defs.rb. Swallowing any of these would
  // hide a message the player needs.
  const notices = [
    '--- Lich: no scripts to kill',
    '--- Lich: no scripts to pause',
    '--- Lich: no scripts to unpause',
    '--- Lich: no scripts are trusted',
    '--- Lich: no active scripts to send to.',
    "--- Lich: sloot does not appear to be running! Use ';list' or ';listall' to see what's active.",
    '--- Lich: cannot find script named foo',
  ]
  for (const n of notices) eq(`rejects: ${n}`, parseLichList(n), null)

  eq('rejects a non-Lich line', parseLichList('You see a small rock.'), null)
  eq('rejects a bare prefix', parseLichList('--- Lich:'), null)
  eq('rejects an empty payload', parseLichList('--- Lich:    '), null)
  eq('rejects a trailing comma', parseLichList('--- Lich: sloot, '), null)
  eq('rejects prose with a comma', parseLichList('--- Lich: saving settings, please wait'), null)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ quickActions: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ quickActions: ${passed} passed`)
