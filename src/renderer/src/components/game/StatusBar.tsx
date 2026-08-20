import { useState, useEffect } from 'react'
import { useAtomValue } from 'jotai'
import { Tooltip } from '../ui/Tooltip'
import { roomAtom } from '../../store/game'
import { roomDisplayName } from '../../lib/mapModel'
import {
  IconWinMinimize, IconWinMaximize, IconWinRestore, IconWinClose,
} from '../ui/Icons'

// True only where there's an OS window we draw chrome for. macOS uses its native
// traffic lights, and a browser tab has no window chrome at all.
const HAS_WINDOW_CHROME =
  window.dr.app.platform !== 'darwin' && window.dr.app.platform !== 'web'

// ── Window controls (custom min/max/close) ────────────────────────────────────
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  const platform = window.dr.app.platform

  useEffect(() => {
    if (!HAS_WINDOW_CHROME) return
    window.dr.window.isMaximized().then(setMaximized)
    return window.dr.window.onMaximizeChange(setMaximized)
  }, [platform])

  // The web build's dr.window methods are no-ops and CSS already hides the
  // controls there; skip rendering three dead buttons in the first place.
  if (!HAS_WINDOW_CHROME) return null

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

// ── Session chips (which game/instance, and where you are) ────────────────────
/**
 * Which game and instance this character is playing on. Nothing in the game
 * stream states it — the `<app>` tag only carries the character name, and only on
 * Lich sessions — so it comes from the login beacon that was lit for this
 * character (see lightBeacon in LoginFlow), newest first. That survives a web
 * reload, since beacons live in settings rather than in session state. A
 * character with no beacon (watch mode, a hand-rolled connect) simply shows no
 * chip rather than guessing.
 */
function useSessionInstance(charName: string) {
  const [inst, setInst] = useState<{ game: string; name: string; code: string } | null>(null)
  useEffect(() => {
    const name = charName.trim().toLowerCase()
    if (!name) { setInst(null); return }
    let cancelled = false
    window.dr.settings.getAll().then(s => {
      if (cancelled) return
      const match = (s.loginPaths ?? [])
        .filter(b => b.charName.trim().toLowerCase() === name)
        .sort((a, b) => (b.usedAt ?? 0) - (a.usedAt ?? 0))[0]
      setInst(match ? { game: match.game, name: match.instanceName, code: match.instance } : null)
    }).catch(() => { /* no settings, no chip */ })
    return () => { cancelled = true }
  }, [charName])
  return inst
}

/**
 * The native DR room id from `<nav rm='NNNN'/>`. Click copies it.
 *
 * The chip holds its place with a dim `--` whenever the id isn't known, rather
 * than unmounting: plenty of rooms never send a `rm` id at all, so a chip that
 * came and went would make the whole bar jump around as you walk. With no id
 * there's nothing to copy, so that state renders as a plain span — no button, no
 * hover affordance, nothing to click.
 */
/**
 * The room you're standing in, beside its id. Purely a readout — the Room panel is
 * where exits and description live — but the id alone told you nothing without one,
 * and the pair reads as one fact: `room 10041` · `The Crossing, Clanthew Boulevard`.
 * Only the name itself shows here: DR's title punctuation ("[…]") and its trailing
 * "(id)" tag are both dropped, the latter because the id chip already carries it.
 *
 * Long names are ellipsised rather than allowed to push the rest of the bar around;
 * the tooltip always carries the full name.
 */
function RoomNameChip() {
  const name = roomDisplayName(useAtomValue(roomAtom).name)
  if (!name) return null
  return (
    <Tooltip text={name}>
      <span className="titlebar-chip titlebar-chip-roomname">
        <span className="titlebar-chip-v">{name}</span>
      </span>
    </Tooltip>
  )
}

function RoomIdChip() {
  const uid = useAtomValue(roomAtom).uid
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 1400)
    return () => window.clearTimeout(t)
  }, [copied])

  if (!uid) {
    return (
      <Tooltip text="Room id — this room doesn't report one">
        <span className="titlebar-chip titlebar-chip-room">
          <span className="titlebar-chip-k">room</span>
          <span className="titlebar-chip-v titlebar-chip-v-empty">--</span>
        </span>
      </Tooltip>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uid)
      setCopied(true)
    } catch { /* clipboard blocked — leave the chip as-is rather than lying */ }
  }

  return (
    <Tooltip text={copied ? 'Copied' : 'Room id — click to copy'}>
      <button className="titlebar-chip titlebar-chip-room titlebar-chip-btn" onClick={copy}>
        <span className="titlebar-chip-k">room</span>
        <span className="titlebar-chip-v">{uid}</span>
      </button>
    </Tooltip>
  )
}

function InstanceChip({ charName }: { charName: string }) {
  const inst = useSessionInstance(charName)
  if (!inst) return null
  return (
    <Tooltip text={`${inst.game} · ${inst.name} (${inst.code})`}>
      <span className="titlebar-chip">
        <span className="titlebar-chip-k">{inst.game}</span>
        <span className="titlebar-chip-v">{inst.name}</span>
      </span>
    </Tooltip>
  )
}

// ── StatusBar (slim draggable title bar) ──────────────────────────────────────
export function StatusBar({ updateSlot, charName = '' }: { updateSlot?: React.ReactNode; charName?: string }) {
  return (
    <div className="status-bar">
      <img src="./icon.png" className="app-icon" alt="" aria-hidden />
      <InstanceChip charName={charName} />
      <RoomIdChip />
      <RoomNameChip />
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
      {/* The divider only earns its place when window controls follow it. */}
      {HAS_WINDOW_CHROME && <div className="titlebar-sep" />}
      <WindowControls />
    </div>
  )
}
