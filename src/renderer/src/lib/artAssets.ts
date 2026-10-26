/**
 * URLs for the painted art sets. Keys come from lib/artKeys.ts. Every lookup returns
 * undefined for a missing file, so callers simply skip the picture.
 *
 *   room-art/   Room panel headers, one per room type (jpg, 960 wide)
 *   death-art/  death / depart / resurrect cards (jpg, 1600 wide)
 *   coins/      <currency>-<metal>, background removed, circle-cropped (webp)
 *   crests/     guild crests, background removed (webp)
 *   empty-art/  Loomy vignettes for empty panels, soft oval edges (webp)
 *
 * Full-size originals and the scripts that made these are kept outside the repo
 * (source/repos/magiloom-art-originals).
 */
import type { DeathCard, GuildKey } from './artKeys'

type Glob = Record<string, string>
const ROOM   = import.meta.glob('../assets/room-art/*.jpg',  { eager: true, import: 'default' }) as Glob
const DEATH  = import.meta.glob('../assets/death-art/*.jpg', { eager: true, import: 'default' }) as Glob
const COINS  = import.meta.glob('../assets/coins/*.webp',    { eager: true, import: 'default' }) as Glob
const CRESTS = import.meta.glob('../assets/crests/*.webp',   { eager: true, import: 'default' }) as Glob
const EMPTY  = import.meta.glob('../assets/empty-art/*.webp', { eager: true, import: 'default' }) as Glob

export const roomArt  = (key: string): string | undefined => ROOM[`../assets/room-art/${key}.jpg`]
export const deathArt = (card: DeathCard): string | undefined => DEATH[`../assets/death-art/${card}.jpg`]
export const crestArt = (guild: GuildKey): string | undefined => CRESTS[`../assets/crests/${guild}.webp`]

/** `currency` as lib/wealth names it ("Kronars"), `metal` as a denomination ("gold"). */
export const coinArt = (currency: string, metal: string): string | undefined =>
  COINS[`../assets/coins/${currency.toLowerCase()}-${metal.toLowerCase()}.webp`]

export type EmptyArtKind = 'conversation' | 'thoughts' | 'combat' | 'atmo' | 'spells' | 'experience'
  | 'deaths' | 'logons' | 'messages' | 'inventory' | 'wealth' | 'waiting'
export const emptyArt = (kind: EmptyArtKind): string | undefined => EMPTY[`../assets/empty-art/${kind}.webp`]
