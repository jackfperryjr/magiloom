import type { Dispatch, SetStateAction } from 'react'
import type { Trigger } from '../../../lib/automation'
import { ClassToggleStrip, distinctClasses } from '../ClassToggleStrip'
import { uid } from './util'

// Settings → Triggers: run a command when a line of game text matches.
export function TriggersTab({
  triggers, setTriggers, classes, toggleClass, importGenie, importMsg,
}: {
  triggers:    Trigger[]
  setTriggers: Dispatch<SetStateAction<Trigger[]>>
  classes:     Record<string, boolean>
  toggleClass: (name: string) => void
  importGenie: () => void
  importMsg:   string
}) {
  return (
    <div className="settings-section">
      <div className="rule-header">
        <span className="settings-section-label">Triggers</span>
        <button className="login-btn-secondary rule-import-btn" onClick={importGenie}>Import…</button>
      </div>
      {importMsg && <div className="settings-hint rule-import-msg">{importMsg}</div>}
      <ClassToggleStrip names={distinctClasses(triggers)} states={classes} onToggle={toggleClass} />
      <div className="rule-list">
        {triggers.length === 0 && (
          <p className="hl-empty-msg">No triggers yet. Add one below.</p>
        )}
        {triggers.map(t => (
          <div key={t.id} className={'rule-row' + (t.enabled ? '' : ' rule-row-off')}>
            <input
              type="checkbox"
              checked={t.enabled}
              title="Enabled"
              onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, enabled: e.target.checked } : x))}
            />
            <input
              className="settings-input settings-input-mono"
              placeholder={t.isRegex ? 'stunned (.+)' : 'text to match'}
              value={t.pattern}
              spellCheck={false}
              onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, pattern: e.target.value } : x))}
            />
            <label className="rule-regex" title="Regular expression">
              <input
                type="checkbox"
                checked={t.isRegex}
                onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, isRegex: e.target.checked } : x))}
              />
              .*
            </label>
            <span className="rule-arrow">→</span>
            <input
              className="settings-input settings-input-mono"
              placeholder="stand"
              value={t.command}
              spellCheck={false}
              onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, command: e.target.value } : x))}
            />
            <input
              className="settings-input settings-input-mono rule-class"
              placeholder="class"
              title="Class (optional) — toggle groups on/off"
              value={t.class ?? ''}
              spellCheck={false}
              onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, class: e.target.value.trim() || undefined } : x))}
            />
            <button className="hl-btn-icon hl-btn-delete" title="Delete"
              onClick={() => setTriggers(list => list.filter(x => x.id !== t.id))}>×</button>
          </div>
        ))}
        <button className="hl-add-btn"
          onClick={() => setTriggers(list => [...list, { id: uid(), pattern: '', isRegex: false, command: '', enabled: true }])}>
          + Add trigger
        </button>
      </div>
      <div className="settings-hint">
        When a line of game text matches, the command fires automatically. Enable
        <code> .*</code> for a regular expression; then <code>%0</code> is the whole match and
        <code> %1</code>…<code>%9</code> are capture groups. A trigger may also run a script (<code>.foo</code>).
        Tag rules with a <b>class</b> to toggle whole groups on/off — from the pills above,
        or in-game with <code>#class name on|off</code>.
      </div>
    </div>
  )
}
