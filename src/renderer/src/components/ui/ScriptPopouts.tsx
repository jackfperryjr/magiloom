import { useAtom, useSetAtom } from 'jotai'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useDetachedWindow } from '../../hooks/useDetachedWindow'
import {
  scriptPopoutsAtom, scriptPopoutKey, SCRIPT_FILES,
  type ScriptKind, type ScriptPopout,
} from '../../store/scriptPopouts'
import { CodeEditor } from './CodeEditor'

// Script files popped out of Settings into windows of their own (see
// store/scriptPopouts). Mounted once at the app root, so the windows outlive Settings.

/** The Settings editors' side of a pop-out: hand a file over, ask whether it's out,
 *  take it back. */
export function useScriptPopout(kind: ScriptKind) {
  const [list, setList] = useAtom(scriptPopoutsAtom)
  const find = (path: string): ScriptPopout | undefined =>
    list.find(e => e.key === scriptPopoutKey(kind, path))
  return {
    isOut: (path: string): boolean => !!find(path),
    popOut: (path: string, content: string, saved: string): void => {
      const key = scriptPopoutKey(kind, path)
      setList(l => (l.some(e => e.key === key) ? l : [...l, { key, kind, path, content, saved }]))
    },
    /** Closes its window and returns its text — unsaved edits included — or null. */
    bringBack: (path: string): ScriptPopout | null => {
      const entry = find(path)
      if (entry) setList(l => l.filter(e => e.key !== entry.key))
      return entry ?? null
    },
    /** The file is gone (deleted): close its window without a word. */
    drop: (path: string): void => {
      const key = scriptPopoutKey(kind, path)
      setList(l => l.filter(e => e.key !== key))
    },
  }
}

export function ScriptPopouts() {
  const [list] = useAtom(scriptPopoutsAtom)
  // One "unsaved changes" prompt at a time; the next shows once it's answered.
  const orphan = list.find(e => e.orphaned)
  return <>
    {list.filter(e => !e.orphaned).map(e => <ScriptWindow key={e.key} entry={e} />)}
    {orphan && <OrphanDialog key={orphan.key} entry={orphan} />}
  </>
}

function useEntryActions(key: string) {
  const setList = useSetAtom(scriptPopoutsAtom)
  return {
    update: (patch: Partial<ScriptPopout>) =>
      setList(l => l.map(e => (e.key === key ? { ...e, ...patch } : e))),
    remove: () => setList(l => l.filter(e => e.key !== key)),
    /** Its window went away: forget a clean file, keep a dirty one to ask about. */
    closed: () => setList(l => l.flatMap(e =>
      e.key !== key ? [e] : e.content !== e.saved ? [{ ...e, orphaned: true }] : [])),
  }
}

function ScriptWindow({ entry }: { entry: ScriptPopout }) {
  const { update, remove, closed } = useEntryActions(entry.key)
  const files = SCRIPT_FILES[entry.kind]
  const label = files.label(entry.path)
  const dirty = entry.content !== entry.saved
  const [status, setStatus]           = useState('')
  const [error, setError]             = useState('')
  const [confirmClose, setConfirmClose] = useState(false)

  const host = useDetachedWindow(true, {
    title: `Lantern — ${label}`,
    features: 'popup=yes,width=920,height=760',
    onClose: closed,
  })

  const save = async (): Promise<void> => {
    const content = entry.content
    try {
      await files.write(entry.path, content)
      update({ saved: content })
      setError(''); setStatus('Saved')
      window.setTimeout(() => setStatus(''), 2500)
    } catch (e) { setError(String(e)) }
  }

  if (!host) return null
  return createPortal(
    <div className="script-pop">
      <header className="script-pop-head">
        <span className="script-pop-name">{label}{dirty ? ' •' : ''}</span>
        <span className="script-pop-kind">{entry.kind === 'cmd' ? 'Genie script' : 'Lich'}</span>
        {status && <span className="lf-status">{status}</span>}
        <div className="script-pop-spacer" />
        {confirmClose ? <>
          <span className="script-pop-warn">Discard unsaved changes?</span>
          <button className="lf-mini lf-danger" onClick={remove}>Discard</button>
          <button className="lf-mini" onClick={() => setConfirmClose(false)}>Keep editing</button>
        </> : <>
          <button className="login-btn script-pop-save" disabled={!dirty} onClick={() => void save()}>Save</button>
          <button className="modal-close" aria-label={`Close ${label}`}
                  onClick={() => (dirty ? setConfirmClose(true) : remove())}>×</button>
        </>}
      </header>
      {error && <div className="lf-error script-pop-error">{error}</div>}
      <CodeEditor path={label} value={entry.content}
                  onChange={v => update({ content: v })} onSave={() => void save()} />
    </div>,
    host,
  )
}

// A window closed (its own ×, or the OS's) with edits still unsaved. The edits are
// kept until this is answered, rather than lost with the window.
function OrphanDialog({ entry }: { entry: ScriptPopout }) {
  const { update, remove } = useEntryActions(entry.key)
  const files = SCRIPT_FILES[entry.kind]
  const label = files.label(entry.path)
  const [error, setError] = useState('')

  const save = async (): Promise<void> => {
    try { await files.write(entry.path, entry.content); remove() }
    catch (e) { setError(String(e)) }
  }

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-box script-orphan">
        <div className="modal-header"><span className="modal-title">Unsaved changes</span></div>
        <div className="modal-body">
          <p className="script-orphan-text">
            The window for <span className="script-pop-name">{label}</span> was closed before
            its changes were saved.
          </p>
          {error && <div className="lf-error" style={{ padding: 0 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="login-btn-secondary" onClick={remove}>Discard</button>
          <button className="login-btn-secondary" onClick={() => update({ orphaned: false })}>Reopen</button>
          <button className="login-btn" onClick={() => void save()}>Save</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
