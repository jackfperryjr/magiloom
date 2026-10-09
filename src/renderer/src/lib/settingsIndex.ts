/**
 * What Settings contains, as data — the thing the Settings search searches.
 *
 * The modal only ever mounts the tab you are looking at, so there is no DOM to
 * scrape for the other eight; and the settings themselves are JSX spread across a
 * dozen components, not a schema. So the catalogue is written out here by hand.
 *
 * That makes drift the risk: rename a setting and its entry goes stale without
 * anything breaking. settingsIndex.test.ts closes that — it reads each tab's source
 * and fails when an entry's label or section no longer appears in it. Adding a
 * setting without an entry is not caught (nothing can know it is missing), so a new
 * SettingRow wants a line here.
 *
 * Pure (no React, no DOM) so it runs under plain node in the tests.
 */

import { THEMES } from './themes'

export type TabId = 'appearance' | 'ambient' | 'notifications' | 'hotkeys' | 'aliases' | 'triggers' | 'scripts' | 'lich' | 'logs'

export const TABS: { id: TabId; label: string }[] = [
  { id: 'appearance',    label: 'Appearance' },
  { id: 'ambient',       label: 'Ambient' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'hotkeys',       label: 'Hotkeys' },
  { id: 'aliases',       label: 'Aliases' },
  { id: 'triggers',      label: 'Triggers' },
  { id: 'scripts',       label: 'Scripts' },
  { id: 'lich',          label: 'Lich' },
  // Lantern's own game-output logs. Separate from the Lich tab because they are a
  // different set of files with a different owner — Lich writes its own, and mixing
  // the two under one heading is what made it unclear which was eating the disk.
  { id: 'logs',          label: 'Lantern Logs' },
]

export interface SettingEntry {
  tab:     TabId
  /** The section heading it sits under, exactly as rendered. */
  section: string
  /** The setting's name, exactly as rendered. Omitted when the entry IS the section
   *  (a rule list or a file browser has no single row to point at). */
  label?:  string
  /** Words a person might type that appear in neither the label nor the section. */
  keywords?: string
  /** Shown on one build only — a result that leads to a row that isn't there is
   *  worse than no result. */
  only?:   'web' | 'desktop'
}

export const SETTINGS_INDEX: SettingEntry[] = [
  // ── Appearance ──
  { tab: 'appearance', section: 'Theme',
    keywords: 'color colour palette skin dark light mode ' + THEMES.map(t => t.name).join(' ') },
  { tab: 'appearance', section: 'Layout',  label: 'Density',       keywords: 'cozy compact spacing padding size' },
  { tab: 'appearance', section: 'Display', label: 'Font family',   keywords: 'typeface monospace text cascadia fira consolas courier' },
  { tab: 'appearance', section: 'Display', label: 'Font size',     keywords: 'text bigger smaller zoom px' },
  { tab: 'appearance', section: 'Display', label: 'Output buffer', keywords: 'scrollback history lines memory' },
  { tab: 'appearance', section: 'Mobile',  label: 'Keep screen awake', keywords: 'wake lock dim sleep phone tablet', only: 'web' },

  // ── Ambient ──
  { tab: 'ambient', section: 'Visuals', label: 'Room tint',     keywords: 'locale color colour cave forest edge glow' },
  { tab: 'ambient', section: 'Visuals', label: 'Combat heat',   keywords: 'hit damage red glow flash' },
  { tab: 'ambient', section: 'Visuals', label: 'Strike flash',  keywords: 'hit attack amber pulse combat' },
  { tab: 'ambient', section: 'Visuals', label: 'Room effects',  keywords: 'embers bubbles forge lava underwater particles animation' },
  { tab: 'ambient', section: 'Visuals', label: 'Death',         keywords: 'dead grey gray desaturate' },
  { tab: 'ambient', section: 'Sound',   label: 'Ambient sound', keywords: 'audio noise background mute' },
  { tab: 'ambient', section: 'Sound',   label: 'Volume',        keywords: 'audio loud quiet' },
  { tab: 'ambient', section: 'Sound',   label: 'Rain',          keywords: 'weather storm audio' },
  { tab: 'ambient', section: 'Sound',   label: 'Wind',          keywords: 'weather snow sandstorm audio' },
  { tab: 'ambient', section: 'Sound',   label: 'Fire',          keywords: 'forge lava crackle audio' },
  { tab: 'ambient', section: 'Sound',   label: 'Water',         keywords: 'underwater bubbles audio' },
  { tab: 'ambient', section: 'Sound',   label: 'Silence in the background', keywords: 'pause hidden tab mute audio' },
  { tab: 'ambient', section: 'Login screen', label: 'Login art',      keywords: 'background picture painting sign-in' },
  { tab: 'ambient', section: 'Login screen', label: 'Scene',          keywords: 'background picture season pin' },
  { tab: 'ambient', section: 'Login screen', label: 'Holiday scenes', keywords: 'yule hallows harvest fireworks' },

  // ── Notifications ──
  { tab: 'notifications', section: 'Alerts', label: 'Play sound',     keywords: 'audio chime beep' },
  { tab: 'notifications', section: 'Alerts', label: 'Desktop popups', keywords: 'toast os notification do not disturb' },
  { tab: 'notifications', section: 'Notify me about', label: 'Mentions',    keywords: 'name' },
  { tab: 'notifications', section: 'Notify me about', label: 'Whispers' },
  { tab: 'notifications', section: 'Notify me about', label: 'Chat',        keywords: 'message dm' },
  { tab: 'notifications', section: 'Notify me about', label: 'Disconnects', keywords: 'dropped connection lost' },
  { tab: 'notifications', section: 'Speak aloud (text-to-speech)', label: 'Speak mentions', keywords: 'tts voice read' },
  { tab: 'notifications', section: 'Speak aloud (text-to-speech)', label: 'Speak whispers', keywords: 'tts voice read' },
  { tab: 'notifications', section: 'Push notifications', label: 'Notify me when the app is closed', keywords: 'phone mobile background' },
  { tab: 'notifications', section: 'Push notifications', label: 'Mentions of my name' },
  { tab: 'notifications', section: 'Push notifications', label: 'Whispers' },
  { tab: 'notifications', section: 'Push notifications', label: 'Room speech (says)' },
  { tab: 'notifications', section: 'Push notifications', label: 'Thoughts (ESP)', keywords: 'gweth' },
  { tab: 'notifications', section: 'Push notifications', label: 'Direct Chat', keywords: 'message dm' },
  { tab: 'notifications', section: 'Custom alerts', keywords: 'watch rule pattern regex name toast popup sound speak' },

  // ── Hotkeys / Aliases / Triggers ──
  { tab: 'hotkeys',  section: 'Quick Actions', keywords: 'buttons shortcut macro command script' },
  { tab: 'hotkeys',  section: 'Function Keys', keywords: 'f1 f2 f3 f4 f5 f6 f7 f8 f9 f10 f11 f12 macro keybind shortcut' },
  { tab: 'aliases',  section: 'Aliases',       keywords: 'shortcut expand command genie import class' },
  { tab: 'aliases',  section: 'Variables',     keywords: 'var $ genie' },
  { tab: 'triggers', section: 'Triggers',      keywords: 'pattern regex action automation genie import class' },

  // ── Scripts ──
  { tab: 'scripts', section: 'Native Scripts', label: 'Script folder', keywords: '.cmd genie wizard directory path' },
  { tab: 'scripts', section: 'Native Scripts', label: 'Script files',  keywords: '.cmd genie wizard editor edit' },

  // ── Lich ──
  { tab: 'lich', section: 'Lich', label: 'Lich path', keywords: 'lich.rbw ruby install location', only: 'desktop' },
  { tab: 'lich', section: 'Lich', label: 'Keep Lich session logs for', keywords: 'retention days storage delete', only: 'web' },
  { tab: 'lich', section: 'Lich', label: 'Export your Lich data', keywords: 'download zip backup', only: 'web' },
  { tab: 'lich', section: 'Lich', label: 'Profiles & custom scripts', keywords: 'yaml files editor setup' },
  { tab: 'lich', section: 'Lich', label: 'Lich session logs', keywords: 'xml raw stream files' },

  // ── Lantern Logs ──
  { tab: 'logs', section: 'Lantern Logs', label: 'Log game output', keywords: 'logging record save transcript' },
  { tab: 'logs', section: 'Lantern Logs', label: 'Logs', keywords: 'files browse download delete' },
]

const TAB_LABEL = new Map(TABS.map(t => [t.id, t.label]))
const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim()

/** What a result is called — its own name, or its section's when it is the section. */
export const entryTitle = (e: SettingEntry): string => e.label ?? e.section

/** Where a result lives, for the line under its title: "Ambient › Sound". */
export function entryPath(e: SettingEntry): string {
  const tab = TAB_LABEL.get(e.tab) ?? ''
  return e.section === tab ? tab : `${tab} › ${e.section}`
}

/**
 * Entries matching every word of `query`, best first.
 *
 * Every word must appear SOMEWHERE in an entry (title, section, tab or keywords) —
 * so "push whispers" finds the push toggle and not the in-app one. Rank is decided
 * by the best place the words landed: a title that starts with the query beats one
 * that merely contains it, which beats a hit on the section or tab, which beats a
 * keyword-only match. Ties keep catalogue order, which is the order the tabs show.
 */
export function searchSettings(query: string, isWeb: boolean): SettingEntry[] {
  const q = norm(query)
  if (!q) return []
  const words = q.split(' ')
  const scored: { e: SettingEntry; score: number; i: number }[] = []

  SETTINGS_INDEX.forEach((e, i) => {
    if (e.only && (e.only === 'web') !== isWeb) return
    const title = norm(entryTitle(e))
    const place = norm(`${e.section} ${TAB_LABEL.get(e.tab) ?? ''}`)
    const extra = norm(e.keywords ?? '')
    if (!words.every(w => title.includes(w) || place.includes(w) || extra.includes(w))) return

    let score = 3
    if (title.startsWith(q)) score = 0
    else if (words.every(w => title.includes(w))) score = 1
    else if (words.every(w => title.includes(w) || place.includes(w))) score = 2
    scored.push({ e, score, i })
  })

  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map(s => s.e)
}
