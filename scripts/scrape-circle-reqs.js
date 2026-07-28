// Scrape DragonRealms per-guild circle requirements into a generated data file.
// Run: node scripts/scrape-circle-reqs.js   →  src/tools/lib/circleReqs.generated.ts
//
// WHY SCRAPED AND NOT DERIVED. The requirements look formulaic for the first ten
// circles and then stop being: Thief's "2nd Weapon" is exactly 1 x circle up to
// circle 10, but 30 at circle 20 and 50 at circle 30. Several columns bend that way,
// each differently, so there is no formula to encode — only a table to copy. Getting
// one cell wrong sends someone off to train the wrong skill for a week, which is why
// this is mechanical rather than typed by hand.
//
// SOURCE. olwydd.org publishes the full table per guild (cr.php takes a circle range
// by POST). It's a long-standing community reference rather than an official one, so
// the generated file records where each number came from and when — if the game's
// requirements change, re-run this and diff.
//
// Structured exactly like scripts/scrape-atmospherics.js: fetch, parse, emit a .ts
// file that's committed, so the site never depends on a third party at runtime.

const fs = require('fs')
const path = require('path')

const BASE = 'https://www.olwydd.org/guilds'
const FIRST_CIRCLE = 2      // circle 1 is where you start; nothing is required for it
const LAST_CIRCLE  = 200    // as far as the source goes; asking for more returns junk

// PROJECTED CIRCLES. The source stops at 200 and so does DR's published table, but
// people plan past it. Every guild's requirements are exactly linear from circle 151
// on — one fixed step per slot, per circle — so circles beyond the scrape are
// continued at that same step rather than left blank. That is an assumption, not a
// fact: if DR ever publishes real numbers above 200 they replace these. It's recorded
// per guild as `scrapedThrough` so the UI can say which rows are projected, and
// `assertLinearTail` below refuses to project at all if the tail stops being linear.
const PROJECT_TO  = 300
const LINEAR_SPAN = 50      // circles of constant step required before we'll project

// Slug → the guild name DR uses. Commoner has no circle requirements and no page.
const GUILDS = {
  barbarian:   'Barbarian',
  bard:        'Bard',
  cleric:      'Cleric',
  empath:      'Empath',
  moonmage:    'Moon Mage',
  necromancer: 'Necromancer',
  paladin:     'Paladin',
  ranger:      'Ranger',
  thief:       'Thief',
  trader:      'Trader',
  warmage:     'Warrior Mage',
}

const OUT = path.resolve(__dirname, '..', 'src/tools/lib/circleReqs.generated.ts')

// The page returns at most 100 rows per request regardless of the range asked for —
// requesting 2–150 silently yields 2–101, which is the kind of truncation that looks
// like success. So page it and assert the full span afterwards.
const PAGE_SIZE = 100

async function fetchPage(slug, from, to) {
  const res = await fetch(`${BASE}/${slug}/cr.php`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      submitted: '1',
      CircleFirst: String(from),
      CircleSecond: String(to),
    }),
  })
  if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`)
  return res.text()
}

/** Column labels from the first header row. "1st<br />Weapon" → "1st Weapon". */
function parseSlots(html) {
  const head = /<tr class="crhead">([\s\S]*?)<\/tr>/.exec(html)
  if (!head) throw new Error('no header row')
  const cells = [...head[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m =>
    m[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim())
  // First column is the circle number itself.
  return cells.slice(1)
}

/** circle → [value per slot]. The header repeats every ten rows; data rows are cr1/cr2. */
function parseRows(html, slotCount) {
  const rows = {}
  for (const m of html.matchAll(/<tr class="cr[12]">([\s\S]*?)<\/tr>/g)) {
    const body = m[1]
    const circleM = /<td><strong>(\d+)<\/strong><\/td>/.exec(body)
    if (!circleM) continue
    const circle = +circleM[1]
    const values = [...body.matchAll(/<td>\s*(-?\d+)\s*<\/td>/g)].map(v => +v[1])
    if (values.length !== slotCount) {
      throw new Error(`circle ${circle}: got ${values.length} values, expected ${slotCount}`)
    }
    rows[circle] = values
  }
  return rows
}

/**
 * The per-circle step over the last LINEAR_SPAN rows, or null if it isn't constant.
 * Returning null is the whole point: a table that has stopped being linear must not
 * be extended by pretending it hasn't.
 */
function linearTailStep(table) {
  if (table.length < LINEAR_SPAN + 1) return null
  const step = table[table.length - 1].map((v, i) => v - table[table.length - 2][i])
  for (let i = table.length - LINEAR_SPAN; i < table.length; i++) {
    const d = table[i].map((v, j) => v - table[i - 1][j])
    if (d.join() !== step.join()) return null
  }
  return step
}

/** Continue a table to `toCircle` at its own constant step. Mutates nothing. */
function project(table, firstCircle, toCircle, step) {
  const out = table.slice()
  for (let c = firstCircle + out.length; c <= toCircle; c++) {
    out.push(out[out.length - 1].map((v, i) => v + step[i]))
  }
  return out
}

async function main() {
  const guilds = {}
  const problems = []

  for (const [slug, name] of Object.entries(GUILDS)) {
    process.stdout.write(`  ${name}… `)
    try {
      let slots = null
      const rows = {}
      for (let from = FIRST_CIRCLE; from <= LAST_CIRCLE; from += PAGE_SIZE) {
        const to = Math.min(from + PAGE_SIZE - 1, LAST_CIRCLE)
        const html = await fetchPage(slug, from, to)
        const pageSlots = parseSlots(html)
        if (slots === null) slots = pageSlots
        else if (pageSlots.join('|') !== slots.join('|')) {
          throw new Error('columns changed between pages')
        }
        Object.assign(rows, parseRows(html, slots.length))
      }
      const circles = Object.keys(rows).map(Number).sort((a, b) => a - b)
      if (!circles.length) throw new Error('no data rows')
      if (circles[circles.length - 1] < LAST_CIRCLE) {
        throw new Error(`only reached circle ${circles[circles.length - 1]}, wanted ${LAST_CIRCLE}`)
      }

      // Store as a dense array indexed from FIRST_CIRCLE, so the file stays compact
      // and a missing circle is impossible to represent by accident.
      const first = circles[0], last = circles[circles.length - 1]
      const table = []
      for (let c = first; c <= last; c++) {
        if (!rows[c]) throw new Error(`gap at circle ${c}`)
        table.push(rows[c])
      }
      const step = linearTailStep(table)
      if (!step) {
        throw new Error(`last ${LINEAR_SPAN} circles are not linear — can't project past ${last}`)
      }
      const full = project(table, first, PROJECT_TO, step)

      guilds[name] = {
        slots, firstCircle: first,
        lastCircle: first + full.length - 1,
        scrapedThrough: last,
        table: full,
      }
      console.log(`${slots.length} slots, circles ${first}–${last} (projected to ${first + full.length - 1})`)
    } catch (err) {
      console.log(`FAILED — ${err.message}`)
      problems.push(`${name}: ${err.message}`)
    }
  }

  if (problems.length) {
    console.error('\nSome guilds failed; not writing a partial file:\n  ' + problems.join('\n  '))
    process.exit(1)
  }

  const banner = `// GENERATED by scripts/scrape-circle-reqs.js — do not edit by hand.
// Source: olwydd.org guild circle-requirement tables (a community reference, not an
// official one). Scraped ${new Date().toISOString().slice(0, 10)}, circles ${FIRST_CIRCLE}-${LAST_CIRCLE},
// then PROJECTED to ${PROJECT_TO}. Re-run the script and diff this file if the game's
// requirements ever change.
//
// Circles above \`scrapedThrough\` are not published anywhere — they continue each
// guild's own per-circle step, which has been exactly constant from circle 151 up.
// Treat them as an estimate, not a source; the generator refuses to project at all
// if that tail ever stops being linear.
//
// Shape: per guild, \`slots\` names the columns and \`table[i]\` holds the required
// ranks for circle \`firstCircle + i\`, aligned to \`slots\`. A slot named like
// "1st Weapon" means the Nth-highest skill of that skillset; "Parry Ability" and
// friends name one specific skill. See circleReqs.ts for how those are matched.

export interface GuildCircleReqs {
  slots:       string[]
  firstCircle: number
  lastCircle:  number
  /** Highest circle taken from the source; everything above it is projected. */
  scrapedThrough: number
  table:       number[][]
}

export const CIRCLE_REQS: Record<string, GuildCircleReqs> = `

  fs.writeFileSync(OUT, banner + JSON.stringify(guilds, null, 0) + '\n', 'utf8')
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`\nWrote ${OUT} (${kb} KB, ${Object.keys(guilds).length} guilds)`)
}

main().catch(err => { console.error(err); process.exit(1) })
