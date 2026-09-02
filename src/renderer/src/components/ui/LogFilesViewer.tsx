import { useState, useEffect, useCallback } from 'react'
import { Tooltip } from './Tooltip'
import { SettingRow, Toggle } from './settings/Field'
import { RetentionNotice, useTierLimits } from './RetentionNotice'

// Game-output logs, embedded in Settings → Lich beside the setups/scripts editor.
// Logging is per character (the toggle here writes CharSettings.logging), and the
// files themselves live server-side on the web client / in the shared data dir on
// desktop — so this is the only way to reach them from the browser. Read-only:
// view a log inline, or download it.

interface LogFilesViewerProps {
  charName?: string
  logging:   boolean
  setLogging: (v: boolean) => void
}

const fmtSize = (n: number): string =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`

export function LogFilesViewer({ charName = '', logging, setLogging }: LogFilesViewerProps) {
  const [files, setFiles]       = useState<LogFileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent]   = useState('')
  const [truncated, setTruncated] = useState(false)
  const [mine, setMine]         = useState(true)
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const limits = useTierLimits()

  const refresh = useCallback(async () => {
    try { setFiles(await window.dr.logs.list()); setError('') }
    catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  // The log dir is shared by every character on this install/bucket, so default to
  // just the one being played; the toggle reveals the rest.
  const slug  = charName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
  const shown = mine && slug ? files.filter(f => f.char === slug) : files

  const open = async (name: string) => {
    setLoading(true)
    try {
      const res = await window.dr.logs.read(name)
      setSelected(name); setContent(res.content); setTruncated(res.truncated); setError('')
    } catch (e) { setError(String(e)) }
    finally { setLoading(false) }
  }

  // Removes the .jsonl event sidecar alongside the text log — they're the same
  // session in two shapes, and an orphaned sidecar is unreadable on its own.
  const remove = async (name: string) => {
    try {
      await window.dr.logs.delete(name)
      if (selected === name) { setSelected(null); setContent('') }
      setConfirmDelete(null)
      await refresh()
    } catch (e) { setError(String(e)) }
  }

  // Always download the FULL log, not whatever the viewer truncated to.
  const download = async (name: string) => {
    try {
      const res = await window.dr.logs.read(name)
      const url = URL.createObjectURL(new Blob([res.content], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(String(e)) }
  }

  return (
    <div className="lf-embed">
      <div className="lf-embed-head">
        <span className="settings-label" style={{ margin: 0 }}>Logs</span>
        {files.length > 0 && slug && (
          <span className="lf-log-filter">
            <span>Only {charName}</span>
            <Toggle checked={mine} onChange={setMine} size="sm" label={`Only ${charName}`} />
          </span>
        )}
      </div>

      <SettingRow
        label={<>Log {charName || 'this character'}&apos;s game output</>}
        hint="Writes one file per character per day. Saved with the rest of Settings, and
              applies to the character you're playing right now."
        disabled={!charName}
      >
        <Toggle
          checked={logging}
          onChange={setLogging}
          disabled={!charName}
          label="Log game output"
        />
      </SettingRow>

      <div className="lf-body lf-body-embed">
        <div className="lf-list">
          <div className="lf-group">
            <div className="lf-group-head">
              <span>Log files</span>
              <span className="lf-group-actions">
                <Tooltip text="Refresh"><button className="lf-mini" onClick={() => void refresh()}>↻</button></Tooltip>
              </span>
            </div>
            {shown.length === 0 && <div className="lf-none">— none —</div>}
            {shown.map(f => (
              <div key={f.name} className={'lf-item' + (selected === f.name ? ' active' : '')}>
                <span className="lf-item-name" onClick={() => void open(f.name)}>
                  {mine && slug ? f.day : f.name} <span className="lf-log-size">{fmtSize(f.size)}</span>
                </span>
                {confirmDelete === f.name ? (
                  <span className="lf-confirm">
                    <button className="lf-mini lf-danger" onClick={() => void remove(f.name)}>Delete</button>
                    <button className="lf-mini" onClick={() => setConfirmDelete(null)}>×</button>
                  </span>
                ) : <>
                  <Tooltip text="Download"><button className="lf-mini" onClick={() => void download(f.name)}>↓</button></Tooltip>
                  <Tooltip text="Delete"><button className="lf-mini" onClick={() => setConfirmDelete(f.name)}>🗑</button></Tooltip>
                </>}
              </div>
            ))}
          </div>
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
          </> : <div className="lf-empty">Select a log to view it, or ↓ to download.</div>}
        </div>
      </div>
      {error && <div className="lf-error">{error}</div>}
      <RetentionNotice limits={limits} />
    </div>
  )
}
