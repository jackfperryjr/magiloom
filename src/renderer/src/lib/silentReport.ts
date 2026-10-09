/**
 * Hiding the reply to a command the client sent on its own.
 *
 * The client polls a few reports in the background (EXP, to keep rested experience
 * current) and has to keep their text out of the game window. The obvious way — set
 * a flag when the command is sent, clear it at the next prompt — is wrong in both
 * directions, and it is what the EXP poll used to do:
 *
 *   • Prompts are not rare. Vitals, other players and running scripts all produce
 *     them, so one very often lands between sending the command and the reply
 *     starting — more often still on the web client, where the round trip is longer.
 *     That prompt cleared the flag, and the whole report then printed.
 *   • While the flag was up it hid EVERYTHING on the main stream, so whatever did
 *     arrive in that gap — someone speaking, a death, an arrival — was swallowed.
 *
 * So the window is opened by the reply itself. After begin(), nothing is hidden
 * until a line matching `start` arrives; from there the reply's monospaced block is
 * hidden up to the prompt that ends it. Reports are sent as one `<output
 * class="mono">` block, which is what lets "the reply" be told from an unrelated
 * line arriving at the same moment. Prompts before the reply only count down a
 * give-up budget, for the reply that never comes.
 *
 * Pure (no store, no DOM) so the sequence can be tested line by line.
 */
export class SilentReport {
  private pending = false
  private active  = false
  private budget  = 0

  /**
   * @param start  matches the first line of the reply (trimmed)
   * @param giveUp prompts to wait for a reply before standing down
   */
  constructor(private readonly start: RegExp, private readonly giveUp = 4) {}

  /** The command has just been sent; its reply should be hidden. */
  begin(): void {
    this.pending = true
    this.active  = false
    this.budget  = this.giveUp
  }

  /** Stand down — the player asked for this report themselves, so show it. */
  cancel(): void {
    this.pending = false
    this.active  = false
  }

  /** One main-stream line. True when it is part of the hidden reply. */
  line(text: string, isMono: boolean): boolean {
    if (!isMono) return false
    if (this.pending && !this.active && this.start.test(text.trim())) this.active = true
    return this.active
  }

  /** A prompt arrived. True when it closed a reply that was being hidden. */
  prompt(): boolean {
    if (this.active) { this.cancel(); return true }
    if (this.pending && --this.budget <= 0) this.pending = false
    return false
  }
}
