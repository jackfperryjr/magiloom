import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react'
import { useAtomValue, useAtom } from 'jotai'
import {
  presenceModeAtom, avatarsAtom, avatarCropsAtom, serverAvatarsAtom, linkModeAtom, broadcastReceiveAtom,
} from '../../store/game'
import type { PresenceMode, ProfileInfo, ConnectionStatus } from '../../store/game'
import type { AvatarCrop } from '../../lib/avatar'
import { CircleAvatar } from '../ui/CircleAvatar'
import { downscaleToFit } from '../../lib/image'
import { useProfile } from '../../hooks/useProfile'
import { useEnsureAvatars } from '../../hooks/useAvatars'
import { useIsMobile } from '../../hooks/useIsMobile'
import {
  IconCog, IconPaintBrush, IconPhoto, IconPower, IconBolt, IconBroadcast,
} from '../ui/Icons'
import { Tooltip } from '../ui/Tooltip'
import { BroadcastModal } from '../ui/BroadcastModal'

// ── Character bar (bottom-left identity + user menu) ──────────────────────────
// Read a picked File into a data URL (raw — cropping happens live in the modal).
function readImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload  = () => resolve(reader.result as string)
    reader.readAsDataURL(file)
  })
}

// Interactive avatar cropper: pan (drag) + zoom (slider/wheel) a source image
// within a circular frame; export() bakes the framed region to a 256px square.
export interface AvatarCropHandle { export: () => { url: string; crop: AvatarCrop } }
const PREVIEW = 240  // matches .avatar-cropper-frame / .avatar-modal-preview img

const AvatarCropper = forwardRef<AvatarCropHandle, { src: string }>(({ src }, ref) => {
  const imgRef = useRef<HTMLImageElement>(null)
  const [nat,  setNat]  = useState<{ w: number; h: number } | null>(null)
  const [zoom, setZoom] = useState(1)                 // multiplier over the cover-fit scale
  const [off,  setOff]  = useState({ x: 0, y: 0 })    // pan, in preview px
  const drag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)

  const base  = nat ? Math.max(PREVIEW / nat.w, PREVIEW / nat.h) : 1
  const scale = base * zoom
  const dispW = nat ? nat.w * scale : PREVIEW
  const dispH = nat ? nat.h * scale : PREVIEW

  // Keep the image covering the circle — no gaps at the edges.
  const clamp = (o: { x: number; y: number }) => {
    const maxX = Math.max(0, (dispW - PREVIEW) / 2)
    const maxY = Math.max(0, (dispH - PREVIEW) / 2)
    return { x: Math.min(maxX, Math.max(-maxX, o.x)), y: Math.min(maxY, Math.max(-maxY, o.y)) }
  }
  useEffect(() => { setOff(o => clamp(o)) }, [zoom, nat])  // eslint-disable-line react-hooks/exhaustive-deps

  const onDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }
  }
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    setOff(clamp({ x: drag.current.ox + (e.clientX - drag.current.px), y: drag.current.oy + (e.clientY - drag.current.py) }))
  }
  const onUp = (e: React.PointerEvent) => {
    drag.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch { /* noop */ }
  }
  const onWheel = (e: React.WheelEvent) => {
    setZoom(z => Math.min(3, Math.max(1, z - e.deltaY * 0.0015)))
  }

  // Keep the full (downscaled) image; return the pan/zoom as size-independent
  // fractions so any circle can reproduce this exact framing.
  useImperativeHandle(ref, () => ({
    export: () => {
      const maxX = Math.max(0, (dispW - PREVIEW) / 2)
      const maxY = Math.max(0, (dispH - PREVIEW) / 2)
      return { url: src, crop: { zoom, px: maxX ? off.x / maxX : 0, py: maxY ? off.y / maxY : 0 } }
    },
  }), [dispW, dispH, off, zoom, src])

  return (
    <div className="avatar-cropper">
      <div className="avatar-cropper-frame" onPointerDown={onDown} onPointerMove={onMove}
           onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <img
          ref={imgRef} src={src} alt="" draggable={false}
          onLoad={e => { setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setZoom(1); setOff({ x: 0, y: 0 }) }}
          style={{ width: dispW, height: dispH, transform: `translate(calc(-50% + ${off.x}px), calc(-50% + ${off.y}px))` }}
        />
      </div>
      <input className="avatar-cropper-zoom" type="range" min={1} max={3} step={0.01}
             value={zoom} onChange={e => setZoom(Number(e.target.value))} aria-label="Zoom" />
      <div className="avatar-cropper-hint">Drag to reposition · scroll or slider to zoom</div>
    </div>
  )
})
AvatarCropper.displayName = 'AvatarCropper'

const IDLE_MS = 5 * 60 * 1000  // auto-idle after 5 min of no input

const PRESENCE_LABEL: Record<PresenceMode, string> = {
  online: 'Online',
  idle:   'Idle',
  dnd:    'Do Not Disturb',
}

// Flip to idle after IDLE_MS with no keyboard/pointer activity.
function useAutoIdle(): boolean {
  const [idle, setIdle] = useState(false)
  useEffect(() => {
    let timer = 0
    const reset = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), IDLE_MS)
    }
    const events = ['keydown', 'mousedown', 'mousemove', 'wheel']
    events.forEach(e => window.addEventListener(e, reset))
    reset()
    return () => { window.clearTimeout(timer); events.forEach(e => window.removeEventListener(e, reset)) }
  }, [])
  return idle
}

// Resolve the dot color + label from connection status, the user's chosen
// presence, and auto-idle. Presence only applies while connected.
function presenceFor(status: ConnectionStatus, mode: PresenceMode, autoIdle: boolean): { dot: string; label: string } {
  if (status === 'connecting') return { dot: 'connecting', label: 'Connecting…' }
  if (status !== 'connected')  return { dot: 'offline',    label: 'Offline' }
  if (mode === 'dnd')                 return { dot: 'dnd',  label: PRESENCE_LABEL.dnd }
  if (mode === 'idle' || autoIdle)    return { dot: 'idle', label: PRESENCE_LABEL.idle }
  return { dot: 'online', label: PRESENCE_LABEL.online }
}


function CharacterMenu({
  status, presenceMode, onSetPresence, onEditAvatar, avatar, crop, initial, charName, profile,
  onDisconnect, onConnect, watching, onLeaveWatch, onClose, showActions, onBroadcast, onHighlights, onSettings,
}: {
  status:        ConnectionStatus
  presenceMode:  PresenceMode
  onSetPresence: (m: PresenceMode) => void
  onEditAvatar:  () => void
  avatar:        string | null
  crop?:         AvatarCrop
  initial:       string
  charName:      string
  profile:       ProfileInfo | null
  onDisconnect:  () => void
  onConnect:     () => void
  watching?:     boolean
  onLeaveWatch?: () => void
  onClose:       () => void
  showActions:   boolean        // mobile: quick actions live here instead of the bar
  onBroadcast:   () => void
  onHighlights:  () => void
  onSettings:    () => void
}) {
  const run = (fn: () => void) => () => { onClose(); fn() }
  return (
    <>
      <div className="char-menu-backdrop" onClick={onClose} />
      <div className="char-menu">
        <div className="char-menu-head">
          <Tooltip text="Change avatar">
            <button className="char-menu-avatar" onClick={run(onEditAvatar)}>
              {avatar
                ? <CircleAvatar className="char-menu-avatar-img" src={avatar} crop={crop} alt="" />
                : <span className="char-menu-avatar-initial">{initial}</span>}
              <span className="char-menu-avatar-edit"><IconPhoto size={20} /></span>
            </button>
          </Tooltip>
          <div className="char-menu-profile">
            <div className="char-menu-name">{profile?.name || charName || 'Unknown'}</div>
            <div className="char-menu-field"><span className="char-menu-k">Spouse</span><span className="char-menu-v">{profile?.spouse ?? '—'}</span></div>
            <div className="char-menu-field"><span className="char-menu-k">Roleplay</span><span className="char-menu-v">{profile?.roleplay ?? '—'}</span></div>
            <div className="char-menu-field"><span className="char-menu-k">PvP</span><span className="char-menu-v">{profile?.pvp ?? '—'}</span></div>
          </div>
        </div>
        <div className="char-menu-sep" />
        {showActions && (
          <>
            <button className="char-menu-item" onClick={run(onBroadcast)}><IconBroadcast size={15} /> Broadcast</button>
            <button className="char-menu-item" onClick={run(onHighlights)}><IconPaintBrush size={15} /> Highlights</button>
            <button className="char-menu-item" onClick={run(onSettings)}><IconCog size={15} /> Settings</button>
            <div className="char-menu-sep" />
          </>
        )}
        {status === 'connected' && (
          <>
            {(['online', 'idle', 'dnd'] as PresenceMode[]).map(m => (
              <button key={m} className="char-menu-item" onClick={() => onSetPresence(m)}>
                <span className={`char-menu-dot status-${m}`} />
                {PRESENCE_LABEL[m]}
                {presenceMode === m && <span className="char-menu-check">✓</span>}
              </button>
            ))}
            <div className="char-menu-sep" />
          </>
        )}
        {status === 'connected' ? (
          <button className="char-menu-item char-menu-item-danger" onClick={run(onDisconnect)}>
            <IconPower size={15} /> Disconnect
          </button>
        ) : (
          <button className="char-menu-item char-menu-item-connect" onClick={run(onConnect)}>
            <IconBolt size={15} /> Connect
          </button>
        )}
        {watching && onLeaveWatch && (
          // Watch mode: leave the view without ending the session (it keeps running
          // for its owner). Sits just under Disconnect.
          <button className="char-menu-item" onClick={run(onLeaveWatch)}>
            <IconPower size={15} /> Leave session
          </button>
        )}
      </div>
    </>
  )
}

export function CharacterBar({
  charName, accountName, status, watching = false, onLeaveWatch, onHighlights, onSettings, onDisconnect, onConnect,
}: {
  charName:     string
  accountName:  string
  status:       ConnectionStatus
  watching?:    boolean
  onLeaveWatch?: () => void
  onHighlights: () => void
  onSettings:   () => void
  onDisconnect: () => void
  onConnect:    () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [showBroadcast, setShowBroadcast] = useState(false)
  const isMobile = useIsMobile()
  const linkMode = useAtomValue(linkModeAtom)
  const receive  = useAtomValue(broadcastReceiveAtom)
  const [showAvatar, setShowAvatar] = useState(false)
  // Pending avatar edit in the modal: null = no change; { url } stages a new image
  // (url === null means "remove"). Committed only on Save.
  const [avatarDraft, setAvatarDraft] = useState<{ url: string | null } | null>(null)
  const [cropSrc, setCropSrc] = useState<string | null>(null)   // raw picked image, being cropped
  const cropperRef = useRef<AvatarCropHandle>(null)
  const [presenceMode, setPresenceMode] = useAtom(presenceModeAtom)
  const autoIdle = useAutoIdle()
  const fileRef = useRef<HTMLInputElement>(null)

  // Character PROFILE summary (Name / Spouse / stances) shown in the menu —
  // fetched the first time the menu opens for this character.
  const profile = useProfile(charName, menuOpen)

  // Avatars live in settings.json (userData) keyed by character name, so they
  // persist across runs. The shared atom (loaded once at layout mount) is the
  // single source of truth so the conversation panel reflects saves live.
  const [avatars, setAvatars] = useAtom(avatarsAtom)
  const [avatarCrops, setAvatarCrops] = useAtom(avatarCropsAtom)
  const serverAvatars = useAtomValue(serverAvatarsAtom)
  const avatarKey = charName.toLowerCase()
  // Fetch our own character's shared avatar so it shows even with no local upload
  // (e.g. the web client, whose per-device settings bucket starts empty).
  useEnsureAvatars(charName ? [charName] : [])
  const localAvatar = avatars[avatarKey] ?? null
  // Display precedence: local upload, then the shared (Supabase) image. The saved
  // crop only applies to a local upload; a server image is shown cover-fit.
  const avatar = localAvatar ?? serverAvatars[avatarKey] ?? null
  const avatarCrop = localAvatar ? avatarCrops[avatarKey] : undefined

  // Shared-avatar publishing is opt-in and only surfaced once the service is
  // configured (MAGILOOM_AVATAR_URL set); otherwise avatars stay purely local.
  const [svcEnabled, setSvcEnabled] = useState(false)
  const [share, setShare] = useState(false)
  useEffect(() => {
    window.dr.avatar.enabled().then(setSvcEnabled)
    window.dr.settings.getAll().then(s => setShare(!!s.avatarShare))
  }, [])

  // Keep the shared copy in sync on login: if this character has a local avatar and
  // sharing is on, (re)publish it so OTHER players (and our other characters) resolve
  // it in conversation. Publishing otherwise only happened on an explicit save/toggle,
  // so an avatar set before sharing — or on another device's settings bucket — would
  // never reach the bucket and stayed invisible to everyone else. Once per image.
  const publishedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!svcEnabled || !share || !charName || !localAvatar) return
    const stamp = `${avatarKey}:${localAvatar.length}`
    if (publishedRef.current === stamp) return
    publishedRef.current = stamp
    window.dr.avatar.publish(charName, localAvatar).catch(() => {})
  }, [svcEnabled, share, charName, localAvatar, avatarKey])

  const presence = presenceFor(status, presenceMode, autoIdle)
  const initial  = charName.trim().charAt(0).toUpperCase() || '?'

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !charName) return
    // Downscale to fit the avatar bucket cap (200KB) while keeping the whole
    // image + aspect ratio; the circle crop is applied on top, not baked in.
    try { setCropSrc(await downscaleToFit(await readImageFile(file))) } catch { /* ignore bad image */ }
  }

  const closeAvatar = () => { setAvatarDraft(null); setCropSrc(null); setShowAvatar(false) }

  const onSaveAvatar = async () => {
    if (!charName || (!avatarDraft && !cropSrc)) { closeAvatar(); return }
    // A picked image saves the full original + its crop box; otherwise the
    // staged draft (a removal, or the existing image) with no new crop.
    const result = cropSrc ? cropperRef.current?.export() : undefined
    const url  = result ? result.url : (avatarDraft?.url ?? null)
    const crop = result?.crop

    const nextAvatars = { ...avatars }
    const nextCrops   = { ...avatarCrops }
    if (url) {
      nextAvatars[avatarKey] = url
      if (crop) nextCrops[avatarKey] = crop; else delete nextCrops[avatarKey]
    } else {
      delete nextAvatars[avatarKey]; delete nextCrops[avatarKey]
    }
    await window.dr.settings.patch({ avatars: nextAvatars, avatarCrops: nextCrops })
    setAvatars(nextAvatars); setAvatarCrops(nextCrops)
    // Mirror the change to the shared service when publishing is enabled. A
    // removal always unpublishes; new images only publish with consent. (The
    // crop is local for now; other viewers see the image center-cropped.)
    if (svcEnabled) {
      if (url && share) window.dr.avatar.publish(charName, url).catch(() => {})
      else if (!url)    window.dr.avatar.remove(charName).catch(() => {})
    }
    closeAvatar()
  }

  // Toggling consent publishes/unpublishes the current avatar immediately.
  const onToggleShare = async () => {
    const next = !share
    setShare(next)
    await window.dr.settings.patch({ avatarShare: next })
    if (!charName) return
    if (next && avatar) window.dr.avatar.publish(charName, avatar).catch(() => {})
    else if (!next)     window.dr.avatar.remove(charName).catch(() => {})
  }

  // What the modal shows: the staged draft if editing, else the saved avatar
  const previewUrl = avatarDraft ? avatarDraft.url : avatar

  return (
    <div className="character-bar">
      <input
        ref={fileRef} type="file" accept="image/*"
        style={{ display: 'none' }} onChange={onPickFile}
      />
      <button className="char-identity" onClick={() => setMenuOpen(o => !o)}>
        <span className="char-avatar">
          {avatar
            ? <CircleAvatar className="char-avatar-img" src={avatar} crop={avatarCrop} alt="" />
            : <span className="char-avatar-initial">{initial}</span>}
          <span className={`char-status-dot status-${presence.dot}`} />
        </span>
        <span className="char-identity-text">
          <span className="char-name">{charName || 'Unknown'}</span>
          <span className={'char-sub' + (accountName ? ' has-account' : '')}>
            <span className="char-sub-track">
              <span className="char-presence">{presence.label}</span>
              {accountName && <span className="char-account">{accountName}</span>}
            </span>
          </span>
        </span>
      </button>
      <div className="char-actions">
        <Tooltip text={
          linkMode ? 'Broadcast · Link on'
          : receive ? 'Broadcast · Receiving'
          : 'Broadcast · Off'
        }>
          <button
            className={'char-action-btn char-action-broadcast '
              + (linkMode || receive ? 'bc-on' : 'bc-off')
              + (linkMode ? ' live' : '')}
            onClick={() => setShowBroadcast(true)}
          >
            <IconBroadcast size={22} />
          </button>
        </Tooltip>
        <Tooltip text="Highlight Options">
          <button className="char-action-btn char-action-brush" onClick={onHighlights}><IconPaintBrush size={16} /></button>
        </Tooltip>
        <Tooltip text="User Settings">
          <button className="char-action-btn char-action-gear" onClick={onSettings}><IconCog size={22} /></button>
        </Tooltip>
      </div>
      {menuOpen && (
        <CharacterMenu
          status={status}
          presenceMode={presenceMode}
          onSetPresence={setPresenceMode}
          onEditAvatar={() => setShowAvatar(true)}
          avatar={avatar}
          crop={avatarCrop}
          initial={initial}
          charName={charName}
          profile={profile}
          onDisconnect={onDisconnect}
          onConnect={onConnect}
          watching={watching}
          onLeaveWatch={onLeaveWatch}
          onClose={() => setMenuOpen(false)}
          showActions={isMobile}
          onBroadcast={() => setShowBroadcast(true)}
          onHighlights={onHighlights}
          onSettings={onSettings}
        />
      )}
      {showAvatar && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && closeAvatar()}>
          <div className="avatar-modal">
            <div className="avatar-modal-header">
              <span className="modal-title">{charName || 'Avatar'}</span>
              <button className="modal-close" onClick={closeAvatar}>×</button>
            </div>
            {cropSrc
              ? <AvatarCropper ref={cropperRef} src={cropSrc} />
              : previewUrl
                ? (
                  <div className="avatar-modal-facewrap">
                    <CircleAvatar className="avatar-modal-face" src={previewUrl}
                                  crop={previewUrl === avatar ? avatarCrop : undefined} />
                  </div>
                )
                : <div className="avatar-modal-preview"><span className="avatar-modal-initial">{initial}</span></div>}
            <div className="avatar-modal-actions">
              <button className="login-btn-secondary" onClick={() => fileRef.current?.click()}>
                {previewUrl || cropSrc ? 'Replace' : 'Upload'}
              </button>
              {(previewUrl || cropSrc) && (
                <button className="login-btn-secondary" onClick={() => { setCropSrc(null); setAvatarDraft({ url: null }) }}>Remove</button>
              )}
              <button className="login-btn" onClick={onSaveAvatar} disabled={!avatarDraft && !cropSrc}>Save</button>
            </div>
            {svcEnabled && (
              <label className="avatar-modal-share">
                <input type="checkbox" checked={share} onChange={onToggleShare} />
                <span>Share so other MAGILOOM users see this avatar</span>
              </label>
            )}
          </div>
        </div>
      )}
      {showBroadcast && <BroadcastModal charName={charName} onClose={() => setShowBroadcast(false)} />}
    </div>
  )
}
