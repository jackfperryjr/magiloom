import type { Dispatch, SetStateAction } from 'react'
import type { NotifSettings, NotifRule, PushSettings } from '../Notifications'
import { alertMatches } from '../../../lib/rules'
import { RuleTester, RegexWarning, NoMatch } from '../RuleTester'
import { SettingRow, Toggle } from './Field'

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
        <SettingRow label="Play sound">
          <Toggle checked={notif.sound} onChange={v => setNotif(n => ({ ...n, sound: v }))} label="Play sound" />
        </SettingRow>
        <SettingRow
          label="Desktop popups"
          hint="Only appear when the window isn't focused. Do Not Disturb silences sound and popups."
        >
          <Toggle checked={notif.desktop} onChange={v => setNotif(n => ({ ...n, desktop: v }))} label="Desktop popups" />
        </SettingRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Notify me about</div>
        <SettingRow label="Mentions">
          <Toggle checked={notif.mention} onChange={v => setNotif(n => ({ ...n, mention: v }))} label="Mentions" />
        </SettingRow>
        <SettingRow label="Whispers">
          <Toggle checked={notif.whisper} onChange={v => setNotif(n => ({ ...n, whisper: v }))} label="Whispers" />
        </SettingRow>
        <SettingRow label="Chat">
          <Toggle checked={notif.message} onChange={v => setNotif(n => ({ ...n, message: v }))} label="Chat" />
        </SettingRow>
        <SettingRow label="Disconnects">
          <Toggle checked={notif.disconnect} onChange={v => setNotif(n => ({ ...n, disconnect: v }))} label="Disconnects" />
        </SettingRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Speak aloud (text-to-speech)</div>
        <SettingRow
          label="Speak mentions"
          hint="Reads the line aloud using your system voice."
        >
          <Toggle checked={!!notif.ttsMention} onChange={v => setNotif(n => ({ ...n, ttsMention: v }))} label="Speak mentions" />
        </SettingRow>
        <SettingRow
          label="Speak whispers"
          hint="Custom alerts have their own “Speak” switch, below."
        >
          <Toggle checked={!!notif.ttsWhisper} onChange={v => setNotif(n => ({ ...n, ttsWhisper: v }))} label="Speak whispers" />
        </SettingRow>
      </div>

      <div className="settings-section">
        <div className="settings-section-label">Push notifications</div>
        <SettingRow
          label="Notify me when the app is closed"
          hint="Sent by the Magiloom server to your phone or desktop even when the app is
                closed — like a messaging app. Web app only; on mobile, use Add to Home
                Screen and allow notifications first."
        >
          <Toggle checked={push.enabled} onChange={v => setPush(p => ({ ...p, enabled: v }))} label="Push notifications" />
        </SettingRow>
        <SettingRow label="Mentions of my name" disabled={!push.enabled}>
          <Toggle checked={push.mention} disabled={!push.enabled} label="Push mentions"
            onChange={v => setPush(p => ({ ...p, mention: v }))} />
        </SettingRow>
        <SettingRow label="Whispers" disabled={!push.enabled}>
          <Toggle checked={push.whisper} disabled={!push.enabled} label="Push whispers"
            onChange={v => setPush(p => ({ ...p, whisper: v }))} />
        </SettingRow>
        <SettingRow label="Room speech (says)" hint="Can be noisy in a crowded room." disabled={!push.enabled}>
          <Toggle checked={push.speech} disabled={!push.enabled} label="Push room speech"
            onChange={v => setPush(p => ({ ...p, speech: v }))} />
        </SettingRow>
        <SettingRow label="Thoughts (ESP)" disabled={!push.enabled}>
          <Toggle checked={push.thought} disabled={!push.enabled} label="Push thoughts"
            onChange={v => setPush(p => ({ ...p, thought: v }))} />
        </SettingRow>
        <SettingRow label="Direct Chat" disabled={!push.enabled}>
          <Toggle checked={push.message} disabled={!push.enabled} label="Push direct chat"
            onChange={v => setPush(p => ({ ...p, message: v }))} />
        </SettingRow>
      </div>

      {/* Wide: each rule is a pattern field plus five switches on one line. */}
      <div className="settings-section settings-section-wide">
        <div className="settings-section-label">Custom alerts</div>
        <div className="settings-hint" style={{ marginTop: 0 }}>
          Watch for any incoming text — a character name, a phrase, or a <code>.*</code> regex — and fire the channels you switch on for each row.
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
              <Toggle
                checked={r.enabled} size="sm" label="Enabled"
                onChange={v => patchRule(r.id, { enabled: v })}
              />
              <input
                className="settings-input settings-input-mono"
                placeholder={r.isRegex ? 'has died' : 'text to match'}
                value={r.pattern}
                spellCheck={false}
                onChange={e => patchRule(r.id, { pattern: e.target.value, label: r.label || e.target.value })}
              />
              <span className="rule-regex" data-tooltip="Regular expression">
                <span>.*</span>
                <Toggle checked={r.isRegex} size="sm" label="Regular expression"
                  onChange={v => patchRule(r.id, { isRegex: v })} />
              </span>
              <span className="alert-ch" data-tooltip="App toast">
                <span>Toast</span>
                <Toggle checked={r.toast} size="sm" label="Toast"
                  onChange={v => patchRule(r.id, { toast: v })} />
              </span>
              <span className="alert-ch" data-tooltip="Desktop popup (when window unfocused)">
                <span>Popup</span>
                <Toggle checked={r.desktop} size="sm" label="Popup"
                  onChange={v => patchRule(r.id, { desktop: v })} />
              </span>
              <span className="alert-ch" data-tooltip="Sound">
                <span>Sound</span>
                <Toggle checked={r.sound} size="sm" label="Sound"
                  onChange={v => patchRule(r.id, { sound: v })} />
              </span>
              <span className="alert-ch" data-tooltip="Speak the matched line aloud">
                <span>Speak</span>
                <Toggle checked={!!r.tts} size="sm" label="Speak"
                  onChange={v => patchRule(r.id, { tts: v })} />
              </span>
              <button className="hl-btn-icon hl-btn-delete" data-tooltip="Delete"
                onClick={() => setNotifRules(list => list.filter(x => x.id !== r.id))}>×</button>
              <RegexWarning pattern={r.pattern} isRegex={r.isRegex} />
            </div>
          ))}
        </div>

        {/* Runs the real alert matcher — these are the channels that would fire. */}
        <RuleTester render={line => {
          const hits = notifRules.filter(r => r.enabled && alertMatches(r, line))
          if (hits.length === 0) return <NoMatch what="No alert fires on this line." />
          return (
            <div className="rule-tester-fired">
              {hits.map(r => {
                const channels = [
                  r.toast   && 'Toast',
                  r.desktop && 'Popup',
                  r.sound   && 'Sound',
                  r.tts     && 'Speak',
                ].filter(Boolean) as string[]
                return (
                  <div key={r.id} className="rule-tester-cmd">
                    <span className="rule-arrow">→</span>
                    <code>{r.label || r.pattern}</code>
                    <span className="rule-tester-channels">
                      {channels.length ? channels.join(' · ') : 'no channels switched on'}
                    </span>
                  </div>
                )
              })}
            </div>
          )
        }} />
        <div className="settings-hint">
          Popups only show when the window isn't focused; Do Not Disturb silences
          sound, popups, and speech. Alerts are shared across all characters.
        </div>
      </div>
    </>
  )
}
