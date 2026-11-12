/**
 * Report cards: the readouts that come back as a block of their own — EXP, INFO,
 * SPELLS, KHRI — are set inside a subtle card in the game output.
 *
 * Unlike the copy buttons (see listBlocks.ts), a card can't be found one line at a
 * time: SPELLS' "Fabrication:" or the end of INFO look like anything else on their
 * own. So lines are tagged as they are APPENDED, by a small state machine: a
 * report's first line opens a card, every main-stream line after it joins, and the
 * prompt that closes the command's response (the chunk separator) closes the card.
 * Each line carries its tag, so a rendered line still needs nothing but itself.
 *
 * What opens each card, from real captures:
 *
 *   EXP     Circle: 200                                (full EXP)
 *           SKILL: Rank/Percent towards next rank/…     (EXP <skill>, no Circle line)
 *   INFO    Name: Refia Highwind, …   Race: Human   Guild: Ranger
 *   SPELLS  You recall the spells you have learned from your training.
 *   KHRI    From the Subtlety tree, you know the following khri: Darken (Aug), …
 *
 * PROFILE already renders as a card of its own (the LOOK portrait card).
 *
 * Pure (no React, no store) so it can be tested against captured output.
 */

export type CardKind = 'exp' | 'info' | 'spells' | 'khri'

const OPENERS: [CardKind, RegExp][] = [
  ['exp',    /^\s*Circle:\s*\d+\s*$/],
  ['exp',    /^\s*SKILL:\s*Rank\/Percent towards next rank/],
  ['info',   /^\s*Name:.*\bRace:.*\bGuild:/],
  ['spells', /^\s*You recall the spells you have learned/],
  ['khri',   /^\s*From the \w+ tree, you know the following khri:/],
]

export function cardOpener(text: string): CardKind | null {
  for (const [kind, re] of OPENERS) if (re.test(text)) return kind
  return null
}

export interface CardTag { card: CardKind; cardStart?: true }

/**
 * One output stream's card state. `line()` for every appended text line, `end()` at
 * every separator / divider.
 */
export class CardTracker {
  private open: CardKind | null = null

  /** The tag for this line, or null when it sits outside any card. */
  line(text: string): CardTag | null {
    const opener = cardOpener(text)
    // A different report's opener inside an open card starts a new card: at login
    // the game sends INFO, EXP, SPELLS and KHRI back to back with no prompt between
    // them. The same kind continues — EXP's "SKILL:" header after its "Circle:"
    // line, and KHRI's one "From the … tree" line per tree.
    if (opener && opener !== this.open) {
      this.open = opener
      return { card: opener, cardStart: true }
    }
    return this.open ? { card: this.open } : null
  }

  end(): void { this.open = null }
}
