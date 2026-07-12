import { useAtom } from 'jotai'
import { linkModeAtom, broadcastReceiveAtom } from '../../store/game'
import { IconBroadcast } from './Icons'

// Multi-boxing ("link") control. Both settings are per-WINDOW (each character is
// a separate process), so they persist in localStorage via their atoms — no
// shared-settings write. See useGameConnection for the send-side wiring and
// broadcast-bus.ts (main) for the cross-process delivery.
export function BroadcastModal({ charName, onClose }: { charName: string; onClose: () => void }) {
  const [linkMode, setLinkMode] = useAtom(linkModeAtom)
  const [receive,  setReceive]  = useAtom(broadcastReceiveAtom)

  return (
    <div className="modal-overlay modal-overlay-popover" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="broadcast-modal">
        <div className="broadcast-modal-header">
          <span className={'broadcast-modal-icon' + (linkMode ? ' live' : '')}>
            <IconBroadcast size={24} />
          </span>
          <div className="broadcast-modal-titles">
            <span className="modal-title">Broadcast</span>
            <span className="broadcast-modal-sub">Send commands across your open windows</span>
          </div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="broadcast-modal-body">
          <label className="broadcast-toggle">
            <div className="broadcast-toggle-text">
              <span className="broadcast-toggle-label">Link mode</span>
              <span className="broadcast-toggle-hint">
                Mirror everything I type in {charName || 'this window'} to my other windows.
              </span>
            </div>
            <input type="checkbox" className="broadcast-switch" checked={linkMode}
                   onChange={e => setLinkMode(e.target.checked)} />
          </label>

          <label className="broadcast-toggle">
            <div className="broadcast-toggle-text">
              <span className="broadcast-toggle-label">Receive broadcasts</span>
              <span className="broadcast-toggle-hint">
                Run commands that my other windows broadcast to this one.
              </span>
            </div>
            <input type="checkbox" className="broadcast-switch" checked={receive}
                   onChange={e => setReceive(e.target.checked)} />
          </label>

          <div className="broadcast-help">
            <div className="broadcast-help-title">One-off broadcasts</div>
            <div className="broadcast-help-row">
              <code className="broadcast-key">//</code>
              <span>cmd → run here <b>and</b> in my other windows</span>
            </div>
            <div className="broadcast-help-row">
              <code className="broadcast-key">/</code>
              <span>cmd → run in my other windows <b>only</b></span>
            </div>
            <div className="broadcast-help-note">
              Other windows only act on broadcasts when their own <b>Receive broadcasts</b> is on.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
