/**
 * Settings search: the catalogue and the matcher.
 *
 * Two things are being protected here:
 *
 *   1. The catalogue still describes the real Settings screen. It is written by
 *      hand (see settingsIndex.ts for why), so a renamed setting leaves a result
 *      that leads nowhere. Section 1 reads each tab's source and fails when an
 *      entry's label or section heading is no longer in it.
 *   2. Search returns what was meant. Every word has to land, the two "Whispers"
 *      toggles stay distinguishable, and a setting the current build doesn't show
 *      is never offered.
 *
 * Run: npm run test:tools
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import {
  SETTINGS_INDEX, TABS, searchSettings, entryTitle, entryPath, type TabId,
} from './settingsIndex'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)

// ── 1. The catalogue matches the source ──────────────────────────────────────
{
  // Where each tab's settings are written. The last three are assembled inline in
  // SettingsModal around an embedded file browser, so both files count.
  const UI = 'src/renderer/src/components/ui'
  const SOURCES: Record<TabId, string[]> = {
    appearance:    ['settings/AppearanceTab.tsx'],
    ambient:       ['settings/AmbientTab.tsx'],
    notifications: ['settings/NotificationsTab.tsx'],
    hotkeys:       ['settings/HotkeysTab.tsx'],
    aliases:       ['settings/AliasesTab.tsx'],
    triggers:      ['settings/TriggersTab.tsx'],
    scripts:       ['SettingsModal.tsx', 'CmdFilesEditor.tsx'],
    lich:          ['SettingsModal.tsx', 'LichFilesEditor.tsx', 'LichLogsViewer.tsx'],
    logs:          ['SettingsModal.tsx', 'LogFilesViewer.tsx'],
  }
  const read = (tab: TabId): string =>
    SOURCES[tab].map(f => readFileSync(join(process.cwd(), UI, f), 'utf8')).join('\n').replace(/&amp;/g, '&')

  for (const e of SETTINGS_INDEX) {
    const src = read(e.tab)
    check(`"${e.section}" is still a heading in ${e.tab}`, src.includes(e.section))
    if (e.label) check(`"${e.label}" is still a setting in ${e.tab}`, src.includes(e.label))
  }
  for (const t of TABS) {
    check(`the ${t.id} tab has at least one entry`, SETTINGS_INDEX.some(e => e.tab === t.id))
  }
}

// ── 2. Matching ──────────────────────────────────────────────────────────────
{
  const titles = (q: string, web = false): string[] => searchSettings(q, web).map(entryTitle)

  eq('nothing typed, nothing found', searchSettings('   ', false).length, 0)
  eq('no match is an empty list', searchSettings('zzzqqq', false).length, 0)

  eq('a label is found by its start', titles('font')[0], 'Font family')
  check('and its sibling comes with it', titles('font').includes('Font size'))
  eq('case and spacing do not matter', titles('  FONT   size ')[0], 'Font size')

  // Found by a word that is only in the keywords — the reason they exist.
  eq('a synonym finds the setting', titles('scrollback')[0], 'Output buffer')
  eq('a theme is found by name', titles('bloodstone')[0], 'Theme')
  eq('a function key is found by its name', titles('f7')[0], 'Function Keys')

  // A label hit outranks a keyword hit for the same query.
  eq('the named setting beats a mention of it', titles('volume')[0], 'Volume')

  // Two toggles are both called "Whispers"; the second word has to pick one.
  const push = searchSettings('push whispers', false)
  eq('every word must land', push.length, 1)
  eq('so the section disambiguates', entryPath(push[0]), 'Notifications › Push notifications')
  eq('alone, both are offered', titles('whispers').filter(t => t === 'Whispers').length, 2)

  // A tab name alone lists that tab.
  check('a tab name finds its settings', titles('ambient').includes('Room tint'))
}

// ── 3. Build-specific settings ───────────────────────────────────────────────
{
  const has = (q: string, web: boolean, title: string): boolean =>
    searchSettings(q, web).some(e => entryTitle(e) === title)

  check('the Lich path is offered on desktop', has('lich path', false, 'Lich path'))
  check('but not on web, where there is none', !has('lich path', true, 'Lich path'))
  check('log retention is offered on web', has('retention', true, 'Keep Lich session logs for'))
  check('but not on desktop', !has('retention', false, 'Keep Lich session logs for'))
  check('keep-awake is web only', has('awake', true, 'Keep screen awake') && !has('awake', false, 'Keep screen awake'))
}

// ── 4. Labels ────────────────────────────────────────────────────────────────
{
  eq('a section entry is titled by its section',
    entryTitle({ tab: 'triggers', section: 'Triggers' }), 'Triggers')
  eq('and its path does not say it twice',
    entryPath({ tab: 'triggers', section: 'Triggers' }), 'Triggers')
  eq('a row names its tab and section',
    entryPath({ tab: 'ambient', section: 'Sound', label: 'Volume' }), 'Ambient › Sound')
}

// ── Report ───────────────────────────────────────────────────────────────────
if (failures.length) {
  console.error(`\n✗ settingsIndex: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ settingsIndex: ${passed} passed`)
