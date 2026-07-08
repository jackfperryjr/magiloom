// Genie-style aliases and triggers — pure, testable logic shared by the send
// chokepoint (aliases) and the incoming-stream tap (triggers) in
// useGameConnection. No React, no IPC here.

export interface Alias {
  id:      string
  pattern: string   // first word typed (case-insensitive), e.g. "kk"
  command: string   // expansion, may use %1..%9 (args) and %0 (all args)
  enabled: boolean
  class?:  string   // optional Genie-style class; disabled classes are skipped
}

export interface Trigger {
  id:      string
  pattern: string   // substring, or a regex when isRegex
  isRegex: boolean
  command: string   // fired on match; %0 = whole match, %1..%9 = capture groups
  enabled: boolean
  class?:  string   // optional Genie-style class; disabled classes are skipped
}

// A rule is live when it's individually enabled AND its class (if any) isn't in
// the disabled set. No class → always governed only by `enabled`.
const NO_DISABLED: ReadonlySet<string> = new Set()
function classActive(cls: string | undefined, disabled: ReadonlySet<string>): boolean {
  return !cls || !disabled.has(cls)
}

// %1..%9 → args[0..8]; %0 → all args joined. Unfilled slots become ''.
function subArgs(template: string, args: string[]): string {
  return template.replace(/%(\d)/g, (_m, d: string) => {
    const n = Number(d)
    return n === 0 ? args.join(' ') : (args[n - 1] ?? '')
  })
}

// %0 → whole match, %1..%9 → capture groups (undefined groups become '').
function subMatch(template: string, m: RegExpExecArray): string {
  return template.replace(/%(\d)/g, (_x, d: string) => m[Number(d)] ?? '')
}

/**
 * Expand a typed line when its first word matches an enabled alias. Recurses so
 * an alias can expand into another alias, with a depth cap to stop cycles.
 * Returns the original line unchanged when nothing matches.
 */
export function expandAlias(
  line: string, aliases: Alias[], disabled: ReadonlySet<string> = NO_DISABLED, depth = 0,
): string {
  if (depth > 10) return line
  const trimmed = line.trim()
  if (!trimmed) return line

  const sp   = trimmed.search(/\s/)
  const word = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase()
  const rest = sp === -1 ? '' : trimmed.slice(sp + 1).trim()
  const args = rest ? rest.split(/\s+/) : []

  const a = aliases.find(x => x.enabled && classActive(x.class, disabled) && x.pattern.trim().toLowerCase() === word)
  if (!a) return line

  return expandAlias(subArgs(a.command, args), aliases, disabled, depth + 1)
}

/**
 * Commands to fire for a single incoming game line, from all enabled triggers.
 * A malformed regex is skipped rather than throwing.
 */
export function matchTriggers(
  line: string, triggers: Trigger[], disabled: ReadonlySet<string> = NO_DISABLED,
): string[] {
  const out: string[] = []
  for (const t of triggers) {
    if (!t.enabled || !classActive(t.class, disabled) || !t.pattern.trim() || !t.command.trim()) continue
    if (t.isRegex) {
      let re: RegExp | null = null
      try { re = new RegExp(t.pattern, 'i') } catch { re = null }
      if (!re) continue
      const m = re.exec(line)
      if (m) out.push(subMatch(t.command, m))
    } else if (line.toLowerCase().includes(t.pattern.toLowerCase())) {
      out.push(t.command.replace(/%0/g, line).replace(/%[1-9]/g, ''))
    }
  }
  return out
}
