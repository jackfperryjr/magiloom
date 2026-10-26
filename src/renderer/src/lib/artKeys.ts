/**
 * Which painted asset goes with a game fact. Pure (no image imports), so it can be
 * tested in plain node; lib/artAssets.ts turns these keys into URLs.
 */
import type { RoomLocale } from './roomLocale'

/** Room panel header for a room type. Rooms the classifier can't place are open country. */
export function roomArtKey(locale: RoomLocale): string {
  return locale === 'default' ? 'wilds' : locale
}

const GUILDS = ['barbarian', 'bard', 'cleric', 'empath', 'moonmage', 'necromancer',
  'paladin', 'ranger', 'thief', 'trader', 'warriormage'] as const
export type GuildKey = (typeof GUILDS)[number]

/**
 * Crest for a guild as the game names it ("Moon Mage", "Warrior Mage", "Bard").
 * Spaces and case don't matter; a plural ("Thieves"), a trailing "Guild" or a
 * Commoner gets null rather than a wrong crest.
 */
export function crestKey(guild: string | undefined | null): GuildKey | null {
  if (!guild) return null
  const k = guild.toLowerCase().replace(/\bguild\b/g, '').replace(/[^a-z]/g, '')
  return (GUILDS as readonly string[]).includes(k) ? (k as GuildKey) : null
}

/** Guild name from an INFO line ("Name: Penello Highwind   Race: Human   Guild: Bard"). */
export function guildFromInfoLine(text: string): string | null {
  const m = text.match(/^\s*Name:.*?\bGuild:\s*([A-Za-z][A-Za-z ]*?)\s*$/)
  return m ? m[1] : null
}

/** What happened when the dead indicator changed: the card to show, if any. */
export type DeathCard = 'death' | 'depart' | 'resurrect'
export function deathCardFor(wasDead: boolean, isDead: boolean, departTyped: boolean): DeathCard | null {
  if (!wasDead && isDead) return 'death'
  if (wasDead && !isDead) return departTyped ? 'depart' : 'resurrect'
  return null
}

/** DEPART as typed, in any of the abbreviations the game accepts ("dep", "depa"...). */
export const DEPART_RE = /^\s*dep(?:a(?:r(?:t)?)?)?(?:\s|$)/i
