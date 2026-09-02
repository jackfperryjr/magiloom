import { useState, useEffect, useCallback, useMemo } from 'react'
import { Tooltip } from './Tooltip'
import { Toggle } from './settings/Field'
import { RetentionNotice, useTierLimits } from './RetentionNotice'

// Lich's OWN session logs, embedded in Settings → Lich. A different set from the
// Lantern Logs tab: Lich writes these itself, one pair per reconnect — a raw `.xml`
// of the stream and the same session flattened to `.log`.
//
// They were unreachable from the app until now. On the web build they live entirely
// server-side, so there was no way to see what was on disk, let alone clear it. That
// gap is why an account could sit on gigabytes of logs with nothing in the UI saying
// so. Read-only apart from delete: view, download, remove.

const fmtSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

export function LichLogsViewer() {
  const [files, setFiles]         = useState<LichLogEntry[]>([])
  const [selected, setSelected]   = useState<string | null>(null)
  const [content, setContent]     = useState('')
  const [truncated, setTruncated] = useState(false)
  const [xmlOnly, setXmlOnly]     = useState(true)
  const [error, setError]         = useState('')
  const [loading, setLoading]     = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const limits = useTierLimits()

  const refresh = useCallback(async () => {
    try { setFiles(await window.dr.lich.listLogs(false)); setError('') }
    catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  // The flattened .log has no per-line timestamps, so nothing can be measured from
  // it — and it's the bulk of the files. Default to hiding it, but keep it reachable
  // rather than pretending it isn't taking up the space.
  const shown = useMemo(() => (xmlOnly ? files.filter(f => f.xml) : files), [files, xmlOnly])
  const total = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files])

  const open = async (rel: string) => {
    setLoading(true)
    try {
      const res = await window.dr.lich.readLog(rel)
      setSelected(rel); setContent(res.content); setTruncated(res.truncated); setError('')
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  const download = async (rel: string) => {
    try {
      const res = await window.dr.lich.readLog(rel)
      const url = URL.createObjectURL(new Blob([res.content], { type: 'text/plain' }))
      const a = document.createElement('a')
      // Flatten the nested path into a filename that still says whose session it was.
      a.href = url; a.download = rel.replace(/\//g, '_'); a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(String(e)) }
  }

  const remove = async (rel: string) => {
    try {
      await window.dr.lich.deleteLog(rel)
      if (selected === rel) { setSelected(null); setContent('') }
      setConfirmDelete(null)
      await refresh()
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className="lf-embed">
      <div className="lf-embed-head">
        <span className="settings-label" style={{ margin: 0 }}>Lich session logs</span>
        {files.length > 0 && (
          <span className="lf-log-filter">
            <span>Raw stream only</span>
            <Toggle checked={xmlOnly} onChange={setXmlOnly} size="sm" label="Raw stream only" />
          </span>
        )}
      </div>

      <div className="settings-hint" style={{ marginTop: 0 }}>
        Lich writes one of these every time it reconnects, so they build up fast. The
        raw <code>.xml</code> is the fullest record of a session — nothing has been
        flattened out of it. Older logs are removed automatically; download anything
        worth keeping.
        {files.length > 0 && <> Currently holding <b>{fmtSize(total)}</b> across {files.length} file{files.length === 1 ? '' : 's'}.</>}
      </div>

      <div className="lf-body lf-body-embed">
        <div className="lf-list">
          <div className="lf-group-head">
            <span>Sessions</span>
            <span className="lf-group-actions">
              <Tooltip text="Refresh"><button className="lf-mini" onClick={() => void refresh()}>↻</button></Tooltip>
            </span>
          </div>
          {shown.length === 0 && <div className="lf-none">— none —</div>}
          {shown.map(f => (
            <div key={f.path} className={'lf-item' + (selected === f.path ? ' active' : '')}>
              <span className="lf-item-name" onClick={() => void open(f.path)}>
                {f.char} {f.day} {f.time}
                <span className="lf-log-size">{f.xml ? '' : 'flat · '}{fmtSize(f.size)}</span>
              </span>
              {confirmDelete === f.path ? (
                <span className="lf-confirm">
                  <button className="lf-mini lf-danger" onClick={() => void remove(f.path)}>Delete</button>
                  <button className="lf-mini" onClick={() => setConfirmDelete(null)}>×</button>
                </span>
              ) : <>
                <Tooltip text="Download"><button className="lf-mini" onClick={() => void download(f.path)}>↓</button></Tooltip>
                <Tooltip text="Delete both halves of this session">
                  <button className="lf-mini" onClick={() => setConfirmDelete(f.path)}>🗑</button>
                </Tooltip>
              </>}
            </div>
          ))}
        </div>

        <div className="lf-editor">
          {selected ? <>
            <div className="lf-editor-bar">
              <span className="lf-editor-name">{selected}</span>
              <button
                className="login-btn" style={{ width: 'auto', padding: '5px 14px' }}
                onClick={() => void download(selected)}
              >
                Download
              </button>
            </div>
            {truncated && (
              <div className="settings-hint" style={{ marginTop: 0 }}>
                Showing the end of a large log — download for the whole file.
              </div>
            )}
            <pre className="lf-log-view">{loading ? 'Loading…' : content}</pre>
          </> : <div className="lf-empty">Select a session to view it, or ↓ to download.</div>}
        </div>
      </div>
      {error && <div className="lf-error">{error}</div>}
      <RetentionNotice limits={limits} />
    </div>
  )
}
