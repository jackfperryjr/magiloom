/**
 * Account inventory: reading INVENTORY LIST / VAULT reports off the stream, and
 * searching what has been collected.
 *
 * The storage side is main/holdings-store.ts (desktop) and its copy on the server;
 * the shapes below are the same ones, repeated because the renderer can't import
 * from the main process.
 *
 * Pure (no React, no store, no DOM) so capture can be tested against real reports.
 */

import { listLineKind } from './listBlocks'

export type HoldingKind = 'inv' | 'vault' | 'family'
export interface HoldingItem     { name: string; depth: number }
export interface HoldingSnapshot { at: number; items: HoldingItem[]; by?: string }
export interface HoldingsCharacter { name: string; inv?: HoldingSnapshot; vault?: HoldingSnapshot }
export interface HoldingsAccount {
  name:       string
  family?:    HoldingSnapshot
  characters: Record<string, HoldingsCharacter>
}
export interface HoldingsDoc { version: 1; accounts: Record<string, HoldingsAccount> }

export const EMPTY_HOLDINGS: HoldingsDoc = { version: 1, accounts: {} }

// ── Capture ──────────────────────────────────────────────────────────────────

/** One finished report, ready to store. */
export interface HoldingsCapture { kind: HoldingKind; items: HoldingItem[] }

interface StreamLine {
  text:    string
  links?:  { text: string; cmd: string }[]
  styles?: { preset?: string }[]
}

// INVENTORY LIST opens with this line and nothing else does. Plain INVENTORY lists
// worn items in the same row shape, so the rows alone can't be trusted: reading a
// plain INVENTORY as the full list would replace everything in the character's
// containers with nothing.
const INV_START_RE   = /rummage about your person, taking stock of your possessions/i
const VAULT_START_RE = /\bVault Inventory:/i
// A command as we sent it, or as a script's echo shows it: "[afk2]>vault family".
const VAULT_CMD_RE   = /^(?:\[[^\]]*\]\s*>\s*)?vault\s+(st|fam)/i
const INV_CMD_RE     = /^get #\d+((?: in #\d+)+)$/

/**
 * Collects one report at a time from the main stream.
 *
 * A report is everything between its opening line and the prompt that ends it; the
 * game sends each as a single response, so nothing else is interleaved. `line`
 * takes every main-stream line and `prompt` hands back the report, if one finished.
 *
 * The two vault reports print the same sheet, so which vault it was is taken from
 * the command that asked for it (`command`). When no command was seen — a script
 * sent it and its echo was gagged — it is assumed to be the standard vault, which
 * is the one players check day to day, unless the sheet itself says "family".
 */
export class HoldingsReader {
  private kind: HoldingKind | null = null
  private rows: { name: string; indent: number }[] = []
  private nextVault: 'vault' | 'family' = 'vault'
  // Prompts left before a remembered VAULT FAMILY is forgotten. The command can come
  // to nothing (no runners left), and a "family" that outlived it would mislabel the
  // next standard report. Several, not one: prompts arrive for unrelated reasons, and
  // one often lands between sending a command and its reply.
  private vaultPrompts = 0

  /** A command on its way to the game (ours, or a script's echo of its own). */
  command(text: string): void {
    const m = VAULT_CMD_RE.exec(text.trim())
    if (!m) return
    this.nextVault    = m[1].toLowerCase() === 'fam' ? 'family' : 'vault'
    this.vaultPrompts = 4
  }

  line(line: StreamLine): void {
    if (INV_START_RE.test(line.text)) { this.kind = 'inv'; this.rows = []; return }
    if (VAULT_START_RE.test(line.text)) {
      this.kind = /family/i.test(line.text) ? 'family' : this.nextVault
      this.rows = []
      return
    }
    if (!this.kind) { this.command(line.text); return }

    const row = listLineKind(line)
    if (this.kind === 'inv' && row === 'inv') {
      const link = line.links![0]
      const nest = INV_CMD_RE.exec(link.cmd)?.[1]
      this.rows.push({ name: link.text, indent: nest ? nest.split(' in ').length - 1 : 0 })
    } else if (this.kind !== 'inv' && row === 'vault') {
      // "          (10) a rockwood bo staff" — the number is the vault's own index and
      // shifts as things are taken out; the indent is the nesting.
      const m = /^(\s+)\(\d+\)\s+(.+?)\s*$/.exec(line.text)
      if (m) this.rows.push({ name: m[2], indent: m[1].length })
    }
  }

  /** A prompt arrived. Returns the report it ended, or null if none was open. */
  prompt(): HoldingsCapture | null {
    const kind = this.kind
    if (!kind) {
      if (this.vaultPrompts > 0 && --this.vaultPrompts === 0) this.nextVault = 'vault'
      return null
    }
    const rows = this.rows
    this.kind = null
    this.rows = []
    this.nextVault = 'vault'
    if (kind === 'inv') return { kind, items: rows.map(r => ({ name: r.name, depth: r.indent })) }
    // Vault indents are columns of spaces: the shallowest row is depth 0 and each
    // level in is five more.
    const base = Math.min(...rows.map(r => r.indent), Infinity)
    return { kind, items: rows.map(r => ({ name: r.name, depth: Math.max(0, Math.round((r.indent - base) / 5)) })) }
  }

  reset(): void { this.kind = null; this.rows = []; this.nextVault = 'vault' }
}

// ── Reading the collection ───────────────────────────────────────────────────

/** A place items are kept: one character's person or vault, or an account's family vault. */
export interface HoldingsSection {
  kind:     HoldingKind
  label:    string
  snapshot: HoldingSnapshot
}

export interface HoldingsCharacterView { name: string; sections: HoldingsSection[] }
export interface HoldingsAccountView {
  /** '' when the account was never known — shown as characters with no account. */
  name:       string
  characters: HoldingsCharacterView[]
  family?:    HoldingsSection
}

const SECTION_LABEL: Record<HoldingKind, string> = { inv: 'On person', vault: 'Vault', family: 'Family vault' }

/**
 * The document in display order: accounts A–Z (the unknown one last), characters
 * A–Z within each — except that `current`, the character being played, leads its
 * account, and that account leads the list. It is the one you already know about,
 * and putting it first means everyone else starts in the same place every time.
 */
export function holdingsView(doc: HoldingsDoc, current = ''): HoldingsAccountView[] {
  const me = current.trim().toLowerCase()
  const section = (kind: HoldingKind, s?: HoldingSnapshot): HoldingsSection[] =>
    s ? [{ kind, label: SECTION_LABEL[kind], snapshot: s }] : []

  const accounts = Object.values(doc.accounts).map(a => {
    const characters = Object.values(a.characters)
      .map(c => ({ name: c.name, sections: [...section('inv', c.inv), ...section('vault', c.vault)] }))
      .filter(c => c.sections.length > 0)
      .sort((x, y) =>
        Number(y.name.toLowerCase() === me) - Number(x.name.toLowerCase() === me) || x.name.localeCompare(y.name))
    return { name: a.name, characters, family: section('family', a.family)[0] }
  }).filter(a => a.characters.length > 0 || a.family)

  const mine = (a: HoldingsAccountView): number => Number(a.characters.some(c => c.name.toLowerCase() === me))
  return accounts.sort((x, y) =>
    mine(y) - mine(x) || Number(!x.name) - Number(!y.name) || x.name.localeCompare(y.name))
}

/** An item that matched a search, with the containers it is inside (outermost first). */
export interface HoldingMatch { item: HoldingItem; within: string[] }

/**
 * Items in a snapshot matching every word of `query`, each with its chain of
 * containers — a search result is only useful if it says WHICH bag. The chain comes
 * from depth alone: an item's container is the nearest earlier item one level out.
 */
export function searchSnapshot(snapshot: HoldingSnapshot, query: string): HoldingMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: HoldingMatch[] = []
  const chain: string[] = []
  for (const item of snapshot.items) {
    chain.length = Math.min(chain.length, item.depth)
    const name = item.name.toLowerCase()
    if (words.every(w => name.includes(w))) out.push({ item, within: [...chain] })
    chain[item.depth] = item.name
  }
  return out
}

// ── Saving to a file ─────────────────────────────────────────────────────────

/** A moment as local "2026-10-10 14:32" — sortable, and unambiguous to read back. */
export function stamp(at: number): string {
  const d = new Date(at)
  const two = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/**
 * The account inventory as a plain-text document, for keeping or sharing.
 *
 * Text rather than a spreadsheet format because the thing being saved is a set of
 * nested lists: indentation carries "this is inside that" directly, and it opens
 * anywhere. Each list is dated with when it was TAKEN — a saved copy of an old list
 * must not read as if it were current as of the save.
 *
 * `accounts` is whatever holdingsView returned, cut down to what should be saved:
 * everything, or one character.
 */
export function holdingsText(accounts: HoldingsAccountView[], now: number): string {
  const out: string[] = ['Lantern — Account inventory', `Saved ${stamp(now)}`]
  const section = (s: HoldingsSection, title = s.label): void => {
    const n = s.snapshot.items.length
    out.push('', `${title} — ${n} item${n === 1 ? '' : 's'}, as of ${stamp(s.snapshot.at)}`)
    if (n === 0) out.push('  (empty)')
    for (const item of s.snapshot.items) out.push(`${'  '.repeat(item.depth + 1)}${item.name}`)
  }
  for (const account of accounts) {
    const name = account.name || 'Account not recorded'
    out.push('', '', name, '='.repeat(name.length))
    for (const c of account.characters) {
      out.push('', c.name, '-'.repeat(c.name.length))
      for (const s of c.sections) section(s)
    }
    if (account.family) {
      const by = account.family.snapshot.by
      out.push('', 'Family vault', '------------')
      section(account.family, by ? `Seen by ${by}` : 'Family vault')
    }
  }
  return out.join('\n') + '\n'
}

/** A file name for a saved copy: "lantern-inventory-refia-2026-10-10.txt". */
export function holdingsFileName(who: string, now: number): string {
  const slug = who.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all'
  return `lantern-inventory-${slug}-${stamp(now).slice(0, 10)}.txt`
}

/** "just now", "12 min ago", "3 hr ago", "5 days ago" — how stale a report is. */
export function ageLabel(at: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - at) / 60_000))
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
