import { type InvItem, type InvSnapshot, isContainer, isClosed, isFixed, pathTo } from './inventory'

/**
 * The game commands the item manager can issue, and the rules for when each is
 * offered.
 *
 * Every action is ONE command whose text is shown to the user before it goes out.
 * That is deliberate: items are addressed as `#<exist id>`, a form we've confirmed
 * the server accepts for the inventory walk but not yet for each of these verbs, so
 * a wrong guess should be visible and fixable in one place rather than silently
 * doing nothing. If a verb turns out to need different phrasing, it changes here.
 *
 * Multi-step transfers (empty a hand, unzip nested containers, put the item away,
 * put everything back) are NOT built here. Those need the hand-tracking state
 * machine to be safe, and that waits on live testing.
 */

export interface InvAction {
  id:      string
  label:   string
  command: string
  /** Why it's unavailable, when it is. */
  disabled?: string
}

export const lookAt   = (item: InvItem): string => `look at #${item.id}`
export const lookIn   = (item: InvItem): string => `look in #${item.id}`
export const openIt   = (item: InvItem): string => `open #${item.id}`
export const closeIt  = (item: InvItem): string => `close #${item.id}`
export const getIt    = (item: InvItem): string => `get #${item.id}`
export const dropIt   = (item: InvItem): string => `drop #${item.id}`
export const wearIt   = (item: InvItem): string => `wear #${item.id}`
export const removeIt = (item: InvItem): string => `remove #${item.id}`

/**
 * Where to put an item. The relation follows what the destination can actually hold:
 * DragonRealms says "under", not "underneath".
 */
export function putIn(item: InvItem, target: InvItem, relation: 'in' | 'on' = 'in'): string {
  return `put #${item.id} ${relation} #${target.id}`
}

const held = (i: InvItem): boolean => i.relation === 'righthand' || i.relation === 'lefthand'

/** The actions offered for one item, in the order they should be shown. */
export function actionsFor(snapshot: InvSnapshot, item: InvItem): InvAction[] {
  const out: InvAction[] = []
  const buried = pathTo(snapshot, item).some(isClosed)
  const stuck  = isFixed(item) ? 'The game reports this cannot be picked up.' : undefined
  const shut   = buried ? 'A container on the way to it is closed.' : undefined

  out.push({ id: 'look', label: 'Look', command: lookAt(item), disabled: shut })

  if (isContainer(item)) {
    out.push({ id: 'lookin', label: 'Look in', command: lookIn(item), disabled: shut })
    out.push(isClosed(item)
      ? { id: 'open',  label: 'Open',  command: openIt(item),  disabled: shut }
      : { id: 'close', label: 'Close', command: closeIt(item), disabled: shut })
  }

  if (item.relation === 'worn') {
    out.push({ id: 'remove', label: 'Remove', command: removeIt(item), disabled: stuck })
  } else if (held(item)) {
    out.push({ id: 'wear', label: 'Wear', command: wearIt(item), disabled: stuck })
    out.push({ id: 'drop', label: 'Drop', command: dropIt(item), disabled: stuck })
  } else {
    out.push({ id: 'get', label: 'Get', command: getIt(item), disabled: stuck ?? shut })
  }

  return out
}

/**
 * Containers this item could be put into: anything with capacity, minus itself, its
 * own descendants (a bag can't go inside itself), and anything shut or buried.
 */
export function destinationsFor(snapshot: InvSnapshot, item: InvItem): InvItem[] {
  const out: InvItem[] = []
  for (const candidate of snapshot.items.values()) {
    if (candidate.id === item.id)      continue
    if (!isContainer(candidate))       continue
    if (isClosed(candidate))           continue
    if (candidate.parent === item.id)  continue
    if (pathTo(snapshot, candidate).some(c => c.id === item.id || isClosed(c))) continue
    out.push(candidate)
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}
