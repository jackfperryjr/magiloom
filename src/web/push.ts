import { deviceId, httpBase } from './config'

// ── PWA install + Web Push ───────────────────────────────────────────────────────
// Registers the service worker and subscribes this device to Web Push so the
// server can notify it (alert rules) even when the tab is closed. The subscription
// is keyed by the same device id used for the data bucket, so pushes only reach
// this user's devices.

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export async function registerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  try { await navigator.serviceWorker.register('./sw.js') } catch { /* ignore */ }
}

/** Request notification permission (if needed) and subscribe to Web Push. */
export async function enablePush(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false

  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') return false

  try {
    const reg = await navigator.serviceWorker.ready
    const { publicKey } = await (await fetch(`${httpBase()}/push/vapid`)).json()
    if (!publicKey) return false

    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      })
    }
    await fetch(`${httpBase()}/push/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: deviceId(), subscription: sub.toJSON() }),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Wire push up front: register the SW; if permission is already granted, refresh
 * the subscription silently. Otherwise ask once, on the first user gesture (a
 * browser requirement) — and remember a dismissal so we don't nag.
 */
export function setupPush(): void {
  void registerServiceWorker().then(() => {
    if (Notification?.permission === 'granted') { void enablePush(); return }
    if (Notification?.permission === 'denied') return
    if (localStorage.getItem('magiloom-push-asked')) return
    const ask = () => {
      document.removeEventListener('pointerdown', ask)
      localStorage.setItem('magiloom-push-asked', '1')
      void enablePush()
    }
    document.addEventListener('pointerdown', ask, { once: true })
  })
}
