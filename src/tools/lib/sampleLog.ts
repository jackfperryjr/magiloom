/**
 * A synthetic DragonRealms log, in exactly the format the app writes.
 *
 * It exists so someone arriving at the analyzer with no account and no log files can
 * press one button and see what the thing actually does — a page of empty tables
 * explains nothing. It doubles as a render fixture: the sample exercises every panel
 * (experience, rooms, combat, multiple sessions), so if a table breaks it breaks here
 * in plain view rather than only for a signed-in user with real logs.
 *
 * Composed the same way the tests are: real stream shapes pushed through the same
 * strip-to-lines transform, so it can't drift into being a format that never occurs.
 */

const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (min: number): string => `${pad(9 + Math.floor(min / 60))}:${pad(min % 60)}:00`

/** One exp update, split across two lines exactly as the tag-stripping produces. */
function exp(min: number, abbr: string, rank: number, pct: number): string[] {
  return [`[${clock(min)}] ${abbr}`, `[${clock(min)}] : ${rank} ${pct}% [ 1/34]`]
}

const line = (min: number, text: string): string => `[${clock(min)}] ${text}`

export function sampleLog(): { name: string; content: string } {
  const out: string[] = []

  // ── A morning in the Crossing, then out to hunt ──────────────────────────────
  out.push(line(0, '[Crossing, Town Square Central]'))
  out.push(line(1, 'A courier rushes past, clutching a bundle of scrolls.'))
  out.push(...exp(2, 'Aug', 305, 10))
  out.push(line(3, '[Crossing, Hodierna Way]'))
  out.push(line(5, '[Crossing, Northeast Gate]'))
  out.push(line(7, '[Northeast Wilds, Trail]'))

  // Hunting: kills interleaved with experience, over about an hour.
  const creatures = ['kobold', 'kobold', 'gnoll', 'kobold', 'gnoll', 'wolf']
  creatures.forEach((c, i) => {
    const t = 10 + i * 8
    out.push(line(t, `A ${c} charges at you!`))
    out.push(line(t + 1, `You swing a broadsword at the ${c}!`))
    out.push(line(t + 2, `The ${c} falls to the ground and dies.`))
    out.push(...exp(t + 3, 'LE', 38 + Math.floor(i / 2), (i * 17) % 100))
    out.push(...exp(t + 3, 'Ev', 45, (i * 23) % 100))
    if (i % 3 === 0) out.push(line(t + 4, `You pick up ${120 + i * 40} coins.`))
    if (i % 2 === 1) out.push(line(t + 5, '[Northeast Wilds, Clearing]'))
    else             out.push(line(t + 5, '[Northeast Wilds, Trail]'))
  })

  out.push(...exp(60, 'Aug', 305, 62))
  out.push(line(61, 'You feel a bit more experienced.'))

  // A long break — this is what proves idle time is excluded from the rate.
  out.push(line(140, '[Crossing, Town Square Central]'))
  out.push(line(141, 'You are dead.'))
  out.push(line(142, "Your spirit slips free of your body's confines."))
  out.push(line(145, '[Crossing, Temple]'))
  out.push(...exp(148, 'LE', 42, 5))
  out.push(line(150, 'A cleric murmurs a prayer over you.'))

  return { name: 'sample-2026-07-25.log', content: out.join('\n') + '\n' }
}
