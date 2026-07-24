import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, screen, shell } from 'electron'
import { join, dirname } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import * as lichFiles from './lich-files'
import { autoUpdater } from 'electron-updater'
import { LichManager, LichConnection } from './lich-manager'
import { GameConnection } from './game-connection'
import { CmdScriptEngine } from './cmd-script-engine'
import { BroadcastBus } from './broadcast-bus'
import { MapStore, type StoredZone } from './map-store'
import { LogStore, logSlug, stripToLines } from './log-store'
import { SettingsStore } from './settings-store'
import { sgeAuth } from './sge-auth'
import type { SGELaunchKey } from './sge-auth'
import { writeLichEntry } from './lich-entry'
import { getAvatar, publishAvatar, deleteAvatar, isAvatarServiceEnabled } from './avatar-service'
import { ensurePortrait } from './portrait-service'

// ── Multi-instance isolation ──────────────────────────────────────────────────
// Magiloom is meant to run several windows at once (e.g. one per DragonRealms
// character). They share ONE settings file (accounts, passwords, avatars) but
// each gets its own Chromium session directory — otherwise every extra instance
// collides on the same cache / localStorage and Chromium logs
// "Unable to move the cache: Access is denied." on Windows.
//
// The app rebranded from Magiloom to Lantern (productName), but its userData folder
// stays pinned to the original "Magiloom" directory so existing installs keep their
// settings, accounts, and saved passwords across the rename — the folder name is
// internal and never shown. Must run before we read/repoint userData below.
app.setPath('userData', join(app.getPath('appData'), 'Magiloom'))
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
// Optional game-output logging (off by default; toggled per character in
// Settings → Lich → Logs). The flag is resolved per character, so it's applied
// whenever the active character becomes known and whenever it's re-saved.
const logStore = new LogStore(SHARED_DIR)

function applyLoggingFor(charName: string): void {
  logStore.setChar(charName)
  logStore.setEnabled(settings.getCharSettings(charName).logging)
}

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
// Held between login and character-select so headless Lich can write it into
// entry.yaml (it self-authenticates via --login). Cleared once consumed.
let pendingPassword: string | null = null

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
    if (updateDownloaded)     send('updater:ready', { fromLaunch: downloadedFromLaunch })
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
// Distinguish an update found by the initial launch check (surfaced in the title
// bar, like the old desktop behaviour) from one found by a later background poll
// while the app is already running (surfaced in the panel rail, like the web app).
let polledSinceLaunch    = false
let downloadedFromLaunch = false

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
    downloadedFromLaunch = !polledSinceLaunch
    send('updater:ready', { fromLaunch: downloadedFromLaunch })
  })
  autoUpdater.on('error', (err) => {
    // Update checks fail for all sorts of transient reasons (offline, DNS blip,
    // GitHub 5xx, rate limit). None of these are actionable by the user and the
    // poll below retries, so fail silently. Kept off the in-app output (which is
    // the game panel now) — console only. The renderer shows a connectivity
    // indicator from navigator.onLine instead of surfacing these.
    console.error('[updater] check failed (will retry):', err.message)
  })

  // Poll for updates every 30 minutes in packaged mode, every 10 seconds in dev for
  // testing. The updater is silent in-app — only 'available'/'ready' surface, via the
  // update indicator (updater:available / updater:ready), not the game output.
  const UPDATE_POLL_INTERVAL = app.isPackaged ? 30 * 60 * 1000 : 10 * 1000
  autoUpdater.checkForUpdates()
  setInterval(() => { polledSinceLaunch = true; autoUpdater.checkForUpdates() }, UPDATE_POLL_INTERVAL)
}

function setupIpcHandlers(): void {
  ipcMain.handle('app:version',        () => app.getVersion())
  // Only hand safe web/mail schemes to the OS. Game text renders clickable links from
  // untrusted server content, so an unchecked url could smuggle file:, a Windows
  // protocol handler, etc. straight to shell.openExternal — allowlist http(s)/mailto.
  ipcMain.handle('app:open-external',  (_e, url: string) => {
    try {
      const { protocol } = new URL(url)
      if (protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:') {
        return shell.openExternal(url)
      }
    } catch { /* malformed URL — ignore */ }
  })
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
  ipcMain.handle('settings:get-char',   (_e, name: string) => settings.getCharSettings(name))
  ipcMain.handle('settings:patch-char', (_e, name: string, partial) => {
    settings.patchCharSettings(name, partial)
    // Toggling logging takes effect immediately, but only for the character
    // actually being played — saving Settings while logged in as someone else
    // must not start or stop this session's log.
    if (partial && 'logging' in partial && logStore.currentChar() === logSlug(name)) {
      logStore.setEnabled(settings.getCharSettings(name).logging)
    }
  })

  // Game logs (Settings → Lich → Logs): list what's on disk and read one back
  // for viewing/downloading. Name-jailed in log-store.ts.
  ipcMain.handle('logs:list', () => logStore.listFiles())
  ipcMain.handle('logs:read', (_e, name: string) => logStore.readFile(name))

  // Sky panel: the community moon rise/set feed (dr-scripts `moonwatch`). Fetched in
  // main to sidestep the renderer's CSP; returns null on any failure (panel then just
  // waits for the passive rise/set lines to seed it).
  ipcMain.handle('moons:fetch', async () => {
    try {
      const res = await fetch('https://dr-scripts.firebaseio.com/moon_data_v2.json')
      return res.ok ? await res.json() : null
    } catch { return null }
  })

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
    // Headless Lich self-logs-in from entry.yaml, so keep the password until the
    // character is picked (then it's written masked and cleared).
    pendingPassword = password
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
    _e, characterId: string, characterName: string, accountName: string, useLich?: boolean
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
    // Direct (non-Lich) connections never hit the <app char=…> branch below, so
    // resolve this character's logging flag here — for Lich sessions the same
    // call runs again once Lich reports the character.
    applyLoggingFor(characterName)

    // The "Connect with Lich" login toggle decides this per session. When omitted
    // (older renderer), fall back to the previous behaviour: Lich iff a path is set.
    const wantsLich = useLich ?? !!settings.get('lichPath')
    settings.patch({ connectWithLich: wantsLich })

    // Fully tear down the PREVIOUS session before reconnecting — this handler also
    // runs for an in-app character switch, where the old socket + old Lich are still
    // live. Drop our client socket, then wait for any running Lich to exit and release
    // its port. Skipping this is the "switch fails until I direct-connect first" bug:
    // the old Lich still held port 11024 so the new headless Lich couldn't bind it.
    gameConn.disconnect()
    await lichManager.stopAndWait()

    if (wantsLich) {
      // Headless Lich mode: Lich authenticates itself from its saved-login file and
      // exposes a detachable client port we attach to (no frostbite, no key forwarded).
      // Requires the Lich install + the password captured at login. Any failure
      // (Lich not found, no password) falls through to a direct connection.
      const lichRbw = lichManager.getLichPath(settings.get('lichPath') || undefined)
      if (!lichRbw) {
        lichLog('[sge] Lich not found — connecting directly instead.')
      } else if (!pendingPassword) {
        lichLog('[sge] No password available for headless Lich — connecting directly instead.')
      } else {
        // Write Lich's saved login (masked with its :standard cipher) so --login works.
        writeLichEntry(join(dirname(lichRbw), 'data'), accountName, pendingPassword, characterName)
        pendingPassword = null
        // Make sure the previous Lich has released the detachable-client port before
        // the new one tries to bind it.
        await lichManager.waitForPortFree(11024)
        lichLog('[sge] Launching Lich (headless mode) for ' + characterName + '...')
        const res = lichManager.spawnHeadless(characterName, 11024, settings.get('lichPath') || undefined)
        if (res.ok) {
          lichLog('[sge] Attaching to Lich detachable client on port 11024...')
          gameConn.connect('127.0.0.1', 11024)
          return { ok: true }
        }
        lichLog('[sge] ' + (res.error ?? 'Lich unavailable') + ' — connecting directly instead.')
      }
    }

    lichLog('[sge] Connecting directly to ' + key.host + ':' + key.port)
    gameConn.connectDirect(key.host, key.port, key.key)
    return { ok: true }
  })

  ipcMain.handle('lich:get-log',     () => lichLogBuffer.slice())
  ipcMain.handle('lich:detect-path', () => lichManager.getLichPath(settings.get('lichPath') || undefined))
  ipcMain.handle('lich:stop',        () => { lichManager.stop(); lichConn.disconnect() })
  ipcMain.handle('lich:launch-sidecar', (_e, _charName: string) => {
    return { ok: false, error: 'Use the Lich path in Settings to enable Lich at login.' }
  })

  // Lich file editor — edits profiles/ + custom/ in the local Lich install's
  // scripts dir (…/Lich5/scripts). Path-jailed in lich-files.ts.
  const lichScriptsDir = (): string | null => {
    const rbw = lichManager.getLichPath(settings.get('lichPath') || undefined)
    return rbw ? join(dirname(rbw), 'scripts') : null
  }
  const requireLichDir = (): string => {
    const d = lichScriptsDir()
    if (!d) throw new Error('Lich not found. Set the Lich path in Settings.')
    return d
  }
  ipcMain.handle('lich:list-files',  () => { const d = lichScriptsDir(); return d ? lichFiles.listFiles(d) : [] })
  ipcMain.handle('lich:read-file',   (_e, rel: string) => lichFiles.readFile(requireLichDir(), rel))
  ipcMain.handle('lich:write-file',  (_e, rel: string, content: string) => lichFiles.writeFile(requireLichDir(), rel, content))
  ipcMain.handle('lich:delete-file', (_e, rel: string) => lichFiles.deleteFile(requireLichDir(), rel))

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
  ipcMain.handle('script:read-file',   (_e, name: string) => cmdEngine.read(name))
  ipcMain.handle('script:write-file',  (_e, name: string, content: string) => cmdEngine.write(name, content))
  ipcMain.handle('script:delete-file', (_e, name: string) => cmdEngine.remove(name))
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
        applyLoggingFor(charMatch[1])                      // per-character log file + flag
        cmdEngine.setContext({ charname: charMatch[1] })   // $charname for .cmd scripts
        lichLog('[lich] Character data received -- Lich ready')
        mainWindow?.webContents.send('lich:status', 'ready')
      }
    }
  })
  gameConn.on('connected',    ()          => { lichLog('[game] Connected'); send('game:connected') })
  gameConn.on('disconnected', ()          => { lichReadyDetected = false; send('game:disconnected') })
  gameConn.on('error',        (e: string) => { lichLog('[game] Error: ' + e); send('game:error', e) })
}
