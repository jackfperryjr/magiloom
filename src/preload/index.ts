import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dr', {
  settings: {
    getAll: ()          => ipcRenderer.invoke('settings:get-all'),
    patch:  (p: object) => ipcRenderer.invoke('settings:patch', p)
  },
  avatar: {
    enabled: ()                                  => ipcRenderer.invoke('avatar:enabled'),
    get:     (name: string)                      => ipcRenderer.invoke('avatar:get', name),
    publish: (charName: string, dataUrl: string) => ipcRenderer.invoke('avatar:publish', charName, dataUrl),
    remove:  (charName: string)                  => ipcRenderer.invoke('avatar:delete', charName)
  },
  auth: {
    login: (account: string, password: string) =>
      ipcRenderer.invoke('auth:login', account, password),
    selectInstance: (instanceCode: string) =>
      ipcRenderer.invoke('auth:select-instance', instanceCode),
    selectCharacter: (characterId: string, characterName: string, accountName: string) =>
      ipcRenderer.invoke('auth:select-character', characterId, characterName, accountName),
    savePassword:   (account: string, password: string) => ipcRenderer.invoke('auth:save-password', account, password),
    getPassword:    (account: string)                   => ipcRenderer.invoke('auth:get-password', account),
    forgetPassword: (account: string)                   => ipcRenderer.invoke('auth:forget-password', account),
    forgetAccount:  (account: string)                   => ipcRenderer.invoke('auth:forget-account', account)
  },
  lich: {
    detectPath: ()                  => ipcRenderer.invoke('lich:detect-path'),
    getLog:     ()                  => ipcRenderer.invoke('lich:get-log'),
    stop:         ()                  => ipcRenderer.invoke('lich:stop'),
    launchSidecar: (charName: string) => ipcRenderer.invoke('lich:launch-sidecar', charName),
    onLog:    (cb: (l: string) => void) => { const h = (_e: unknown, l: string) => cb(l); ipcRenderer.on('lich:log', h);    return () => ipcRenderer.removeListener('lich:log', h) },
    onStatus: (cb: (s: string) => void) => { const h = (_e: unknown, s: string) => cb(s); ipcRenderer.on('lich:status', h); return () => ipcRenderer.removeListener('lich:status', h) },
    onError:  (cb: (m: string) => void) => { const h = (_e: unknown, m: string) => cb(m); ipcRenderer.on('lich:error', h);  return () => ipcRenderer.removeListener('lich:error', h) }
  },
  app: {
    getVersion: () => ipcRenderer.invoke('app:version'),
    platform:   process.platform,
  },
  window: {
    minimize:         () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize:   () => ipcRenderer.invoke('window:maximize'),
    close:            () => ipcRenderer.invoke('window:close'),
    isMaximized:      () => ipcRenderer.invoke('window:is-maximized') as Promise<boolean>,
    onMaximizeChange: (cb: (maximized: boolean) => void) => {
      const h = (_e: unknown, v: boolean) => cb(v)
      ipcRenderer.on('window:maximize-change', h)
      return () => ipcRenderer.removeListener('window:maximize-change', h)
    }
  },
  updater: {
    check:       ()                         => ipcRenderer.invoke('updater:check'),
    install:     ()                         => ipcRenderer.invoke('updater:install'),
    onAvailable: (cb: (v: string) => void) => { const h = (_e: unknown, v: string) => cb(v); ipcRenderer.on('updater:available', h); return () => ipcRenderer.removeListener('updater:available', h) },
    onReady:     (cb: () => void)           => { ipcRenderer.on('updater:ready', cb); return () => ipcRenderer.removeListener('updater:ready', cb) },
    onError:     (cb: (m: string) => void) => { const h = (_e: unknown, m: string) => cb(m); ipcRenderer.on('updater:error', h); return () => ipcRenderer.removeListener('updater:error', h) }
  },
  game: {
    getStatus:  ()          => ipcRenderer.invoke('game:get-status'),
    disconnect: ()          => ipcRenderer.invoke('game:disconnect'),
    send:       (d: string) => ipcRenderer.invoke('game:send', d),
    // Use module-level tracking so React Strict Mode's double-mount never leaves
    // two listeners alive simultaneously — each new registration evicts the old one.
    onData: (() => {
      let _h: ((_e: unknown, r: string) => void) | null = null
      return (cb: (r: string) => void) => {
        if (_h) { ipcRenderer.removeListener('game:data', _h); _h = null }
        const h = (_e: unknown, r: string) => cb(r)
        _h = h
        ipcRenderer.on('game:data', h)
        return () => { ipcRenderer.removeListener('game:data', h); if (_h === h) _h = null }
      }
    })(),
    onConnected:    (cb: () => void)           => {                                               ipcRenderer.on('game:connected', cb);    return () => ipcRenderer.removeListener('game:connected', cb) },
    onDisconnected: (cb: () => void)           => {                                               ipcRenderer.on('game:disconnected', cb); return () => ipcRenderer.removeListener('game:disconnected', cb) },
    onError:        (cb: (e: string) => void)  => { const h = (_e: unknown, e: string) => cb(e); ipcRenderer.on('game:error', h);         return () => ipcRenderer.removeListener('game:error', h) }
  }
})
