import { applyTheme } from './themes'

// Per-character appearance settings. Stored in localStorage keyed by character
// name so each character remembers its own theme / font / density / timestamps.
// A character with nothing saved falls back to DEFAULT_APPEARANCE (app defaults).
export interface CharAppearance {
  theme:      string
  fontSize:   number
  fontFamily: string
  density:    'cozy' | 'compact'
  timestamps: boolean
}

export const DEFAULT_APPEARANCE: CharAppearance = {
  theme:      'magiloom',
  fontSize:   13,
  fontFamily: 'Cascadia Code',
  density:    'cozy',
  timestamps: false,
}

const KEY = (name: string) => `magiloom-charsettings:${name.trim().toLowerCase()}`

export function loadCharAppearance(name: string): CharAppearance {
  try {
    const raw = localStorage.getItem(KEY(name))
    if (raw) return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) }
  } catch { /* ignore malformed */ }
  return { ...DEFAULT_APPEARANCE }
}

export function saveCharAppearance(name: string, next: CharAppearance): void {
  try { localStorage.setItem(KEY(name), JSON.stringify(next)) } catch { /* quota / disabled */ }
}

// Apply an appearance to the document. `setTimestamps` bridges the runtime
// timestamp flag owned by the GameOutput module setter.
export function applyAppearance(a: CharAppearance, setTimestamps?: (b: boolean) => void): void {
  applyTheme(a.theme)
  document.documentElement.style.setProperty('--font-game', `'${a.fontFamily}', monospace`)
  document.documentElement.style.setProperty('--font-size-game', `${a.fontSize}px`)
  document.documentElement.dataset.density = a.density
  setTimestamps?.(a.timestamps)
}
