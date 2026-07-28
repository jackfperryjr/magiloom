import { useEffect, useMemo, useRef, useState } from 'react'
import {
  currentAccount, listLogs, readLog, readLogEvents, readLichLog, logout, authToken,
  type Account, type LogFileEntry, type LichLogEntry,
} from '../api'
import { parseJsonl } from '../../main/stream-events'
import { SignIn } from '../components/SignIn'
import { Results } from '../components/Results'
import { analyze, parseLogFile, type Analysis } from '../lib/logAnalysis'
import { sampleLog } from '../lib/sampleLog'
import { parseLichLog, parseLichXml } from '../lib/lichLog'

/**
 * The log analyzer.
 *
 * Two ways in, on purpose:
 *   • Signed in — pulls the logs this account's server sessions wrote, so every
 *     character you play through the web app lands in one place with no file handling.
 *   • Drag and drop — for the desktop app, which logs to your own machine and never
 *     uploads anything. Parsing happens in the browser either way; a dropped file is
 *     never sent anywhere.
 * Both feed the same analysis, and a selection can mix them freely.
 */
export function Analyzer(): JSX.Element {
  // undefined = still checking, null = signed out.
  const [account, setAccount] = useState<Account | null | undefined>(undefined)
  const [files, setFiles]     = useState<LogFileEntry[]>([])
  // Lich's own server-side logs, kept separate from Magiloom's: different directory,
  // different handle (a relative path, not a filename) and a different reader.
  const [lichFiles, setLich]  = useState<LichLogEntry[]>([])
  const [pickedLich, setPickedLich] = useState<Set<string>>(new Set())
  const [picked, setPicked]   = useState<Set<string>>(new Set())
  const [local, setLocal]     = useState<Analysis[]>([])
  const [remote, setRemote]   = useState<Analysis[]>([])
  const [busy, setBusy]       = useState(false)
  const [error, setError]     = useState('')
  const [dragOver, setDragOver] = useState(false)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!authToken()) { setAccount(null); return }
    currentAccount().then(a => setAccount(a)).catch(() => setAccount(null))
  }, [])

  // #/analyzer?sample loads the demo straight away, so the page can be linked to as
  // a worked example ("here's what it tells you") rather than an empty form.
  useEffect(() => {
    if (!location.hash.includes('sample')) return
    const s = sampleLog()
    setLocal([analyze(parseLogFile(s.name, s.content))])
  }, [])

  useEffect(() => {
    if (!account) return
    setError('')
    listLogs()
      .then(({ files, lich }) => {
        setFiles(files)
        // Only the raw-stream .xml is worth offering: the .log beside it is the same
        // session flattened, with no per-line times, so nothing can be measured from it.
        setLich(lich.filter(l => l.xml))
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Could not load your logs.'))
  }, [account])

  // Group by character so a multi-character account reads as a roster, not a file dump.
  const byChar = useMemo(() => {
    const m = new Map<string, LogFileEntry[]>()
    for (const f of files) {
      const arr = m.get(f.char) ?? m.set(f.char, []).get(f.char)!
      arr.push(f)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [files])

  const toggle = (name: string): void => {
    const next = new Set(picked)
    if (next.has(name)) next.delete(name); else next.add(name)
    setPicked(next)
  }

  const toggleChar = (char: string): void => {
    const names = files.filter(f => f.char === char).map(f => f.name)
    const allOn = names.every(n => picked.has(n))
    const next = new Set(picked)
    for (const n of names) { if (allOn) next.delete(n); else next.add(n) }
    setPicked(next)
  }

  // Lich logs group the same way, keyed by path rather than filename — Lich rotates
  // several files a day, so the name alone wouldn't be unique.
  const lichByChar = useMemo(() => {
    const m = new Map<string, LichLogEntry[]>()
    for (const f of lichFiles) {
      const arr = m.get(f.char) ?? m.set(f.char, []).get(f.char)!
      arr.push(f)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [lichFiles])

  const toggleLich = (path: string): void => {
    const next = new Set(pickedLich)
    if (next.has(path)) next.delete(path); else next.add(path)
    setPickedLich(next)
  }

  const toggleLichChar = (char: string): void => {
    const paths = lichFiles.filter(f => f.char === char).map(f => f.path)
    const allOn = paths.every(p => pickedLich.has(p))
    const next = new Set(pickedLich)
    for (const p of paths) { if (allOn) next.delete(p); else next.add(p) }
    setPickedLich(next)
  }

  async function analyzeSelected(): Promise<void> {
    setBusy(true); setError('')
    try {
      // Sequential rather than Promise.all: a month of logs would otherwise open
      // thirty simultaneous multi-megabyte reads against a small server.
      const out: Analysis[] = []
      for (const name of picked) {
        const file = await readLog(name)
        // Pull the sidecar when the listing said there is one — its experience data
        // is exact, and analyze() will prefer it over anything scraped from the text.
        const hasSidecar = files.find(f => f.name === name)?.events
        const sidecar = hasSidecar ? await readLogEvents(name) : null
        out.push(analyze(parseLogFile(file.name, file.content), {
          streamEvents: sidecar ? parseJsonl(sidecar.content) : undefined,
        }))
      }
      // Lich's server-side logs go through the same analysis, but arrive as raw
      // stream rather than flattened text, so they carry their own events.
      for (const path of pickedLich) {
        const file = await readLichLog(path)
        const parsed = parseLichXml(path.split('/').pop() ?? path, file.content, path)
        out.push(analyze(parsed.log, { streamEvents: parsed.events }))
      }
      setRemote(out)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read those logs.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Take dropped files, of which there are now three kinds and no reason to make
   * anyone care which:
   *   • Magiloom `.log`, optionally paired with its `.jsonl` sidecar by name.
   *   • Lich `.xml` — the raw stream, which needs no sidecar because nothing was
   *     flattened out of it in the first place.
   *   • Lich `.log` — the flattened one, which has no per-line timestamps and so
   *     can't be analyzed at all; recognised only so we can say why.
   * Each file is classified by its CONTENT, not its extension, since both writers use
   * `.log` for entirely different formats.
   */
  async function addLocalFiles(fileList: FileList | null): Promise<void> {
    if (!fileList?.length) return
    setError('')
    setBusy(true)

    try {
      const all = Array.from(fileList)
      const sidecars = new Map<string, string>()   // "refia-2026-07-09" → jsonl content
      for (const f of all.filter(f => f.name.endsWith('.jsonl'))) {
        sidecars.set(f.name.replace(/\.jsonl$/, ''), await f.text())
      }

      const out: Analysis[] = []
      const rejected: string[] = []
      let flattenedLich = 0

      for (const f of all.filter(f => !f.name.endsWith('.jsonl'))) {
        const text = await f.text()
        // A folder pick carries the path, which is the only place a Lich log records
        // which character it belongs to (…/DR-Refia/2026/07/…).
        const path = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name
        const lich = parseLichLog(f.name, text, path)

        if (lich.kind === 'xml') {
          out.push(analyze(lich.log, { streamEvents: lich.events }))
          continue
        }
        if (lich.kind === 'text') { flattenedLich++; continue }

        const parsed = parseLogFile(f.name, text)
        if (!parsed.lines.length) { rejected.push(f.name); continue }
        const sidecar = sidecars.get(f.name.replace(/\.log$/, ''))
        out.push(analyze(parsed, { streamEvents: sidecar ? parseJsonl(sidecar) : undefined }))
      }

      if (flattenedLich && !out.length) {
        setError(
          `Those ${flattenedLich === 1 ? 'is a Lich .log file' : `are ${flattenedLich} Lich .log files`}, ` +
          'which record no per-line times — nothing can be measured from them. Use the ' +
          '.xml file saved next to each one instead; it holds the full stream.')
      } else if (!out.length && sidecars.size && !rejected.length) {
        setError('Those are sidecar files. Add the .log files too — ideally both together.')
      } else if (rejected.length) {
        setError(`${rejected.join(', ')} wasn't a log this understands.`)
      }
      setLocal(prev => [...prev, ...out])
    } finally {
      setBusy(false)
    }
  }

  const results = [...remote, ...local]
  const selectedCount = picked.size + pickedLich.size

  // Bring the readout into view once it appears. The form above it is tall enough
  // that on a laptop the numbers land below the fold and it looks like nothing
  // happened. Only fires when results arrive, so it never fights a manual scroll,
  // and it's skipped for anyone who's asked for reduced motion.
  useEffect(() => {
    if (!results.length || !resultsRef.current) return
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    resultsRef.current.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
  }, [results.length])

  return (
    <>
      <h1>Log Analyzer</h1>
      <p className="lede">
        Turn your play logs into something you can read: experience gained per skill,
        where your hours actually went, and what you fought. Every character you play
        through Magiloom, in one place.
      </p>

      {account === undefined && <div className="card"><p className="muted">Checking your account…</p></div>}

      {account === null && <SignIn onSignedIn={a => setAccount(a)} />}

      {account && (
        <div className="card">
          <div className="row" style={{ marginBottom: 14 }}>
            <h2 style={{ margin: 0, flex: 1 }}>Your logs</h2>
            <span className="muted shrink">{account.email}</span>
            <button className="ghost small shrink" onClick={() => { logout(); setAccount(null); setFiles([]); setLich([]); setRemote([]) }}>
              Sign out
            </button>
          </div>

          {error && <p className="err">{error}</p>}

          {files.length === 0 && lichFiles.length === 0 && !error && (
            <p className="empty">
              No logs on the server yet.<br />
              <span className="muted">
                Turn on logging in the app (Settings → Logs) and play a while — or drop a
                desktop log below.
              </span>
            </p>
          )}

          {byChar.map(([char, list]) => (
            <div key={char} style={{ marginBottom: 16 }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <h3 style={{ margin: 0, flex: 1, textTransform: 'capitalize' }}>{char}</h3>
                <button className="ghost small shrink" onClick={() => toggleChar(char)}>
                  {list.every(f => picked.has(f.name)) ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="filelist">
                {list.map(f => (
                  <label className="fileitem" key={f.name}>
                    <input type="checkbox" checked={picked.has(f.name)} onChange={() => toggle(f.name)} />
                    <span className="fname mono">{f.day}</span>
                    {f.events && <span className="pill" data-tooltip="Structured data was recorded alongside this log — its experience figures are exact.">exact</span>}
                    <span className="fsize">{(f.size / 1024).toFixed(0)} KB</span>
                  </label>
                ))}
              </div>
            </div>
          ))}

          {lichByChar.length > 0 && (
            <>
              <h3 style={{ marginTop: 22 }}>
                From Lich <span className="pill">exact</span>
              </h3>
              <p className="note" style={{ marginTop: 4 }}>
                When the server runs Lich for you it keeps its own record of the raw game
                stream — a better source than the text log, since nothing has been stripped
                out of it. Lich starts a new file each time it reconnects, so there are
                usually several a day.
              </p>
              {lichByChar.map(([char, list]) => (
                <div key={char} style={{ marginBottom: 16 }}>
                  <div className="row" style={{ marginBottom: 6 }}>
                    <h3 style={{ margin: 0, flex: 1, textTransform: 'capitalize' }}>{char}</h3>
                    <button className="ghost small shrink" onClick={() => toggleLichChar(char)}>
                      {list.every(f => pickedLich.has(f.path)) ? 'Clear' : 'Select all'}
                    </button>
                  </div>
                  <div className="filelist">
                    {list.map(f => (
                      <label className="fileitem" key={f.path}>
                        <input type="checkbox" checked={pickedLich.has(f.path)}
                               onChange={() => toggleLich(f.path)} />
                        <span className="fname mono">{f.day} <span className="muted">{f.time}</span></span>
                        <span className="fsize">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {(files.length > 0 || lichFiles.length > 0) && (
            <button disabled={!selectedCount || busy} onClick={analyzeSelected}>
              {busy ? 'Reading…' : `Analyze ${selectedCount || ''} log${selectedCount === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
      )}

      <div className="card">
        <h2>Or drop a log file</h2>
        <div
          className={`drop${dragOver ? ' over' : ''}`}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); void addLocalFiles(e.dataTransfer.files) }}
        >
          <p style={{ margin: '0 0 10px' }}>
            Drag log files here — or
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <label className="btn shrink" style={{ display: 'inline-block' }}>
              Choose files
              <input type="file" multiple accept=".log,.xml,.jsonl,.txt" style={{ display: 'none' }}
                     onChange={e => { void addLocalFiles(e.target.files); e.target.value = '' }} />
            </label>
            {/* A folder pick is the only way the browser hands us the path, and a Lich
                log records its character nowhere else — the name lives in the
                DR-<Character> directory, not in the file. */}
            <label className="btn ghost shrink" style={{ display: 'inline-block' }}>
              Choose a folder
              <input type="file" multiple style={{ display: 'none' }}
                     // @ts-expect-error — non-standard but supported everywhere that matters
                     webkitdirectory="" directory=""
                     onChange={e => { void addLocalFiles(e.target.files); e.target.value = '' }} />
            </label>
          </div>
          <p className="muted" style={{ margin: '12px 0 0', fontSize: '.85rem' }}>
            Magiloom's own logs are in its data folder under <span className="mono">logs/</span>.
            Lich keeps its own too, under <span className="mono">Lich5/logs/DR-&lt;Character&gt;/</span> —
            drop the <span className="mono">.xml</span> files, which hold the full game stream and give
            exact results. Picking the whole folder also picks up which character each log belongs to.
            Nothing is uploaded either way.
          </p>
        </div>
        {local.length > 0 && (
          <p className="note">
            {local.length} dropped log{local.length === 1 ? '' : 's'} included.{' '}
            <button className="ghost small" onClick={() => setLocal([])}>Remove</button>
          </p>
        )}
        {results.length === 0 && (
          <p className="note">
            Not sure what you'd get?{' '}
            <button className="ghost small" onClick={() => {
              const s = sampleLog()
              setLocal([analyze(parseLogFile(s.name, s.content))])
            }}>Load a sample log</button>
          </p>
        )}
      </div>

      {results.length > 0 && (
        <div ref={resultsRef}>
          <Results list={results} />
        </div>
      )}
    </>
  )
}
