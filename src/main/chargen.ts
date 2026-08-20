import { Socket } from 'net'
import { EventEmitter } from 'events'

/**
 * DragonRealms' character generator.
 *
 * Creation is not a separate service — it's an ordinary game session launched
 * against character slot "0". The SGE side is identical to logging in a real
 * character (`L 0 STORM` on the eaccess socket, see sge-auth.ts); only the game
 * socket differs:
 *
 *   - the handshake identifies as WIZARD, not STORMFRONT, and ends with "GOOD"
 *   - there is no <playerID> validation round trip, so the session is live as
 *     soon as the handshake is written
 *   - the generator is line-oriented plain text (with the occasional <d cmd=…>
 *     link), so commands go up terminated by a bare \n and output comes back
 *     unchunked — none of GameConnection's XML tag-depth accumulation applies,
 *     which is why this is its own socket rather than a flag on that class
 *
 * Protocol confirmed against the Saga client's implementation.
 */
export class CharGenConnection extends EventEmitter {
  private sock: Socket | null = null

  connect(host: string, port: number, key: string): void {
    this.disconnect()
    const s = new Socket()
    this.sock = s
    s.setEncoding('latin1')
    s.setNoDelay(true)
    s.on('connect', () => {
      s.write(key + '\r\n', 'latin1')
      s.write('/FE:WIZARD /VERSION:1.0.1.22 /P:WIN_UNKNOWN\r\n', 'latin1')
      s.write('GOOD\r\n', 'latin1')
      this.emit('connected')
    })
    s.on('data',  (c: string) => this.emit('data', c))
    s.on('error', (e)         => this.emit('error', e.message))
    s.on('close', ()          => { if (this.sock === s) this.sock = null; this.emit('closed') })
    s.connect(port, host)
  }

  isOpen(): boolean { return !!this.sock && !this.sock.destroyed }

  /** One generator command. Trailing newlines are normalised to a single \n. */
  send(line: string): void {
    if (!this.isOpen()) return
    this.sock!.write(line.replace(/[\r\n]+$/, '') + '\n', 'latin1')
  }

  disconnect(): void {
    const s = this.sock
    this.sock = null
    s?.destroy()
  }
}
