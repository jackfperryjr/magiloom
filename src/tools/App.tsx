import { Suspense, lazy, useEffect, useState } from 'react'
import { Analyzer } from './pages/Analyzer'
import { Planner } from './pages/Planner'

// The circle checker carries the per-guild requirement tables — every circle for every
// guild, which is most of the site's weight and useless to someone reading their logs.
// Lazily loaded so it's fetched only when that tab is opened.
const Circles = lazy(() => import('./pages/Circles').then(m => ({ default: m.Circles })))

// Hash routing — GitHub Pages has no rewrite rules, so a real path would 404 on
// refresh or on a shared link. Three pages doesn't justify a router dependency.
const PAGES = [
  { id: 'analyzer', label: 'Log Analyzer', el: () => <Analyzer /> },
  { id: 'planner',  label: 'TDP Planner',  el: () => <Planner  /> },
  { id: 'circles',  label: 'Circles',      el: () => <Circles  /> },
] as const

type PageId = typeof PAGES[number]['id']

function currentPage(): PageId {
  const id = location.hash.replace(/^#\/?/, '').split('?')[0]
  return PAGES.some(p => p.id === id) ? id as PageId : 'analyzer'
}

export function App(): JSX.Element {
  const [page, setPage] = useState<PageId>(currentPage)

  useEffect(() => {
    const onHash = () => setPage(currentPage())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  // Keep the tab title honest — it's what a bookmark or a shared link shows.
  useEffect(() => {
    const label = PAGES.find(p => p.id === page)?.label ?? 'Tools'
    document.title = `${label} — Magiloom Tools`
  }, [page])

  const active = PAGES.find(p => p.id === page) ?? PAGES[0]

  return (
    <>
      <nav className="topbar">
        <div className="topbar-inner">
          <a className="brand" href="../">Magiloom</a>
          <div className="tabs">
            {PAGES.map(p => (
              <a
                key={p.id}
                className={`tab${p.id === page ? ' active' : ''}`}
                href={`#/${p.id}`}
              >{p.label}</a>
            ))}
          </div>
          <a className="tab" href="../app/">Play →</a>
        </div>
      </nav>
      <div className="shell">
        <Suspense fallback={<p className="muted" style={{ padding: '40px 0' }}>Loading…</p>}>
          {active.el()}
        </Suspense>
      </div>
    </>
  )
}
