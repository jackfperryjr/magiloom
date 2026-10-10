import { EventEmitter } from 'events'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'

// ── Account inventory ("holdings") ───────────────────────────────────────────────
// What every character owns, as last seen: the INVENTORY LIST and VAULT STANDARD
// reports each character has run, plus the family vault each DragonRealms account
// shares. It exists so that, logged in as one character, you can find out which of
// the others is holding something.
//
// This is a record of REPORTS, not a live inventory. Nothing here asks the game for
// anything — both commands cost roundtime and a vault report costs a runner — so a
// snapshot is exactly as old as the last time its command was run, and each one
// carries the time it was taken so the viewer can say so.
//
// One JSON file. The same class backs the desktop app (one file for the machine) and
// the server (one per Magiloom account, under that user's directory); a copy lives in
// magiserver's src/lib, and the two should be kept identical.
//
// Every write re-reads the file first. On the server one instance is shared by all of
// a user's sessions, so that is redundant there; on the desktop each window is its own
// process with its own instance, and without it two characters open at once would each
// write back a document that had never heard of the other's report.

export type HoldingKind = 'inv' | 'vault' | 'family'

/** One item. `depth` is how many containers deep it sits: 0 is worn / top level. */
export interface HoldingItem { name: string; depth: number }

export interface HoldingSnapshot {
  /** When the report was captured (ms). Stamped here, not by the client. */
  at:    number
  items: HoldingItem[]
  /** Family vault only: the character who ran the report. */
  by?:   string
}

export interface HoldingsCharacter {
  /** As the game spells it; the record is keyed by its lower-case form. */
  name:   string
  inv?:   HoldingSnapshot
  vault?: HoldingSnapshot
}

export interface HoldingsAccount {
  name:       string
  /** The family vault is shared by the account, so it is stored once, not per character. */
  family?:    HoldingSnapshot
  characters: Record<string, HoldingsCharacter>
}

export interface HoldingsDoc {
  version:  1
  accounts: Record<string, HoldingsAccount>
}

export interface HoldingsPut {
  /** DragonRealms account. May be empty when the client doesn't know it. */
  account:   string
  character: string
  kind:      HoldingKind
  items:     HoldingItem[]
}

// Bounds on what a client can store. Generous next to anything a real character
// carries (a full vault is a few hundred items), and small enough that one account
// can't grow its file without limit by posting junk.
const MAX_ITEMS     = 4000
const MAX_NAME      = 240
const MAX_DEPTH     = 16
const MAX_LABEL     = 64
const MAX_ACCOUNTS  = 24
const MAX_CHARS     = 64

const empty = (): HoldingsDoc => ({ version: 1, accounts: {} })
const label = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, MAX_LABEL) : '')
const keyOf = (name: string): string => name.toLowerCase()

/** Coerce whatever arrived into a well-formed item list; never throws. */
function cleanItems(raw: unknown): HoldingItem[] {
  if (!Array.isArray(raw)) return []
  const out: HoldingItem[] = []
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const item = r as Partial<HoldingItem> | null
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, MAX_NAME) : ''
    if (!name) continue
    const depth = Number.isFinite(item?.depth) ? Math.round(item!.depth as number) : 0
    out.push({ name, depth: Math.min(MAX_DEPTH, Math.max(0, depth)) })
  }
  return out
}

export class HoldingsStore extends EventEmitter {
  constructor(private readonly dir: string) { super() }

  private file(): string { return join(this.dir, 'holdings.json') }

  private read(): HoldingsDoc {
    try {
      const doc = JSON.parse(readFileSync(this.file(), 'utf8')) as HoldingsDoc
      if (doc && doc.version === 1 && doc.accounts && typeof doc.accounts === 'object') return doc
    } catch { /* missing or unreadable — start empty rather than fail the caller */ }
    return empty()
  }

  // Write-then-rename, so a crash mid-write leaves the previous file rather than half
  // of the new one.
  private write(doc: HoldingsDoc): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
    const tmp = this.file() + '.tmp'
    writeFileSync(tmp, JSON.stringify(doc))
    renameSync(tmp, this.file())
    this.emit('changed', doc)
  }

  get(): HoldingsDoc { return this.read() }

  /** Replace one report. Returns the whole document, as it now stands. */
  put(input: HoldingsPut): HoldingsDoc {
    const kind = input?.kind
    if (kind !== 'inv' && kind !== 'vault' && kind !== 'family') throw new Error('Unknown inventory report.')
    const character = label(input.character)
    if (!character) throw new Error('No character to file this inventory under.')
    const accountName = label(input.account)

    const doc = this.read()
    const aKey = keyOf(accountName)
    let account = doc.accounts[aKey]
    if (!account) {
      if (Object.keys(doc.accounts).length >= MAX_ACCOUNTS) throw new Error('Too many accounts stored.')
      account = doc.accounts[aKey] = { name: accountName, characters: {} }
    }
    const snapshot: HoldingSnapshot = { at: Date.now(), items: cleanItems(input.items) }

    if (kind === 'family') {
      account.family = { ...snapshot, by: character }
    } else {
      const cKey = keyOf(character)
      let entry = account.characters[cKey]
      if (!entry) {
        if (Object.keys(account.characters).length >= MAX_CHARS) throw new Error('Too many characters stored.')
        entry = account.characters[cKey] = { name: character }
      }
      entry.name = character
      entry[kind] = snapshot
      // A character first seen before its account was known was filed under "".
      // Now that the account is known, that orphan is this character: drop it,
      // so it doesn't sit beside the real one for ever.
      if (aKey && doc.accounts['']?.characters[cKey]) {
        delete doc.accounts[''].characters[cKey]
        if (!Object.keys(doc.accounts[''].characters).length && !doc.accounts[''].family) delete doc.accounts['']
      }
    }
    this.write(doc)
    return doc
  }

  /**
   * Forget a character — or, with no character, an account's family vault. An account
   * left with nothing in it is removed too.
   */
  remove(accountName: string, character?: string): HoldingsDoc {
    const doc = this.read()
    const aKey = keyOf(label(accountName))
    const account = doc.accounts[aKey]
    if (!account) return doc
    if (character) delete account.characters[keyOf(label(character))]
    else delete account.family
    if (!Object.keys(account.characters).length && !account.family) delete doc.accounts[aKey]
    this.write(doc)
    return doc
  }
}
