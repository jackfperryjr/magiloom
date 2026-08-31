// Quick actions: the click-to-run buttons in the Scripts panel. One button is a
// label plus a target dispatched one of three ways — as a raw game command, as a
// native .cmd script, or as a Lich script. All three ultimately go through the
// same command path the input bar uses, so aliases, echo and logging behave
// exactly as if the player had typed it.
//
// Also home to the `;list` reply parser: knowing which Lich scripts are running
// is the same problem (what can I start, what can I stop), and keeping the parse
// out of the store makes it testable on its own.

export type QuickKind = 'command' | 'cmd' | 'lich'

export interface QuickAction {
  id:     string
  label:  string
  kind:   QuickKind
  target: string
}

export const QUICK_KINDS: { id: QuickKind; label: string; hint: string }[] = [
  { id: 'command', label: 'Command',    hint: 'sent as typed' },
  { id: 'cmd',     label: '.cmd script', hint: 'runs a native script' },
  { id: 'lich',    label: 'Lich script', hint: 'runs ;script' },
]

export const newQuickAction = (): QuickAction => ({
  id: Math.random().toString(36).slice(2, 10),
  label: '',
  kind: 'command',
  target: '',
})

// The literal text a quick action sends. Prefixes are only added when the user
// hasn't already typed one, so pasting ";sloot" into a Lich action still works.
export function quickActionCommand(a: { kind: QuickKind; target: string }): string {
  const t = a.target.trim()
  if (!t) return ''
  switch (a.kind) {
    case 'cmd':  return t.startsWith('.') ? t : `.${t}`
    case 'lich': return t.startsWith(';') ? t : `;${t}`
    default:     return t
  }
}

// What to show on a button whose label the user left blank.
export const quickActionLabel = (a: QuickAction): string =>
  a.label.trim() || quickActionCommand(a) || 'unnamed'

// ── Lich `;list` ──────────────────────────────────────────────────────────────
// Lich answers `;list` on a single line via `respond` (Lich5 lib/global_defs.rb):
//   --- Lich: no active scripts
//   --- Lich: sloot, bigshot (paused), waggle
// Every other `--- Lich:` notice is prose, so we accept only a payload shaped
// like that comma-joined list of script names. Returns null for anything else,
// which lets the caller leave unrelated Lich chatter alone (visible, unparsed).

export interface LichScript { name: string; paused: boolean }

const LICH_PREFIX  = /^---\s*Lich:\s*(.+?)\s*$/
const SCRIPT_NAME  = /^[A-Za-z0-9][\w.-]*$/

export function parseLichList(text: string): LichScript[] | null {
  const m = LICH_PREFIX.exec(text)
  if (!m) return null
  const payload = m[1]
  if (/^no active scripts\.?$/i.test(payload)) return []

  const out: LichScript[] = []
  for (const part of payload.split(',')) {
    const p = part.trim()
    if (!p) return null
    const paused = / \(paused\)$/.test(p)
    const name   = paused ? p.slice(0, -' (paused)'.length) : p
    // Any token that isn't a bare script name means this was ordinary Lich
    // prose that happened to contain a comma — reject the whole line.
    if (!SCRIPT_NAME.test(name)) return null
    out.push({ name, paused })
  }
  return out.length > 0 ? out : null
}
