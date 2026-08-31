import type { Dispatch, SetStateAction } from 'react'
import {
  QUICK_KINDS, newQuickAction, quickActionCommand, type QuickAction, type QuickKind,
} from '../../../lib/quickActions'

const FK_KEYS = ['F1','F2','F3','F4','F5','F6','F7','F8','F9','F10','F11','F12']

// Settings → Hotkeys: the two ways to fire something without typing it. Quick
// actions are the clickable buttons in the Scripts panel; function keys are the
// same idea bound to a key. They live together because choosing between them is
// the only real decision — the thing being run is identical either way.
export function HotkeysTab({
  quickActions, setQuickActions, functionKeys, setFk,
}: {
  quickActions:    QuickAction[]
  setQuickActions: Dispatch<SetStateAction<QuickAction[]>>
  functionKeys:    Record<string, string>
  setFk:           (key: string, cmd: string) => void
}) {
  const patch = (id: string, p: Partial<QuickAction>) =>
    setQuickActions(list => list.map(x => x.id === id ? { ...x, ...p } : x))

  return (
    <>
    <div className="settings-section settings-section-wide">
      <div className="settings-section-label">Quick Actions</div>
      <div className="rule-list">
        {quickActions.length === 0 && (
          <p className="hl-empty-msg">No quick actions yet. Add one below — they show as buttons in the Scripts panel.</p>
        )}
        {quickActions.map(a => (
          <div key={a.id} className="rule-row">
            <input
              className="settings-input rule-key"
              placeholder="Label"
              value={a.label}
              spellCheck={false}
              onChange={e => patch(a.id, { label: e.target.value })}
            />
            <select
              className="settings-input quick-kind-select"
              aria-label="Action type"
              value={a.kind}
              onChange={e => patch(a.id, { kind: e.target.value as QuickKind })}
            >
              {QUICK_KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
            <input
              className="settings-input settings-input-mono"
              placeholder={a.kind === 'command' ? 'stance defensive' : a.kind === 'cmd' ? 'hunt' : 'sloot'}
              value={a.target}
              spellCheck={false}
              onChange={e => patch(a.id, { target: e.target.value })}
            />
            {/* What actually goes out — the prefix is added for you, so it's worth showing. */}
            <code className="quick-preview">{quickActionCommand(a) || '—'}</code>
            <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
              onClick={() => setQuickActions(list => list.filter(x => x.id !== a.id))}>×</button>
          </div>
        ))}
        <button className="hl-add-btn"
          onClick={() => setQuickActions(list => [...list, newQuickAction()])}>
          + Add quick action
        </button>
      </div>
      <div className="settings-hint">
        Quick actions appear as buttons at the top of the <strong>Scripts</strong> panel.
        A <code>Command</code> is sent exactly as typed; a <code>.cmd script</code> runs one of
        your native scripts; a <code>Lich script</code> runs <code>;name</code>. Arguments are
        allowed in all three (<code>hunt orc</code>). Quick actions are per character.
      </div>
    </div>

    <div className="settings-section settings-section-wide">
      <div className="settings-section-label">Function Keys</div>
      <div className="fk-grid">
        {FK_KEYS.map(key => (
          <label key={key} className="fk-row">
            <span className="fk-label">{key}</span>
            <input
              className="settings-input settings-input-mono"
              type="text"
              placeholder="command"
              value={functionKeys[key] ?? ''}
              onChange={e => setFk(key, e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="settings-hint">
        Bound keys also show as buttons in the Scripts panel, so you can click them
        when a key isn't handy. A binding may be any command, including a
        script (<code>.hunt</code> or <code>;sloot</code>).
      </div>
    </div>
    </>
  )
}
