/**
 * Regex guard + rule engine tests.
 *
 * Two things are being protected here:
 *
 *   1. A user pattern can never hang the client. Every rule editor accepts raw
 *      regex, and those patterns run against every incoming line, so a
 *      catastrophically backtracking pattern used to be a hard freeze with no way
 *      out but hand-editing settings.json. The guard has to catch the classic
 *      traps, and — just as important — must NOT bench ordinary patterns.
 *   2. The Test boxes show the truth. They call the same functions the live
 *      pipeline calls, so these assert the shared engine's behaviour: match
 *      semantics, gag/sub ordering, and that a benched pattern simply stops
 *      matching rather than throwing.
 *
 * Run: npm run test:tools
 */

import { safeRegex, regexStatus, safeTest, _clearRegexCache } from './regexSafety'
import {
  matchHighlight, applyGagSub, alertMatches, alertMatcher, patternMatches,
  previewHighlights, type TextRule,
} from './rules'
import { matchTriggers, expandAlias, type Trigger, type Alias } from './automation'
import type { Highlight } from './themes'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

const hl = (o: Partial<Highlight>): Highlight => ({
  id: Math.random().toString(36).slice(2), pattern: '', isRegex: false,
  color: '#fff', bgcolor: '', bold: false, enabled: true, ...o,
})

// ── 1. The guard benches catastrophic patterns ───────────────────────────────
{
  _clearRegexCache()

  // The classic traps. Each is a VALID regex that takes exponential time to fail.
  const evil = [
    '(a+)+$',
    '(a|a)+$',
    '(a*)*$',
    '([a-zA-Z]+)*$',
    '(\\s*\\w*)*$',
  ]
  for (const p of evil) {
    const t0 = Date.now()
    const { status, re } = safeRegex(p)
    const elapsed = Date.now() - t0
    eq(`"${p}" is benched`, status, 'benched')
    check(`"${p}" yields no usable regex`, re === null)
    // The guard must also be FAST — bailing early is what keeps it from becoming
    // the hang it exists to prevent.
    check(`"${p}" is benched quickly`, elapsed < 400, `took ${elapsed}ms`)
  }

  // A benched pattern simply never matches; it does not throw.
  eq('a benched pattern never matches', safeTest('(a+)+$', 'aaaaaaaaaaaaaaaaaaaa!'), false)
}

// ── 2. …and leaves ordinary patterns alone ───────────────────────────────────
{
  _clearRegexCache()

  // Realistic rules a player would actually write. None of these may be benched —
  // a false positive silently switches off a rule that was working.
  const fine = [
    'You are stunned',
    '^You have died',
    '(\\w+) whispers',
    'a (?:large|small) (kobold|orc)',
    '\\b(Katamba|Xibar|Yavash)\\b',
    '^\\s*\\[.+\\]\\s*$',
    'gold (\\d+) coins?',
    '.*',
    '(.*)',
    '[A-Za-z]+\\s+[A-Za-z]+',
    '^(?!You)\\w+ arrives',
    'roundtime:?\\s*\\d+',
  ]
  for (const p of fine) {
    const { status } = safeRegex(p)
    eq(`"${p}" is allowed`, status, 'ok')
  }
}

// ── 3. Invalid patterns are reported, not thrown ─────────────────────────────
{
  _clearRegexCache()
  for (const p of ['(unclosed', 'a{2,1}', '[z-a]', '*nope']) {
    const { status, re, reason } = safeRegex(p)
    eq(`"${p}" is invalid`, status, 'invalid')
    check(`"${p}" yields no regex`, re === null)
    check(`"${p}" explains why`, typeof reason === 'string' && reason.length > 0)
  }
  eq('an invalid pattern never matches', safeTest('(unclosed', 'anything'), false)

  // A blank pattern is not an error — it is just an unfinished rule.
  eq('a blank pattern is not flagged', regexStatus('').status, 'ok')
  eq('whitespace is not flagged', regexStatus('   ').status, 'ok')
}

// ── 4. Caching: same answer, and an edit gets a fresh chance ─────────────────
{
  _clearRegexCache()
  const a = safeRegex('(a+)+$')
  const b = safeRegex('(a+)+$')
  check('a repeated pattern returns the cached result', a === b)
  // Editing the pattern is a different key, so it is judged on its own merits
  // rather than staying benched.
  eq('the rewritten pattern is judged fresh', safeRegex('(a+)$').status, 'ok')
  // Flags are part of the key.
  check('flags are part of the cache key', safeRegex('abc', 'i') !== safeRegex('abc', 'gi'))
}

// ── 5. The shared engine: highlights ─────────────────────────────────────────
{
  _clearRegexCache()
  const rules = [
    hl({ pattern: 'kobold', color: '#f00' }),
    hl({ pattern: '^You are stunned', isRegex: true, color: '#0f0' }),
    hl({ pattern: 'disabled rule', color: '#00f', enabled: false }),
    hl({ pattern: 'classed', color: '#ff0', class: 'combat' }),
  ]

  check('a substring rule matches case-insensitively', matchHighlight('A large KOBOLD appears.', rules)?.pattern === 'kobold')
  check('a regex rule matches', matchHighlight('You are stunned!', rules)?.pattern === '^You are stunned')
  eq('a non-matching line matches nothing', matchHighlight('Nothing here.', rules), null)
  eq('a disabled rule never matches', matchHighlight('a disabled rule here', rules), null)

  // Class gating.
  check('a classed rule matches when its class is on', matchHighlight('classed line', rules)?.pattern === 'classed')
  eq('a classed rule is skipped when its class is off',
    matchHighlight('classed line', rules, new Set(['combat'])), null)

  // First match wins, in list order.
  const ordered = [hl({ pattern: 'orc', color: '#111' }), hl({ pattern: 'orc', color: '#222' })]
  eq('the first matching rule wins', matchHighlight('an orc', ordered)?.color, '#111')

  // A benched pattern is inert rather than fatal.
  const dangerous = [hl({ pattern: '(a+)+$', isRegex: true, color: '#f00' })]
  eq('a benched highlight matches nothing', matchHighlight('aaaaaaaaaaaaaaaaaaaa!', dangerous), null)
}

// ── 6. The shared engine: gags and substitutes ───────────────────────────────
{
  _clearRegexCache()
  const gag: TextRule = { pattern: 'boring', isRegex: false, action: 'gag', enabled: true }
  const sub: TextRule = { pattern: 'ugly', isRegex: false, action: 'sub', replace: 'pretty', enabled: true }

  eq('a gag suppresses the line', applyGagSub('a boring message', [gag]), null)
  eq('a gag leaves other lines alone', applyGagSub('a fine message', [gag]), 'a fine message')
  eq('a substitute rewrites', applyGagSub('an ugly thing', [sub]), 'an pretty thing')
  eq('a substitute replaces every occurrence',
    applyGagSub('ugly and ugly', [sub]), 'pretty and pretty')
  eq('a blank replacement removes the text',
    applyGagSub('say hello loudly', [{ pattern: 'hello ', isRegex: false, action: 'sub', replace: '', enabled: true }]),
    'say loudly')

  // A literal pattern's metacharacters are taken at face value, not as regex.
  eq('a literal pattern is escaped',
    applyGagSub('cost is 5 (gold)', [{ pattern: '(gold)', isRegex: false, action: 'sub', replace: 'silver', enabled: true }]),
    'cost is 5 silver')

  // A disabled or class-gated rule is skipped.
  eq('a disabled gag does nothing', applyGagSub('a boring message', [{ ...gag, enabled: false }]), 'a boring message')
  eq('a class-gated gag is skipped',
    applyGagSub('a boring message', [{ ...gag, class: 'spam' }], new Set(['spam'])), 'a boring message')

  // A benched substitute leaves the line untouched instead of throwing.
  eq('a benched substitute is inert',
    applyGagSub('aaaaaaaaaaaaaaaaaaaa!', [{ pattern: '(a+)+$', isRegex: true, action: 'sub', replace: 'X', enabled: true }]),
    'aaaaaaaaaaaaaaaaaaaa!')
}

// ── 7. The Test box preview matches the real pipeline ────────────────────────
{
  _clearRegexCache()
  // Gag wins outright.
  const withGag = [hl({ pattern: 'spam', action: 'gag' }), hl({ pattern: 'spam', color: '#f00' })]
  const gagged = previewHighlights('this is spam', withGag)
  check('the preview reports a gag', gagged.gagged)
  check('and names the rule that gagged it', gagged.gaggedBy?.pattern === 'spam')

  // Substitutes run before colouring, and the colour is matched on the REWRITTEN
  // text — the ordering the live client uses.
  const withSub = [
    hl({ pattern: 'a goblin', action: 'sub', replace: 'a friend' }),
    hl({ pattern: 'friend', color: '#0f0' }),
  ]
  const subbed = previewHighlights('you see a goblin', withSub)
  eq('the preview applies the substitute', subbed.text, 'you see a friend')
  check('the preview reports the change', subbed.changed)
  check('and colours the rewritten text', subbed.hl?.pattern === 'friend')

  // Nothing matching is reported as such.
  const quiet = previewHighlights('nothing to see', [hl({ pattern: 'zzz', color: '#f00' })])
  check('a quiet line reports no change', !quiet.changed && quiet.hl === null && !quiet.gagged)
}

// ── 8. Triggers and aliases still behave (now via the guard) ─────────────────
{
  _clearRegexCache()
  const triggers: Trigger[] = [
    { id: '1', pattern: 'you are stunned', isRegex: false, command: 'stand', enabled: true },
    { id: '2', pattern: '^(\\w+) whispers', isRegex: true, command: 'reply %1', enabled: true },
    { id: '3', pattern: '(a+)+$', isRegex: true, command: 'boom', enabled: true },
  ]
  eq('a substring trigger fires', matchTriggers('You are stunned!', triggers).join(','), 'stand')
  eq('a regex trigger fills capture groups',
    matchTriggers('Bob whispers something', triggers).join(','), 'reply Bob')
  eq('a benched trigger never fires',
    matchTriggers('aaaaaaaaaaaaaaaaaaaa!', triggers).join(','), '')

  const aliases: Alias[] = [
    { id: '1', pattern: 'kk', command: 'kill %1', enabled: true },
    { id: '2', pattern: 'h', command: 'kk orc', enabled: true },
  ]
  eq('an alias expands with args', expandAlias('kk goblin', aliases), 'kill goblin')
  eq('an alias expands recursively', expandAlias('h', aliases), 'kill orc')
  eq('a non-alias is unchanged', expandAlias('look', aliases), 'look')
}

// ── 9. Alerts ────────────────────────────────────────────────────────────────
{
  _clearRegexCache()
  eq('a substring alert matches', alertMatches({ pattern: 'Bob', isRegex: false, enabled: true }, 'Bob arrives.'), true)
  eq('and is case-insensitive', alertMatches({ pattern: 'bob', isRegex: false, enabled: true }, 'BOB arrives.'), true)
  eq('a regex alert matches', alertMatches({ pattern: '^\\w+ has died', isRegex: true, enabled: true }, 'Fred has died!'), true)
  eq('a benched alert never matches',
    alertMatches({ pattern: '(a+)+$', isRegex: true, enabled: true }, 'aaaaaaaaaaaaaaaaaaaa!'), false)
  eq('a blank alert never matches', alertMatches({ pattern: '  ', isRegex: false, enabled: true }, 'anything'), false)

  // The compiled matcher agrees with the one-shot form, and is reusable.
  const m = alertMatcher({ pattern: 'orc', isRegex: false, enabled: true })
  check('the compiled matcher is reusable', !!m && m('an orc') && !m('a kobold') && m('ORC again'))
  eq('a benched rule compiles to null', alertMatcher({ pattern: '(a+)+$', isRegex: true, enabled: true }), null)

  eq('patternMatches handles the blank case', patternMatches('', false, 'anything'), false)
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ rules: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ rules: ${passed} passed`)
