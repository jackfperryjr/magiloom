import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tooltip } from '../ui/Tooltip'
import { useDetachedWindow } from '../../hooks/useDetachedWindow'
import { roomAtom } from '../../store/game'
import {
  invSnapshotAtom, invStatusAtom, invErrorAtom, invPendingAtom, refreshInventoryAtom,
} from '../../store/inventory'
import {
  type InvItem, type InvSnapshot, type InvSort, type InvSortKey, PLAYER, ROOM,
  isContainer, isClosed, weightOf, capacityOf, childrenOf,
  sortItems, isInvSort, DEFAULT_SORT, NATURAL_DIR,
} from '../../lib/inventory'
import { actionsFor, destinationsFor, putIn } from '../../lib/inventoryCommands'

/**
 * The interactive item manager: the character's whole item tree, navigable and
 * actionable, in a modal or popped out into its own window.
 *
 * The docked Inventory panel stays what it always was — the flat INV list — because
 * it is three inches wide and a tree needs room. This is the version with space.
 */

// ── Grouping ──────────────────────────────────────────────────────────────────
// Top-level items are bucketed by where they sit on the character; everything else
// hangs off its container. Order here is the order shown.
const GROUPS = [
  { id: 'held',   label: 'Held' },
  { id: 'worn',   label: 'Worn' },
  { id: 'feet',   label: 'At your feet' },
  { id: 'reserved', label: 'Reserved' },
  { id: 'ground', label: 'On the ground' },
] as const
type GroupId = typeof GROUPS[number]['id']

function groupOf(item: InvItem): GroupId | null {
  if (item.parent === ROOM) return 'ground'
  if (item.parent !== PLAYER) return null      // nested — shown under its container
  switch (item.relation) {
    case 'righthand': case 'lefthand': return 'held'
    case 'worn':      return 'worn'
    case 'atfeet':    return 'feet'
    case 'reserved':  return 'reserved'
    default:          return null
  }
}

function describeLocation(snapshot: InvSnapshot, item: InvItem): string {
  if (item.parent === ROOM) return 'On the ground.'
  if (item.parent === PLAYER) {
    switch (item.relation) {
      case 'worn':      return 'Worn.'
      case 'righthand': return 'In your right hand.'
      case 'lefthand':  return 'In your left hand.'
      case 'atfeet':    return 'At your feet.'
      case 'reserved':  return 'Reserved.'
      default:          return `${item.relation}.`
    }
  }
  const parent = snapshot.items.get(item.parent)
  const where  = item.relation === 'underneath' ? 'under' : item.relation
  return parent ? `${where.charAt(0).toUpperCase()}${where.slice(1)} ${parent.name}.` : 'Location unknown.'
}

/**
 * Raw weight carried inside each container, keyed by id.
 *
 * Computed once per snapshot by walking each item's ancestors, rather than
 * recursively per row — a pack rat's inventory renders hundreds of rows, and the
 * naive version re-walks the whole subtree for every container in every one.
 */
function containedWeights(snapshot: InvSnapshot): Map<string, number> {
  const totals = new Map<string, number>()
  for (const item of snapshot.items.values()) {
    const weight = Math.max(0, weightOf(item) ?? 0)
    if (weight === 0) continue
    const seen = new Set([item.id])
    let parent = item.parent
    while (parent !== PLAYER && parent !== ROOM) {
      if (seen.has(parent)) break
      seen.add(parent)
      totals.set(parent, (totals.get(parent) ?? 0) + weight)
      const next = snapshot.items.get(parent)
      if (!next) break
      parent = next.parent
    }
  }
  return totals
}

// ── Column meanings ───────────────────────────────────────────────────────────
// The server's numbers are unlabelled integers, so every place one is shown says
// what it is. Scale is still uncalibrated — see weightOf/capacityOf in lib/inventory.
const COLUMNS = {
  contents: { label: 'Items',  hint: 'How many items are directly inside this container.' },
  weight:   { label: 'Weight', hint: 'The item’s own weight, in the game’s raw units. “+N” is what it carries inside.' },
  capacity: { label: 'Holds',  hint: 'How much this container can hold, in the game’s raw units. Blank means it isn’t a container.' },
} as const

// ── Sorting ───────────────────────────────────────────────────────────────────
// Sorting reorders siblings and leaves the nesting alone (see sortItems), so these
// apply just as well to the cards, where the tree is implied rather than drawn.
const SORTS: { key: InvSortKey; label: string; hint: string }[] = [
  { key: 'location', label: 'Location', hint: 'The game’s own order — held, then worn, in the order it lists them.' },
  { key: 'name',     label: 'Name',     hint: 'By the item’s noun, so “a rugged brown backpack” files under B rather than A.' },
  { key: 'weight',   label: 'Weight',   hint: 'By the item’s own weight. Unknown weights sit at the bottom.' },
  { key: 'contents', label: 'Items',    hint: 'By how many things are directly inside. Anything that isn’t a container sits at the bottom.' },
  { key: 'capacity', label: 'Holds',    hint: 'By how much the container can hold. Anything that isn’t a container sits at the bottom.' },
]

const sortLabel = (key: InvSortKey): string => SORTS.find(s => s.key === key)?.label ?? key

const ariaSort = (sort: InvSort, key: InvSortKey): 'ascending' | 'descending' | 'none' =>
  sort.key !== key ? 'none' : sort.dir === 'asc' ? 'ascending' : 'descending'

/**
 * A column heading that sorts by its own column. The caret's space is held even when
 * the column isn't the active one, so switching columns doesn't shuffle the widths.
 */
function SortHeader({ sort, sortKey, label, hint, onSort }: {
  sort: InvSort; sortKey: InvSortKey; label: string; hint: string; onSort: (k: InvSortKey) => void
}) {
  const on = sort.key === sortKey
  return (
    <button
      className={'inv-mgr-sortbtn' + (on ? ' inv-mgr-sortbtn-on' : '')}
      data-tooltip={`${hint} Click to sort by this.`}
      onClick={() => onSort(sortKey)}
    >
      <span>{label}</span>
      <span className="inv-mgr-caret" aria-hidden="true">{on ? (sort.dir === 'asc' ? '▲' : '▼') : ''}</span>
    </button>
  )
}

function EyeIcon({ off = false }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  )
}

// ── Rows ──────────────────────────────────────────────────────────────────────
interface Row { item: InvItem; depth: number }

/** Flatten a container's subtree into rows, honouring collapse state and sort. */
function rowsUnder(snapshot: InvSnapshot, parentId: string, depth: number, collapsed: Set<string>, visible: Set<string> | null, sort: InvSort): Row[] {
  const out: Row[] = []
  for (const child of sortItems(snapshot, childrenOf(snapshot, parentId), sort)) {
    if (visible && !visible.has(child.id)) continue
    out.push({ item: child, depth })
    if (!collapsed.has(child.id)) out.push(...rowsUnder(snapshot, child.id, depth + 1, collapsed, visible, sort))
  }
  return out
}

/**
 * Items matching the filter, plus every container above them — a match three bags
 * deep is meaningless without the bags, and hiding them would make the tree lie
 * about where things are.
 */
function matchingIds(snapshot: InvSnapshot, filter: string): Set<string> | null {
  const needle = filter.trim().toLowerCase()
  if (!needle) return null
  const keep = new Set<string>()
  for (const item of snapshot.items.values()) {
    const haystack = `${item.name} ${item.long ?? ''}`.toLowerCase()
    if (!haystack.includes(needle)) continue
    keep.add(item.id)
    let parent = item.parent
    while (parent !== PLAYER && parent !== ROOM) {
      const next = snapshot.items.get(parent)
      if (!next || keep.has(next.id)) break
      keep.add(next.id)
      parent = next.parent
    }
  }
  return keep
}

// ── Layout preferences ────────────────────────────────────────────────────────
type ItemView = 'table' | 'cards'

interface ItemPrefs {
  view: ItemView; setView: (v: ItemView) => void
  sort: InvSort;  setSort: (s: InvSort) => void
}

/**
 * Remembers the chosen view and sort in global settings, not per character — which
 * layout someone finds readable is about them, not about who they're playing.
 *
 * Reads once on mount and writes through on change. The initial render uses the
 * defaults until the stored values arrive; that's a frame or two on open, and it
 * beats blocking the panel on a settings round-trip. The stored sort is validated
 * rather than trusted, since settings.json is a file a user can hand-edit.
 */
function useItemPrefs(): ItemPrefs {
  const [view, setView] = useState<ItemView>('table')
  const [sort, setSort] = useState<InvSort>(DEFAULT_SORT)

  useEffect(() => {
    let live = true
    window.dr?.settings?.getAll?.().then(all => {
      if (!live) return
      const savedView = all?.itemManagerView
      if (savedView === 'table' || savedView === 'cards') setView(savedView)
      const savedSort = all?.itemManagerSort
      if (isInvSort(savedSort)) setSort(savedSort)
    }).catch(() => { /* no stored preference — the defaults stand */ })
    return () => { live = false }
  }, [])

  return {
    view,
    setView: next => { setView(next); window.dr?.settings?.patch?.({ itemManagerView: next }) },
    sort,
    setSort: next => { setSort(next); window.dr?.settings?.patch?.({ itemManagerSort: next }) },
  }
}

// ── The view ──────────────────────────────────────────────────────────────────
function ItemManagerBody({ detached, onDetach, onAttach, onClose }: {
  detached: boolean; onDetach: () => void; onAttach: () => void; onClose: () => void
}) {
  const snapshot = useAtomValue(invSnapshotAtom)
  const status   = useAtomValue(invStatusAtom)
  const error    = useAtomValue(invErrorAtom)
  const pending  = useAtomValue(invPendingAtom)
  const room     = useAtomValue(roomAtom)
  const refresh  = useSetAtom(refreshInventoryAtom)

  const [filter, setFilter]       = useState('')
  const [selectedId, setSelected] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [hidden, setHidden]       = useState<Set<GroupId>>(new Set())
  const { view, setView, sort, setSort } = useItemPrefs()
  const [sent, setSent]           = useState('')
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Load on first open; a tree from a previous session is worth nothing.
  useEffect(() => {
    if (status === 'idle') refresh(false)
  }, [status, refresh])

  useEffect(() => () => { if (refreshTimer.current) clearTimeout(refreshTimer.current) }, [])

  const visible  = useMemo(() => (snapshot ? matchingIds(snapshot, filter) : null), [snapshot, filter])
  const carried  = useMemo(() => (snapshot ? containedWeights(snapshot) : new Map<string, number>()), [snapshot])
  const selected = selectedId && snapshot ? snapshot.items.get(selectedId) ?? null : null

  // The snapshot is a photograph taken in one room. Items on the ground belong to
  // that room, so once the character walks away it is describing somewhere else.
  // (Assumes the envelope's `room` uses the same numbering as <nav rm>; if this
  // reads stale while standing still, that assumption is what's wrong.)
  const movedOn = !!snapshot && !!room.uid && room.uid !== snapshot.room

  const run = (command: string): void => {
    window.dr?.game?.send(command)
    setSent(command)
    // Give the game a moment to apply it, then re-read rather than guessing what
    // changed — the server is the only honest source for where things ended up.
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => refresh(true), 700)
  }

  const toggle = (id: string): void => setCollapsed(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  // Every non-empty group, hidden or not — the toggles need counts for the ones
  // currently switched off, so hiding is applied at render, not here.
  const groups = useMemo(() => {
    if (!snapshot) return []
    return GROUPS.map(group => {
      // Sorting happens per group, so "heaviest first" ranks what you're wearing
      // against the rest of what you're wearing — not against a rock on the ground.
      const tops = [...snapshot.items.values()].filter(item => groupOf(item) === group.id)
      const rows: Row[] = []
      for (const item of sortItems(snapshot, tops, sort)) {
        if (visible && !visible.has(item.id)) continue
        rows.push({ item, depth: 0 })
        if (!collapsed.has(item.id)) rows.push(...rowsUnder(snapshot, item.id, 1, collapsed, visible, sort))
      }
      return { ...group, rows }
    }).filter(g => g.rows.length > 0)
  }, [snapshot, visible, collapsed, sort])

  const shown      = groups.filter(g => !hidden.has(g.id))
  const totalShown = shown.reduce((n, g) => n + g.rows.length, 0)

  // Picking a different key uses that key's natural direction — heaviest first, but
  // names A→Z; picking the current key again flips it. The select and the column
  // headers both come through here, so the two can never disagree.
  const chooseSort = (key: InvSortKey): void => setSort(
    key === sort.key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: NATURAL_DIR[key] },
  )

  const dirLabel =
    sort.key === 'location' ? (sort.dir === 'asc' ? 'Game order' : 'Reversed')
    : sort.key === 'name'   ? (sort.dir === 'asc' ? 'A → Z' : 'Z → A')
    : sort.dir === 'asc'    ? 'Lowest first' : 'Highest first'

  const toggleGroup = (id: GroupId): void => setHidden(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  return (
    <div className="inv-mgr">
      <header className="inv-mgr-head">
        <span className="inv-mgr-title">Items</span>
        {status === 'loading' && (
          <span className="inv-mgr-status">Loading{pending > 1 ? ` — ${pending} branches` : ''}…</span>
        )}
        {status === 'ready' && snapshot && (
          <span className="inv-mgr-status">
            {snapshot.items.size} items{movedOn ? ' — taken in another room' : ''}
          </span>
        )}
        <div className="inv-mgr-spacer" />
        <Tooltip text="Re-read the inventory from the game">
          <button className="inv-mgr-btn" onClick={() => refresh(true)} disabled={status === 'loading'}>Refresh</button>
        </Tooltip>
        <Tooltip text={detached ? 'Put it back in the main window' : 'Move this into its own window'}>
          <button className="inv-mgr-btn" onClick={detached ? onAttach : onDetach}>
            {detached ? 'Return' : 'Pop out'}
          </button>
        </Tooltip>
        <button className="modal-close" onClick={onClose} aria-label="Close items">×</button>
      </header>

      {error && (
        <div className="inv-mgr-error">
          <span>{error}</span>
          <button className="inv-mgr-btn" onClick={() => refresh(false)}>Try again</button>
        </div>
      )}

      <div className="inv-mgr-tools">
        <input
          className="inv-mgr-filter"
          placeholder="Filter items…"
          aria-label="Filter items"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        {filter && <span className="inv-mgr-count">{totalShown} shown</span>}
        <div className="inv-mgr-sort">
          <label className="inv-mgr-sort-label" htmlFor="inv-sort">Sort</label>
          <select
            id="inv-sort"
            className="inv-mgr-sort-select"
            value={sort.key}
            data-tooltip={SORTS.find(s => s.key === sort.key)?.hint}
            onChange={e => chooseSort(e.target.value as InvSortKey)}
          >
            {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <Tooltip text={`${dirLabel} — click to reverse`}>
            <button
              className="inv-mgr-sortdir"
              aria-label={`Sorted by ${sortLabel(sort.key).toLowerCase()}, ${dirLabel.toLowerCase()}. Reverse.`}
              onClick={() => chooseSort(sort.key)}
            >{sort.dir === 'asc' ? '↑' : '↓'}</button>
          </Tooltip>
        </div>
        <div className="inv-mgr-viewtoggle" role="group" aria-label="View">
          {(['table', 'cards'] as const).map(mode => (
            <button
              key={mode}
              className={'inv-mgr-viewbtn' + (view === mode ? ' inv-mgr-viewbtn-on' : '')}
              aria-pressed={view === mode}
              onClick={() => setView(mode)}
            >{mode === 'table' ? 'List' : 'Cards'}</button>
          ))}
        </div>
      </div>

      {groups.length > 0 && (
        <div className="inv-mgr-shelf" role="group" aria-label="Show or hide locations">
          {groups.map(group => {
            const off = hidden.has(group.id)
            return (
              <Tooltip key={group.id} text={`${off ? 'Show' : 'Hide'} ${group.label.toLowerCase()}`}>
                <button
                  className={'inv-mgr-chip' + (off ? ' inv-mgr-chip-off' : '')}
                  aria-pressed={!off}
                  onClick={() => toggleGroup(group.id)}
                >
                  <EyeIcon off={off} />
                  <span>{group.label}</span>
                  <span className="inv-mgr-chip-count">{group.rows.length}</span>
                </button>
              </Tooltip>
            )
          })}
        </div>
      )}

      <div className="inv-mgr-body">
        <div className="inv-mgr-tree">
          {!snapshot && status !== 'loading' && (
            <p className="panel-empty">Nothing loaded yet. Refresh to read your inventory.</p>
          )}
          {snapshot && groups.length === 0 && (
            <p className="panel-empty">{filter ? 'Nothing matches that.' : 'No items.'}</p>
          )}
          {snapshot && groups.length > 0 && shown.length === 0 && (
            <p className="panel-empty">Every location is hidden. Use the buttons above to bring one back.</p>
          )}
          {shown.map(group => (
            <section key={group.id} className="inv-mgr-group">
              <h3 className="inv-mgr-group-name">{group.label}</h3>
              {view === 'table' ? (
                <table className="inv-mgr-table">
                  <thead>
                    <tr>
                      <th scope="col" className="inv-mgr-th-name" aria-sort={ariaSort(sort, 'name')}>
                        <SortHeader sort={sort} sortKey="name" label="Item" hint={SORTS[1].hint} onSort={chooseSort} />
                      </th>
                      {(['contents', 'weight', 'capacity'] as const).map(key => (
                        <th key={key} scope="col" className="inv-mgr-th-num" aria-sort={ariaSort(sort, key)}>
                          <SortHeader
                            sort={sort}
                            sortKey={key}
                            label={COLUMNS[key].label}
                            hint={COLUMNS[key].hint}
                            onSort={chooseSort}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.rows.map(({ item, depth }) => {
                      const container = isContainer(item)
                      const kids      = container ? childrenOf(snapshot!, item.id).length : 0
                      const inside    = carried.get(item.id) ?? 0
                      return (
                        <tr
                          key={item.id}
                          className={'inv-mgr-row' + (item.id === selectedId ? ' inv-mgr-row-on' : '')}
                          onClick={() => setSelected(item.id)}
                        >
                          <td className="inv-mgr-cell-name" style={{ paddingLeft: 6 + depth * 14 }}>
                            {container && kids > 0 ? (
                              <button
                                className="inv-mgr-twist"
                                aria-label={collapsed.has(item.id) ? 'Expand' : 'Collapse'}
                                onClick={e => { e.stopPropagation(); toggle(item.id) }}
                              >{collapsed.has(item.id) ? '▸' : '▾'}</button>
                            ) : <span className="inv-mgr-twist-gap" />}
                            <span className="inv-mgr-name">{item.name}</span>
                            {isClosed(item) && <span className="inv-mgr-tag">closed</span>}
                            {item.locker && <span className="inv-mgr-tag">locker</span>}
                          </td>
                          <td className="inv-mgr-cell-num">{container ? kids : ''}</td>
                          <td className="inv-mgr-cell-num">
                            {weightOf(item) ?? '—'}
                            {inside > 0 ? <span className="inv-mgr-sub"> +{inside}</span> : null}
                          </td>
                          <td className="inv-mgr-cell-num">{capacityOf(item) ?? '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="inv-mgr-cards">
                  {group.rows.map(({ item, depth }) => (
                    <ItemCard
                      key={item.id}
                      snapshot={snapshot!}
                      item={item}
                      depth={depth}
                      carried={carried.get(item.id) ?? 0}
                      selected={item.id === selectedId}
                      onSelect={() => setSelected(item.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>

        <aside className="inv-mgr-detail">
          {!selected ? (
            <p className="panel-empty">Select an item.</p>
          ) : (
            <>
              <h3 className="inv-mgr-detail-name">{selected.name}</h3>
              {selected.long && selected.long !== selected.name && (
                <p className="inv-mgr-detail-long">{selected.long}</p>
              )}
              <p className="inv-mgr-detail-where">{describeLocation(snapshot!, selected)}</p>
              <dl className="inv-mgr-facts">
                <div>
                  <dt data-tooltip={COLUMNS.weight.hint}>{COLUMNS.weight.label}</dt>
                  <dd>
                    {weightOf(selected) ?? 'unknown'}
                    {(carried.get(selected.id) ?? 0) > 0 && (
                      <span className="inv-mgr-sub"> +{carried.get(selected.id)} inside</span>
                    )}
                  </dd>
                </div>
                {isContainer(selected) && (
                  <>
                    <div>
                      <dt data-tooltip={COLUMNS.capacity.hint}>{COLUMNS.capacity.label}</dt>
                      <dd>{capacityOf(selected) ?? '—'}</dd>
                    </div>
                    <div>
                      <dt data-tooltip={COLUMNS.contents.hint}>{COLUMNS.contents.label}</dt>
                      <dd>{childrenOf(snapshot!, selected.id).length}</dd>
                    </div>
                  </>
                )}
              </dl>
              <p className="inv-mgr-units">
                Weight and capacity are the game's own numbers, in units we haven't pinned down yet —
                useful for comparing items, not yet for reading as pounds.
              </p>

              <div className="inv-mgr-actions">
                {actionsFor(snapshot!, selected).map(action => (
                  <Tooltip key={action.id} text={action.disabled ?? action.command}>
                    <button
                      className="inv-mgr-btn"
                      disabled={!!action.disabled}
                      onClick={() => run(action.command)}
                    >{action.label}</button>
                  </Tooltip>
                ))}
              </div>

              <PutInPicker snapshot={snapshot!} item={selected} onRun={run} />

              {sent && <p className="inv-mgr-sent">Sent <code>{sent}</code></p>}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

/**
 * One item as a tile. Nesting can't be shown by indentation in a grid, so a card
 * carries its container's name instead — otherwise two identical rings in different
 * pouches would be indistinguishable.
 */
function ItemCard({ snapshot, item, depth, carried, selected, onSelect }: {
  snapshot: InvSnapshot; item: InvItem; depth: number; carried: number
  selected: boolean; onSelect: () => void
}) {
  const container = isContainer(item)
  const kids      = container ? childrenOf(snapshot, item.id).length : 0
  const parent    = depth > 0 ? snapshot.items.get(item.parent) : undefined

  return (
    <button
      className={'inv-mgr-card' + (selected ? ' inv-mgr-card-on' : '')}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className="inv-mgr-card-name">{item.name}</span>
      {parent && <span className="inv-mgr-card-where">in {parent.name}</span>}
      <span className="inv-mgr-card-tags">
        {isClosed(item) && <span className="inv-mgr-tag">closed</span>}
        {item.locker && <span className="inv-mgr-tag">locker</span>}
      </span>
      <span className="inv-mgr-card-stats">
        {container && (
          <span className="inv-mgr-card-stat" data-tooltip={COLUMNS.contents.hint}>
            <span className="inv-mgr-card-stat-label">{COLUMNS.contents.label.toLowerCase()}:</span>
            <b>{kids}</b>
          </span>
        )}
        <span className="inv-mgr-card-stat" data-tooltip={COLUMNS.weight.hint}>
          <span className="inv-mgr-card-stat-label">{COLUMNS.weight.label.toLowerCase()}:</span>
          <b>{weightOf(item) ?? '—'}{carried > 0 ? `+${carried}` : ''}</b>
        </span>
        {container && (
          <span className="inv-mgr-card-stat" data-tooltip={COLUMNS.capacity.hint}>
            <span className="inv-mgr-card-stat-label">{COLUMNS.capacity.label.toLowerCase()}:</span>
            <b>{capacityOf(item) ?? '—'}</b>
          </span>
        )}
      </span>
    </button>
  )
}

/** Destination picker for a single put. One command, chosen explicitly. */
function PutInPicker({ snapshot, item, onRun }: {
  snapshot: InvSnapshot; item: InvItem; onRun: (cmd: string) => void
}) {
  const [target, setTarget] = useState('')
  const options = useMemo(() => destinationsFor(snapshot, item), [snapshot, item])
  if (options.length === 0) return null

  const chosen = options.find(o => o.id === target)
  return (
    <div className="inv-mgr-put">
      <label className="inv-mgr-put-label" htmlFor="inv-put-target">Put in</label>
      <select
        id="inv-put-target"
        className="inv-mgr-put-select"
        value={target}
        onChange={e => setTarget(e.target.value)}
      >
        <option value="">Choose a container…</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <Tooltip text={chosen ? putIn(item, chosen) : 'Choose a container first'}>
        <button
          className="inv-mgr-btn"
          disabled={!chosen}
          onClick={() => chosen && onRun(putIn(item, chosen))}
        >Put</button>
      </Tooltip>
      <p className="inv-mgr-put-note">
        One command — the game may want the item in hand first.
      </p>
    </div>
  )
}

// ── Shell: modal, or its own window ───────────────────────────────────────────
export function ItemManager({ onClose }: { onClose: () => void }) {
  const [detached, setDetached] = useState(false)
  const host = useDetachedWindow(detached, {
    title: 'Lantern — Items',
    onClose: () => setDetached(false),
  })

  const body = (
    <ItemManagerBody
      detached={detached}
      onDetach={() => setDetached(true)}
      onAttach={() => setDetached(false)}
      onClose={onClose}
    />
  )

  if (detached) return host ? createPortal(body, host) : null

  return createPortal(
    <div
      className="inv-mgr-backdrop"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="inv-mgr-modal">{body}</div>
    </div>,
    document.body,
  )
}
