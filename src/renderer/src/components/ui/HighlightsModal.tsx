import { useState, useEffect, useRef } from 'react'
import type { Highlight } from '../../lib/themes'
import { Tooltip } from './Tooltip'
import { ClassToggleStrip, distinctClasses, toggleClassState } from './ClassToggleStrip'
import { RuleTester, RegexWarning, NoMatch } from './RuleTester'
import { previewHighlights } from '../../lib/rules'
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
        {hl.action && (
          <span className={'hl-action-badge hl-action-' + hl.action}>{hl.action}</span>
        )}
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
          <label className="hl-class-row">
            <span className="hl-class-label">Action</span>
            <select
              className="hl-class-input"
              value={hl.action ?? 'highlight'}
              onChange={e => {
                const v = e.target.value
                onChange({ ...hl, action: v === 'highlight' ? undefined : (v as 'gag' | 'sub') })
              }}
            >
              <option value="highlight">Highlight (color)</option>
              <option value="gag">Gag (hide line)</option>
              <option value="sub">Substitute (rewrite)</option>
            </select>
          </label>
          {hl.action === 'sub' && (
            <label className="hl-class-row">
              <span className="hl-class-label">Replace</span>
              <input
                className="hl-class-input"
                value={hl.replace ?? ''}
                placeholder="replacement text (blank = remove)"
                spellCheck={false}
                onChange={e => onChange({ ...hl, replace: e.target.value })}
              />
            </label>
          )}
          {hl.action !== 'gag' && (
            <label className="hl-checkbox-label">
              <input
                type="checkbox"
                checked={hl.bold}
                onChange={e => onChange({ ...hl, bold: e.target.checked })}
              />
              Bold
            </label>
          )}
          {hl.action !== 'gag' && (
            <ColorPicker label="Text color" value={hl.color} onChange={c => onChange({ ...hl, color: c })} />
          )}
          {hl.action !== 'gag' && (
            <ColorPicker label="Background" value={hl.bgcolor} onChange={c => onChange({ ...hl, bgcolor: c })} />
          )}
          <label className="hl-class-row">
            <span className="hl-class-label">Class</span>
            <input
              className="hl-class-input"
              value={hl.class ?? ''}
              placeholder="(none)"
              spellCheck={false}
              onChange={e => onChange({ ...hl, class: e.target.value.trim() || undefined })}
            />
          </label>
          <button className="hl-options-done" onClick={() => setExpanded(false)}>Done ▲</button>
        </div>
      )}
      <RegexWarning pattern={hl.pattern} isRegex={hl.isRegex} />
    </div>
  )
}

// What the whole rule set does to a test line, in the order the client does it:
// gags and substitutes at ingest, then colouring. Uses the same functions the live
// pipeline uses, so this can't drift from real behaviour.
function HighlightPreview({ highlights, line }: { highlights: Highlight[]; line: string }) {
  const p = previewHighlights(line, highlights)

  if (p.gagged) {
    return (
      <div className="rule-tester-fired">
        <div className="rule-tester-cmd">
          <span className="hl-action-badge hl-action-gag">gag</span>
          <span className="rule-tester-gagged">Line hidden{p.gaggedBy?.pattern ? <> by <code>{p.gaggedBy.pattern}</code></> : null}</span>
        </div>
      </div>
    )
  }

  const styled = p.hl
    ? { color: p.hl.color || undefined, background: p.hl.bgcolor || undefined, fontWeight: p.hl.bold ? 'bold' as const : undefined }
    : undefined

  if (!p.changed && !p.hl) return <NoMatch what="No highlight matches this line." />

  return (
    <div className="rule-tester-fired">
      {p.changed && (
        <div className="rule-tester-cmd">
          <span className="hl-action-badge hl-action-sub">sub</span>
          <span className="rule-tester-channels">
            rewritten by {p.subbedBy.map(h => <code key={h.id}>{h.pattern}</code>)}
          </span>
        </div>
      )}
      <div className="rule-tester-line" style={styled}>{p.text}</div>
      {p.hl && (
        <div className="rule-tester-channels">
          coloured by <code>{p.hl.pattern}</code>
        </div>
      )}
    </div>
  )
}

// One editable highlight set: the account-wide shared one, or this character's own.
interface HlSet { highlights: Highlight[]; classes: Record<string, boolean>; dirty: boolean }
const EMPTY_SET: HlSet = { highlights: [], classes: {}, dirty: false }

export function HighlightsModal({ onClose, charName = '' }: { onClose: () => void; charName?: string }) {
  // Both sets are loaded so flipping the share switch just swaps which one the
  // editor shows; edits stay local until Save — that's what lets Cancel discard them.
  const [share,  setShare]  = useState(true)
  const [shared, setShared] = useState<HlSet>(EMPTY_SET)
  const [own,    setOwn]    = useState<HlSet>(EMPTY_SET)
  const [hasOwn, setHasOwn] = useState(false)

  useEffect(() => {
    Promise.all([window.dr.settings.getChar(charName), window.dr.settings.getAll()]).then(([c, s]) => {
      const sharedHl  = (s.highlights ?? []) as Highlight[]
      const sharedCls = s.classes ?? {}
      setShare(charName ? c.shareHighlights : true)
      setShared({ highlights: sharedHl, classes: sharedCls, dirty: false })
      // No list of its own yet → opting out starts from a copy of the shared set.
      setOwn({
        highlights: ((c.ownHighlights as Highlight[] | undefined) ?? sharedHl).map(h => ({ ...h })),
        classes:    { ...(c.ownClasses ?? sharedCls) },
        dirty:      false,
      })
      setHasOwn(c.ownHighlights !== undefined)
    })
  }, [charName])

  const cur = share ? shared : own
  const edit = (fn: (s: HlSet) => Partial<HlSet>) =>
    (share ? setShared : setOwn)(s => ({ ...s, ...fn(s), dirty: true }))

  const highlights = cur.highlights
  const add    = () => edit(s => ({ highlights: [...s.highlights, { ...BLANK, id: uid() }] }))
  const update = (id: string, hl: Highlight) =>
    edit(s => ({ highlights: s.highlights.map(h => h.id === id ? hl : h) }))
  const remove = (id: string) =>
    edit(s => ({ highlights: s.highlights.filter(h => h.id !== id) }))
  const toggleClass = (name: string) => edit(s => ({ classes: toggleClassState(s.classes, name) }))
  // Seed the shared set from this character's own list (e.g. the character you
  // customised before sharing existed).
  const adoptOwn = () => edit(() => ({
    highlights: own.highlights.map(h => ({ ...h, id: uid() })),
    classes:    { ...own.classes },
  }))

  const handleSave = async () => {
    // Write only the sets that were actually edited, so an untouched one can't
    // overwrite changes another character saved in the meantime.
    if (!charName) {
      if (shared.dirty) await window.dr.settings.patch({ highlights: shared.highlights, classes: shared.classes })
    } else {
      if (share && shared.dirty) {
        await window.dr.settings.patchChar(charName, { shareHighlights: true, highlights: shared.highlights, classes: shared.classes })
      } else if (!share && own.dirty) {
        await window.dr.settings.patchChar(charName, { shareHighlights: false, highlights: own.highlights, classes: own.classes })
      } else {
        await window.dr.settings.patchChar(charName, { shareHighlights: share })
      }
      // Edits made to the set that isn't selected still count.
      if (!share && shared.dirty) await window.dr.settings.patch({ highlights: shared.highlights, classes: shared.classes })
      if (share && own.dirty) {
        await window.dr.settings.patchChar(charName, { shareHighlights: false, highlights: own.highlights, classes: own.classes })
        await window.dr.settings.patchChar(charName, { shareHighlights: true })
      }
    }
    onClose()
  }

  return (
    <div className="modal-overlay modal-overlay-popover" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box modal-highlights">
        <div className="modal-header">
          <span className="modal-title">Highlights</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="hl-body">
          {charName && (
            <label className="broadcast-toggle hl-share-toggle">
              <div className="broadcast-toggle-text">
                <span className="broadcast-toggle-label">Use shared highlights</span>
                <span className="broadcast-toggle-hint">
                  {share
                    ? <>Changes here, and <code>#class</code> toggles, apply to every character using the shared set.</>
                    : <>{charName} keeps its own highlights and class states.</>}
                </span>
              </div>
              <input type="checkbox" className="broadcast-switch" checked={share}
                     onChange={e => setShare(e.target.checked)} />
            </label>
          )}
          {charName && share && hasOwn && (
            <button className="hl-adopt-btn" onClick={adoptOwn}>
              Replace the shared set with {charName}'s own highlights
            </button>
          )}
          <ClassToggleStrip names={distinctClasses(highlights)} states={cur.classes} onToggle={toggleClass} />
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
          <RuleTester render={line => <HighlightPreview highlights={highlights} line={line} />} />
        </div>
        <div className="modal-footer">
          <button className="login-btn-secondary" onClick={onClose}>Cancel</button>
          <button className="login-btn" style={{ minWidth: 80 }} onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  )
}
