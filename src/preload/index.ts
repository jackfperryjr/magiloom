import { contextBridge, ipcRenderer } from 'electron'

// Cache the "update ready" event. The main process replays it on did-finish-load,
// which runs BEFORE React mounts — so a component that subscribes via onReady in a
// mount effect would otherwise miss it and never show the icon. We remember the last
// payload and hand it to any listener that subscribes late.
type UpdateReadyInfo = { fromLaunch?: boolean }
let _readyInfo: UpdateReadyInfo | null = null
ipcRenderer.on('updater:ready', (_e, info: UpdateReadyInfo) => { _readyInfo = info ?? {} })

contextBridge.exposeInMainWorld('dr', {
  settings: {
    getAll:    ()          => ipcRenderer.invoke('settings:get-all'),
    patch:     (p: object) => ipcRenderer.invoke('settings:patch', p),
    getChar:   (name: string)                  => ipcRenderer.invoke('settings:get-char', name),
    patchChar: (name: string, partial: object) => ipcRenderer.invoke('settings:patch-char', name, partial)
  },
  avatar: {
    enabled: ()                                  => ipcRenderer.invoke('avatar:enabled'),
    get:     (name: string)                      => ipcRenderer.invoke('avatar:get', name),
    publish: (charName: string, dataUrl: string) => ipcRenderer.invoke('avatar:publish', charName, dataUrl),
    remove:  (charName: string)                  => ipcRenderer.invoke('avatar:delete', charName)
  },
  portrait: {
    generate: (name: string, prompt: string) => ipcRenderer.invoke('portrait:generate', name, prompt),
  },
  auth: {
    login: (account: string, password: string) =>
      ipcRenderer.invoke('auth:login', account, password),
    selectInstance: (instanceCode: string) =>
      ipcRenderer.invoke('auth:select-instance', instanceCode),
    selectCharacter: (characterId: string, characterName: string, accountName: string, useLich?: boolean) =>
      ipcRenderer.invoke('auth:select-character', characterId, characterName, accountName, useLich),
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
    listFiles:  ()                             => ipcRenderer.invoke('lich:list-files'),
    readFile:   (rel: string)                  => ipcRenderer.invoke('lich:read-file', rel),
    writeFile:  (rel: string, content: string) => ipcRenderer.invoke('lich:write-file', rel, content),
    deleteFile: (rel: string)                  => ipcRenderer.invoke('lich:delete-file', rel),
    onLog:    (cb: (l: string) => void) => { const h = (_e: unknown, l: string) => cb(l); ipcRenderer.on('lich:log', h);    return () => ipcRenderer.removeListener('lich:log', h) },
    onStatus: (cb: (s: string) => void) => { const h = (_e: unknown, s: string) => cb(s); ipcRenderer.on('lich:status', h); return () => ipcRenderer.removeListener('lich:status', h) },
    onError:  (cb: (m: string) => void) => { const h = (_e: unknown, m: string) => cb(m); ipcRenderer.on('lich:error', h);  return () => ipcRenderer.removeListener('lich:error', h) }
  },
  logs: {
    list: ()             => ipcRenderer.invoke('logs:list'),
    read: (name: string) => ipcRenderer.invoke('logs:read', name)
  },
  moons: {
    fetch: () => ipcRenderer.invoke('moons:fetch')
  },
  script: {
    list:       ()                          => ipcRenderer.invoke('script:list'),
    running:    ()                          => ipcRenderer.invoke('script:running'),
    defaultDir: ()                          => ipcRenderer.invoke('script:default-dir'),
    run:     (name: string, args: string[] = []) => ipcRenderer.invoke('script:run', name, args),
    stop:    (id?: number)                  => ipcRenderer.invoke('script:stop', id),
    readFile:   (name: string)                  => ipcRenderer.invoke('script:read-file', name),
    writeFile:  (name: string, content: string) => ipcRenderer.invoke('script:write-file', name, content),
    deleteFile: (name: string)                  => ipcRenderer.invoke('script:delete-file', name),
    onOutput: (cb: (l: string) => void)      => { const h = (_e: unknown, l: string) => cb(l); ipcRenderer.on('script:output', h); return () => ipcRenderer.removeListener('script:output', h) },
    onStatus: (cb: (s: unknown) => void)     => { const h = (_e: unknown, s: unknown) => cb(s); ipcRenderer.on('script:status', h); return () => ipcRenderer.removeListener('script:status', h) }
  },
  app: {
    getVersion:   () => ipcRenderer.invoke('app:version'),
    openExternal: (url: string) => ipcRenderer.invoke('app:open-external', url),
    chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
    chooseFile:   (filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('dialog:choose-file', filters),
    openTextFile: (filters?: { name: string; extensions: string[] }[]) => ipcRenderer.invoke('dialog:open-text-file', filters),
    platform:     process.platform,
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
    onReady:     (cb: (info?: UpdateReadyInfo) => void) => {
      const h = (_e: unknown, info: UpdateReadyInfo) => cb(info)
      ipcRenderer.on('updater:ready', h)
      if (_readyInfo) cb(_readyInfo)   // late subscriber: replay the cached event
      return () => ipcRenderer.removeListener('updater:ready', h)
    },
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
    // Every command sent to the game (any UI path) — used by the automapper to
    // capture movement. Fires just before the server response arrives.
    onSent: (cb: (cmd: string) => void) => { const h = (_e: unknown, c: string) => cb(c); ipcRenderer.on('game:sent', h); return () => ipcRenderer.removeListener('game:sent', h) },
    onConnected:    (cb: () => void)           => {                                               ipcRenderer.on('game:connected', cb);    return () => ipcRenderer.removeListener('game:connected', cb) },
    onDisconnected: (cb: () => void)           => {                                               ipcRenderer.on('game:disconnected', cb); return () => ipcRenderer.removeListener('game:disconnected', cb) },
    onError:        (cb: (e: string) => void)  => { const h = (_e: unknown, e: string) => cb(e); ipcRenderer.on('game:error', h);         return () => ipcRenderer.removeListener('game:error', h) }
  },
  map: {
    // Shared world-map (automapper) persistence.
    load:       ()                    => ipcRenderer.invoke('map:load'),
    saveZone:   (zone: object)        => ipcRenderer.invoke('map:save-zone', zone),
    deleteZone: (zoneId: string)      => ipcRenderer.invoke('map:delete-zone', zoneId),
    clear:      ()                    => ipcRenderer.invoke('map:clear'),
    export:     (content: string, defaultName: string) => ipcRenderer.invoke('map:export', content, defaultName),
    // A zone rewritten by another character's window, to merge into this one.
    onZoneChanged: (cb: (zone: unknown) => void) => {
      const h = (_e: unknown, zone: unknown) => cb(zone)
      ipcRenderer.on('map:zone-changed', h)
      return () => ipcRenderer.removeListener('map:zone-changed', h)
    }
  },
  broadcast: {
    // Send a command to OTHER Magiloom windows (this window runs its own copy).
    send:       (cmd: string) => ipcRenderer.invoke('broadcast:send', cmd),
    // Opt this window in/out of executing commands broadcast by other windows.
    setReceive: (on: boolean) => ipcRenderer.invoke('broadcast:set-receive', on),
    // A command broadcast from another window, to run in this one.
    onIncoming: (cb: (cmd: string) => void) => {
      const h = (_e: unknown, cmd: string) => cb(cmd)
      ipcRenderer.on('broadcast:incoming', h)
      return () => ipcRenderer.removeListener('broadcast:incoming', h)
    }
  }
})
