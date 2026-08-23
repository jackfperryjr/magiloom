import type { Dispatch, SetStateAction } from 'react'
import { matchTriggers, type Trigger } from '../../../lib/automation'
import { ClassToggleStrip, distinctClasses } from '../ClassToggleStrip'
import { RuleTester, RegexWarning, NoMatch } from '../RuleTester'
import { Toggle } from './Field'
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
    // Wide: rule rows are a line of fields, not a label/control pair.
    <div className="settings-section settings-section-wide">
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
            <Toggle
              checked={t.enabled}
              size="sm"
              label="Enabled"
              onChange={v => setTriggers(list => list.map(x => x.id === t.id ? { ...x, enabled: v } : x))}
            />
            <input
              className="settings-input settings-input-mono"
              placeholder={t.isRegex ? 'stunned (.+)' : 'text to match'}
              value={t.pattern}
              spellCheck={false}
              onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, pattern: e.target.value } : x))}
            />
            <span className="rule-regex" data-tooltip="Regular expression">
              <span>.*</span>
              <Toggle
                checked={t.isRegex}
                size="sm"
                label="Regular expression"
                onChange={v => setTriggers(list => list.map(x => x.id === t.id ? { ...x, isRegex: v } : x))}
              />
            </span>
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
              data-tooltip="Class (optional) — toggle groups on/off"
              value={t.class ?? ''}
              spellCheck={false}
              onChange={e => setTriggers(list => list.map(x => x.id === t.id ? { ...x, class: e.target.value.trim() || undefined } : x))}
            />
            <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
              onClick={() => setTriggers(list => list.filter(x => x.id !== t.id))}>×</button>
            <RegexWarning pattern={t.pattern} isRegex={t.isRegex} />
          </div>
        ))}
        <button className="hl-add-btn"
          onClick={() => setTriggers(list => [...list, { id: uid(), pattern: '', isRegex: false, command: '', enabled: true }])}>
          + Add trigger
        </button>
      </div>

      {/* Runs the real trigger matcher, so this is exactly what would fire. */}
      <RuleTester render={line => {
        const fired = matchTriggers(line, triggers)
        if (fired.length === 0) return <NoMatch what="No trigger fires on this line." />
        return (
          <div className="rule-tester-fired">
            {fired.map((cmd, i) => (
              <div key={i} className="rule-tester-cmd">
                <span className="rule-arrow">→</span>
                <code>{cmd}</code>
              </div>
            ))}
          </div>
        )
      }} />
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
