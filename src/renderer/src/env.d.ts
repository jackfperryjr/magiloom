/// <reference types="vite/client" />

interface SGECharacter  { id: string; name: string }
interface SGEInstance   { code: string; name: string }
interface SavedAccount  { name: string; lastCharacter?: string }

interface AppSettings {
  lichPath:         string
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
  aliases?:         { id: string; pattern: string; command: string; enabled: boolean }[]
  triggers?:        { id: string; pattern: string; isRegex: boolean; command: string; enabled: boolean }[]
  highlights:       unknown[]
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
  }
}

interface CharSettings {
  functionKeys: Record<string, string>
  aliases:      NonNullable<AppSettings['aliases']>
  triggers:     NonNullable<AppSettings['triggers']>
  highlights:   unknown[]
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
    selectCharacter: (characterId: string, characterName: string, accountName: string) => Promise<
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
    onLog:    (cb: (l: string) => void) => () => void
    onStatus: (cb: (s: string) => void) => () => void
    onError:  (cb: (m: string) => void) => () => void
  }
  script: {
    list:       () => Promise<string[]>
    running:    () => Promise<{ id: number; name: string; state: string }[]>
    defaultDir: () => Promise<string>
    run:      (name: string, args?: string[]) => Promise<{ ok: boolean; error?: string }>
    stop:     (id?: number) => Promise<void>
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
    onConnected:    (cb: () => void)           => () => void
    onDisconnected: (cb: () => void)           => () => void
    onError:        (cb: (e: string) => void)  => () => void
  }
}

declare global { interface Window { dr: DrAPI } }
export {}
