import { useAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../ui/Tooltip'
import { useDetachedWindow } from '../../hooks/useDetachedWindow'
import { holdingsAtom } from '../../store/holdings'
import {
  holdingsView, searchSnapshot, ageLabel, holdingsText, holdingsFileName,
  type HoldingsSection, type HoldingsAccountView, type HoldingMatch,
} from '../../lib/holdings'

/**
 * Account inventory: what every character was last seen holding, in one place.
 *
 * It answers one question — "who has the thing?" — so it is a list and a search box,
 * and nothing in it acts on the game. The item manager is the tool for the character
 * you are playing; this is the one for the characters you aren't.
 *
 * Everything shown is a REPORT a character ran (INVENTORY LIST, VAULT STANDARD,
 * VAULT FAMILY), kept as it was. Nothing is fetched to fill this in — those commands
 * cost roundtime, and a vault report a runner — so each list says how old it is.
 */

/** One collapsible entry: a character, or an account's family vault. */
interface Entry {
  key:      string
  account:  string
  /** The character to forget; undefined for a family vault. */
  character?: string
  title:    string
  note?:    string
  sections: HoldingsSection[]
}

function entriesOf(account: HoldingsAccountView): Entry[] {
  const out: Entry[] = account.characters.map(c => ({
    key: `${account.name}/${c.name}`, account: account.name, character: c.name,
    title: c.name, sections: c.sections,
  }))
  if (account.family) {
    out.push({
      key: `${account.name}//family`, account: account.name,
      title: 'Family vault',
      note: account.family.snapshot.by ? `seen by ${account.family.snapshot.by}` : undefined,
      sections: [account.family],
    })
  }
  return out
}

/**
 * Hand the browser a text file to save. The anchor is made in the MAIN document even
 * when this is showing in a popped-out window: a download belongs to the page that
 * started it, and the pop-out is an about:blank with no origin of its own to own one.
 */
function saveText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const plural  = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`
const matchCount = (n: number): string => `${n} match${n === 1 ? '' : 'es'}`

function HoldingsBody({ charName, detached, onDetach, onAttach, onClose }: {
  charName: string; detached: boolean; onDetach: () => void; onAttach: () => void; onClose: () => void
}) {
  const [doc, setDoc] = useAtom(holdingsAtom)
  const [query, setQuery]   = useState('')
  const [open, setOpen]     = useState<Set<string>>(new Set())
  const [forget, setForget] = useState<string | null>(null)
  const [error, setError]   = useState('')
  // Ages are to the minute; a slow tick keeps them honest while the window sits open.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  // The store only pushes changes made in THIS process. On the desktop another
  // character's window is another process, so re-read whenever this opens.
  useEffect(() => {
    window.dr.holdings.get().then(setDoc).catch(() => {
      // The web client can be newer than the server it reaches. Say so rather than
      // show an empty list that looks like nothing was ever recorded.
      setError('Account inventory is not available from this server yet.')
    })
  }, [setDoc])

  const accounts  = useMemo(() => holdingsView(doc, charName), [doc, charName])
  const entries   = useMemo(() => accounts.flatMap(entriesOf), [accounts])
  const searching = query.trim() !== ''
  const matches = useMemo(() => {
    const map = new Map<string, { section: HoldingsSection; hits: HoldingMatch[] }[]>()
    if (!searching) return map
    for (const e of entries) {
      const found = e.sections
        .map(section => ({ section, hits: searchSnapshot(section.snapshot, query) }))
        .filter(f => f.hits.length > 0)
      if (found.length) map.set(e.key, found)
    }
    return map
  }, [entries, query, searching])

  const totalItems = entries.reduce((n, e) => n + e.sections.reduce((m, s) => m + s.snapshot.items.length, 0), 0)
  const totalHits  = [...matches.values()].reduce((n, f) => n + f.reduce((m, x) => m + x.hits.length, 0), 0)
  const people     = entries.filter(e => e.character).length

  const toggle = (key: string): void => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Saved copies are of what is RECORDED, never of a search: a file holding only the
  // matches would look like a character's whole list and be missing most of it.
  const downloadAll = (): void => saveText(holdingsFileName('', Date.now()), holdingsText(accounts, Date.now()))
  const downloadOne = (e: Entry): void => {
    const only = accounts.filter(a => a.name === e.account).map(a => e.character
      ? { ...a, family: undefined, characters: a.characters.filter(c => c.name === e.character) }
      : { ...a, characters: [] })
    const who = e.character ?? `family vault ${e.account}`
    saveText(holdingsFileName(who, Date.now()), holdingsText(only, Date.now()))
  }

  const doForget = async (e: Entry): Promise<void> => {
    setForget(null)
    try { setDoc(await window.dr.holdings.remove(e.account, e.character)); setError('') }
    catch (err) { setError(String(err instanceof Error ? err.message : err)) }
  }

  return (
    <div className="inv-mgr hold">
      <header className="inv-mgr-head">
        <span className="inv-mgr-title">Account inventory</span>
        <span className="inv-mgr-status">
          {entries.length === 0 ? '' : `${plural(people, 'character')} — ${plural(totalItems, 'item')}`}
        </span>
        <div className="inv-mgr-spacer" />
        <Tooltip text="Save every character's lists as a text file">
          <button className="inv-mgr-btn" onClick={downloadAll} disabled={entries.length === 0}>Download all</button>
        </Tooltip>
        <Tooltip text={detached ? 'Put it back in the main window' : 'Move this into its own window'}>
          <button className="inv-mgr-btn" onClick={detached ? onAttach : onDetach}>
            {detached ? 'Return' : 'Pop out'}
          </button>
        </Tooltip>
        <button className="modal-close" onClick={onClose} aria-label="Close account inventory">×</button>
      </header>

      <div className="hold-search">
        <input
          className="inv-mgr-filter"
          type="text"
          autoFocus
          spellCheck={false}
          aria-label="Search every character's items"
          placeholder="Search every character's items"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && query) { e.stopPropagation(); setQuery('') } }}
        />
        {searching && (
          <span className="inv-mgr-count">
            {totalHits === 0 ? 'No matches' : matchCount(totalHits)}
          </span>
        )}
      </div>

      {error && <div className="inv-mgr-error"><span>{error}</span></div>}

      <div className="hold-body">
        {entries.length === 0 && (
          <div className="hold-empty">
            <p>Nothing recorded yet.</p>
            <p>
              Type <code>INV LIST</code> or <code>VAULT STANDARD</code> on a character and what it
              reports is kept here, for every character to look up. <code>VAULT FAMILY</code> is
              kept once per game account.
            </p>
            <p>Nothing is requested for you — each list is as recent as the last time you ran it.</p>
          </div>
        )}

        {accounts.map(account => {
          const shown = entriesOf(account).filter(e => !searching || matches.has(e.key))
          if (shown.length === 0) return null
          return (
            <section key={account.name || '(none)'} className="hold-account">
              <h3 className="hold-account-name">{account.name || 'Account not recorded'}</h3>
              {shown.map(e => {
                const isOpen = searching || open.has(e.key)
                const count  = e.sections.reduce((n, s) => n + s.snapshot.items.length, 0)
                const mine   = e.character?.toLowerCase() === charName.toLowerCase()
                return (
                  <div key={e.key} className={'hold-entry' + (isOpen ? ' open' : '') + (mine ? ' hold-entry-mine' : '')}>
                    <div className="hold-entry-head">
                      <button
                        className="hold-entry-toggle"
                        aria-expanded={isOpen}
                        disabled={searching}
                        onClick={() => toggle(e.key)}
                      >
                        <span className="hold-chevron" aria-hidden="true">›</span>
                        <span className="hold-entry-name">{e.title}</span>
                        {mine && <span className="hold-tag">playing</span>}
                        {e.note && <span className="hold-entry-note">{e.note}</span>}
                        <span className="hold-entry-count">
                          {searching
                            ? matchCount(matches.get(e.key)!.reduce((n, f) => n + f.hits.length, 0))
                            : plural(count, 'item')}
                        </span>
                      </button>
                      <Tooltip text={e.character ? `Save ${e.character}'s lists as a text file` : 'Save this family vault as a text file'}>
                        <button className="inv-mgr-btn hold-row-btn" onClick={() => downloadOne(e)}>Download</button>
                      </Tooltip>
                      {forget === e.key ? (
                        <span className="hold-confirm">
                          <button className="inv-mgr-btn hold-danger" onClick={() => void doForget(e)}>Forget</button>
                          <button className="inv-mgr-btn" onClick={() => setForget(null)}>Keep</button>
                        </span>
                      ) : (
                        <Tooltip text={e.character ? `Remove ${e.character}'s lists from here` : 'Remove this family vault from here'}>
                          <button className="inv-mgr-btn hold-row-btn" onClick={() => setForget(e.key)}>Forget</button>
                        </Tooltip>
                      )}
                    </div>

                    {isOpen && !searching && e.sections.map(s => (
                      <div key={s.kind} className="hold-section">
                        <div className="hold-section-head">
                          <span>{s.label}</span>
                          <span className="hold-section-meta">
                            {plural(s.snapshot.items.length, 'item')} · {ageLabel(s.snapshot.at, now)}
                          </span>
                        </div>
                        {s.snapshot.items.length === 0
                          ? <div className="hold-none">Empty.</div>
                          : s.snapshot.items.map((item, i) => (
                              <div key={i} className="hold-item" style={{ paddingLeft: 10 + item.depth * 16 }}>
                                {item.name}
                              </div>
                            ))}
                      </div>
                    ))}

                    {searching && matches.get(e.key)!.map(({ section, hits }) => (
                      <div key={section.kind} className="hold-section">
                        <div className="hold-section-head">
                          <span>{section.label}</span>
                          <span className="hold-section-meta">{ageLabel(section.snapshot.at, now)}</span>
                        </div>
                        {hits.map((h, i) => (
                          <div key={i} className="hold-item hold-hit">
                            <span>{h.item.name}</span>
                            {h.within.length > 0 && <span className="hold-within">in {h.within.join(' › ')}</span>}
                          </div>
                        ))}
                      </div>
                    ))}
                  </div>
                )
              })}
            </section>
          )
        })}
      </div>
    </div>
  )
}

// ── Shell: modal, or its own window ───────────────────────────────────────────
export function HoldingsWindow({ charName, onClose }: { charName: string; onClose: () => void }) {
  const [detached, setDetached] = useState(false)
  const host = useDetachedWindow(detached, {
    title: 'Lantern — Account inventory',
    onClose: () => setDetached(false),
  })

  const body = (
    <HoldingsBody
      charName={charName}
      detached={detached}
      onDetach={() => setDetached(true)}
      onAttach={() => setDetached(false)}
      onClose={onClose}
    />
  )

  if (detached) return host ? createPortal(body, host) : null

  return createPortal(
    <div className="inv-mgr-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="inv-mgr-modal hold-modal">{body}</div>
    </div>,
    document.body,
  )
}
