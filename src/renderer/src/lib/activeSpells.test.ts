/**
 * Active-spell line parser tests.
 *
 * The roisaen/roisan/Fading lines are copied verbatim from real DR logs (Refia,
 * 2026-07). The Indefinite/OM/percent and khri lines are the shapes Lich's parser
 * documents; no log here has them yet.
 *
 * Run: npm run test:tools
 */

import { parseActiveSpellLine as parse } from './activeSpells'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
// Key-order-independent: objects are compared with their keys sorted.
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x)
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, canon(got) === canon(want), `got ${canon(got)}, wanted ${canon(want)}`)

const base = { roisaen: 0, percent: 0, expires: 0 }

// ── Seen in real logs ────────────────────────────────────────────────────────
eq('plural roisaen', parse('Skein of Shadows  (28 roisaen)', false),
  { ...base, name: 'Skein of Shadows', kind: 'timed', roisaen: 28 })
eq('singular roisan (final minute) — used to leak into main', parse('Bloodthorns  (1 roisan)', false),
  { ...base, name: 'Bloodthorns', kind: 'timed', roisaen: 1 })
eq('Fading — used to leak into main', parse('Bloodthorns  (Fading)', false),
  { ...base, name: 'Bloodthorns', kind: 'fading' })
eq('apostrophe in name', parse("Redeemer's Pride  (3 roisaen)", false)?.name, "Redeemer's Pride")

// ── Khri (Lich's documented shape) ───────────────────────────────────────────
eq('khri timed', parse('Khri Sagacity  (1 roisan)', false),
  { ...base, name: 'Khri Sagacity', kind: 'timed', roisaen: 1 })
eq('khri plural', parse('Khri Hasten  (12 roisaen)', false)?.roisaen, 12)

// ── Untimed shapes: only inside a percWindow refresh ─────────────────────────
eq('Indefinite in snapshot', parse('Hydra Hex  (Indefinite)', true)?.kind, 'indefinite')
eq('OM in snapshot', parse('Persistence of Mana  (OM)', true)?.kind, 'indefinite')
eq('percent in snapshot', parse('Osrel Meraud  (94%)', true), { ...base, name: 'Osrel Meraud', kind: 'percent', percent: 94 })
eq('Indefinite outside a snapshot is ordinary text', parse('Hydra Hex  (Indefinite)', false), null)
eq('percent outside a snapshot is ordinary text', parse('The sale price  (50%)', false), null)

// ── Ordinary game text must not match ────────────────────────────────────────
eq('prose with parens', parse('You see a moth (lying down).', true), null)
eq('exp line', parse('  Slings: 1749 19%  [ 9/34]', true), null)
eq('empty', parse('', true), null)

if (failures.length) {
  console.error(`✗ activeSpells: ${failures.length} failed`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`✓ activeSpells: ${passed} passed`)
