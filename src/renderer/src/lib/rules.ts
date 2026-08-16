// The matching engine behind the user's text rules — highlights, gags,
// substitutes, and custom alerts.
//
// This logic used to live inline in the three places that run it (GameOutput for
// highlights, the store's ingest path for gags/subs, NotificationCenter for
// alerts). It is pulled out here for two reasons: every pattern now goes through
// the backtracking guard in one place, and the "Test" box in each rule editor can
// call the SAME function the live engine calls, so what it previews is what
// actually happens rather than a second implementation that drifts.
//
// See lib/automation.ts for the other half (aliases and triggers), which was
// already pure and testable.

import type { Highlight } from './themes'
import { safeRegex, safeTest } from './regexSafety'

const NO_DISABLED: ReadonlySet<string> = new Set()

export const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// A rule is live when it's enabled and its class (if any) isn't switched off.
function live(rule: { enabled: boolean; class?: string }, disabled: ReadonlySet<string>): boolean {
  return rule.enabled && (!rule.class || !disabled.has(rule.class))
}

/** Does this pattern match this line? Honors the regex/substring toggle. */
export function patternMatches(pattern: string, isRegex: boolean, text: string): boolean {
  if (!pattern) return false
  return isRegex
    ? safeTest(pattern, text)
    : text.toLowerCase().includes(pattern.toLowerCase())
}

/**
 * The first highlight that matches, or null. Only colouring rules are considered —
 * gags and substitutes are applied at ingest instead (see applyGagSub), so a line
 * reaching the renderer has already been through them.
 */
export function matchHighlight(
  text: string, highlights: Highlight[], disabled: ReadonlySet<string> = NO_DISABLED,
): Highlight | null {
  for (const hl of highlights) {
    if (!live(hl, disabled) || !hl.pattern) continue
    if (patternMatches(hl.pattern, hl.isRegex, text)) return hl
  }
  return null
}

// A gag/sub rule — the subset of highlight fields the ingest path needs.
export interface TextRule {
  pattern: string
  isRegex: boolean
  action: 'gag' | 'sub'
  replace?: string
  enabled: boolean
  class?: string
}

/**
 * Apply gags and substitutes to an incoming line. Returns the (possibly rewritten)
 * text, or null when a gag suppresses the line entirely.
 */
export function applyGagSub(
  text: string, rules: TextRule[], disabled: ReadonlySet<string> = NO_DISABLED,
): string | null {
  if (rules.length === 0) return text
  let out = text
  for (const r of rules) {
    if (!live(r, disabled) || !r.pattern) continue
    if (r.action === 'gag') {
      if (patternMatches(r.pattern, r.isRegex, out)) return null
    } else {
      // Substitute every occurrence. A literal pattern is escaped so its
      // metacharacters are taken at face value.
      const { re } = safeRegex(r.isRegex ? r.pattern : escapeRe(r.pattern), 'gi')
      if (!re) continue                     // invalid or benched — leave the line alone
      re.lastIndex = 0
      out = out.replace(re, r.replace ?? '')
    }
  }
  return out
}

// A custom alert rule — the fields matching needs. (The full NotifRule, with its
// per-channel flags, lives with the notification UI.)
export interface AlertRule {
  pattern: string
  isRegex: boolean
  enabled: boolean
}

/** Does a custom alert fire on this line? */
export function alertMatches(rule: AlertRule, text: string): boolean {
  const p = rule.pattern.trim()
  if (!p) return false
  return patternMatches(p, rule.isRegex, text)
}

/**
 * Compile an alert rule to a reusable matcher, or null when it can never match
 * (blank, invalid, or benched). Callers hold these across many lines.
 */
export function alertMatcher(rule: AlertRule): ((s: string) => boolean) | null {
  const p = rule.pattern.trim()
  if (!p) return null
  if (rule.isRegex) {
    const { re } = safeRegex(p)
    if (!re) return null
    return s => { re.lastIndex = 0; return re.test(s) }
  }
  const needle = p.toLowerCase()
  return s => s.toLowerCase().includes(needle)
}

// ── What a rule would do, for the editors' Test boxes ────────────────────────────

/**
 * What the highlight pipeline does to a line, in the order the live client does it:
 * gags and substitutes run at ingest, then whatever survives is matched for colour.
 * `gaggedBy` / `subbedBy` / `hl` name the rules responsible so the editor can say
 * which one acted.
 */
export interface HighlightPreview {
  gagged: boolean
  gaggedBy?: Highlight
  text: string                  // after substitutions
  changed: boolean              // a substitute rewrote it
  subbedBy: Highlight[]
  hl: Highlight | null          // the colouring rule that won, if any
}

export function previewHighlights(
  input: string, highlights: Highlight[], disabled: ReadonlySet<string> = NO_DISABLED,
): HighlightPreview {
  let text = input
  const subbedBy: Highlight[] = []

  for (const h of highlights) {
    if (!live(h, disabled) || !h.pattern) continue
    if (h.action === 'gag') {
      if (patternMatches(h.pattern, h.isRegex, text)) {
        return { gagged: true, gaggedBy: h, text, changed: text !== input, subbedBy, hl: null }
      }
    } else if (h.action === 'sub') {
      const before = text
      const out = applyGagSub(text, [{
        pattern: h.pattern, isRegex: h.isRegex, action: 'sub', replace: h.replace, enabled: true,
      }])
      text = out ?? text
      if (text !== before) subbedBy.push(h)
    }
  }

  // Only colouring rules reach the renderer.
  const colouring = highlights.filter(h => h.action !== 'gag' && h.action !== 'sub')
  return {
    gagged: false,
    text,
    changed: text !== input,
    subbedBy,
    hl: matchHighlight(text, colouring, disabled),
  }
}
