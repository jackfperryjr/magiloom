import { useState, useEffect, useRef, useCallback } from 'react'
import { Tooltip } from './Tooltip'

// Editor for a user's Lich profiles (<Char>-setup.yaml) and custom scripts (.lic),
// embedded in Settings → Lich. Backed by the path-jailed dr.lich.* file API — on
// the web client these live in the user's server-side Lich home; on desktop, the
// local Lich install's scripts/.

interface LichFileEntry { dir: 'profiles' | 'custom'; name: string; size: number; mtime: number }

const GROUPS: { dir: 'profiles' | 'custom'; label: string; ext: RegExp; suffix: string; hint: string }[] = [
  { dir: 'profiles', label: 'Character setups', ext: /\.ya?ml$/i, suffix: '.yaml', hint: 'Charname-setup.yaml' },
  { dir: 'custom',   label: 'Custom scripts',   ext: /\.lic$/i,   suffix: '.lic',  hint: 'script.lic' },
]

export function LichFilesEditor() {
  const [files, setFiles]     = useState<LichFileEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [content, setContent] = useState('')
  const [dirty, setDirty]     = useState(false)
  const [error, setError]     = useState('')
  const [status, setStatus]   = useState('')
  const [newFor, setNewFor]   = useState<'profiles' | 'custom' | null>(null)
  const [newName, setNewName] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadDir    = useRef<'profiles' | 'custom'>('custom')

  const flash = (m: string) => { setStatus(m); window.setTimeout(() => setStatus(''), 2500) }

  const refresh = useCallback(async () => {
    try { setFiles(await window.dr.lich.listFiles()) }
    catch (e) { setError(String(e)) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const open = async (rel: string) => {
    try {
      const res = await window.dr.lich.readFile(rel)
      setSelected(rel); setContent(res.content); setDirty(false); setError('')
    } catch (e) { setError(String(e)) }
  }

  const save = async () => {
    if (!selected) return
    try { await window.dr.lich.writeFile(selected, content); setDirty(false); flash('Saved'); void refresh() }
    catch (e) { setError(String(e)) }
  }

  const remove = async (rel: string) => {
    try {
      await window.dr.lich.deleteFile(rel)
      setConfirmDelete(null)
      if (selected === rel) { setSelected(null); setContent(''); setDirty(false) }
      flash('Deleted'); void refresh()
    } catch (e) { setError(String(e)) }
  }

  const createNew = async () => {
    if (!newFor || !newName.trim()) return
    const g = GROUPS.find(x => x.dir === newFor)!
    let name = newName.trim()
    if (!g.ext.test(name)) name += g.suffix
    const rel = `${newFor}/${name}`
    try {
      await window.dr.lich.writeFile(rel, '')
      setNewFor(null); setNewName('')
      await refresh(); void open(rel)
    } catch (e) { setError(String(e)) }
  }

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    try {
      const rel = `${uploadDir.current}/${file.name}`
      await window.dr.lich.writeFile(rel, await file.text())
      await refresh(); void open(rel); flash('Uploaded ' + file.name)
    } catch (err) { setError(String(err)) }
  }

  const renderGroup = (g: typeof GROUPS[number]) => {
    const items = files.filter(f => f.dir === g.dir)
    return (
      <div className="lf-group" key={g.dir}>
        <div className="lf-group-head">
          <span>{g.label}</span>
          <span className="lf-group-actions">
            <Tooltip text="New file"><button className="lf-mini" onClick={() => { setNewFor(g.dir); setNewName('') }}>+</button></Tooltip>
            <Tooltip text="Upload a file"><button className="lf-mini" onClick={() => { uploadDir.current = g.dir; fileInputRef.current?.click() }}>↑</button></Tooltip>
          </span>
        </div>
        {newFor === g.dir && (
          <div className="lf-new">
            <input autoFocus className="lf-new-input" placeholder={g.hint} value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void createNew(); if (e.key === 'Escape') setNewFor(null) }} />
            <button className="lf-mini" onClick={() => void createNew()}>✓</button>
            <button className="lf-mini" onClick={() => setNewFor(null)}>×</button>
          </div>
        )}
        {items.length === 0 && newFor !== g.dir && <div className="lf-none">— none —</div>}
        {items.map(f => {
          const rel = `${f.dir}/${f.name}`
          return (
            <div key={rel} className={'lf-item' + (selected === rel ? ' active' : '')}>
              <span className="lf-item-name" onClick={() => void open(rel)}>{f.name}</span>
              {confirmDelete === rel ? (
                <span className="lf-confirm">
                  <button className="lf-mini lf-danger" onClick={() => void remove(rel)}>Delete</button>
                  <button className="lf-mini" onClick={() => setConfirmDelete(null)}>×</button>
                </span>
              ) : (
                <Tooltip text="Delete"><button className="lf-mini" onClick={() => setConfirmDelete(rel)}>🗑</button></Tooltip>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="lf-embed">
      <div className="lf-embed-head">
        <span className="settings-label" style={{ margin: 0 }}>Profiles &amp; custom scripts</span>
        {status && <span className="lf-status">{status}</span>}
      </div>
      <div className="lf-body lf-body-embed">
        <div className="lf-list">{GROUPS.map(renderGroup)}</div>
        <div className="lf-editor">
          {selected ? <>
            <div className="lf-editor-bar">
              <span className="lf-editor-name">{selected}{dirty ? ' •' : ''}</span>
              <button className="login-btn" style={{ width: 'auto', padding: '5px 14px' }} disabled={!dirty} onClick={() => void save()}>Save</button>
            </div>
            <textarea className="lf-textarea" spellCheck={false} value={content}
              onChange={e => { setContent(e.target.value); setDirty(true) }} />
          </> : <div className="lf-empty">Select a file to edit, or use + / ↑ to create or upload one.</div>}
        </div>
      </div>
      {error && <div className="lf-error">{error}</div>}
      <input ref={fileInputRef} type="file" accept=".yaml,.yml,.lic" style={{ display: 'none' }} onChange={onUpload} />
    </div>
  )
}
