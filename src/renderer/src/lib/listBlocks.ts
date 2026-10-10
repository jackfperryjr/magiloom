/**
 * Item lists in the game output that get a one-click "copy" button: INVENTORY LIST
 * and the vault reports (VAULT STANDARD / VAULT FAMILY).
 *
 * Like the EXP readout's button, these are recognised ONE LINE AT A TIME. A rendered
 * line can't ask what came before it without giving up its memo, so there is no
 * "start of list" state here: a row is a list row because of what it is, and the
 * button reads the run of neighbouring rows back off the DOM when it is clicked.
 *
 * What each row looks like on the wire:
 *
 *   INVENTORY LIST — one link per row. A worn item is `remove #id`; anything inside
 *   a container is `get #id in #id`, with one more ` in #id` per level down:
 *       <d cmd='remove #52110553'>a rugged brown backpack</d>
 *          -<d cmd='get #52110571 in #52110553'>a vial of ithor potion</d>
 *
 *   VAULT — a monospaced, numbered row, indented by its depth:
 *            (6)  a mottled green leather weapon harness
 *                 (7)  a steel throwing hammer with a tempered head
 *
 * Pure (no React, no DOM) so the recognisers can be tested against real captures.
 */

export type ListKind = 'inv' | 'vault'

interface ListLine {
  text:    string
  links?:  { text: string; cmd: string }[]
  styles?: { preset?: string }[]
}

const INV_CMD_RE   = /^(?:remove #\d+|get #\d+((?: in #\d+)+))$/
const VAULT_ROW_RE = /^\s+\(\d+\)\s+\S/

/** How many containers deep an inventory row is: 0 for a worn item. */
function invDepth(cmd: string): number {
  const m = INV_CMD_RE.exec(cmd)
  return m?.[1] ? m[1].split(' in ').length - 1 : 0
}

/** Which list, if any, this output line is a row of. */
export function listLineKind(line: ListLine): ListKind | null {
  const link = line.links?.length === 1 ? line.links[0] : null
  // The row must be the item and nothing else. LOOK IN a container also carries
  // `get #id in #id` links, but as one sentence holding many of them.
  if (link && INV_CMD_RE.test(link.cmd) && line.text.trim().replace(/^-/, '') === link.text) return 'inv'
  if (!line.links?.length && line.styles?.some(s => s.preset === 'mono') && VAULT_ROW_RE.test(line.text)) return 'vault'
  return null
}

/**
 * A row's text as it should be copied.
 *
 * A vault row is copied as sent. An inventory row is REBUILT: the parser keeps a
 * tagged line's text but not the spaces in front of it, so on the way in every row
 * has lost its indent and the nesting with it. The depth is still there in the link
 * (see invDepth), so the row is laid out again the way the game prints it — two
 * spaces for a worn item, three more and a dash for each level inside it.
 */
export function listRowText(kind: ListKind, line: ListLine): string {
  if (kind === 'vault') return line.text.replace(/\s+$/, '')
  const link  = line.links![0]
  const depth = invDepth(link.cmd)
  return depth === 0 ? `  ${link.text}` : `${' '.repeat(2 + 3 * depth)}-${link.text}`
}

/**
 * The rows of one list as a block to paste: the indent every row shares is removed,
 * so the list starts at the margin and only the nesting is left.
 */
export function listBlockText(rows: string[]): string {
  const indents = rows.filter(r => r.trim()).map(r => r.length - r.trimStart().length)
  const shared  = indents.length ? Math.min(...indents) : 0
  return rows.map(r => r.slice(shared)).join('\n')
}
