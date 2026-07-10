import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { LichManager, LichConnection } from './lich-manager'
import { GameConnection } from './game-connection'
import { CmdScriptEngine } from './cmd-script-engine'
import { BroadcastBus } from './broadcast-bus'
import { MapStore, type StoredZone } from './map-store'
import { LogStore, stripToLines } from './log-store'
import { SettingsStore } from './settings-store'
import { sgeAuth } from './sge-auth'
import type { SGELaunchKey } from './sge-auth'
import { getAvatar, publishAvatar, deleteAvatar, isAvatarServiceEnabled } from './avatar-service'
import { ensurePortrait } from './portrait-service'

// ── Multi-instance isolation ──────────────────────────────────────────────────
// Magiloom is meant to run several windows at once (e.g. one per DragonRealms
// character). They share ONE settings file (accounts, passwords, avatars) but
// each gets its own Chromium session directory — otherwise every extra instance
// collides on the same cache / localStorage and Chromium logs
// "Unable to move the cache: Access is denied." on Windows.
//
// SHARED_DIR is the default userData location (…/AppData/Roaming/Magiloom);
// capture it BEFORE we repoint userData at a per-instance slot below.
const SHARED_DIR = app.getPath('userData')

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true }
  catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM' }
}

// Claim the lowest-numbered slot whose previous owner has exited, so slots (and
// their caches / window positions) get reused across restarts instead of piling
// up. Windows are launched manually, so the pid-file race is not a concern.
function claimInstanceDir(): string {
  for (let slot = 0; ; slot++) {
    const dir     = join(SHARED_DIR, 'instances', String(slot))
    const pidFile = join(dir, 'owner.pid')
    mkdirSync(dir, { recursive: true })
    if (existsSync(pidFile)) {
      const owner = parseInt(readFileSync(pidFile, 'utf8'), 10)
      if (!Number.isNaN(owner) && owner !== process.pid && pidAlive(owner)) continue
    }
    writeFileSync(pidFile, String(process.pid), 'utf8')
    return dir
  }
}

app.setPath('userData', claimInstanceDir())

// ── Window state persistence ──────────────────────────────────────────────────
interface WindowState { x: number; y: number; width: number; height: number; maximized: boolean }

function winStatePath() { return join(app.getPath('userData'), 'window-state.json') }

function loadWindowState(): WindowState | null {
  try {
    const p = winStatePath()
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as WindowState
  } catch { return null }
}

function saveWindowState(win: BrowserWindow): void {
  try {
    const maximized = win.isMaximized()
    const bounds    = maximized ? win.getNormalBounds() : win.getBounds()
    writeFileSync(winStatePath(), JSON.stringify({ ...bounds, maximized }), 'utf8')
  } catch {}
}

function isOnScreen(s: WindowState): boolean {
  return screen.getAllDisplays().some(d => {
    const a = d.workArea
    return s.x < a.x + a.width && s.x + s.width > a.x &&
           s.y < a.y + a.height && s.y + s.height > a.y
  })
}

let mainWindow: BrowserWindow | null = null
const lichManager = new LichManager()
const gameConn    = new GameConnection()
const lichConn    = new LichConnection()
const settings    = new SettingsStore(SHARED_DIR)
const cmdEngine   = new CmdScriptEngine(
  () => settings.get('scriptDir') || join(SHARED_DIR, 'scripts')
)
// Cross-process command bus for multi-boxing ("link"). Lives in the SHARED dir so
// every character window (a separate process) sees the same bus.
const broadcastBus = new BroadcastBus(SHARED_DIR)
// Shared world-map database (automapper). Lives in the SHARED dir so every
// character's exploration accumulates into one map.
const mapStore = new MapStore(SHARED_DIR)
// Optional per-character game-output logging (off by default; toggled in Settings).
const logStore = new LogStore(SHARED_DIR)
logStore.setEnabled(!!settings.get('logging'))

const lichLogBuffer: string[] = []

function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
}

function lichLog(line: string) {
  lichLogBuffer.push(line)
  if (lichLogBuffer.length > 200) lichLogBuffer.shift()
  send('lich:log', line)
}

let pendingSelectInstance:  ((code: string) => Promise<unknown>) | null = null
let pendingSelectCharacter: ((id: string)   => Promise<SGELaunchKey>) | null = null

function createWindow(): void {
  const saved  = loadWindowState()
  const bounds = saved && isOnScreen(saved)
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : { width: 1400, height: 900 }

  mainWindow = new BrowserWindow({
    ...bounds, minWidth: 800, minHeight: 600,
    backgroundColor: '#04080f',
    icon: join(app.getAppPath(), 'resources', 'icon.png'),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false, contextIsolation: true, nodeIntegration: false
    }
  })
  if (saved?.maximized) mainWindow.maximize()
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12')
      mainWindow?.webContents.toggleDevTools()
  })
  mainWindow.on('close',      () => saveWindowState(mainWindow!))
  mainWindow.on('maximize',   () => send('window:maximize-change', true))
  mainWindow.on('unmaximize', () => send('window:maximize-change', false))

  // Right-click any image (LOOK portrait, avatar, …) → save it. Handles both
  // data: URLs (decode) and http(s) (fetch), with a native save dialog.
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const url = params.srcURL
    const win = mainWindow
    if (params.mediaType !== 'image' || !url || !win) return
    Menu.buildFromTemplate([{
      label: 'Save Image As…',
      click: async () => {
        if (!win) return
        const m = /^data:([^;]+);base64,(.+)$/.exec(url)
        const ext = (m ? m[1].split('/')[1] : 'png').replace('jpeg', 'jpg')
        const res = await dialog.showSaveDialog(win, { defaultPath: `magiloom-image.${ext}` })
        if (res.canceled || !res.filePath) return
        try {
          const bytes = m ? Buffer.from(m[2], 'base64') : Buffer.from(await (await fetch(url)).arrayBuffer())
          writeFileSync(res.filePath, bytes)
        } catch (err) { lichLog('[image] save failed: ' + String(err)) }
      },
    }]).popup({ window: win })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    for (const line of lichLogBuffer) {
      send('lich:log', line)
    }
    mainWindow?.webContents.send(
      gameConn.getStatus() === 'connected' ? 'game:connected' : 'game:disconnected'
    )
    send('lich:status', lichManager.getStatus())
    // Replay any update events that fired before the renderer was ready
    if (pendingUpdateVersion) send('updater:available', pendingUpdateVersion)
    if (updateDownloaded)     send('updater:ready')
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)  // hide default menu bar
  createWindow()
  setupIpcHandlers()
  setupUpdater()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  mainWindow = null
  cmdEngine.stop()
  broadcastBus.dispose()
  mapStore.dispose()
  gameConn.disconnect()
  lichConn.disconnect()
  lichManager.stop()
  if (process.platform !== 'darwin') app.quit()
})

// Track update state so we can replay to renderer after it loads
let pendingUpdateVersion = ''
let updateDownloaded     = false

function setupUpdater(): void {
  autoUpdater.autoDownload         = true
  autoUpdater.autoInstallOnAppQuit = true
  // Skip electron-updater's own code-signature check — app is not signed
  ;(autoUpdater as unknown as Record<string, unknown>).verifyUpdateCodeSignature = () => Promise.resolve(null)

  autoUpdater.on('update-available', (info) => {
    pendingUpdateVersion = info.version
    send('updater:available', info.version)
  })
  autoUpdater.on('update-downloaded', () => {
    updateDownloaded = true
    send('updater:ready')
  })
  autoUpdater.on('error', (err) => {
    // Update checks fail for all sorts of transient reasons (offline, DNS blip,
    // GitHub 5xx, rate limit). None of these are actionable by the user and the
    // poll below retries, so fail silently — just log. The renderer shows a
    // connectivity indicator from navigator.onLine instead of surfacing these.
    lichLog('[updater] check failed (will retry): ' + err.message)
  })

  // Poll for updates every 30 minutes in packaged mode, every 10 seconds in dev for testing
  const UPDATE_POLL_INTERVAL = app.isPackaged ? 30 * 60 * 1000 : 10 * 1000
  autoUpdater.checkForUpdates()
  setInterval(() => {
    lichLog('[updater] Checking for updates...')
    autoUpdater.checkForUpdates()
  }, UPDATE_POLL_INTERVAL)
}

function setupIpcHandlers(): void {
  ipcMain.handle('app:version',        () => app.getVersion())
  ipcMain.handle('app:open-external',  (_e, url: string) => shell.openExternal(url))
  ipcMain.handle('window:minimize',    () => mainWindow?.minimize())
  ipcMain.handle('window:maximize',    () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.handle('window:close',       () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('updater:check',   () => { if (app.isPackaged) autoUpdater.checkForUpdates() })
  ipcMain.handle('updater:install', async () => {
    const updateWin = new BrowserWindow({
      width: 340, height: 320,
      frame: false, resizable: false, center: true,
      backgroundColor: '#04080f',
      icon: join(app.getAppPath(), 'resources', 'icon.png'),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
    })
    mainWindow?.hide()
    const htmlPath = app.isPackaged
      ? join(process.resourcesPath, 'update.html')
      : join(__dirname, '../../resources/update.html')
    await updateWin.loadFile(htmlPath)
    // Let the splash render before quitAndInstall closes everything
    await new Promise(r => setTimeout(r, 700))
    autoUpdater.quitAndInstall(true, true)
  })
  ipcMain.handle('settings:get-all', () => settings.getAll())
  ipcMain.handle('settings:patch',   (_e, p) => { settings.patch(p); if (p && 'logging' in p) logStore.setEnabled(!!p.logging) })
  ipcMain.handle('settings:get-char',   (_e, name: string) => settings.getCharSettings(name))
  ipcMain.handle('settings:patch-char', (_e, name: string, partial) => settings.patchCharSettings(name, partial))

  ipcMain.handle('avatar:enabled', () => isAvatarServiceEnabled())
  ipcMain.handle('avatar:get',     (_e, name: string) => getAvatar(name))
  ipcMain.handle('avatar:publish', (_e, charName: string, dataUrl: string) => publishAvatar(settings, charName, dataUrl))
  ipcMain.handle('avatar:delete',  (_e, charName: string) => deleteAvatar(settings, charName))
  ipcMain.handle('portrait:generate', (_e, name: string, prompt: string) => ensurePortrait(name, prompt))

  ipcMain.handle('auth:save-password', (_e, account: string, password: string) => {
    if (!safeStorage.isEncryptionAvailable()) return
    const encrypted = safeStorage.encryptString(password)
    settings.savePassword(account, encrypted.toString('base64'))
  })
  ipcMain.handle('auth:get-password', (_e, account: string) => {
    if (!safeStorage.isEncryptionAvailable()) return null
    const b64 = settings.getPasswordB64(account)
    if (!b64) return null
    try { return safeStorage.decryptString(Buffer.from(b64, 'base64')) } catch { return null }
  })
  ipcMain.handle('auth:forget-password', (_e, account: string) => {
    settings.forgetPassword(account)
  })
  ipcMain.handle('auth:forget-account', (_e, account: string) => {
    settings.forgetAccount(account)
  })

  ipcMain.handle('auth:login', async (_e, account: string, password: string) => {
    const result = await sgeAuth(account, password, (l) => lichLog('[sge] ' + l))
    if (!result.ok) return result
    pendingSelectInstance = result.selectInstance
    settings.saveAccount(account)
    return { ok: true, instances: result.instances }
  })

  ipcMain.handle('auth:select-instance', async (_e, code: string) => {
    if (!pendingSelectInstance) return { ok: false, error: 'Session expired.' }
    const result = await (pendingSelectInstance as (c: string) => Promise<{
      ok: boolean; error?: string; characters?: unknown[];
      selectCharacter?: (id: string) => Promise<SGELaunchKey>
    }>)(code)
    if (!result.ok) return result
    pendingSelectCharacter = result.selectCharacter ?? null
    return { ok: true, characters: result.characters }
  })

  ipcMain.handle('auth:select-character', async (
    _e, characterId: string, characterName: string, accountName: string
  ) => {
    if (!pendingSelectCharacter) return { ok: false, error: 'Session expired.' }

    // Always do the L step to get a fresh key
    let key: SGELaunchKey
    try {
      key = await pendingSelectCharacter(characterId)
    } catch (e: unknown) {
      return { ok: false, error: String(e) }
    }
    pendingSelectCharacter = null
    settings.saveAccount(accountName, characterName)

    const lichPath = settings.get('lichPath')
    if (lichPath) {
      // Lich mode: launch with --frostbite -g host:port (exactly like Frostbite)
      // Then connect to Lich's port 4901 and send the key — Lich forwards it to game
      lichLog('[sge] Launching Lich (frostbite mode) for ' + characterName + '...')
      lichManager.spawnOnly(key.host, key.port, lichPath)
      lichLog('[sge] Connecting to Lich on port 11024...')
      gameConn.connectWithKey('127.0.0.1', 11024, key.key)
    } else {
      lichLog('[sge] Connecting directly to ' + key.host + ':' + key.port)
      gameConn.connectDirect(key.host, key.port, key.key)
    }
    return { ok: true }
  })

  ipcMain.handle('lich:get-log',     () => lichLogBuffer.slice())
  ipcMain.handle('lich:detect-path', () => lichManager.getLichPath(settings.get('lichPath') || undefined))
  ipcMain.handle('lich:stop',        () => { lichManager.stop(); lichConn.disconnect() })
  ipcMain.handle('lich:launch-sidecar', (_e, _charName: string) => {
    return { ok: false, error: 'Use the Lich path in Settings to enable Lich at login.' }
  })

  lichManager.on('log',    (l: string) => lichLog(l))
  lichManager.on('status', (s: string) => send('lich:status', s))
  lichManager.on('error',  (m: string) => { lichLog('[error] ' + m); send('lich:error', m) })
  lichManager.on('ready',  (port: number) => {
    lichLog('[lich] Lich ready on port ' + port + ' -- ;commands route through main connection')
    // Don't connect lichConn here -- it would steal gameConn's slot on port 11024
    // ;commands are sent via gameConn directly; Lich intercepts them
  })

  // ── Native .cmd script engine ───────────────────────────────────────────────
  ipcMain.handle('script:list',    () => cmdEngine.list())
  ipcMain.handle('script:running', () => cmdEngine.running())
  ipcMain.handle('script:default-dir', () => join(SHARED_DIR, 'scripts'))
  ipcMain.handle('script:run',     (_e, name: string, args: string[] = []) => cmdEngine.run(name, args))
  ipcMain.handle('script:stop',    (_e, id?: number) => cmdEngine.stop(id))
  ipcMain.handle('dialog:choose-folder', async () => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  ipcMain.handle('dialog:choose-file', async (_e, filters?: { name: string; extensions: string[] }[]) => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0]
  })
  ipcMain.handle('dialog:open-text-file', async (_e, filters?: { name: string; extensions: string[] }[]) => {
    if (!mainWindow) return null
    const res = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters })
    if (res.canceled || !res.filePaths[0]) return null
    try {
      return { path: res.filePaths[0], content: readFileSync(res.filePaths[0], 'utf8') }
    } catch (e) {
      return { path: res.filePaths[0], content: '', error: String(e) }
    }
  })

  cmdEngine.on('send',   (cmd: string)          => { gameConn.send(cmd); send('game:sent', cmd) })
  cmdEngine.on('echo',   (text: string)         => send('script:output', text))
  cmdEngine.on('status', (info: unknown)        => send('script:status', info))
  cmdEngine.on('error',  (msg: string)          => { lichLog('[script] ' + msg); send('script:output', msg) })

  ipcMain.handle('game:get-status', () => gameConn.getStatus())
  ipcMain.handle('game:disconnect', () => gameConn.disconnect())
  ipcMain.handle('game:send', (_e, d: string) => {
    // All commands go through gameConn -- Lich intercepts ; prefixed lines
    gameConn.send(d)
    // Echo every sent command back to the renderer so the automapper can capture
    // movement regardless of how it was issued (typed, clicked exit link, Room
    // panel, alias). This is the single universal capture point.
    send('game:sent', d)
  })

  // ── Broadcast bus (multi-boxing / link) ─────────────────────────────────────
  // A command broadcast from another window arrives here; hand it to the renderer
  // so it echoes + alias-expands in THIS character's context (it must not
  // re-broadcast, or windows would loop — the renderer's incoming handler sends
  // locally only).
  broadcastBus.on('command', (cmd: string) => send('broadcast:incoming', cmd))
  ipcMain.handle('broadcast:send',        (_e, cmd: string) => broadcastBus.send(cmd))
  ipcMain.handle('broadcast:set-receive', (_e, on: boolean) => broadcastBus.setReceive(on))

  // ── Automapper: shared world-map persistence ──────────────────────────────
  // A zone rewritten by another character's window flows back into this one.
  mapStore.on('zoneChanged', (zone: StoredZone) => send('map:zone-changed', zone))
  ipcMain.handle('map:load',        () => mapStore.loadAll())
  ipcMain.handle('map:save-zone',   (_e, zone: StoredZone) => mapStore.saveZone(zone))
  ipcMain.handle('map:delete-zone', (_e, zoneId: string)   => mapStore.deleteZone(zoneId))
  ipcMain.handle('map:clear',       () => mapStore.clearAll())
  // Export the whole map (or one zone) to a user-chosen file for sharing/backup.
  ipcMain.handle('map:export', async (_e, content: string, defaultName: string) => {
    if (!mainWindow) return { ok: false }
    const res = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'Map', extensions: ['xml'] }],
    })
    if (res.canceled || !res.filePath) return { ok: false }
    try { writeFileSync(res.filePath, content, 'utf8'); return { ok: true, path: res.filePath } }
    catch (err) { return { ok: false, error: String(err) } }
  })

  let lichReadyDetected = false
  gameConn.on('log',          (l: string) => lichLog('[game] ' + l))
  gameConn.on('data',         (r: string) => {
    send('game:data', r)
    cmdEngine.feed(r)   // drive waitfor/matchwait in running .cmd scripts
    if (logStore.isEnabled()) for (const line of stripToLines(r)) logStore.writeLine(line)
    if (!lichReadyDetected) {
      // <app char="Name"> appears in the game stream once Lich has connected
      // to the game server and parsed the character name from the initial XML.
      // This is the reliable signal that XMLData.name is set and scripts can run.
      const charMatch = /<app[^>]+char=["']([^"']+)["']/.exec(r)
      if (charMatch) {
        lichReadyDetected = true
        logStore.setChar(charMatch[1])                     // per-character log file naming
        cmdEngine.setContext({ charname: charMatch[1] })   // $charname for .cmd scripts
        lichLog('[lich] Character data received -- Lich ready')
        mainWindow?.webContents.send('lich:status', 'ready')
      }
    }
  })
  gameConn.on('connected',    ()          => { lichLog('[game] Connected'); send('game:connected') })
  gameConn.on('disconnected', ()          => send('game:disconnected'))
  gameConn.on('error',        (e: string) => { lichLog('[game] Error: ' + e); send('game:error', e) })
}
