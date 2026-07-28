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
const LAST_CIRCLE  = 200    // as far as the tables go; TDP awards stop at 150 (lib/tdp.ts)

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
      guilds[name] = { slots, firstCircle: first, lastCircle: last, table }
      console.log(`${slots.length} slots, circles ${first}–${last}`)
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
// official one). Scraped ${new Date().toISOString().slice(0, 10)}, circles ${FIRST_CIRCLE}-${LAST_CIRCLE}.
// Re-run the script and diff this file if the game's requirements ever change.
//
// Shape: per guild, \`slots\` names the columns and \`table[i]\` holds the required
// ranks for circle \`firstCircle + i\`, aligned to \`slots\`. A slot named like
// "1st Weapon" means the Nth-highest skill of that skillset; "Parry Ability" and
// friends name one specific skill. See circleReqs.ts for how those are matched.

export interface GuildCircleReqs {
  slots:       string[]
  firstCircle: number
  lastCircle:  number
  table:       number[][]
}

export const CIRCLE_REQS: Record<string, GuildCircleReqs> = `

  fs.writeFileSync(OUT, banner + JSON.stringify(guilds, null, 0) + '\n', 'utf8')
  const kb = (fs.statSync(OUT).size / 1024).toFixed(0)
  console.log(`\nWrote ${OUT} (${kb} KB, ${Object.keys(guilds).length} guilds)`)
}

main().catch(err => { console.error(err); process.exit(1) })
