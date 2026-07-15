import { EventEmitter } from 'events'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { parseCmd, ParsedCmd, CmdInstruction } from './cmd-parser'

// ── .cmd script engine ──────────────────────────────────────────────────────
// A native, main-process interpreter for Genie/Wizard-style `.cmd` scripts. It
// runs client-side and is independent of Lich: it injects game commands through
// the existing game socket (`send` event) and satisfies match/waitfor by being
// fed the game's text stream (`feed`).
//
// Command set (Genie parity target):
//   flow    : goto · gosub/return · pause · exit/shutdown · if_N · if…then
//   waits   : wait · waitfor · waitforre · match · matchre · matchwait
//             · nextroom · move
//   output  : put/send · echo
//   data    : setvariable/var · deletevariable · math · counter · random · save
//   vars    : %N positional · %name user vars · $name built-ins (see setContext)
//
// Events:
//   'send'   (cmd: string, id: number)   — inject a command into the game
//   'echo'   (text: string, id: number)  — script output for the script panel
//   'status' (info: ScriptStatus)        — a script started/paused/stopped
//   'error'  (message: string, id: number)

export type ScriptState = 'running' | 'waiting' | 'paused' | 'stopped'

export interface ScriptStatus {
  id:    number
  name:  string
  state: ScriptState
}

interface Match {
  label: string
  /** Lowercased substring to search for … */
  text?: string
  /** … or a compiled regex (matchre). */
  re?:   RegExp
}

interface GosubFrame {
  retPc: number
  args:  string[]
}

interface RunState {
  id:     number
  name:   string
  parsed: ParsedCmd
  args:   string[]              // positional args: args[0] → %1, args[1] → %2 …
  vars:   Map<string, string>   // user variables (%name), lowercased keys
  gosub:  GosubFrame[]
  pc:     number                // index of the NEXT instruction to execute
  state:  ScriptState

  // Pending `match`/`matchre` lines accumulate until a `matchwait` arms them.
  pendingMatches: Match[]
  matchTable:  Match[] | null
  matchTimer:  ReturnType<typeof setTimeout> | null

  // Active blocking wait (only one at a time):
  waitForText: string | null    // waitfor: lowercased substring
  waitForRe:   RegExp | null     // waitforre
  waitPrompt:  boolean           // wait (next game prompt)
  waitRoom:    boolean           // nextroom / move (next room change)
  pauseTimer:  ReturnType<typeof setTimeout> | null
  moveTimer:   ReturnType<typeof setTimeout> | null
}

// Guards against a runaway script (e.g. a `goto` loop with no pause/wait) hard-
// locking the main process. One `step()` may execute at most this many
// instructions before yielding control back with an error.
const MAX_STEPS_PER_SLICE = 100_000

// A `move` that never produces a room change resumes after this long so the
// script isn't wedged forever on a bad exit.
const MOVE_TIMEOUT_MS = 5_000

export class CmdScriptEngine extends EventEmitter {
  private scripts = new Map<number, RunState>()
  private nextId  = 1
  /** Built-in `$variables` (e.g. charname), shared across scripts. */
  private context: Record<string, string> = {}

  /** `resolveDir` returns the current scripts folder (may change via settings). */
  constructor(private resolveDir: () => string) { super() }

  /** Merge built-in variable values ($name) provided by the host (e.g. charname). */
  setContext(patch: Record<string, string>): void {
    this.context = { ...this.context, ...patch }
  }

  private scriptDir(): string {
    const dir = this.resolveDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return dir
  }

  /** Basenames (without extension) of every `.cmd` file in the scripts folder. */
  list(): string[] {
    try {
      return readdirSync(this.scriptDir())
        .filter(f => f.toLowerCase().endsWith('.cmd'))
        .map(f => f.slice(0, -4))
        .sort((a, b) => a.localeCompare(b))
    } catch {
      return []
    }
  }

  private resolvePath(name: string): string | null {
    // Accept 'foo', 'foo.cmd', with or without surrounding whitespace. Reject
    // path separators so a script name can't escape the scripts folder.
    const base = name.trim().replace(/\.cmd$/i, '')
    if (!base || /[\\/]/.test(base)) return null
    const p = join(this.scriptDir(), base + '.cmd')
    return existsSync(p) ? p : null
  }

  // ── User file editing (powers the in-app .cmd editor) ─────────────────────────
  // Sanitize a script name to a `<base>.cmd` path inside the scripts folder,
  // rejecting path separators so a name can never escape the folder (same guard as
  // resolvePath, minus the must-exist check so we can create new files).
  private editPath(name: string): string {
    const base = name.trim().replace(/\.cmd$/i, '')
    if (!base || /[\\/]/.test(base)) throw new Error('Invalid script name')
    return join(this.scriptDir(), base + '.cmd')
  }

  /** Read a script's source. Throws if the name is invalid or the file is missing. */
  read(name: string): { name: string; content: string } {
    const p = this.editPath(name)
    if (!existsSync(p)) throw new Error('Not found: ' + name)
    return { name: name.trim().replace(/\.cmd$/i, ''), content: readFileSync(p, 'utf8') }
  }

  /** Create or overwrite a script's source. */
  write(name: string, content: string): { name: string } {
    const p = this.editPath(name)
    writeFileSync(p, content, 'utf8')
    return { name: name.trim().replace(/\.cmd$/i, '') }
  }

  /** Delete a script file (no-op if it's already gone). */
  remove(name: string): { name: string } {
    const p = this.editPath(name)
    if (existsSync(p)) rmSync(p)
    return { name: name.trim().replace(/\.cmd$/i, '') }
  }

  run(name: string, args: string[] = []): { ok: boolean; error?: string } {
    const path = this.resolvePath(name)
    if (!path) return { ok: false, error: `Script not found: ${name}` }

    let parsed: ParsedCmd
    try {
      parsed = parseCmd(readFileSync(path, 'utf8'))
    } catch (e) {
      return { ok: false, error: `Failed to read ${name}: ${String(e)}` }
    }

    const id = this.nextId++
    const state: RunState = {
      id, name: name.trim().replace(/\.cmd$/i, ''), parsed, args,
      vars: new Map(), gosub: [],
      pc: 0, state: 'running',
      pendingMatches: [], matchTable: null, matchTimer: null,
      waitForText: null, waitForRe: null, waitPrompt: false, waitRoom: false,
      pauseTimer: null, moveTimer: null,
    }
    this.scripts.set(id, state)
    this.emit('echo', `[${state.name}] started`, id)
    this.emitStatus(state)
    this.step(state)
    return { ok: true }
  }

  /** Stop one script by id, or all scripts when id is omitted. */
  stop(id?: number): void {
    if (id === undefined) {
      for (const s of [...this.scripts.values()]) this.halt(s, 'stopped by user')
      return
    }
    const s = this.scripts.get(id)
    if (s) this.halt(s, 'stopped by user')
  }

  running(): ScriptStatus[] {
    return [...this.scripts.values()].map(s => ({ id: s.id, name: s.name, state: s.state }))
  }

  /**
   * Feed a raw chunk of the game stream to every waiting script. Prompt / room
   * transitions are detected on the raw (tagged) chunk; text matching runs on
   * the XML-stripped lines.
   */
  feed(chunk: string): void {
    if (this.scripts.size === 0) return

    const hasPrompt = /<prompt/i.test(chunk)
    const hasRoom   = /room desc|roomName/i.test(chunk)

    const lines = stripXml(chunk).split('\n')
    for (const raw of lines) {
      const line = raw.trim()
      if (!line) continue
      // Snapshot: a resolved wait may `step()` and mutate the map.
      for (const s of [...this.scripts.values()]) this.matchLine(s, line)
    }

    if (hasPrompt || hasRoom) {
      for (const s of [...this.scripts.values()]) {
        if (s.state !== 'waiting') continue
        if ((s.waitPrompt && hasPrompt) || (s.waitRoom && hasRoom)) {
          this.clearWaits(s)
          this.resume(s)
        }
      }
    }
  }

  // ── stream matching ─────────────────────────────────────────────────────────

  private matchLine(s: RunState, line: string): void {
    if (s.state !== 'waiting') return
    const lower = line.toLowerCase()

    if (s.waitForText !== null) {
      if (lower.includes(s.waitForText)) { this.clearWaits(s); this.resume(s) }
      return
    }
    if (s.waitForRe !== null) {
      if (s.waitForRe.test(line)) { this.clearWaits(s); this.resume(s) }
      return
    }
    if (s.matchTable) {
      const hit = s.matchTable.find(m => m.re ? m.re.test(line) : (m.text !== undefined && lower.includes(m.text)))
      if (hit) {
        const target = s.parsed.labels.get(hit.label)
        this.clearWaits(s)
        if (target === undefined) { this.halt(s, `matched but label not found: ${hit.label}`); return }
        s.pc = target
        this.resume(s)
      }
    }
  }

  /** Continue executing after a wait/pause resolves. */
  private resume(s: RunState): void {
    if (!this.scripts.has(s.id)) return
    s.state = 'running'
    this.emitStatus(s)
    this.step(s)
  }

  /**
   * Execute instructions synchronously until a blocking instruction parks the
   * script (state → waiting/paused) or it runs off the end.
   */
  private step(s: RunState): void {
    let budget = MAX_STEPS_PER_SLICE
    while (s.state === 'running') {
      if (budget-- <= 0) {
        this.halt(s, 'aborted: ran too long without pausing (possible infinite loop)')
        return
      }
      const inst = s.parsed.instructions[s.pc]
      if (!inst) { this.halt(s, null); return }   // fell off the end → normal exit
      s.pc++
      this.exec(s, inst)
    }
  }

  /**
   * Execute a single instruction. May change pc, set a wait state, or halt.
   * Safe to call recursively (if_N / if…then run a trailing command).
   */
  private exec(s: RunState, inst: CmdInstruction): void {
    switch (inst.command) {
      case 'put':
      case 'send':
        this.emit('send', this.subst(s, inst.args), s.id)
        return

      case 'echo':
        this.emit('echo', `[${s.name}] ${this.subst(s, inst.args)}`, s.id)
        return

      case 'goto': {
        const label = this.subst(s, inst.argv[0] ?? '').toLowerCase()
        const target = s.parsed.labels.get(label)
        if (target === undefined) { this.halt(s, `goto: label not found: ${label}`); return }
        s.pc = target
        return
      }

      case 'gosub': {
        const label = this.subst(s, inst.argv[0] ?? '').toLowerCase()
        const target = s.parsed.labels.get(label)
        if (target === undefined) { this.halt(s, `gosub: label not found: ${label}`); return }
        // Remaining tokens become the subroutine's %1..%n (already substituted).
        const subArgs = inst.argv.slice(1).map(a => this.subst(s, a))
        s.gosub.push({ retPc: s.pc, args: s.args })
        s.args = subArgs
        s.pc = target
        return
      }

      case 'return': {
        const frame = s.gosub.pop()
        if (!frame) { this.halt(s, null); return }   // return with empty stack → exit
        s.args = frame.args
        s.pc = frame.retPc
        return
      }

      case 'match': {
        const label = (inst.argv[0] ?? '').toLowerCase()
        const text  = inst.args.slice(inst.argv[0]?.length ?? 0).trim()
        if (!label || !text) { this.halt(s, `match: expected <label> <text> (line ${inst.lineNo})`); return }
        s.pendingMatches.push({ label, text: this.subst(s, text).toLowerCase() })
        return
      }

      case 'matchre': {
        const label = (inst.argv[0] ?? '').toLowerCase()
        const pat   = inst.args.slice(inst.argv[0]?.length ?? 0).trim()
        const re = this.compileRe(this.subst(s, pat))
        if (!label || !re) { this.halt(s, `matchre: expected <label> <regex> (line ${inst.lineNo})`); return }
        s.pendingMatches.push({ label, re })
        return
      }

      case 'matchwait': {
        if (s.pendingMatches.length === 0) { this.halt(s, `matchwait with no preceding match (line ${inst.lineNo})`); return }
        s.matchTable = s.pendingMatches
        s.pendingMatches = []
        s.state = 'waiting'
        const secs = parseFloat(inst.argv[0] ?? '')
        if (!Number.isNaN(secs) && secs > 0) {
          // On timeout, fall through to the instruction after matchwait.
          s.matchTimer = setTimeout(() => { this.clearWaits(s); this.resume(s) }, secs * 1000)
        }
        this.emitStatus(s)
        return
      }

      case 'waitfor': {
        const text = this.subst(s, inst.args).trim().toLowerCase()
        if (!text) { this.halt(s, `waitfor: missing text (line ${inst.lineNo})`); return }
        s.waitForText = text
        s.state = 'waiting'
        this.emitStatus(s)
        return
      }

      case 'waitforre': {
        const re = this.compileRe(this.subst(s, inst.args).trim())
        if (!re) { this.halt(s, `waitforre: invalid regex (line ${inst.lineNo})`); return }
        s.waitForRe = re
        s.state = 'waiting'
        this.emitStatus(s)
        return
      }

      case 'wait': {
        s.waitPrompt = true
        s.state = 'waiting'
        this.emitStatus(s)
        return
      }

      case 'nextroom': {
        s.waitRoom = true
        s.state = 'waiting'
        this.emitStatus(s)
        return
      }

      case 'move': {
        const dir = this.subst(s, inst.args).trim() || 'go'
        this.emit('send', dir, s.id)
        s.waitRoom = true
        s.state = 'waiting'
        s.moveTimer = setTimeout(() => { this.clearWaits(s); this.resume(s) }, MOVE_TIMEOUT_MS)
        this.emitStatus(s)
        return
      }

      case 'pause': {
        const secs = parseFloat(inst.argv[0] ?? '')
        const ms = (Number.isNaN(secs) ? 1 : secs) * 1000
        s.state = 'paused'
        this.emitStatus(s)
        s.pauseTimer = setTimeout(() => { s.pauseTimer = null; this.resume(s) }, ms)
        return
      }

      case 'setvariable':
      case 'setv':
      case 'var': {
        const name = (inst.argv[0] ?? '').toLowerCase()
        const value = this.subst(s, inst.args.slice(inst.argv[0]?.length ?? 0).trim())
        if (!name) { this.halt(s, `setvariable: missing name (line ${inst.lineNo})`); return }
        s.vars.set(name, value)
        return
      }

      case 'deletevariable':
      case 'delvariable':
      case 'unvar': {
        s.vars.delete((inst.argv[0] ?? '').toLowerCase())
        return
      }

      case 'math': {
        // math <var> <op> <value>
        const name = (inst.argv[0] ?? '').toLowerCase()
        const op   = (inst.argv[1] ?? '').toLowerCase()
        const val  = Number(this.subst(s, inst.argv[2] ?? '0'))
        if (!name) { this.halt(s, `math: missing var (line ${inst.lineNo})`); return }
        s.vars.set(name, String(this.applyMath(Number(s.vars.get(name) ?? '0'), op, val)))
        return
      }

      case 'counter': {
        // counter <op> <value>  → operates on %c
        const op  = (inst.argv[0] ?? '').toLowerCase()
        const val = Number(this.subst(s, inst.argv[1] ?? '0'))
        s.vars.set('c', String(this.applyMath(Number(s.vars.get('c') ?? '0'), op, val)))
        return
      }

      case 'random': {
        const lo = Math.floor(Number(this.subst(s, inst.argv[0] ?? '0')))
        const hi = Math.floor(Number(this.subst(s, inst.argv[1] ?? '0')))
        const [a, b] = lo <= hi ? [lo, hi] : [hi, lo]
        s.vars.set('random', String(a + Math.floor(Math.random() * (b - a + 1))))
        return
      }

      case 'save': {
        s.vars.set('s', this.subst(s, inst.args))
        return
      }

      case 'if': {
        // if <expr> then <command>
        const m = /\bthen\b/i.exec(inst.args)
        if (!m) { this.halt(s, `if: missing 'then' (line ${inst.lineNo})`); return }
        const expr = inst.args.slice(0, m.index).trim()
        const rest = inst.args.slice(m.index + m[0].length).trim()
        if (this.evalCond(s, expr) && rest) this.exec(s, makeInst(rest, inst.lineNo))
        return
      }

      case 'exit':
      case 'shutdown':
        this.halt(s, null)
        return

      default: {
        // if_N <command>: run the trailing command only when the script has at
        // least N arguments in the current context.
        const ifn = /^if_(\d+)$/.exec(inst.command)
        if (ifn) {
          const n = Number(ifn[1])
          if (s.args.length >= n && inst.args) this.exec(s, makeInst(inst.args, inst.lineNo))
          return
        }
        // Unknown keyword: warn and continue so a script degrades instead of dying.
        this.emit('echo', `[${s.name}] unknown command '${inst.command}' (line ${inst.lineNo})`, s.id)
      }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  /** Substitute %N positional args, %name user vars, and $name built-ins. */
  private subst(s: RunState, text: string): string {
    if (!text || !/[%$]/.test(text)) return text
    return text.replace(/([%$])(\w+)/g, (_m, sigil: string, name: string) => {
      if (sigil === '$') return this.context[name.toLowerCase()] ?? ''
      if (/^\d+$/.test(name)) {
        const n = Number(name)
        return n === 0 ? s.args.join(' ') : (s.args[n - 1] ?? '')
      }
      return s.vars.get(name.toLowerCase()) ?? ''
    })
  }

  private applyMath(cur: number, op: string, val: number): number {
    switch (op) {
      case 'set':  case '=':  return val
      case 'add':  case '+':  return cur + val
      case 'subtract': case 'sub': case '-': return cur - val
      case 'multiply': case 'mul': case '*': return cur * val
      case 'divide':   case 'div': case '/': return val === 0 ? cur : cur / val
      default: return cur
    }
  }

  /** Evaluate a `if` condition: `A OP B`, or a lone truthy token. */
  private evalCond(s: RunState, expr: string): boolean {
    const e = this.subst(s, expr).trim()
    const m = /^(.*?)\s*(==|=|!=|<>|>=|<=|>|<|\beq\b|\bne\b|\bcontains\b)\s*(.*)$/i.exec(e)
    if (!m) return !!e && e !== '0' && e.toLowerCase() !== 'false'
    const a = m[1].trim(), op = m[2].toLowerCase(), b = m[3].trim()
    const na = Number(a), nb = Number(b)
    const numeric = a !== '' && b !== '' && !Number.isNaN(na) && !Number.isNaN(nb)
    switch (op) {
      case '=': case '==': case 'eq': return numeric ? na === nb : a.toLowerCase() === b.toLowerCase()
      case '!=': case '<>': case 'ne': return numeric ? na !== nb : a.toLowerCase() !== b.toLowerCase()
      case '>':  return numeric ? na >  nb : a > b
      case '<':  return numeric ? na <  nb : a < b
      case '>=': return numeric ? na >= nb : a >= b
      case '<=': return numeric ? na <= nb : a <= b
      case 'contains': return a.toLowerCase().includes(b.toLowerCase())
      default: return false
    }
  }

  /** Compile a `/pattern/flags` or bare-pattern regex; null on failure. */
  private compileRe(src: string): RegExp | null {
    if (!src) return null
    try {
      const m = /^\/(.*)\/([a-z]*)$/is.exec(src)
      return m ? new RegExp(m[1], m[2] || 'i') : new RegExp(src, 'i')
    } catch { return null }
  }

  private clearWaits(s: RunState): void {
    if (s.matchTimer) { clearTimeout(s.matchTimer); s.matchTimer = null }
    if (s.moveTimer)  { clearTimeout(s.moveTimer);  s.moveTimer = null }
    s.matchTable = null
    s.waitForText = null
    s.waitForRe = null
    s.waitPrompt = false
    s.waitRoom = false
  }

  /** Terminate a script. `reason` null = normal completion; string = error/stop. */
  private halt(s: RunState, reason: string | null): void {
    if (s.pauseTimer) clearTimeout(s.pauseTimer)
    this.clearWaits(s)
    s.state = 'stopped'
    this.scripts.delete(s.id)
    if (reason && reason !== 'stopped by user') this.emit('error', `[${s.name}] ${reason}`, s.id)
    this.emit('echo', `[${s.name}] ${reason ? reason : 'finished'}`, s.id)
    this.emitStatus(s)
  }

  private emitStatus(s: RunState): void {
    this.emit('status', { id: s.id, name: s.name, state: s.state } as ScriptStatus)
  }
}

/** Tokenize one line into an instruction (for inline if_N / if…then commands). */
function makeInst(raw: string, lineNo: number): CmdInstruction {
  const t = raw.trim()
  const sp = t.search(/\s/)
  const command = (sp === -1 ? t : t.slice(0, sp)).toLowerCase()
  const args = sp === -1 ? '' : t.slice(sp + 1).trim()
  const argv = args ? args.split(/\s+/) : []
  return { command, args, argv, lineNo, raw: t }
}

/** Remove XML/HTML tags so scripts match against the visible game text only. */
function stripXml(chunk: string): string {
  return chunk.replace(/<[^>]*>/g, '')
}
