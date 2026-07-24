import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { existsSync } from 'fs'
import { join } from 'path'
import { createConnection, Socket } from 'net'

export type LichStatus = 'stopped' | 'starting' | 'ready' | 'error'

export class LichManager extends EventEmitter {
  private process:   ChildProcess | null = null
  private status:    LichStatus = 'stopped'
  private pollTimer: ReturnType<typeof setInterval> | null = null

  getLichPath(override?: string): string {
    if (override && existsSync(override)) return override
    const home = process.env['HOME'] || process.env['USERPROFILE'] || ''
    const candidates = [
      'C:\\Ruby4Lich5\\Lich5\\lich.rbw',
      join('C:\\', 'Ruby4Lich5', 'Lich5', 'lich.rbw'),
      join(home, 'Desktop', 'Lich5', 'lich.rbw'),
      'C:\\lich5\\lich.rbw',
      join(home, 'lich5', 'lich.rbw'),
      join(home, 'lich5', 'lich.rb'),
    ]
    return candidates.find(existsSync) ?? ''
  }

  getRubyPath(): string {
    const candidates = [
      'C:\\Ruby4Lich5\\4.0.0\\bin\\ruby.exe',
      'C:\\Ruby4Lich5\\bin\\ruby.exe',
      'C:\\Ruby31\\bin\\ruby.exe',
      'ruby',
    ]
    return candidates.find(p => p === 'ruby' || existsSync(p)) ?? 'ruby'
  }

  /**
   * Spawn Lich and immediately start gameConn retrying its proxy port.
   * Lich opens port 11024 within ~2-3s; the retry loop catches it.
   * No polling here — the caller (index.ts) drives the connection.
   */
  /**
   * Spawn Lich using --frostbite -g host:port, exactly like Frostbite does.
   * No --login, no entry.yaml — Lich connects to the game server directly
   * using the host:port we provide from our SGE auth.
   */
  spawnOnly(
    gameHost: string,
    gamePort: number,
    lichPathOverride?: string
  ): { ok: boolean; error?: string } {
    if (this.process) this.stop()

    const lichPath = this.getLichPath(lichPathOverride)
    if (!lichPath) {
      this.setStatus('error')
      return { ok: false, error: 'Lich not found. Set the path in Settings.' }
    }

    const rubyPath = this.getRubyPath()

    const args = [
      lichPath,
      '--dragonrealms',
      '--frostbite',
      `-g`, `${gameHost}:${gamePort}`,
    ]

    this.emit('log', `Launching Lich: ${rubyPath} ${args.join(' ')}`)
    this.setStatus('starting')
    this._spawn(rubyPath, args)

    // Signal ready after 8s — gives Lich time to connect to game and parse
    // the initial XML (character name, vitals etc) before scripts start running
    setTimeout(() => {
      if (this.status === 'starting') {
        this.setStatus('ready')
        this.emit('ready', 11024)
      }
    }, 8000)

    return { ok: true }
  }

  /**
   * Launch Lich fully headless: it self-authenticates from its saved-login file
   * (data/entry.yaml — see lich-entry.ts writeLichEntry) via `--login <Char>`,
   * connects to the game itself, and exposes a detachable client on `listenPort`
   * (`--headless=PORT` expands to `--without-frontend --detachable-client=PORT`).
   * No frostbite frontend and no game key forwarded from us; the caller's
   * GameConnection attaches to `listenPort` with a plain connect (no handshake) and
   * Lich streams StormFront XML to it. Credentials live in entry.yaml, not on the
   * command line, so the launch line is safe to log verbatim.
   */
  spawnHeadless(
    characterName: string,
    listenPort: number,
    lichPathOverride?: string
  ): { ok: boolean; error?: string } {
    if (this.process) this.stop()

    const lichPath = this.getLichPath(lichPathOverride)
    if (!lichPath) {
      this.setStatus('error')
      return { ok: false, error: 'Lich not found. Set the path in Settings.' }
    }
    const rubyPath = this.getRubyPath()

    const args = [
      lichPath,
      '--dragonrealms',
      '--login', characterName,
      `--headless=${listenPort}`,
    ]

    this.emit('log', `Launching Lich (headless, port ${listenPort}): ${rubyPath} ${args.join(' ')}`)
    this.setStatus('starting')
    this._spawn(rubyPath, args)

    // Lich self-login (SGE + game connect) then opens the detachable port; the
    // GameConnection retry loop attaches once it's up. Signal ready after 8s like
    // spawnOnly so scripts don't start before the initial XML is parsed.
    setTimeout(() => {
      if (this.status === 'starting') {
        this.setStatus('ready')
        this.emit('ready', listenPort)
      }
    }, 8000)

    return { ok: true }
  }

  /**
   * Launch Lich in detachable-client mode for script execution only.
   * Uses port polling since this mode doesn't broker the game connection.
   */
  launchForScripts(
    characterName: string,
    lichPathOverride?: string,
    port = 4901
  ): { ok: boolean; error?: string } {
    if (this.status === 'starting' || this.status === 'ready') return { ok: true }
    if (this.process) this.stop()

    const lichPath = this.getLichPath(lichPathOverride)
    if (!lichPath) {
      this.setStatus('error')
      return { ok: false, error: 'Lich not found. Set the path in Settings.' }
    }

    const rubyPath = this.getRubyPath()

    const args = [
      lichPath,
      `--detachable-client=${port}`,
      '--without-frontend',
      '--dragonrealms',
    ]

    this.emit('log', `Launching Lich (script mode): ${rubyPath} ${args.join(' ')}`)
    this.setStatus('starting')
    this._spawn(rubyPath, args)
    this._pollPort(port)
    return { ok: true }
  }

  stop(): void {
    this.clearPoll()
    this.process?.kill('SIGTERM')
    this.process = null
    this.setStatus('stopped')
  }

  /**
   * Stop the current Lich and resolve once it has FULLY exited (its 'close' event,
   * after stdio drains). Switching characters spawns a new headless Lich on the same
   * port, so the old one must be gone first — otherwise the new Lich can't bind the
   * detachable-client port and dies, which is the "switch fails until I direct-connect
   * first" bug. Resolves immediately when nothing is running, and after `timeoutMs` if
   * the process refuses to die so a switch never hangs.
   */
  stopAndWait(timeoutMs = 4000): Promise<void> {
    this.clearPoll()
    const proc = this.process
    this.process = null
    this.setStatus('stopped')
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let done = false
      const finish = () => { if (done) return; done = true; resolve() }
      proc.once('close', finish)
      try { proc.kill('SIGTERM') } catch { finish() }
      setTimeout(finish, timeoutMs)
    })
  }

  /**
   * Resolve once nothing is listening on `port` (a connect attempt is refused), or
   * after `timeoutMs`. Gives the OS a beat to release the socket a just-killed Lich
   * held before the replacement tries to bind it.
   */
  waitForPortFree(port: number, timeoutMs = 3000): Promise<void> {
    const started = Date.now()
    return new Promise<void>((resolve) => {
      const probe = () => {
        const s = createConnection({ port, host: '127.0.0.1' })
        const cleanup = () => { s.removeAllListeners(); s.destroy() }
        s.on('connect', () => {                    // still held — wait and retry
          cleanup()
          if (Date.now() - started >= timeoutMs) resolve()
          else setTimeout(probe, 150)
        })
        s.on('error', () => { cleanup(); resolve() })  // refused → free
      }
      probe()
    })
  }

  getStatus(): LichStatus { return this.status }

  private _spawn(rubyPath: string, args: string[]): void {
    const proc = spawn(rubyPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    this.process = proc
    proc.stdin?.end()

    // Lich's own logging (Lich.log) goes to STDERR, so this is where the "why did
    // it quit" detail lives. Keep a tail so we can replay it on exit — a fast/quiet
    // exit can flush its final stderr AFTER the 'exit' event, which would otherwise
    // be lost.
    const tail: string[] = []
    const record = (l: string) => { tail.push(l); if (tail.length > 80) tail.shift() }
    // True only while `proc` is the manager's current process. Once it's replaced by a
    // new spawn or intentionally stopped (this.process !== proc), its late stdio/close
    // events must NOT touch status or emit errors — otherwise stopping the old Lich
    // during a character switch surfaces as a spurious "Lich exited" failure.
    const current = () => this.process === proc

    proc.stdout?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(Boolean).forEach(l => { record(l); this.emit('log', l) })
    })
    proc.stderr?.on('data', (d: Buffer) => {
      d.toString().split('\n').filter(Boolean).forEach(l => {
        record(`[stderr] ${l}`)
        this.emit('log', `[stderr] ${l}`)
        if (/error|failed|invalid|no such|cannot/i.test(l) && this.status !== 'ready' && current()) {
          this.setStatus('error')
          this.emit('error', l.trim())
        }
      })
    })

    // Record the exit code, but do the diagnostic on 'close' — it fires only after
    // stdout/stderr have fully drained, so we never miss Lich's final words.
    let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null
    proc.on('exit', (code, signal) => { exited = { code, signal }; if (current()) this.clearPoll() })
    proc.on('close', () => {
      // A stale process we've already replaced/stopped: stay silent.
      if (!current()) return
      if (this.status === 'ready') { this.setStatus('stopped'); this.process = null; return }
      const code = exited?.code ?? null
      const signal = exited?.signal ?? null
      const reason = signal
        ? `terminated by signal ${signal}`
        : code !== null ? `exited with code ${code}` : 'terminated unexpectedly'
      if (tail.length) {
        this.emit('log', '[lich] ── Lich output before exit ──')
        for (const l of tail) this.emit('log', l)
        this.emit('log', '[lich] ── end Lich output ──')
      } else {
        this.emit('log', '[lich] Lich produced no output before exiting (silent exit — likely the wrong headless launch mode).')
      }
      this.emit('log', `[lich] Process ${reason}`)
      this.setStatus('error')
      this.emit('error', `Lich ${reason}. Check the log for details.`)
      this.process = null
    })
  }

  private _pollPort(port: number): void {
    this.clearPoll()
    let attempts = 0
    this.pollTimer = setInterval(() => {
      attempts++
      if (attempts % 30 === 0) {
        this.emit('log', `[lich] Still waiting for Lich to start… (${attempts}s elapsed)`)
      }
      if (attempts > 300) {
        this.clearPoll()
        this.setStatus('error')
        this.emit('error', 'Timed out waiting for Lich scripting port (5 min).')
        return
      }
      const s = createConnection({ port, host: '127.0.0.1' })
      s.on('connect', () => {
        s.destroy()
        this.clearPoll()
        this.setStatus('ready')
        this.emit('ready', port)
      })
      s.on('error', () => s.destroy())
    }, 1000)
  }

  private setStatus(s: LichStatus) {
    this.status = s
    this.emit('status', s)
  }

  private clearPoll(): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
  }
}

// ── LichConnection ─────────────────────────────────────────────────────────────
export class LichConnection extends EventEmitter {
  private socket: Socket | null = null

  connect(port = 4901): void {
    if (this.socket) { this.socket.destroy(); this.socket = null }
    const s = new Socket()
    s.setEncoding('latin1')
    s.on('connect', () => { this.socket = s; this.emit('connected') })
    s.on('close',   () => { this.socket = null })
    s.on('error',   () => { this.socket = null })
    s.connect(port, '127.0.0.1')
  }

  send(cmd: string): boolean {
    if (!this.socket || this.socket.destroyed) return false
    this.socket.write(cmd.endsWith('\n') ? cmd : cmd + '\n', 'latin1')
    return true
  }

  isConnected(): boolean {
    return !!(this.socket && !this.socket.destroyed)
  }

  disconnect(): void {
    this.socket?.destroy()
    this.socket = null
  }
}
