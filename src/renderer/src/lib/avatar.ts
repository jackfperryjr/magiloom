import type { CSSProperties } from 'react'
import { letterAvatarDataUrl } from './letterAvatar'

// A saved crop for a circular avatar: the bucket keeps the full original image,
// and this positions a pan/zoom window over it. Size-independent — `px`/`py` are
// fractions of the available pan range (-1..1), `zoom` a multiplier over the
// cover-fit scale — so the same crop reproduces at any circle size.
export interface AvatarCrop { zoom: number; px: number; py: number }

// Inline <img> style that reproduces `crop` for an image of natural size `nat`
// inside a circular window of `box` px. Used by both the cropper preview and
// every avatar circle so they stay pixel-identical.
export function cropImgStyle(nat: { w: number; h: number }, box: number, crop: AvatarCrop): CSSProperties {
  const scale = Math.max(box / nat.w, box / nat.h) * crop.zoom
  const dispW = nat.w * scale, dispH = nat.h * scale
  const offX = crop.px * Math.max(0, (dispW - box) / 2)
  const offY = crop.py * Math.max(0, (dispH - box) / 2)
  return {
    position: 'absolute', left: '50%', top: '50%', width: dispW, height: dispH, maxWidth: 'none',
    transform: `translate(calc(-50% + ${offX}px), calc(-50% + ${offY}px))`,
  }
}

// Resolve the avatar image src for a speaker name. Precedence:
//   1. local self-upload (your own characters, from settings.avatars)
//   2. server-backed custom image (fetched into serverAvatars by name)
//   3. deterministic letter avatar (always available, no network)
// `self` is the logged-in character so "You" speech resolves to their avatar.
export function resolveAvatarSrc(
  name: string,
  avatars: Record<string, string>,
  serverAvatars: Record<string, string | null>,
  self: string,
): string {
  const raw = name.trim()
  const key = (raw.toLowerCase() === 'you' ? self : raw).trim().toLowerCase()
  return avatars[key] || serverAvatars[key] || letterAvatarDataUrl(key || raw)
}
