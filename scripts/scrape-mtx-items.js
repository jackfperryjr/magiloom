// Scrape every microtransaction-event item off Elanthipedia into a generated data file.
// Run: node scripts/scrape-mtx-items.js [--refresh]  →  src/tools/lib/mtxItems.generated.ts
//
// WHAT IT'S FOR. The Item Analyzer (#/items) matches a pasted inventory against
// everything ever sold, auctioned, raffled or dropped at a SimuCoin event, so someone
// can tell the paid-for items in a pile of gear from the ones that merely look fancy
// (in DR, rare materials aren't the tell — event origin is).
//
// SOURCE. Elanthipedia's Category:Microtrans_events, walked recursively, plus every
// subpage of each event (End Loot, Incidental loot, Raffle, Auction...). Read through
// the MediaWiki API rather than scraped HTML, so it's the wikitext editors actually
// wrote. The raw pages are cached under node_modules/.cache/mtx-wiki so re-running to
// tweak the parser doesn't hit the wiki again; --refresh refetches.
//
// FORMATS. The wiki has used several over the years, and all are read:
//   {{ShopItem|t=i|name|price}}                 newer end loot (with bundle contents
//                                               nested as {{sloot}} in note=)
//   |{{sloot|i|name}}||type||cost||details      older wikitables — the price column is
//                                               found from the table's header row
//   {{AuctLoot|i|name|winner|price|...}}        auctions
//   {{Raffle|i|name|winner}}                    raffles
//   * {{sloot|i|name}} / {{qloot|i|name}}       incidental drops (bullet lists)
//
// PRICES. Each event has its own currency, so raw prices only compare within one
// event. EVENT_RATES below converts to SimuCoins (100 SC = $1) where the wiki gives
// enough to do the arithmetic — ticket price against what one ticket earns, or the
// marginal price of a multiplier. Every rate records how it was derived. Events with
// no rate keep their raw price and a within-event percentile, and the UI says so.
//
// Structured like scripts/scrape-circle-reqs.js: fetch, parse, emit a .ts file that's
// committed, so the site never depends on a third party at runtime.

const fs = require('fs')
const path = require('path')

const ROOT     = path.resolve(__dirname, '..')
const OUT      = path.join(ROOT, 'src/tools/lib/mtxItems.generated.ts')
const CACHE    = path.join(ROOT, 'node_modules/.cache/mtx-wiki')
const API      = 'https://elanthipedia.play.net/api.php'
const ROOT_CAT = 'Category:Microtrans_events'
const UA       = 'magiloom-tools/1.0 (item analyzer data build)'
const REFRESH  = process.argv.includes('--refresh')
// Refuse to write if the scrape comes back this much smaller than what's committed —
// almost always a wiki formatting change the parser no longer reads, not items
// genuinely disappearing. --allow-shrink overrides after a human has looked.
const MAX_SHRINK   = 0.10
const ALLOW_SHRINK = process.argv.includes('--allow-shrink')
// Markdown summary for the scheduled workflow's PR body (path from the environment).
const SUMMARY_PATH = process.env.MTX_SUMMARY

// SimuCoins per unit of event currency. lo/hi bracket the estimate where a ticket's
// yield varies. Keep `how` honest — it's shown in the UI next to every dollar figure.
const EVENT_RATES = {
  'Sleeping Dragon Corn Maze': {
    currency: 'kernels', lo: 10, hi: 10,
    how: 'A 100 SC single-task ticket rewards 10 kernels; a 1,000 SC pass, 10 per task for the first 10.',
  },
  "Droughtman's Challenge": {
    currency: 'indicia', lo: 20, hi: 20,
    how: 'A 100 SC run rewards 5 indicia; the 5x (400 SC) and 10x (900 SC) multipliers price extra indicia at the same 20 SC each.',
  },
  'House of the Revenant Fang': {
    currency: 'merits', lo: 20, hi: 20,
    how: 'Merit multipliers (3x 400 SC, 5x 800 SC, 10x 1,800 SC on a ~10-merit run) all price an extra merit at 20 SC.',
  },
  'Su Helmas': {
    currency: 'fame', lo: 9, hi: 10,
    how: 'A 100 SC task contract rewards 10–11 fame.',
  },
  'Taisidon Mystery': {
    currency: 'points', lo: 1, hi: 1,
    how: 'A 100 SC boarding pass rewards 100 points; the 5x (400 SC) and 10x (900 SC) multipliers agree.',
  },
  "Fenvol's Folly": {
    currency: 'inkbits', lo: 1, hi: 1,
    how: 'A run rewards 100 inkbits; the 5x multiplier (400 SC) prices an extra inkbit at 1 SC.',
  },
  "Aesthene's Close": {
    currency: 'chronocoins', lo: 1, hi: 1,
    how: 'A 100 SC time slip earns 100 chronocoins.',
  },
  "Drathrok's Duskruin": {
    currency: 'bloodscrip', lo: 0.4, hi: 2,
    how: 'A 100 SC dueling slip earns 50–250 bloodscrip depending on the run, so the range is wide.',
  },
}

// "Su Helmas 434: The Forbidden Temple/End loot" → "Su Helmas"
function familyOf(title) {
  const base = title.split('/')[0]
  return base.replace(/:.*$/, '').replace(/\s+\d+.*$/, '').replace(/\s+\(.*\)$/, '').trim()
}

// ── Wiki API ─────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function api(params) {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2' })}`
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    await sleep(250) // be polite
    if (res.ok) return res.json()
    console.warn(`  HTTP ${res.status}, retrying…`)
    await sleep(2000 * (attempt + 1))
  }
  throw new Error(`API request failed: ${url}`)
}

async function* apiAll(params) {
  let cont = {}
  for (;;) {
    const data = await api({ ...params, ...cont })
    if (data.query) yield data.query
    if (!data.continue) return
    cont = data.continue
  }
}

async function categoryPages(root) {
  const pages = new Set()
  const seen = new Set()
  const queue = [root]
  while (queue.length) {
    const cat = queue.shift()
    if (seen.has(cat)) continue
    seen.add(cat)
    for await (const q of apiAll({ action: 'query', list: 'categorymembers', cmtitle: cat, cmlimit: '500' })) {
      for (const m of q.categorymembers) {
        if (m.ns === 14) queue.push(m.title)
        else if (m.ns === 0) pages.add(m.title)
      }
    }
  }
  return [...pages]
}

async function subpages(title) {
  const out = []
  for await (const q of apiAll({ action: 'query', list: 'allpages', apprefix: `${title}/`, aplimit: '500' })) {
    out.push(...q.allpages.map(p => p.title))
  }
  return out
}

const cacheFile = title => path.join(CACHE, title.replace(/[^\w.\-' ]/g, '_') + '.wiki')

async function fetchWikitext(titles) {
  const result = new Map()
  const todo = []
  for (const t of titles) {
    const f = cacheFile(t)
    if (!REFRESH && fs.existsSync(f)) result.set(t, fs.readFileSync(f, 'utf8'))
    else todo.push(t)
  }
  for (let i = 0; i < todo.length; i += 50) {
    const data = await api({
      action: 'query', prop: 'revisions', rvprop: 'content', rvslots: 'main',
      redirects: '1', titles: todo.slice(i, i + 50).join('|'),
    })
    for (const p of data.query?.pages ?? []) {
      const text = p.revisions?.[0]?.slots?.main?.content
      if (!text) continue
      fs.writeFileSync(cacheFile(p.title), text)
      result.set(p.title, text)
    }
    process.stdout.write('.')
  }
  if (todo.length) process.stdout.write('\n')
  return result
}

// ── Wikitext parsing ─────────────────────────────────────────────────────────

/** Split on `sep` at nesting depth 0, so [[a|b]] and {{x|y}} stay whole. */
function splitTop(s, sep) {
  const parts = []
  let buf = ''
  let depth = 0
  for (let i = 0; i < s.length;) {
    const two = s.slice(i, i + 2)
    if (two === '[[' || two === '{{') { depth++; buf += two; i += 2 }
    else if (two === ']]' || two === '}}') { depth--; buf += two; i += 2 }
    else if (depth === 0 && s.startsWith(sep, i)) { parts.push(buf); buf = ''; i += sep.length }
    else { buf += s[i]; i++ }
  }
  parts.push(buf)
  return parts
}

/** Body of the first {{tmpl|…}} in s, respecting nested braces. */
function templateBody(s, tmpl) {
  const start = s.indexOf(`{{${tmpl}|`)
  if (start < 0) return null
  const i = start + tmpl.length + 3
  let depth = 1
  let j = i
  while (j < s.length && depth > 0) {
    if (s.startsWith('{{', j)) { depth++; j += 2 }
    else if (s.startsWith('}}', j)) { depth--; j += 2 }
    else j++
  }
  return s.slice(i, j - 2)
}

function stripMarkup(s) {
  return String(s ?? '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const NON_PRICE_COLS = /^(item|type|details|notes?|buyer|surface|shelf|display|flare|quantity|room|entrance)$/i
const SLOOT = /\{\{sloot\|[^|}]*\|([^}]*)\}\}/g

function parsePage(text, page) {
  const items = []
  let headers = null
  let row = null

  const add = (name, priceRaw, kind, note) => {
    name = stripMarkup(name).replace(/\s*\(\d+\)$/, '')
    if (!name) return
    const raw = stripMarkup(priceRaw)
    const m = raw.match(/\d[\d,]*/)
    items.push({ name, kind, page, price: m ? +m[0].replace(/,/g, '') : null, note: note ? stripMarkup(note) : null })
  }

  const flushRow = () => {
    const body = row && templateBody(row.join('||'), 'sloot')
    if (body) {
      const name = splitTop(body, '|')[1]
      let price = null
      if (headers) {
        const idx = headers.findIndex((h, k) => k > 0 && !NON_PRICE_COLS.test(h))
        if (idx > 0) price = row[idx]
      }
      price ??= row.slice(1).find(c => /^[\d,]+$/.test(c.trim()))
      add(name, price, 'shop')
    }
    row = null
  }

  for (const line of text.split('\n')) {
    // ── wikitables (older end loot: one {{sloot}} per row)
    if (line.startsWith('!')) {
      flushRow()
      headers = line.slice(1).split(/!!|\|\|/).map(h => stripMarkup(h.replace(/<br\s*\/?>/g, ' ')))
    } else if (line.startsWith('|-') || line.startsWith('|}')) {
      flushRow()
      if (line.startsWith('|}')) headers = null
    } else if (line.startsWith('|') && !line.startsWith('{|')) {
      row ??= []
      row.push(...splitTop(line.slice(1), '||'))
    }

    let body
    if ((body = templateBody(line, 'AuctLoot'))) {
      const p = splitTop(body, '|')
      const notes = p.find(x => x.startsWith('notes='))?.slice(6)
      add(p[1], p[3], 'auction', notes)
    }
    if ((body = templateBody(line, 'Raffle'))) add(splitTop(body, '|')[1], null, 'raffle')
    if ((body = templateBody(line, 'qloot'))) add(splitTop(body, '|')[1], null, 'incidental')

    // Bullet lists of {{sloot}}: incidental drops, grounds loot, pig maze prizes…
    if (/^[:*]+/.test(line) && line.includes('{{sloot|')) {
      const kind = /incidental/i.test(page) ? 'incidental' : 'listed'
      for (const m of line.matchAll(SLOOT)) add(m[1].split('|')[0], null, kind)
    }

    // {{ShopItem|t=i|name|price|name=…|note=…}}
    for (const m of line.matchAll(/\{\{ShopItem\|(.*?)\}\}(?=\s*$|\s*\{\{|\s*<)/g)) {
      const named = {}
      const positional = []
      for (const p of splitTop(m[1], '|')) {
        const kv = p.match(/^\s*(t|name|note|noun|link)\s*=([\s\S]*)$/)
        if (kv) named[kv[1]] = kv[2]
        else positional.push(p)
      }
      const name = stripMarkup(positional[0])
      if (!name) continue
      add(name, positional[1], 'shop')
      if (named.name && stripMarkup(named.name) !== name) add(named.name, positional[1], 'shop')
      // Bundle contents (origami packages and the like) — sold only as part of the bundle.
      for (const b of String(named.note ?? '').matchAll(SLOOT)) {
        add(b[1].split('|')[0], positional[1], 'bundle', `part of: ${name}`)
      }
    }
  }
  flushRow()
  return items
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(CACHE, { recursive: true })
  console.log(`Walking ${ROOT_CAT}…`)
  const pages = await categoryPages(ROOT_CAT)
  console.log(`  ${pages.length} pages`)

  console.log('Finding subpages…')
  const all = new Set(pages)
  for (const p of pages) for (const s of await subpages(p)) all.add(s)
  console.log(`  ${all.size} pages total`)

  console.log('Fetching wikitext (cached)…')
  const texts = await fetchWikitext([...all])

  let items = []
  for (const [title, text] of texts) items.push(...parsePage(text, title))

  // Within-page percentile per kind: the only fair comparison across currencies.
  const groups = new Map()
  for (const i of items) {
    const k = `${i.page}\u0000${i.kind}`
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(i)
  }
  for (const group of groups.values()) {
    const prices = group.map(i => i.price).filter(p => p != null).sort((a, b) => a - b)
    if (!prices.length) continue
    for (const i of group) {
      if (i.price == null) continue
      i.pct = Math.round((100 * prices.filter(p => p < i.price).length) / prices.length)
    }
  }

  // Events table, then compact rows that point into it.
  const eventNames = [...new Set(items.map(i => i.page.split('/')[0]))].sort()
  const eventIdx = new Map(eventNames.map((e, k) => [e, k]))
  const events = eventNames.map(name => {
    const family = familyOf(name)
    const rate = EVENT_RATES[family]
    return rate
      ? { name, family, currency: rate.currency, scLo: rate.lo, scHi: rate.hi, rateHow: rate.how }
      : { name, family, currency: null, scLo: null, scHi: null, rateHow: null }
  })

  const seen = new Set()
  const rows = []
  for (const i of items) {
    const sub = i.page.includes('/') ? i.page.slice(i.page.indexOf('/') + 1) : ''
    const row = [i.name, i.kind, eventIdx.get(i.page.split('/')[0]), sub, i.price, i.pct ?? null, i.note]
    const key = JSON.stringify(row)
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[2] - b[2])

  const unpriced = [...new Set(events.filter(e => e.scLo == null).map(e => e.family))]
  const header = `// GENERATED by scripts/scrape-mtx-items.js — do not edit by hand.
// Source: Elanthipedia ${ROOT_CAT} (recursively) and every event's subpages.
// Scraped ${new Date().toISOString().slice(0, 10)}: ${rows.length} listings from ${events.length} events.
// Re-run the script after a new event's pages are filled in, and diff.
//
// SimuCoin rates are DERIVED (see EVENT_RATES in the script for how each was worked
// out) and are estimates of what an item cost to earn at its event, not a resale price.
// Families without a rate: ${unpriced.join(', ') || 'none'}.

export type MtxKind = 'auction' | 'raffle' | 'shop' | 'bundle' | 'listed' | 'incidental'

export interface MtxEvent {
  name: string
  family: string
  currency: string | null
  /** SimuCoins per unit of event currency, low and high estimate; null = unknown. */
  scLo: number | null
  scHi: number | null
  rateHow: string | null
}

/** [name, kind, event index, subpage, price, within-page percentile, note] */
export type MtxRow = [string, MtxKind, number, string, number | null, number | null, string | null]

export const MTX_EVENTS: MtxEvent[] = ${JSON.stringify(events, null, 1)}

export const MTX_ROWS: MtxRow[] = [
${rows.map(r => JSON.stringify(r)).join(',\n')}
]
`
  // ── Compare with what's committed ──
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : ''
  const oldRows = (old.match(/^\["/gm) ?? []).length
  const oldEvents = new Set([...old.matchAll(/^\s*"name": "(.+?)",$/gm)].map(m => JSON.parse(`"${m[1]}"`)))
  const newEvents = events.map(e => e.name).filter(n => !oldEvents.has(n))
  const unpricedNew = [...new Set(events.filter(e => newEvents.includes(e.name) && e.scLo == null).map(e => e.family))]

  if (oldRows && rows.length < oldRows * (1 - MAX_SHRINK) && !ALLOW_SHRINK) {
    console.error(`✗ Scrape found ${rows.length} listings, down from ${oldRows} committed (more than ${MAX_SHRINK * 100}% fewer).`)
    console.error('  That usually means a wiki page changed format and the parser missed it. Nothing written.')
    console.error('  Check the parser, or re-run with --allow-shrink if the drop is real.')
    process.exit(1)
  }

  // The date line alone changing isn't a change — otherwise every scheduled run opens a PR.
  const sameAsBefore = old.replace(/^\/\/ Scraped .*$/m, '') === header.replace(/^\/\/ Scraped .*$/m, '')
  if (!sameAsBefore) fs.writeFileSync(OUT, header)

  const counts = rows.reduce((m, r) => ((m[r[1]] = (m[r[1]] ?? 0) + 1), m), {})
  console.log(`${sameAsBefore ? 'Unchanged' : 'Wrote'}: ${rows.length} listings (${JSON.stringify(counts)}) from ${events.length} events`)
  console.log(`  → ${path.relative(ROOT, OUT)} (${(Buffer.byteLength(header) / 1024 / 1024).toFixed(2)} MB)`)
  console.log(`  no SimuCoin rate: ${unpriced.join(', ')}`)
  if (newEvents.length) console.log(`  new events: ${newEvents.join(', ')}`)

  if (SUMMARY_PATH) {
    const md = [
      `Listings: **${oldRows.toLocaleString()} → ${rows.length.toLocaleString()}** across ${events.length} events.`,
      '',
      newEvents.length
        ? `New events:\n${newEvents.map(n => `- ${n}`).join('\n')}`
        : 'No new events — changes are edits to existing event pages.',
      '',
      unpricedNew.length
        ? `⚠️ **No SimuCoin rate yet** for new event famil${unpricedNew.length === 1 ? 'y' : 'ies'}: ${unpricedNew.join(', ')}. ` +
          'Their items will show a price but no dollar figure until a rate is added to `EVENT_RATES` in `scripts/scrape-mtx-items.js` ' +
          '(ticket SC price ÷ currency one ticket earns).'
        : 'Every new event has a SimuCoin rate.',
      '',
      `Families still without a rate: ${unpriced.join(', ') || 'none'}.`,
    ].join('\n')
    fs.writeFileSync(SUMMARY_PATH, md)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
