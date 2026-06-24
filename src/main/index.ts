import { app, BrowserWindow, ipcMain, Menu, safeStorage, screen } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { autoUpdater } from 'electron-updater'
import { LichManager, LichConnection } from './lich-manager'
import { GameConnection } from './game-connection'
import { SettingsStore } from './settings-store'
import { sgeAuth } from './sge-auth'
import type { SGELaunchKey } from './sge-auth'

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
const settings    = new SettingsStore()

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
  mainWindow.on('close',      () => saveWindowState(mainWindow!))
  mainWindow.on('maximize',   () => send('window:maximize-change', true))
  mainWindow.on('unmaximize', () => send('window:maximize-change', false))

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
    lichLog('[updater] Error: ' + err.message)
    send('updater:error', err.message)
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
  ipcMain.handle('settings:patch',   (_e, p) => settings.patch(p))

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

  ipcMain.handle('game:get-status', () => gameConn.getStatus())
  ipcMain.handle('game:disconnect', () => gameConn.disconnect())
  ipcMain.handle('game:send', (_e, d: string) => {
    // All commands go through gameConn -- Lich intercepts ; prefixed lines
    gameConn.send(d)
  })

  let lichReadyDetected = false
  gameConn.on('log',          (l: string) => lichLog('[game] ' + l))
  gameConn.on('data',         (r: string) => {
    send('game:data', r)
    if (!lichReadyDetected) {
      // <app char="Name"> appears in the game stream once Lich has connected
      // to the game server and parsed the character name from the initial XML.
      // This is the reliable signal that XMLData.name is set and scripts can run.
      if (/<app[^>]+char=/.test(r)) {
        lichReadyDetected = true
        lichLog('[lich] Character data received -- Lich ready')
        mainWindow?.webContents.send('lich:status', 'ready')
      }
    }
  })
  gameConn.on('connected',    ()          => { lichLog('[game] Connected'); send('game:connected') })
  gameConn.on('disconnected', ()          => send('game:disconnected'))
  gameConn.on('error',        (e: string) => { lichLog('[game] Error: ' + e); send('game:error', e) })
}
