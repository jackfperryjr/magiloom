import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AppSettings {
  lichPath:    string
  connectWithLich?: boolean            // login toggle: route this session through Lich
  scriptDir:   string                  // folder holding native .cmd scripts ('' → default)
  accounts:    { name: string; lastCharacter?: string }[]
  lastAccount: string
  fontSize:    number
  fontFamily:  string
  passwords:   Record<string, string>  // account name → base64 encrypted password
  functionKeys: Record<string, string> // e.g. { F1: 'attack', F2: 'spell' }
  aliases?:     { id: string; pattern: string; command: string; enabled: boolean; class?: string }[]
  triggers?:    { id: string; pattern: string; isRegex: boolean; command: string; enabled: boolean; class?: string }[]
  highlights?:  unknown[]              // global default set; per-character overrides live in `characters`
  classes?:     Record<string, boolean> // Genie-style class on/off (global default)
  vars?:        Record<string, string>  // Genie-style #var named variables (global default)
  // Per-character overrides for gameplay settings. Missing keys fall back to the
  // matching global value above, so existing setups become each character's
  // default until it customises. Keyed by lowercased character name.
  characters?:  Record<string, CharScopedSettings>
  avatars?:      Record<string, string> // lowercased character name → data URL
  avatarTokens?: Record<string, string> // account name → avatar-service bearer token
  avatarShare?:  boolean                // consent to publish avatars to the shared service
  // Legacy global logging flag. Logging is now per character (see
  // CharScopedSettings.logging); this survives only as the fallback default so an
  // existing setup keeps logging until each character sets its own preference.
  logging?:      boolean
}

// The subset of settings that can be overridden per character.
export interface CharScopedSettings {
  functionKeys?: Record<string, string>
  aliases?:      AppSettings['aliases']
  triggers?:     AppSettings['triggers']
  highlights?:   unknown[]
  classes?:      Record<string, boolean>  // Genie-style class on/off, per character
  vars?:         Record<string, string>   // Genie-style #var named variables, per character
  logging?:      boolean                  // write this character's output to a log file
  // Appearance + panel layout — previously kept per-character in the renderer's
  // localStorage, now unified here so they follow the character across windows.
  appearance?:   { theme: string; fontSize: number; fontFamily: string; density: 'cozy' | 'compact' }
  panels?:       { id: string; label: string; visible: boolean }[]
  panelHeights?: Record<string, number>
}

// A fully-resolved per-character view: the four gameplay keys resolve to
// char-override ?? global default; appearance/panels pass through (undefined when
// the character hasn't set them, so the renderer can apply its own defaults).
export interface ResolvedCharSettings {
  functionKeys: Record<string, string>
  aliases:      NonNullable<AppSettings['aliases']>
  triggers:     NonNullable<AppSettings['triggers']>
  highlights:   unknown[]
  classes:      Record<string, boolean>
  vars:         Record<string, string>
  logging:      boolean
  appearance?:   CharScopedSettings['appearance']
  panels?:       CharScopedSettings['panels']
  panelHeights?: CharScopedSettings['panelHeights']
}

const DEFAULTS: AppSettings = {
  lichPath:    '',
  scriptDir:   '',
  accounts:    [],
  lastAccount: '',
  fontSize:    13,
  fontFamily:  'Cascadia Code',
  passwords:   {},
  functionKeys: {}
}

export class SettingsStore {
  private data: AppSettings

  // `dir` is the shared data directory (not per-instance userData), so every
  // running window reads and writes the same accounts/passwords/settings.
  constructor(private dir: string) { this.data = this.load() }

  private settingsPath(): string {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    return join(this.dir, 'settings.json')
  }

  get<K extends keyof AppSettings>(key: K): AppSettings[K] { return this.data[key] }

  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.data[key] = value
    this.save()
  }

  getAll(): AppSettings { return { ...this.data } }

  patch(partial: Partial<AppSettings>): void {
    this.data = { ...this.data, ...partial }
    this.save()
  }

  private charKey(name: string): string { return name.trim().toLowerCase() }

  // Resolve a character's gameplay settings: its own overrides, falling back to
  // the global value for anything it hasn't customised. An empty name (no active
  // character) yields the globals.
  getCharSettings(name: string): ResolvedCharSettings {
    const c = (name ? this.data.characters?.[this.charKey(name)] : undefined) ?? {}
    return {
      functionKeys: c.functionKeys ?? this.data.functionKeys ?? {},
      aliases:      c.aliases      ?? this.data.aliases      ?? [],
      triggers:     c.triggers     ?? this.data.triggers     ?? [],
      highlights:   c.highlights   ?? this.data.highlights   ?? [],
      classes:      c.classes      ?? this.data.classes      ?? {},
      vars:         c.vars         ?? this.data.vars         ?? {},
      logging:      c.logging      ?? !!this.data.logging,
      appearance:   c.appearance,
      panels:       c.panels,
      panelHeights: c.panelHeights,
    }
  }

  patchCharSettings(name: string, partial: CharScopedSettings): void {
    if (!name.trim()) return
    const k = this.charKey(name)
    const cur = this.data.characters?.[k] ?? {}
    this.data.characters = { ...(this.data.characters ?? {}), [k]: { ...cur, ...partial } }
    this.save()
  }

  savePassword(account: string, encryptedB64: string): void {
    this.data.passwords = { ...this.data.passwords, [account]: encryptedB64 }
    this.save()
  }

  getPasswordB64(account: string): string | null {
    return this.data.passwords?.[account] ?? null
  }

  forgetPassword(account: string): void {
    const { [account]: _, ...rest } = this.data.passwords ?? {}
    this.data.passwords = rest
    this.save()
  }

  forgetAccount(account: string): void {
    this.data.accounts = this.data.accounts.filter(
      a => a.name.toLowerCase() !== account.toLowerCase()
    )
    const { [account]: _, ...rest } = this.data.passwords ?? {}
    this.data.passwords = rest
    this.save()
  }

  saveAccount(name: string, lastCharacter?: string): void {
    const idx = this.data.accounts.findIndex(
      a => a.name.toLowerCase() === name.toLowerCase()
    )
    const entry = lastCharacter !== undefined
      ? { name, lastCharacter }
      : { name, lastCharacter: this.data.accounts[idx]?.lastCharacter }

    if (idx >= 0) this.data.accounts[idx] = entry
    else          this.data.accounts.push(entry)

    this.data.lastAccount = name
    this.save()
  }

  private load(): AppSettings {
    try {
      return { ...DEFAULTS, ...JSON.parse(readFileSync(this.settingsPath(), 'utf8')) }
    } catch { return { ...DEFAULTS } }
  }

  private save(): void {
    writeFileSync(this.settingsPath(), JSON.stringify(this.data, null, 2), 'utf8')
  }
}
