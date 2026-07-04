import { letterAvatarDataUrl } from './letterAvatar'

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
