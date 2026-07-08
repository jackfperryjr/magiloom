// ── .cmd script parser ──────────────────────────────────────────────────────
// Tokenizes a Genie/Wizard-style `.cmd` script into a flat instruction list plus
// a label → index map. Parsing is intentionally dumb and side-effect free: it
// does no variable substitution and evaluates nothing. The engine
// (cmd-script-engine.ts) owns all runtime behaviour, so the same ParsedCmd can be
// re-run with different arguments.

export interface CmdInstruction {
  /** Lowercased command keyword, e.g. 'put', 'goto', 'matchwait'. */
  command: string
  /** Everything after the command, verbatim (used by put/echo). */
  args:    string
  /** Whitespace-split args (used by goto/match/pause/…). */
  argv:    string[]
  /** 1-based source line number, for error messages. */
  lineNo:  number
  /** The original trimmed source line. */
  raw:     string
}

export interface ParsedCmd {
  instructions: CmdInstruction[]
  /** Label name (lowercased) → index into `instructions`. */
  labels: Map<string, number>
}

// A label line is a single bare word terminated by a colon, e.g. `start:`.
// No embedded whitespace — that disambiguates it from commands like
// `match done You have arrived:` whose trailing colon is part of the match text.
const LABEL_RE = /^([A-Za-z0-9_.-]+):$/

export function parseCmd(source: string): ParsedCmd {
  const instructions: CmdInstruction[] = []
  const labels = new Map<string, number>()

  const lines = source.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = lines[i].trim()

    // Skip blanks and comments (# … ). Genie also treats `//` as a comment.
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue

    const label = LABEL_RE.exec(raw)
    if (label) {
      // Labels point at the NEXT instruction to run. Duplicate labels: last wins,
      // matching Genie (goto lands on the most recent definition).
      labels.set(label[1].toLowerCase(), instructions.length)
      continue
    }

    const sp = raw.search(/\s/)
    const command = (sp === -1 ? raw : raw.slice(0, sp)).toLowerCase()
    const args = sp === -1 ? '' : raw.slice(sp + 1).trim()
    const argv = args ? args.split(/\s+/) : []

    instructions.push({ command, args, argv, lineNo, raw })
  }

  return { instructions, labels }
}
