import { app } from 'electron'
import { join } from 'path'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

export interface AppSettings {
  lichPath:    string
  accounts:    { name: string; lastCharacter?: string }[]
  lastAccount: string
  fontSize:    number
  fontFamily:  string
  passwords:   Record<string, string>  // account name → base64 encrypted password
  functionKeys: Record<string, string> // e.g. { F1: 'attack', F2: 'spell' }
}

const DEFAULTS: AppSettings = {
  lichPath:    '',
  accounts:    [],
  lastAccount: '',
  fontSize:    13,
  fontFamily:  'Cascadia Code',
  passwords:   {},
  functionKeys: {}
}

function settingsPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'settings.json')
}

export class SettingsStore {
  private data: AppSettings

  constructor() { this.data = this.load() }

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
      return { ...DEFAULTS, ...JSON.parse(readFileSync(settingsPath(), 'utf8')) }
    } catch { return { ...DEFAULTS } }
  }

  private save(): void {
    writeFileSync(settingsPath(), JSON.stringify(this.data, null, 2), 'utf8')
  }
}
