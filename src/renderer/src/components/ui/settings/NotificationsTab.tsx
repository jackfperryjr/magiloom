import type { Dispatch, SetStateAction } from 'react'
import type { NotifSettings, NotifRule, PushSettings } from '../Notifications'

// Settings → Notifications: alerts, TTS, push, and user-defined custom alert rules.
export function NotificationsTab({
  notif, setNotif, push, setPush, notifRules, setNotifRules,
  watchName, setWatchName, patchRule, addWatchName,
}: {
  notif:        NotifSettings
  setNotif:     Dispatch<SetStateAction<NotifSettings>>
  push:         PushSettings
  setPush:      Dispatch<SetStateAction<PushSettings>>
  notifRules:   NotifRule[]
  setNotifRules: Dispatch<SetStateAction<NotifRule[]>>
  watchName:    string
  setWatchName: Dispatch<SetStateAction<string>>
  patchRule:    (id: string, p: Partial<NotifRule>) => void
  addWatchName: () => void
}) {
  return (
    <>
      <div className="settings-section">
        <div className="settings-section-label">Alerts</div>
        <label className="settings-row">
          <span className="settings-label">Play sound</span>
          <input type="checkbox" checked={notif.sound} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, sound: e.target.checked }))} />
        </label>
        <label className="settings-row">
          <span className="settings-label">Desktop popups</span>
          <input type="checkbox" checked={notif.desktop} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, desktop: e.target.checked }))} />
        </label>
        <div className="settings-hint">
          Desktop popups only appear when the window isn't focused. Do Not Disturb silences sound and popups.
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-label">Notify me about</div>
        <label className="settings-row">
          <span className="settings-label">Mentions</span>
          <input type="checkbox" checked={notif.mention} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, mention: e.target.checked }))} />
        </label>
        <label className="settings-row">
          <span className="settings-label">Whispers</span>
          <input type="checkbox" checked={notif.whisper} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, whisper: e.target.checked }))} />
        </label>
        <label className="settings-row">
          <span className="settings-label">Messages</span>
          <input type="checkbox" checked={notif.message} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, message: e.target.checked }))} />
        </label>
        <label className="settings-row">
          <span className="settings-label">Disconnects</span>
          <input type="checkbox" checked={notif.disconnect} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, disconnect: e.target.checked }))} />
        </label>
      </div>
      <div className="settings-section">
        <div className="settings-section-label">Speak aloud (text-to-speech)</div>
        <label className="settings-row">
          <span className="settings-label">Speak mentions</span>
          <input type="checkbox" checked={!!notif.ttsMention} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, ttsMention: e.target.checked }))} />
        </label>
        <label className="settings-row">
          <span className="settings-label">Speak whispers</span>
          <input type="checkbox" checked={!!notif.ttsWhisper} style={{ width: 'auto' }}
            onChange={e => setNotif(n => ({ ...n, ttsWhisper: e.target.checked }))} />
        </label>
        <div className="settings-hint">Reads the line aloud using your system voice. Custom alerts have their own “Speak” option below.</div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Push notifications</div>
        <label className="settings-row">
          <span className="settings-label">Notify me when the app is closed</span>
          <input type="checkbox" checked={push.enabled} style={{ width: 'auto' }}
            onChange={e => setPush(p => ({ ...p, enabled: e.target.checked }))} />
        </label>
        <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
          <span className="settings-label">Mentions of my name</span>
          <input type="checkbox" checked={push.mention} disabled={!push.enabled} style={{ width: 'auto' }}
            onChange={e => setPush(p => ({ ...p, mention: e.target.checked }))} />
        </label>
        <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
          <span className="settings-label">Whispers</span>
          <input type="checkbox" checked={push.whisper} disabled={!push.enabled} style={{ width: 'auto' }}
            onChange={e => setPush(p => ({ ...p, whisper: e.target.checked }))} />
        </label>
        <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
          <span className="settings-label">Room speech (says)</span>
          <input type="checkbox" checked={push.speech} disabled={!push.enabled} style={{ width: 'auto' }}
            onChange={e => setPush(p => ({ ...p, speech: e.target.checked }))} />
        </label>
        <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
          <span className="settings-label">Thoughts (ESP)</span>
          <input type="checkbox" checked={push.thought} disabled={!push.enabled} style={{ width: 'auto' }}
            onChange={e => setPush(p => ({ ...p, thought: e.target.checked }))} />
        </label>
        <label className="settings-row" style={push.enabled ? undefined : { opacity: 0.5 }}>
          <span className="settings-label">Direct messages</span>
          <input type="checkbox" checked={push.message} disabled={!push.enabled} style={{ width: 'auto' }}
            onChange={e => setPush(p => ({ ...p, message: e.target.checked }))} />
        </label>
        <div className="settings-hint">
          Sent by the Magiloom server to your phone or desktop even when the app is closed — like a messaging app.
          Web app only; on mobile, use <strong>Add to Home Screen</strong> and allow notifications first. Room speech can be noisy in a crowded room.
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Custom alerts</div>
        <div className="settings-hint" style={{ marginTop: 0 }}>
          Watch for any incoming text — a character name, a phrase, or a <code>.*</code> regex — and fire the channels you check on each row.
        </div>
        <div className="alert-quickadd">
          <input
            className="settings-input"
            placeholder="Add an alert — text to watch (e.g. a name)…"
            value={watchName}
            spellCheck={false}
            onChange={e => setWatchName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addWatchName() } }}
          />
          <button className="login-btn-secondary rule-import-btn" onClick={addWatchName}>+ Add</button>
        </div>

        <div className="rule-list">
          {notifRules.length === 0 && (
            <p className="hl-empty-msg">No alerts yet. Type text to watch above and press + Add.</p>
          )}
          {notifRules.map(r => (
            <div key={r.id} className={'rule-row' + (r.enabled ? '' : ' rule-row-off')}>
              <input
                type="checkbox"
                checked={r.enabled}
                data-tooltip="Enabled"
                onChange={e => patchRule(r.id, { enabled: e.target.checked })}
              />
              <input
                className="settings-input settings-input-mono"
                placeholder={r.isRegex ? 'has died' : 'text to match'}
                value={r.pattern}
                spellCheck={false}
                onChange={e => patchRule(r.id, { pattern: e.target.value, label: r.label || e.target.value })}
              />
              <label className="rule-regex" data-tooltip="Regular expression">
                <input
                  type="checkbox"
                  checked={r.isRegex}
                  onChange={e => patchRule(r.id, { isRegex: e.target.checked })}
                />
                .*
              </label>
              <label className="alert-ch" data-tooltip="App toast">
                <input type="checkbox" checked={r.toast}
                  onChange={e => patchRule(r.id, { toast: e.target.checked })} />
                Toast
              </label>
              <label className="alert-ch" data-tooltip="Desktop popup (when window unfocused)">
                <input type="checkbox" checked={r.desktop}
                  onChange={e => patchRule(r.id, { desktop: e.target.checked })} />
                Popup
              </label>
              <label className="alert-ch" data-tooltip="Sound">
                <input type="checkbox" checked={r.sound}
                  onChange={e => patchRule(r.id, { sound: e.target.checked })} />
                Sound
              </label>
              <label className="alert-ch" data-tooltip="Speak the matched line aloud">
                <input type="checkbox" checked={!!r.tts}
                  onChange={e => patchRule(r.id, { tts: e.target.checked })} />
                Speak
              </label>
              <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
                onClick={() => setNotifRules(list => list.filter(x => x.id !== r.id))}>×</button>
            </div>
          ))}
        </div>
        <div className="settings-hint">
          Popups only show when the window isn't focused; Do Not Disturb silences
          sound, popups, and speech. Alerts are shared across all characters.
        </div>
      </div>
    </>
  )
}
