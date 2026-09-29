// Server-clock offset, learned from `<prompt time="…">`.
//
// DR's timers — <roundTime value=…/> and <castTime value=…/> — are absolute server
// epochs, and the countdowns compare them against the local clock. A device whose
// clock is a few seconds off (phones especially) would show RT and spell prep wrong
// by exactly that much. Every prompt carries the server's time, so the gap between
// it and Date.now() at arrival tells us the skew.
//
// A single sample is noisy in one direction only: the prompt time is floored to the
// second and the line spends some latency in flight, so each sample UNDER-reads the
// true offset by up to ~1s + latency and never over-reads it. The max over recent
// samples therefore converges on the truth from below. A rolling window (rather
// than an all-time max) lets it follow the local clock when NTP steps it.
//
// Skew under DEADBAND is left uncorrected: that's inside the 1s quantization, and
// a well-synced clock is better served by the raw comparison than by an estimate
// that starts up to a second low.

const WINDOW   = 30
const DEADBAND = 1500

export class ServerClock {
  private samples: number[] = []

  /** Record a prompt: `serverSec` from its time attr, `localMs` = Date.now() at arrival. */
  observe(serverSec: number, localMs: number): void {
    if (!(serverSec > 0)) return
    this.samples.push(serverSec * 1000 - localMs)
    if (this.samples.length > WINDOW) this.samples.shift()
  }

  /** Estimated server-minus-local offset in ms (0 when within the deadband). */
  offset(): number {
    if (this.samples.length === 0) return 0
    const est = Math.max(...this.samples)
    return Math.abs(est) < DEADBAND ? 0 : est
  }

  /** Convert a server epoch-ms timestamp to local epoch-ms. 0 (no timer) stays 0. */
  toLocal(serverMs: number): number {
    return serverMs > 0 ? serverMs - this.offset() : 0
  }

  reset(): void { this.samples = [] }
}
