import { useState, useEffect } from 'react'
import { Tooltip } from '../ui/Tooltip'
import {
  IconWinMinimize, IconWinMaximize, IconWinRestore, IconWinClose,
} from '../ui/Icons'

// ── Window controls (custom min/max/close) ────────────────────────────────────
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const platform = window.dr.app.platform

  useEffect(() => {
    if (platform === 'darwin') return
    window.dr.window.isMaximized().then(setMaximized)
    return window.dr.window.onMaximizeChange(setMaximized)
  }, [platform])

  if (platform === 'darwin') return null

  return (
    <div className="window-controls">
      <Tooltip text="Minimize">
        <button className="wc-btn" onClick={() => window.dr.window.minimize()}>
          <IconWinMinimize />
        </button>
      </Tooltip>
      <Tooltip text={maximized ? 'Restore' : 'Maximize'}>
        <button className="wc-btn" onClick={() => window.dr.window.toggleMaximize()}>
          {maximized ? <IconWinRestore /> : <IconWinMaximize />}
        </button>
      </Tooltip>
      <Tooltip text="Close">
        <button className="wc-btn wc-close" onClick={() => window.dr.window.close()}>
          <IconWinClose />
        </button>
      </Tooltip>
    </div>
  )
}

// ── StatusBar (slim draggable title bar) ──────────────────────────────────────
export function StatusBar({ updateSlot }: { updateSlot?: React.ReactNode }) {
  return (
    <div className="status-bar">
      <img src="./icon.png" className="app-icon" alt="" aria-hidden />
      <div className="status-bar-spacer" />
      <Tooltip text="Guide">
        <button
          className="titlebar-help"
          onClick={() => window.dr.app.openExternal('https://github.com/jackfperryjr/magiloom/blob/main/GUIDE.md')}
        >
          <svg className="titlebar-help-icon" viewBox="0 0 20 20" aria-hidden="true">
            <mask id="titlebar-help-cutout">
              <circle cx="10" cy="10" r="10" fill="#fff" />
              <text x="10" y="15" textAnchor="middle" fontFamily="system-ui, sans-serif"
                fontSize="14" fontWeight="700" fill="#000">?</text>
            </mask>
            <rect width="20" height="20" fill="currentColor" mask="url(#titlebar-help-cutout)" />
          </svg>
        </button>
      </Tooltip>
      {updateSlot}
      {window.dr.app.platform !== 'darwin' && <div className="titlebar-sep" />}
      <WindowControls />
    </div>
  )
}
