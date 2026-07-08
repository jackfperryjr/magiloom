import { useState, useEffect, useRef } from 'react'
import type { Highlight } from '../../lib/themes'
import { Tooltip } from './Tooltip'
export type { Highlight }



const PRESET_COLORS = [
  '#e8c87a', '#f0a070', '#e07070', '#d070c0',
  '#9090e8', '#70b8f0', '#70d090', '#a0d870',
  '#f0f0a0', '#ffffff', '#c0c0c0', '#888888',
]

const BLANK: Omit<Highlight, 'id'> = {
  pattern: '', isRegex: false, color: '#e8c87a',
  bgcolor: '', bold: false, enabled: true
}

function uid() { return Math.random().toString(36).slice(2, 9) }

function ColorPicker({ value, onChange, label }: {
  value: string; onChange: (v: string) => void; label: string
}) {
  return (
    <div className="hl-color-picker">
      <span className="hl-color-label">{label}</span>
      <div className="hl-swatches">
        <Tooltip text="None">
          <div
            className={'hl-swatch hl-swatch-none' + (!value ? ' active' : '')}
            onClick={() => onChange('')}
          />
        </Tooltip>
        {PRESET_COLORS.map(c => (
          <div
            key={c}
            className={'hl-swatch' + (value === c ? ' active' : '')}
            style={{ background: c }}
            onClick={() => onChange(c)}
          />
        ))}
        <Tooltip text="Custom">
          <input
            type="color"
            className="hl-color-input"
            value={value || '#ffffff'}
            onChange={e => onChange(e.target.value)}
          />
        </Tooltip>
      </div>
    </div>
  )
}

function HighlightRow({ hl, onChange, onDelete }: {
  hl: Highlight
  onChange: (hl: Highlight) => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)

  // When a row's options open, make sure they're scrolled into view — otherwise
  // the last row's options render below the fold of the scroll container.
  useEffect(() => {
    if (expanded) optionsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [expanded])

  const previewStyle: React.CSSProperties = {
    color:      hl.color   || undefined,
    background: hl.bgcolor || undefined,
    fontWeight: hl.bold    ? 'bold' : undefined,
  }

  return (
    <div className={'hl-row' + (!hl.enabled ? ' hl-row-disabled' : '')}>
      <div className="hl-row-main">
        <Tooltip text="Enable">
          <input
            type="checkbox"
            checked={hl.enabled}
            onChange={e => onChange({ ...hl, enabled: e.target.checked })}
          />
        </Tooltip>
        <div className="hl-preview" style={previewStyle}>
          {hl.pattern || <span className="hl-empty">pattern…</span>}
        </div>
        <input
          className="hl-pattern-input"
          value={hl.pattern}
          onChange={e => onChange({ ...hl, pattern: e.target.value })}
          placeholder="text or /regex/"
          spellCheck={false}
        />
        <Tooltip text="Options">
          <button className="hl-btn-icon" onClick={() => setExpanded(x => !x)}>
            {expanded ? '▲' : '▼'}
          </button>
        </Tooltip>
        <Tooltip text="Delete">
          <button className="hl-btn-icon hl-btn-delete" onClick={onDelete}>×</button>
        </Tooltip>
      </div>
      {expanded && (
        <div className="hl-row-options" ref={optionsRef}>
          <label className="hl-checkbox-label">
            <input
              type="checkbox"
              checked={hl.isRegex}
              onChange={e => onChange({ ...hl, isRegex: e.target.checked })}
            />
            Regular expression
          </label>
          <label className="hl-checkbox-label">
            <input
              type="checkbox"
              checked={hl.bold}
              onChange={e => onChange({ ...hl, bold: e.target.checked })}
            />
            Bold
          </label>
          <ColorPicker label="Text color" value={hl.color} onChange={c => onChange({ ...hl, color: c })} />
          <ColorPicker label="Background" value={hl.bgcolor} onChange={c => onChange({ ...hl, bgcolor: c })} />
          <button className="hl-options-done" onClick={() => setExpanded(false)}>Done ▲</button>
        </div>
      )}
    </div>
  )
}

export function HighlightsModal({ onClose, charName = '' }: { onClose: () => void; charName?: string }) {
  const [highlights, setHighlights] = useState<Highlight[]>([])

  useEffect(() => {
    window.dr.settings.getChar(charName).then(c => {
      setHighlights((c.highlights as Highlight[]) ?? [])
    })
  }, [charName])

  // Edits stay local until Save — that's what lets Cancel discard them.
  const add = () => setHighlights(hls => [...hls, { ...BLANK, id: uid() }])

  const update = (id: string, hl: Highlight) =>
    setHighlights(hls => hls.map(h => h.id === id ? hl : h))

  const remove = (id: string) =>
    setHighlights(hls => hls.filter(h => h.id !== id))

  const handleSave = async () => {
    await window.dr.settings.patchChar(charName, { highlights })
    onClose()
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-highlights">
        <div className="modal-header">
          <span className="modal-title">Highlights</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="hl-body">
          {highlights.length === 0 && (
            <p className="hl-empty-msg">No highlights yet. Add one below.</p>
          )}
          {highlights.map(hl => (
            <HighlightRow
              key={hl.id}
              hl={hl}
              onChange={h => update(hl.id, h)}
              onDelete={() => remove(hl.id)}
            />
          ))}
          <button className="hl-add-btn" onClick={add}>+ Add highlight</button>
        </div>
        <div className="modal-footer">
          <button className="login-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="login-btn" style={{ minWidth: 80 }} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
