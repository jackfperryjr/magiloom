import { useMemo, useState } from 'react'
import { MTX_EVENTS, MTX_ROWS } from '../lib/mtxItems.generated'
import {
  TIER_LABEL, appraise, buildIndex, parseInventory, scRange, toCsv, usd, usdRange,
  type Appraisal, type Tier,
} from '../lib/itemAnalyzer'

/**
 * Item Cost Analyzer.
 *
 * Paste an INV LIST, HOME RECALL or vault book (or all three) and get back every item
 * that came out of a SimuCoin event, with what it cost to earn there. Runs entirely in
 * the browser against data baked from Elanthipedia — nothing is uploaded or stored;
 * the CSV export is the only way anything leaves the page, and it goes to the user.
 */

// Built once per page load; the data is the bulk of this tab's weight anyway.
let INDEX: ReturnType<typeof buildIndex> | null = null
const index = () => (INDEX ??= buildIndex(MTX_ROWS, MTX_EVENTS))

const RATED = [...new Map(MTX_EVENTS.filter(e => e.scLo != null).map(e => [e.family, e])).values()]
  .sort((a, b) => a.family.localeCompare(b.family))
const UNRATED = [...new Set(MTX_EVENTS.filter(e => e.scLo == null).map(e => e.family))].sort()

const TIERS: Tier[] = ['prize', 'shop', 'possible', 'drop']
const TIER_HELP: Record<Tier, string> = {
  prize:    'Won at an event auction or raffle — one-of-a-kind or close to it.',
  shop:     'Sold for event currency at an event’s end-loot shop.',
  possible: 'Close to an event item’s name but not identical — altered, or a near miss. Check by hand.',
  drop:     'A random incidental drop at an event. Short, plain names are often ordinary items too.',
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function Estimate({ a }: { a: Appraisal }): JSX.Element {
  const b = a.best
  const money = usdRange(b, a.count)
  if (!money) return <span className="muted">{b.event.currency ? 'no price' : 'event has no SC rate'}</span>
  const tip = `${scRange(b, a.count)}${a.count > 1 ? ` for ${a.count}` : ''}. ${b.event.rateHow ?? ''}`
  return (
    <span data-tooltip={tip} title={tip} style={a.tier === 'possible' ? { color: 'var(--text-dim)' } : undefined}>
      {money}{a.tier === 'possible' && ' ?'}
    </span>
  )
}

export function ItemAnalyzer(): JSX.Element {
  const [text, setText]       = useState('')
  const [shown, setShown]     = useState<Set<Tier>>(() => new Set(['prize', 'shop', 'possible']))
  const [generic, setGeneric] = useState(false)

  const lines   = useMemo(() => parseInventory(text), [text])
  const results = useMemo(() => (lines.length ? appraise(lines, index()) : []), [lines])
  const rows    = results.filter(r => shown.has(r.tier) && (generic || !r.generic))

  const counts = useMemo(() => {
    const c: Record<Tier, number> = { prize: 0, shop: 0, possible: 0, drop: 0 }
    for (const r of results) c[r.tier]++
    return c
  }, [results])

  // Only confident matches count toward the total.
  const total = useMemo(() => {
    let lo = 0, hi = 0, n = 0
    for (const r of results) {
      if ((r.tier !== 'shop' && r.tier !== 'prize') || r.best.scLo == null) continue
      lo += r.best.scLo * r.count
      hi += r.best.scHi! * r.count
      n++
    }
    return { lo, hi, n }
  }, [results])

  const toggle = (t: Tier) => setShown(s => {
    const next = new Set(s)
    if (next.has(t)) next.delete(t)
    else next.add(t)
    return next
  })

  const onFile = (f: File | undefined) => { if (f) f.text().then(setText) }

  return (
    <>
      <h1>Item Cost Analyzer</h1>
      <p className="lede">
        Paste an inventory and it scans for items that originated at microtrans (SimuCoin)
        events — end loot, auctions, raffles and drops — with what each cost to earn at the
        event. Nothing is uploaded or stored; it all runs in your browser.
      </p>

      <div className="card">
        <h2>Your inventory</h2>
        <p className="lede" style={{ fontSize: '.9rem' }}>
          Any mix of <span className="mono">INV LIST</span>, <span className="mono">HOME RECALL</span>{' '}
          and <span className="mono">READ VAULT BOOK</span> works — paste the whole session if
          that's easier, the rest is ignored. A bulleted list of item names works too
          (<span className="mono">- matte indurium sphere</span>). Or load a{' '}
          <span className="mono">.txt</span> log.
        </p>
        <textarea
          rows={12} value={text} onChange={e => setText(e.target.value)}
          placeholder={'You have:\n  a pale kirmiko pocket with reinforced seams\n     -a steel tachi\n…'}
          style={{
            width: '100%', fontFamily: "'JetBrains Mono', monospace", fontSize: '.85rem',
            background: 'var(--bg-panel)', color: 'var(--text-bright)',
            border: '1px solid var(--border-hi)', borderRadius: 8, padding: 10, resize: 'vertical',
          }}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <label className="shrink" style={{ margin: 0 }}>
            <span className="btn ghost small" style={{ display: 'inline-block', border: '1px solid var(--border-hi)', background: 'transparent', color: 'var(--text)' }}>
              Load .txt file
            </span>
            <input type="file" accept=".txt,.log,text/plain" style={{ display: 'none' }}
                   onChange={e => { onFile(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          {text && <button className="ghost small shrink" onClick={() => setText('')}>Clear</button>}
          <span className="muted" style={{ fontSize: '.85rem' }}>
            {text && `${lines.length} item line${lines.length === 1 ? '' : 's'} read`}
          </span>
        </div>
        {text.trim() && lines.length === 0 && (
          <p className="err">
            No items found. Item lines start with an article —{' '}
            <span className="mono">a steel tachi</span>, <span className="mono">some leathers</span> —
            or a list bullet: <span className="mono">- steel tachi</span>.
          </p>
        )}
      </div>

      {results.length > 0 && (
        <>
          <div className="tiles">
            <div className="tile">
              <div className="val accent">{counts.prize + counts.shop}</div>
              <div className="lbl">Event items</div>
            </div>
            <div className="tile">
              <div className="val amber">
                {total.n ? (total.lo === total.hi ? usd(total.lo) : `${usd(total.lo)}–${usd(total.hi)}`) : '—'}
              </div>
              <div className="lbl">Event cost of {total.n} priced</div>
            </div>
            <div className="tile">
              <div className="val">{counts.possible}</div>
              <div className="lbl">Possible matches</div>
            </div>
            <div className="tile">
              <div className="val">{counts.drop}</div>
              <div className="lbl">Event drops</div>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
              <div className="tabs" style={{ flex: 1 }}>
                {TIERS.map(t => (
                  <button key={t} className={`tab${shown.has(t) ? ' active' : ''}`}
                          title={TIER_HELP[t]} onClick={() => toggle(t)}>
                    {TIER_LABEL[t]} <span className="muted">{counts[t]}</span>
                  </button>
                ))}
              </div>
              {shown.has('drop') && (
                <label className="shrink" style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0 }}>
                  <input type="checkbox" checked={generic} onChange={e => setGeneric(e.target.checked)} style={{ width: 'auto' }} />
                  Include generic names
                </label>
              )}
              <button className="small shrink"
                      onClick={() => download('item-analysis.csv', toCsv(results))}>
                Export CSV
              </button>
            </div>

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Where</th>
                    <th>Kind</th>
                    <th>Event</th>
                    <th className="num">Event price</th>
                    <th className="num">Event cost</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(a => {
                    const b = a.best
                    const others = [...new Set(a.listings.map(l => l.event.name))].filter(n => n !== b.event.name)
                    return (
                      <tr key={a.text}>
                        <td>
                          {a.count > 1 && <span className="muted">{a.count}× </span>}{a.text}
                          {a.tier === 'possible' && (
                            <div className="muted" style={{ fontSize: '.8rem' }}>
                              ≈ {b.name} ({Math.round(a.similarity! * 100)}% alike)
                            </div>
                          )}
                          {b.kind === 'auction' && b.note && (
                            <div className="muted" style={{ fontSize: '.8rem' }}>{b.note}</div>
                          )}
                        </td>
                        <td className="muted" style={{ fontSize: '.85rem' }}>
                          {a.places.join(', ')}
                          {a.container && <div style={{ fontSize: '.78rem', color: 'var(--text-dim)' }}>in {a.container}</div>}
                        </td>
                        <td><span className={`pill${a.tier === 'prize' ? ' amber' : ''}`}>{b.kind}</span></td>
                        <td style={{ fontSize: '.88rem' }}>
                          {b.event.name}
                          {others.length > 0 && (
                            <span className="muted" title={others.join('\n')}> +{others.length}</span>
                          )}
                        </td>
                        <td className="num muted">
                          {b.price != null ? `${b.price.toLocaleString()} ${b.event.currency ?? ''}` : '—'}
                        </td>
                        <td className="num"><Estimate a={a} /></td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="empty">Nothing in the selected categories.</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="note">
              <strong>Event cost</strong> is what the item took to earn at its most recent
              event, converted to SimuCoins (100 SC = $1) — not what players resell it for,
              which is often more. Hover a figure to see how its event's rate was worked out.
              The CSV has every match, including the categories hidden here.
            </p>
          </div>

          <div className="card tight">
            <h3>How event currencies are converted</h3>
            <div className="table-wrap">
              <table>
                <tbody>
                  {RATED.map(e => (
                    <tr key={e.family}>
                      <td>{e.family}</td>
                      <td className="num">
                        {e.scLo === e.scHi ? e.scLo : `${e.scLo}–${e.scHi}`} SC / {e.currency?.replace(/s$/, '')}
                      </td>
                      <td className="muted" style={{ fontSize: '.85rem' }}>{e.rateHow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note warn">
              No rate yet for {UNRATED.join(', ')} — items from those show their price but no
              dollar figure. Item data comes from Elanthipedia; an event the wiki hasn't
              catalogued won't match.
            </p>
          </div>
        </>
      )}
    </>
  )
}
