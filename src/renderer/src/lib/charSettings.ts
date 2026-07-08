import { applyTheme } from './themes'

// Per-character appearance settings. Stored in the shared settings.json under the
// character's `characters[name]` namespace so they follow the character across
// windows/instances. Legacy installs kept these in localStorage; those are
// migrated up on first load (see loadCharAppearance).
export interface CharAppearance {
  theme:      string
  fontSize:   number
  fontFamily: string
  density:    'cozy' | 'compact'
}

export const DEFAULT_APPEARANCE: CharAppearance = {
  theme:      'magiloom',
  fontSize:   13,
  fontFamily: 'Cascadia Code',
  density:    'cozy',
}

const LEGACY_KEY = (name: string) => `magiloom-charsettings:${name.trim().toLowerCase()}`

function readLegacyAppearance(name: string): CharAppearance | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY(name))
    if (raw) return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) }
  } catch { /* ignore malformed */ }
  return null
}

export async function loadCharAppearance(name: string): Promise<CharAppearance> {
  try {
    const c = await window.dr.settings.getChar(name)
    if (c.appearance) return { ...DEFAULT_APPEARANCE, ...c.appearance }
    // One-time migration from the old localStorage key.
    const legacy = readLegacyAppearance(name)
    if (legacy) {
      window.dr.settings.patchChar(name, { appearance: legacy })
      try { localStorage.removeItem(LEGACY_KEY(name)) } catch { /* ignore */ }
      return legacy
    }
  } catch { /* fall through to defaults */ }
  return { ...DEFAULT_APPEARANCE }
}

export function saveCharAppearance(name: string, next: CharAppearance): void {
  window.dr.settings.patchChar(name, { appearance: next })
}

// Apply an appearance to the document.
export function applyAppearance(a: CharAppearance): void {
  applyTheme(a.theme)
  document.documentElement.style.setProperty('--font-game', `'${a.fontFamily}', monospace`)
  document.documentElement.style.setProperty('--font-size-game', `${a.fontSize}px`)
  document.documentElement.dataset.density = a.density
}
