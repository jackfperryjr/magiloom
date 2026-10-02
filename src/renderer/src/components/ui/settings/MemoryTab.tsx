import { useEffect, useMemo, useRef, useState } from 'react'
import { readMemLog, clearMemLog, currentSample } from '../../../lib/memoryWatch'
import {
  describeEvent, formatLog, segments, watchdogThreshold, type MemEvent, type MemLog, type MemSample,
} from '../../../lib/memoryLog'

// Settings → Memory: the flight recorder's history, so a slow climb (or the moment
// of a spike) is visible before the tab dies — and copyable into a bug report after.
//
// One series (JS heap) on one axis. The DOM element count is a different measure on
// a different scale, so it lives in the tooltip and the table rather than on a
// second y-axis. Page loads are drawn as event rules: a load that followed an
// UNCLEAN end (crash or killed tab) and a watchdog auto-refresh are labelled; plain
// loads are faint ticks.

const H = 200
const PAD = { top: 28, right: 12, bottom: 24, left: 44 }

const timeLabel = (at: number): string =>
  new Date(at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
const fullTime = (at: number): string =>
  new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

function ago(at: number, now: number): string {
  const m = Math.round((now - at) / 60_000)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} hr ago`
  return `${Math.round(h / 24)} days ago`
}

/** 0, then round steps up to the top — 3 or 4 gridlines. */
function yTicks(max: number): number[] {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(v => v >= raw) ?? raw
  const out: number[] = []
  for (let v = 0; v <= max + 1e-9; v += step) out.push(Math.round(v * 10) / 10)
  return out
}

function MemoryChart({ log, now }: { log: MemLog; now: number }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  const [hover, setHover] = useState<MemSample | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.floor(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const withHeap = log.samples.filter(s => s.heap !== null)
  if (withHeap.length === 0) {
    return <div className="mem-empty">No heap readings yet — this browser may not report them (Edge and Chrome do).</div>
  }

  const t0 = Math.min(withHeap[0].at, ...log.events.map(e => e.at))
  const t1 = Math.max(now, withHeap[withHeap.length - 1].at)
  const peak = Math.max(...withHeap.map(s => s.heap!))
  const limit = withHeap[withHeap.length - 1].limit
  const threshold = watchdogThreshold(limit)
  // Show the watchdog line only once readings get anywhere near it; otherwise it
  // would flatten a healthy 40 MB trace into the floor.
  const showThreshold = peak >= threshold * 0.6
  const yMax = yTicks(Math.max(showThreshold ? threshold * 1.05 : peak * 1.2, 50)).at(-1)!

  const iw = width - PAD.left - PAD.right
  const ih = H - PAD.top - PAD.bottom
  const x = (at: number) => PAD.left + (t1 === t0 ? iw : ((at - t0) / (t1 - t0)) * iw)
  const y = (mb: number) => PAD.top + ih - (mb / yMax) * ih

  const runs = segments(withHeap)
  const line = (r: MemSample[]) => r.map((s, i) => `${i ? 'L' : 'M'}${x(s.at).toFixed(1)} ${y(s.heap!).toFixed(1)}`).join(' ')
  const area = (r: MemSample[]) => `${line(r)} L${x(r.at(-1)!.at).toFixed(1)} ${y(0)} L${x(r[0].at).toFixed(1)} ${y(0)} Z`

  const onMove = (e: React.PointerEvent<SVGRectElement>): void => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left + PAD.left
    let best = withHeap[0], bestD = Infinity
    for (const s of withHeap) { const d = Math.abs(x(s.at) - px); if (d < bestD) { bestD = d; best = s } }
    setHover(best)
  }

  const eventMark = (e: MemEvent, i: number) => {
    const ex = x(e.at)
    const kind = e.kind === 'watchdog' ? 'auto' : e.unclean ? 'crash' : 'load'
    const label = kind === 'auto' ? 'auto-refresh' : kind === 'crash' ? 'crash?' : null
    return (
      <g key={i} className={`mem-ev mem-ev-${kind}`}>
        <line x1={ex} x2={ex} y1={PAD.top} y2={PAD.top + ih} />
        {label && <text x={ex + 3} y={PAD.top - 5}>{label}</text>}
      </g>
    )
  }

  const tipLeft = hover ? Math.min(Math.max(x(hover.at) - 70, 0), width - 150) : 0

  return (
    <div className="mem-chart" ref={wrapRef}>
      <svg width={width} height={H} role="img" aria-label={`JS heap over time, peak ${peak} MB`}>
        {yTicks(yMax).map(v => (
          <g key={v} className="mem-grid">
            <line x1={PAD.left} x2={PAD.left + iw} y1={y(v)} y2={y(v)} />
            <text x={PAD.left - 6} y={y(v) + 4} textAnchor="end">{v}</text>
          </g>
        ))}
        <text className="mem-axis-unit" x={PAD.left - 6} y={PAD.top - 14} textAnchor="end">MB</text>
        <text className="mem-axis-time" x={PAD.left} y={H - 6}>{timeLabel(t0)}</text>
        <text className="mem-axis-time" x={PAD.left + iw} y={H - 6} textAnchor="end">{timeLabel(t1)}</text>

        {showThreshold && (
          <g className="mem-threshold">
            <line x1={PAD.left} x2={PAD.left + iw} y1={y(threshold)} y2={y(threshold)} />
            {/* Left and under the line: event labels sit along the top edge, mostly
                toward the recent (right) end, so this can't collide with them. */}
            <text x={PAD.left + 4} y={y(threshold) + 12}>auto-refresh at {Math.round(threshold)} MB</text>
          </g>
        )}

        {log.events.map(eventMark)}
        {runs.map((r, i) => <path key={`a${i}`} className="mem-area" d={area(r)} />)}
        {runs.map((r, i) => <path key={`l${i}`} className="mem-line" d={line(r)} />)}

        {hover && (
          <g className="mem-cross">
            <line x1={x(hover.at)} x2={x(hover.at)} y1={PAD.top} y2={PAD.top + ih} />
            <circle cx={x(hover.at)} cy={y(hover.heap!)} r={4} />
          </g>
        )}
        <rect x={PAD.left} y={PAD.top} width={iw} height={ih} fill="transparent"
              onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover && (
        <div className="mem-tip" style={{ left: tipLeft }}>
          <div className="mem-tip-v"><span className="mem-tip-key" />{hover.heap} MB</div>
          <div>{fullTime(hover.at)}</div>
          <div>{hover.dom.toLocaleString()} page elements{hover.hidden ? ' · background' : ''}</div>
        </div>
      )}
    </div>
  )
}

export function MemoryTab() {
  const [log, setLog]   = useState<MemLog>(() => readMemLog())
  const [now, setNow]   = useState(() => Date.now())
  const [live, setLive] = useState<MemSample>(() => currentSample())
  const [copied, setCopied]   = useState(false)
  const [arming, setArming]   = useState(false)   // two-step clear, no native confirm

  useEffect(() => {
    const id = window.setInterval(() => { setLog(readMemLog()); setNow(Date.now()); setLive(currentSample()) }, 30_000)
    return () => window.clearInterval(id)
  }, [])
  useEffect(() => {
    if (!arming) return
    const t = window.setTimeout(() => setArming(false), 3000)
    return () => window.clearTimeout(t)
  }, [arming])

  const day = now - 24 * 3600_000
  const peak24 = useMemo(() => {
    const v = log.samples.filter(s => s.at >= day && s.heap !== null).map(s => s.heap!)
    return v.length ? Math.max(...v) : null
  }, [log, day])
  const lastCrash = [...log.events].reverse().find(e => e.kind === 'boot' && e.unclean)
  const autoCount = log.events.filter(e => e.kind === 'watchdog').length

  // Newest first: samples and events interleaved.
  const recent = useMemo(() => [
    ...log.samples.map(s => ({ at: s.at, s, e: null as MemEvent | null })),
    ...log.events.map(e => ({ at: e.at, s: null as MemSample | null, e })),
  ].sort((a, b) => b.at - a.at).slice(0, 14), [log])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatLog(log, navigator.userAgent))
      setCopied(true); window.setTimeout(() => setCopied(false), 1800)
    } catch { /* clipboard blocked */ }
  }
  const clear = (): void => {
    if (!arming) { setArming(true); return }
    clearMemLog(); setLog(readMemLog()); setArming(false)
  }

  return (
    <div className="mem-tab">
      <div className="settings-hint">
        Lantern records its memory use every 5 minutes, and marks every page load, so a slow climb or a sudden
        spike shows up here before it becomes a crash. If memory passes the auto-refresh line, Lantern refreshes
        itself the next time the tab is in the background; your game session stays connected.
      </div>

      <div className="mem-stats">
        <div className="mem-stat"><span className="mem-stat-n">{live.heap ?? '—'}</span><span className="mem-stat-k">MB now</span></div>
        <div className="mem-stat"><span className="mem-stat-n">{peak24 ?? '—'}</span><span className="mem-stat-k">MB peak, 24 h</span></div>
        <div className="mem-stat"><span className="mem-stat-n">{live.dom.toLocaleString()}</span><span className="mem-stat-k">page elements</span></div>
        <div className="mem-stat">
          <span className="mem-stat-n mem-stat-word">{lastCrash ? ago(lastCrash.at, now) : 'none'}</span>
          <span className="mem-stat-k">last unclean close{autoCount ? ` · ${autoCount} auto-refresh` : ''}</span>
        </div>
      </div>

      <MemoryChart log={log} now={now} />

      <div className="mem-actions">
        <button className="lf-mini" onClick={copy}>{copied ? 'Copied' : 'Copy log'}</button>
        <button className="lf-mini" onClick={() => { setLog(readMemLog()); setNow(Date.now()); setLive(currentSample()) }}>Refresh</button>
        <button className="lf-mini lf-danger" onClick={clear}>{arming ? 'Click again to clear' : 'Clear log'}</button>
        <span className="mem-count">{log.samples.length} samples · {log.events.length} page loads/events</span>
      </div>

      <table className="mem-table">
        <thead><tr><th>When</th><th>JS heap</th><th>Elements</th><th /></tr></thead>
        <tbody>
          {recent.map((r, i) => r.e ? (
            <tr key={i} className={r.e.kind === 'watchdog' ? 'mem-row-auto' : r.e.unclean ? 'mem-row-crash' : 'mem-row-load'}>
              <td>{fullTime(r.at)}</td><td colSpan={3}>{describeEvent(r.e)}</td>
            </tr>
          ) : (
            <tr key={i}>
              <td>{fullTime(r.at)}</td>
              <td>{r.s!.heap === null ? '—' : `${r.s!.heap} MB`}</td>
              <td>{r.s!.dom.toLocaleString()}</td>
              <td className="mem-bg">{r.s!.hidden ? 'background' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
