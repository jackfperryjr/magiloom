import { wsUrl, setWatch } from './config'
import * as account from './auth'
import { enablePush } from './push'
import { webUpdater } from './updater'

// App version, baked in at build time from package.json (vite.web.config.ts) — the
// same source the desktop ships. Avoids a manually-maintained server-side version var.
declare const __APP_VERSION__: string
const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0'

// ── WebSocket transport ─────────────────────────────────────────────────────────
// Speaks the server's JSON envelope (see magiserver gateway.ts):
//   invoke → { t:'invoke', id, channel, args }  ← { t:'result', id, ok, result|error }
//   event  ← { t:'event', channel, args }
// and re-exposes it as the same `window.dr` API the Electron preload provides, so
// the React renderer runs unchanged against the remote server.

type AnyFn = (...args: any[]) => void   // eslint-disable-line @typescript-eslint/no-explicit-any

class Transport {
  private ws: WebSocket | null = null
  private nextId = 1
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  private listeners = new Map<string, Set<AnyFn>>()
  private queue: string[] = []          // invokes buffered until the socket opens

  constructor() { this.connect() }

  private connect(): void {
    let ws: WebSocket
    try { ws = new WebSocket(wsUrl()) } catch { setTimeout(() => this.connect(), 1500); return }
    this.ws = ws
    ws.onopen = () => { for (const m of this.queue) ws.send(m); this.queue = [] }
    ws.onmessage = ev => this.onMessage(String(ev.data))
    ws.onclose = () => {
      this.ws = null
      // Settle in-flight invokes so callers don't hang; the server drops this
      // client's game session on close, so a reconnect starts fresh (re-login).
      for (const [, p] of this.pending) p.reject(new Error('connection closed'))
      this.pending.clear()
      setTimeout(() => this.connect(), 1500)
    }
    ws.onerror = () => { /* onclose fires next */ }
  }

  private onMessage(raw: string): void {
    let msg: { t?: string; id?: number; ok?: boolean; result?: unknown; error?: string; channel?: string; args?: unknown[] }
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.t === 'result' && typeof msg.id === 'number') {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      if (msg.ok) p.resolve(msg.result)
      else p.reject(new Error(msg.error || 'request failed'))
    } else if (msg.t === 'event' && msg.channel) {
      const set = this.listeners.get(msg.channel)
      if (set) for (const cb of [...set]) cb(...(msg.args ?? []))
    }
  }

  invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    const id = this.nextId++
    const payload = JSON.stringify({ t: 'invoke', id, channel, args })
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(payload)
      else this.queue.push(payload)
    })
  }

  /** Subscribe to an event channel; returns an unsubscribe fn (mirrors preload onX). */
  on(channel: string, cb: AnyFn): () => void {
    let set = this.listeners.get(channel)
    if (!set) { set = new Set(); this.listeners.set(channel, set) }
    set.add(cb)
    return () => { set!.delete(cb) }
  }

  /** Drop and immediately re-open the socket — used after sign-in/out so the server
   *  re-buckets this client under its new identity (?auth=). */
  reconnect(): void {
    const ws = this.ws
    this.ws = null
    if (ws) { ws.onclose = null; try { ws.close() } catch { /* already closing */ } }
    for (const [, p] of this.pending) p.reject(new Error('reconnecting'))
    this.pending.clear()
    this.connect()
  }
}

// ── Browser replacements for Electron-only main-process features ─────────────────

/** openTextFile → a hidden file input (used by the Genie map import). */
function pickTextFile(
  filters?: { name: string; extensions: string[] }[],
): Promise<{ path: string; content: string } | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    if (filters?.length) input.accept = filters.flatMap(f => f.extensions.map(e => '.' + e)).join(',')
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return resolve(null)
      const reader = new FileReader()
      reader.onload = () => resolve({ path: file.name, content: String(reader.result ?? '') })
      reader.onerror = () => resolve(null)
      reader.readAsText(file)
    }
    input.click()
  })
}

/** map.export → a browser download instead of a native save dialog. */
function downloadFile(content: string, filename: string): Promise<{ ok: boolean; path?: string }> {
  try {
    const url = URL.createObjectURL(new Blob([content], { type: 'application/xml' }))
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return Promise.resolve({ ok: true, path: filename })
  } catch { return Promise.resolve({ ok: false }) }
}

/** Build the `window.dr` object, mirroring src/preload/index.ts over WebSocket. */
export function installDr(): void {
  const t = new Transport()
  const dr = {
    settings: {
      getAll:    () => t.invoke('settings:get-all'),
      patch:     (p: object) => t.invoke('settings:patch', p),
      getChar:   (name: string) => t.invoke('settings:get-char', name),
      patchChar: (name: string, partial: object) => t.invoke('settings:patch-char', name, partial),
    },
    avatar: {
      enabled: () => t.invoke('avatar:enabled'),
      get:     (name: string) => t.invoke('avatar:get', name),
      publish: (charName: string, dataUrl: string) => t.invoke('avatar:publish', charName, dataUrl),
      remove:  (charName: string) => t.invoke('avatar:delete', charName),
    },
    portrait: {
      generate: (name: string, prompt: string) => t.invoke('portrait:generate', name, prompt),
    },
    auth: {
      login:           (account: string, password: string) => t.invoke('auth:login', account, password),
      selectInstance:  (instanceCode: string) => t.invoke('auth:select-instance', instanceCode),
      selectCharacter: (characterId: string, characterName: string, accountName: string, useLich?: boolean) =>
        t.invoke('auth:select-character', characterId, characterName, accountName, useLich),
      savePassword:   (account: string, password: string) => t.invoke('auth:save-password', account, password),
      getPassword:    (account: string) => t.invoke('auth:get-password', account),
      forgetPassword: (account: string) => t.invoke('auth:forget-password', account),
      forgetAccount:  (account: string) => t.invoke('auth:forget-account', account),
    },
    lich: {
      detectPath:    () => t.invoke('lich:detect-path'),
      getLog:        () => t.invoke('lich:get-log'),
      stop:          () => t.invoke('lich:stop'),
      launchSidecar: (charName: string) => t.invoke('lich:launch-sidecar', charName),
      listFiles:  () => t.invoke('lich:list-files'),
      readFile:   (rel: string) => t.invoke('lich:read-file', rel),
      writeFile:  (rel: string, content: string) => t.invoke('lich:write-file', rel, content),
      deleteFile: (rel: string) => t.invoke('lich:delete-file', rel),
      onLog:    (cb: (l: string) => void) => t.on('lich:log', cb),
      onStatus: (cb: (s: string) => void) => t.on('lich:status', cb),
      onError:  (cb: (m: string) => void) => t.on('lich:error', cb),
    },
    script: {
      list:       () => t.invoke('script:list'),
      running:    () => t.invoke('script:running'),
      defaultDir: () => t.invoke('script:default-dir'),
      run:  (name: string, args: string[] = []) => t.invoke('script:run', name, args),
      stop: (id?: number) => t.invoke('script:stop', id),
      readFile:   (name: string) => t.invoke('script:read-file', name),
      writeFile:  (name: string, content: string) => t.invoke('script:write-file', name, content),
      deleteFile: (name: string) => t.invoke('script:delete-file', name),
      onOutput: (cb: (l: string) => void) => t.on('script:output', cb),
      onStatus: (cb: (s: unknown) => void) => t.on('script:status', cb),
    },
    app: {
      getVersion:   () => Promise.resolve(APP_VERSION),
      openExternal: (url: string) => { window.open(url, '_blank', 'noopener'); return Promise.resolve() },
      chooseFolder: () => Promise.resolve(null),
      chooseFile:   () => Promise.resolve(null),
      openTextFile: (filters?: { name: string; extensions: string[] }[]) => pickTextFile(filters),
      platform:     'web',
    },
    // Desktop window chrome has no meaning in a browser tab — no-ops.
    window: {
      minimize:         () => Promise.resolve(),
      toggleMaximize:   () => Promise.resolve(),
      close:            () => Promise.resolve(),
      isMaximized:      () => Promise.resolve(false),
      onMaximizeChange: (_cb: (m: boolean) => void) => () => {},
    },
    // Web "auto-update": a version-check (updater.ts) drives the same indicator the
    // desktop uses; install() reloads to pick up the freshly deployed bundle. We end
    // the DR session first so the reload lands on the LOGIN screen rather than an auto-
    // resumed game session — otherwise the resumed DR login competes with the Magiloom
    // account and you can't reach "Sign in to sync" (same disconnect→login the sign-out
    // flow uses).
    updater: {
      ...webUpdater,
      install: async () => {
        try { await t.invoke('game:disconnect') } catch { /* ignore */ }
        return webUpdater.install()
      },
    },
    game: {
      getStatus:  () => t.invoke('game:get-status'),
      disconnect: () => t.invoke('game:disconnect'),
      send:       (d: string) => t.invoke('game:send', d),
      onData:         (cb: (r: string) => void)   => t.on('game:data', cb),
      onSent:         (cb: (cmd: string) => void) => t.on('game:sent', cb),
      onConnected:    (cb: () => void)            => t.on('game:connected', cb),
      onDisconnected: (cb: () => void)            => t.on('game:disconnected', cb),
      onError:        (cb: (e: string) => void)   => t.on('game:error', cb),
    },
    map: {
      load:       () => t.invoke('map:load'),
      saveZone:   (zone: object) => t.invoke('map:save-zone', zone),
      deleteZone: (zoneId: string) => t.invoke('map:delete-zone', zoneId),
      clear:      () => t.invoke('map:clear'),
      export:     (content: string, defaultName: string) => downloadFile(content, defaultName),
      onZoneChanged: (cb: (zone: unknown) => void) => t.on('map:zone-changed', cb),
    },
    broadcast: {
      send:       (cmd: string) => t.invoke('broadcast:send', cmd),
      setReceive: (on: boolean) => t.invoke('broadcast:set-receive', on),
      onIncoming: (cb: (cmd: string) => void) => t.on('broadcast:incoming', cb),
    },
    // Magiloom account (web only — desktop's preload has no `account`, so the UI
    // gates on its presence). Signing in/out re-buckets the connection on the server,
    // so we reconnect the socket and re-point the push subscription afterward.
    account: {
      isSignedIn: () => account.isSignedIn(),
      current:    () => account.currentAccount(),
      signUp: async (email: string, password: string) => {
        const r = await account.register(email, password)
        if (r.ok) { t.reconnect(); void enablePush() }
        return r
      },
      signIn: async (email: string, password: string) => {
        const r = await account.login(email, password)
        if (r.ok) { t.reconnect(); void enablePush() }
        return r
      },
      signOut: () => { account.logout(); setWatch(null); t.reconnect(); void enablePush() },
      // Paid watch mode: list this account's live sessions, and attach to / detach
      // from one (reconnects the socket with ?watch=, so the server mirrors that
      // session's stream to this client too instead of starting a fresh one).
      sessions: () => t.invoke('session:list'),
      watch:   (conn: string) => { setWatch(conn); t.reconnect() },
      unwatch: () => { setWatch(null); t.reconnect() },
    },
  }
  ;(window as unknown as { dr: typeof dr }).dr = dr
}
