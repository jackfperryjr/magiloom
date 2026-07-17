import type { Dispatch, SetStateAction } from 'react'
import type { Alias } from '../../../lib/automation'
import { ClassToggleStrip, distinctClasses } from '../ClassToggleStrip'
import { uid } from './util'

// Settings → Aliases: first-word command aliases (with %-args) + user variables.
export function AliasesTab({
  aliases, setAliases, vars, setVars, classes, toggleClass, importGenie, importMsg,
}: {
  aliases:     Alias[]
  setAliases:  Dispatch<SetStateAction<Alias[]>>
  vars:        { name: string; value: string }[]
  setVars:     Dispatch<SetStateAction<{ name: string; value: string }[]>>
  classes:     Record<string, boolean>
  toggleClass: (name: string) => void
  importGenie: () => void
  importMsg:   string
}) {
  return (
    <>
    <div className="settings-section">
      <div className="rule-header">
        <span className="settings-section-label">Aliases</span>
        <button className="login-btn-secondary rule-import-btn" onClick={importGenie}>Import…</button>
      </div>
      {importMsg && <div className="settings-hint rule-import-msg">{importMsg}</div>}
      <ClassToggleStrip names={distinctClasses(aliases)} states={classes} onToggle={toggleClass} />
      <div className="rule-list">
        {aliases.length === 0 && (
          <p className="hl-empty-msg">No aliases yet. Add one below.</p>
        )}
        {aliases.map(a => (
          <div key={a.id} className={'rule-row' + (a.enabled ? '' : ' rule-row-off')}>
            <input
              type="checkbox"
              checked={a.enabled}
              title="Enabled"
              onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, enabled: e.target.checked } : x))}
            />
            <input
              className="settings-input settings-input-mono rule-key"
              placeholder="kk"
              value={a.pattern}
              spellCheck={false}
              onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, pattern: e.target.value } : x))}
            />
            <span className="rule-arrow">→</span>
            <input
              className="settings-input settings-input-mono"
              placeholder="kill %1"
              value={a.command}
              spellCheck={false}
              onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, command: e.target.value } : x))}
            />
            <input
              className="settings-input settings-input-mono rule-class"
              placeholder="class"
              title="Class (optional) — toggle groups on/off"
              value={a.class ?? ''}
              spellCheck={false}
              onChange={e => setAliases(list => list.map(x => x.id === a.id ? { ...x, class: e.target.value.trim() || undefined } : x))}
            />
            <button className="hl-btn-icon hl-btn-delete" title="Delete"
              onClick={() => setAliases(list => list.filter(x => x.id !== a.id))}>×</button>
          </div>
        ))}
        <button className="hl-add-btn"
          onClick={() => setAliases(list => [...list, { id: uid(), pattern: '', command: '', enabled: true }])}>
          + Add alias
        </button>
      </div>
      <div className="settings-hint">
        Type the alias as the first word of a command. Use <code>%1</code>…<code>%9</code> for the
        words after it and <code>%0</code> for all of them (e.g. <code>kk</code> → <code>kill %1</code>).
        An alias may expand to a script (<code>.hunt %1</code>).
      </div>
    </div>

    <div className="settings-section">
      <div className="settings-section-label">Variables</div>
      <div className="rule-list">
        {vars.length === 0 && (
          <p className="hl-empty-msg">No variables yet. Add one below, or set them live with <code>#var name value</code>.</p>
        )}
        {vars.map((v, i) => (
          <div key={i} className="rule-row">
            <span className="rule-arrow">%</span>
            <input
              className="settings-input settings-input-mono rule-key"
              placeholder="target"
              value={v.name}
              spellCheck={false}
              onChange={e => setVars(list => list.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}
            />
            <span className="rule-arrow">=</span>
            <input
              className="settings-input settings-input-mono"
              placeholder="orc"
              value={v.value}
              spellCheck={false}
              onChange={e => setVars(list => list.map((x, j) => j === i ? { ...x, value: e.target.value } : x))}
            />
            <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
              onClick={() => setVars(list => list.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        <button className="hl-add-btn"
          onClick={() => setVars(list => [...list, { name: '', value: '' }])}>
          + Add variable
        </button>
      </div>
      <div className="settings-hint">
        Reference a variable as <code>%name</code> in any command, alias, or trigger
        (e.g. <code>attack %target</code>). Set them live with <code>#var target orc</code>,
        view with <code>#var</code>, remove with <code>#unvar target</code>.
      </div>
    </div>
    </>
  )
}
