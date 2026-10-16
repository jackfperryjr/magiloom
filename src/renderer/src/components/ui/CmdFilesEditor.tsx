import { useState, useEffect, useRef, useCallback } from 'react'
import { Tooltip } from './Tooltip'
import { CodeEditor } from './CodeEditor'
import { PopoutButton } from './PopoutButton'
import { useScriptPopout } from './ScriptPopouts'
import { useIsMobile } from '../../hooks/useIsMobile'

// Editor for the user's native Genie/Wizard `.cmd` scripts, embedded in
// Settings → Scripts. Backed by the dr.script.* file API, which is confined to the
// configured scripts folder (script names can't contain path separators). Mirrors
// LichFilesEditor, but the scripts folder is flat — one bucket of `.cmd` files — so
// there are no sub-groups. Scripts are keyed by their basename (no extension), the
// same identity dr.script.run/list use.

// Nudge the Scripts sidebar panel to rescan after a create/delete/rename.
const notifyScriptsChanged = () => window.dispatchEvent(new CustomEvent('scripts:changed'))

export function CmdFilesEditor() {
  const [files, setFiles]       = useState<string[]>([])
  const [selected, setSelected] = useState<string | null>(null)   // basename
  const [content, setContent]   = useState('')
  const [saved, setSaved]       = useState('')    // what's on disk, for handing a file to a pop-out
  const [dirty, setDirty]       = useState(false)
  const [error, setError]       = useState('')
  const [status, setStatus]     = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName]   = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pop      = useScriptPopout('cmd')
  const isMobile = useIsMobile()
  const out      = selected !== null && pop.isOut(selected)

  const flash = (m: string) => { setStatus(m); window.setTimeout(() => setStatus(''), 2500) }

  const refresh = useCallback(async () => {
    try { setFiles(await window.dr.script.list()) }
    catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const open = async (name: string) => {
    try {
      const res = await window.dr.script.readFile(name)
      setSelected(name); setContent(res.content); setSaved(res.content); setDirty(false); setError('')
    } catch (e) { setError(String(e)) }
  }

  // The pop-out owns the file while it's out, unsaved edits and all. Back here by
  // bringBack, it returns them; closed any other way it was saved or discarded
  // there, so what's on disk is the truth — reread it.
  const popOut = () => {
    if (!selected) return
    pop.popOut(selected, content, dirty ? saved : content)
    setDirty(false)
  }
  const bringBack = () => {
    const entry = selected ? pop.bringBack(selected) : null
    if (entry) { setContent(entry.content); setSaved(entry.saved); setDirty(entry.content !== entry.saved) }
  }
  const wasOut = useRef(false)
  useEffect(() => {
    if (wasOut.current && !out && selected && !dirty) void open(selected)
    wasOut.current = out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [out])

  const save = async () => {
    if (!selected) return
    try { await window.dr.script.writeFile(selected, content); setSaved(content); setDirty(false); flash('Saved'); void refresh() }
    catch (e) { setError(String(e)) }
  }

  const remove = async (name: string) => {
    try {
      await window.dr.script.deleteFile(name)
      setConfirmDelete(null)
      pop.drop(name)
      if (selected === name) { setSelected(null); setContent(''); setDirty(false) }
      flash('Deleted'); void refresh(); notifyScriptsChanged()
    } catch (e) { setError(String(e)) }
  }

  const createNew = async () => {
    const base = newName.trim().replace(/\.cmd$/i, '')
    if (!base) return
    try {
      await window.dr.script.writeFile(base, '')
      setCreating(false); setNewName('')
      await refresh(); notifyScriptsChanged(); void open(base)
    } catch (e) { setError(String(e)) }
  }

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try {
      const base = file.name.replace(/\.cmd$/i, '')
      await window.dr.script.writeFile(base, await file.text())
      await refresh(); notifyScriptsChanged(); void open(base); flash('Uploaded ' + file.name)
    } catch (err) { setError(String(err)) }
  }

  return (
    <div className="lf-embed">
      <div className="lf-embed-head">
        <span className="settings-label" style={{ margin: 0 }}>Script files</span>
        {status && <span className="lf-status">{status}</span>}
      </div>
      <div className="lf-body lf-body-embed lf-body-code">
        <div className="lf-list">
          <div className="lf-group">
            <div className="lf-group-head">
              <span>.cmd scripts</span>
              <span className="lf-group-actions">
                <Tooltip text="New script"><button className="lf-mini" onClick={() => { setCreating(true); setNewName('') }}>+</button></Tooltip>
                <Tooltip text="Upload a .cmd file"><button className="lf-mini" onClick={() => fileInputRef.current?.click()}>↑</button></Tooltip>
              </span>
            </div>
            {creating && (
              <div className="lf-new">
                <input autoFocus className="lf-new-input" placeholder="script.cmd" value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') void createNew(); if (e.key === 'Escape') setCreating(false) }} />
                <button className="lf-mini" onClick={() => void createNew()}>✓</button>
                <button className="lf-mini" onClick={() => setCreating(false)}>×</button>
              </div>
            )}
            {files.length === 0 && !creating && <div className="lf-none">— none —</div>}
            {files.map(name => (
              <div key={name} className={'lf-item' + (selected === name ? ' active' : '')}>
                <span className="lf-item-name" onClick={() => void open(name)}>{name}.cmd</span>
                {confirmDelete === name ? (
                  <span className="lf-confirm">
                    <button className="lf-mini lf-danger" onClick={() => void remove(name)}>Delete</button>
                    <button className="lf-mini" onClick={() => setConfirmDelete(null)}>×</button>
                  </span>
                ) : (
                  <Tooltip text="Delete"><button className="lf-mini" onClick={() => setConfirmDelete(name)}>🗑</button></Tooltip>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="lf-editor">
          {selected && out ? (
            <div className="lf-empty lf-popped">
              <span><span className="lf-popped-name">{selected}.cmd</span> is open in its own window.</span>
              <button className="lf-mini" onClick={bringBack}>Bring it back here</button>
            </div>
          ) : selected ? <>
            <div className="lf-editor-bar">
              <span className="lf-editor-name">{selected}.cmd{dirty ? ' •' : ''}</span>
              <span className="lf-editor-actions">
                {!isMobile && <PopoutButton className="lf-mini" label="Edit in its own window" onClick={popOut} />}
                <button className="login-btn" style={{ width: 'auto', padding: '5px 14px' }} disabled={!dirty} onClick={() => void save()}>Save</button>
              </span>
            </div>
            <CodeEditor path={selected + '.cmd'} value={content} onChange={v => { setContent(v); setDirty(true) }} onSave={() => void save()} />
          </> : <div className="lf-empty">Select a script to edit, or use + / ↑ to create or upload one.</div>}
        </div>
      </div>
      {error && <div className="lf-error">{error}</div>}
      <input ref={fileInputRef} type="file" accept=".cmd" style={{ display: 'none' }} onChange={onUpload} />
    </div>
  )
}
