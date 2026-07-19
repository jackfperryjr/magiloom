/// <reference types="vite/client" />

import type { MapDB, Zone } from './lib/mapModel'

interface SGECharacter  { id: string; name: string }
interface SGEInstance   { code: string; name: string }
interface SavedAccount  { name: string; lastCharacter?: string }

interface AppSettings {
  lichPath:         string
  connectWithLich?: boolean            // login toggle: route this session through Lich
  scriptDir:        string
  accounts:         SavedAccount[]
  lastAccount:      string
  fontSize:         number
  fontFamily:       string
  theme:            string
  timestamps:       boolean
  density:          'cozy' | 'compact'
  outputBufferSize: number
  functionKeys:     Record<string, string>
  aliases?:         { id: string; pattern: string; command: string; enabled: boolean; class?: string }[]
  triggers?:        { id: string; pattern: string; isRegex: boolean; command: string; enabled: boolean; class?: string }[]
  highlights:       unknown[]
  classes?:         Record<string, boolean>
  vars?:            Record<string, string>
  passwords:        Record<string, string>
  avatars?:         Record<string, string>
  avatarCrops?:     Record<string, { zoom: number; px: number; py: number }>
  avatarTokens?:    Record<string, string>
  avatarShare?:     boolean
  verbs?:           string[]
  notifications?:   {
    sound:      boolean
    desktop:    boolean
    mention:    boolean
    whisper:    boolean
    disconnect: boolean
    ttsMention?: boolean
    ttsWhisper?: boolean
  }
  // User-defined "watch" alerts: fire toast/desktop/sound/speak when incoming game
  // text matches. Global (shared across characters). See components/ui/Notifications.tsx.
  notifRules?:      {
    id: string; label: string; pattern: string; isRegex: boolean
    toast: boolean; desktop: boolean; sound: boolean; tts?: boolean; enabled: boolean
  }[]
  // Opt-in Web Push for conversation/mentions, evaluated server-side so it fires
  // even when the PWA is closed. Only effective on the hosted web app (the desktop
  // app has no server). See magiserver/src/trigger-engine.ts.
  push?:            {
    enabled: boolean
    mention: boolean
    whisper: boolean
    speech:  boolean
    thought: boolean
  }
  // Legacy global logging flag — now per character (CharSettings.logging); kept
  // only as the fallback default for setups saved before the split.
  logging?:         boolean
}


interface CharSettings {
  functionKeys: Record<string, string>
  aliases:      NonNullable<AppSettings['aliases']>
  triggers:     NonNullable<AppSettings['triggers']>
  highlights:   unknown[]
  classes:      Record<string, boolean>
  vars:         Record<string, string>
  logging:      boolean
  appearance?:   { theme: string; fontSize: number; fontFamily: string; density: 'cozy' | 'compact' }
  panels?:       { id: string; label: string; visible: boolean }[]
  panelHeights?: Record<string, number>
}

interface DrAPI {
  settings: {
    getAll: () => Promise<AppSettings>
    patch:  (p: Partial<AppSettings>) => Promise<void>
    getChar:   (name: string) => Promise<CharSettings>
    patchChar: (name: string, partial: Partial<CharSettings>) => Promise<void>
  }
  avatar: {
    enabled: () => Promise<boolean>
    get:     (name: string) => Promise<string | null>
    publish: (charName: string, dataUrl: string) => Promise<{ ok: boolean; error?: string }>
    remove:  (charName: string) => Promise<{ ok: boolean; error?: string }>
  }
  portrait: {
    generate: (name: string, prompt: string) => Promise<string | null>
  }
  auth: {
    login: (account: string, password: string) => Promise<
      { ok: true; instances: SGEInstance[] } | { ok: false; error: string }
    >
    selectInstance: (instanceCode: string) => Promise<
      { ok: true; characters: SGECharacter[] } | { ok: false; error: string }
    >
    selectCharacter: (characterId: string, characterName: string, accountName: string, useLich?: boolean) => Promise<
      { ok: true } | { ok: false; error: string }
    >
    savePassword:   (account: string, password: string) => Promise<void>
    getPassword:    (account: string)                   => Promise<string | null>
    forgetPassword: (account: string)                   => Promise<void>
    forgetAccount:  (account: string)                   => Promise<void>
  }
  lich: {
    detectPath: () => Promise<string>
    stop:          () => Promise<void>
    launchSidecar: (charName: string) => Promise<{ ok: boolean; error?: string }>
    listFiles:  () => Promise<{ dir: 'profiles' | 'custom'; name: string; size: number; mtime: number }[]>
    readFile:   (rel: string) => Promise<{ path: string; content: string }>
    writeFile:  (rel: string, content: string) => Promise<{ path: string }>
    deleteFile: (rel: string) => Promise<{ path: string }>
    onLog:    (cb: (l: string) => void) => () => void
    onStatus: (cb: (s: string) => void) => () => void
    onError:  (cb: (m: string) => void) => () => void
  }
  logs: {
    list: () => Promise<LogFileEntry[]>
    read: (name: string) => Promise<{ name: string; content: string; size: number; truncated: boolean }>
  }
  script: {
    list:       () => Promise<string[]>
    running:    () => Promise<{ id: number; name: string; state: string }[]>
    defaultDir: () => Promise<string>
    run:      (name: string, args?: string[]) => Promise<{ ok: boolean; error?: string }>
    stop:     (id?: number) => Promise<void>
    readFile:   (name: string) => Promise<{ name: string; content: string }>
    writeFile:  (name: string, content: string) => Promise<{ name: string }>
    deleteFile: (name: string) => Promise<{ name: string }>
    onOutput: (cb: (line: string) => void) => () => void
    onStatus: (cb: (info: { id: number; name: string; state: string }) => void) => () => void
  }
  app: {
    getVersion:   () => Promise<string>
    openExternal: (url: string) => Promise<void>
    chooseFolder: () => Promise<string | null>
    chooseFile:   (filters?: { name: string; extensions: string[] }[]) => Promise<string | null>
    openTextFile: (filters?: { name: string; extensions: string[] }[]) => Promise<{ path: string; content: string; error?: string } | null>
    platform:     string
  }
  window: {
    minimize:         () => Promise<void>
    toggleMaximize:   () => Promise<void>
    close:            () => Promise<void>
    isMaximized:      () => Promise<boolean>
    onMaximizeChange: (cb: (maximized: boolean) => void) => () => void
  }
  updater: {
    check:       () => Promise<void>
    install:     () => Promise<void>
    onAvailable: (cb: (version: string) => void) => () => void
    onReady:     (cb: () => void)                => () => void
    onError:     (cb: (message: string) => void) => () => void
  }
  game: {
    getStatus:      ()               => Promise<string>
    disconnect:     ()               => Promise<void>
    send:           (d: string)      => Promise<void>
    onData:         (cb: (r: string) => void) => () => void
    onSent:         (cb: (cmd: string) => void) => () => void
    onConnected:    (cb: () => void)           => () => void
    onDisconnected: (cb: () => void)           => () => void
    onError:        (cb: (e: string) => void)  => () => void
  }
  broadcast: {
    send:       (cmd: string) => Promise<void>
    setReceive: (on: boolean) => Promise<void>
    onIncoming: (cb: (cmd: string) => void) => () => void
  }
  map: {
    load:       () => Promise<MapDB>
    saveZone:   (zone: Zone) => Promise<void>
    deleteZone: (zoneId: string) => Promise<void>
    clear:      () => Promise<void>
    export:     (content: string, defaultName: string) => Promise<{ ok: boolean; path?: string; error?: string }>
    onZoneChanged: (cb: (zone: Zone) => void) => () => void
  }
  // Magiloom account — WEB CLIENT ONLY (the Electron preload omits it). Gate any
  // usage on `window.dr.account` being present. Signing in syncs a user's settings,
  // Lich profiles/custom scripts and avatars across their devices.
  account?: {
    isSignedIn: () => boolean
    current:    () => Promise<MagiloomAccount | null>
    signUp:  (email: string, password: string) => Promise<AccountAuthResult>
    signIn:  (email: string, password: string) => Promise<AccountAuthResult>
    signOut: () => void
    // Paid watch mode.
    sessions: () => Promise<WatchSession[]>
    watch:    (conn: string) => void
    unwatch:  () => void
  }
}

declare global {
  interface Window { dr: DrAPI }
  // One game-output log file on disk, e.g. refia-2026-07-09.log (see main/log-store.ts).
  interface LogFileEntry { name: string; char: string; day: string; size: number; mtime: number }
  interface MagiloomAccount { id: string; email: string; tier: 'free' | 'paid' }
  type AccountAuthResult =
    | { ok: true; account: MagiloomAccount; token: string }
    | { ok: false; error: string }
  interface WatchSession { conn: string; charName: string; connected: boolean; current: boolean }
}
export {}
