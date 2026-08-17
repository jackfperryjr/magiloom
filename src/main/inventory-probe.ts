import { app } from 'electron'
import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

/**
 * Dev-only probe for the game's structured-inventory commands.
 *
 * The server has an undocumented `_inventory manager <id>` that answers with the
 * character's whole item tree as XML (`<inventoryManager>` wrapping one `<i/>` per
 * item), and `_inventory viewitem <id> <exist>` for a single item's detail. Neither
 * tag means anything to sge-parser, which silently ignores tags it doesn't know —
 * so typing the command in-game produces *no visible output whether it worked or
 * not*. That ambiguity is the whole reason this exists.
 *
 * On a matching command it opens a capture window and dumps every raw byte the
 * socket delivers for the next few seconds, verbatim, to
 * `<userData>/logs/inventory-probe.log`. That catches the success case (the XML)
 * and both failure cases (a plain-text "I could not find..." refusal, or dead
 * silence) with equal clarity.
 *
 * Off in packaged builds unless MAGILOOM_INVENTORY_PROBE=1. Delete this file and
 * its two listeners in index.ts once the question is settled.
 */

const WINDOW_MS = 8000            // how long to capture after a probe command
const MAX_BYTES = 512 * 1024      // hard cap, in case a window opens during a flood

export const inventoryProbeEnabled =
  !app.isPackaged || process.env.MAGILOOM_INVENTORY_PROBE === '1'

let capturing  = false
let captured   = ''
let sentCmd    = ''
let sentAt     = 0
let timer: ReturnType<typeof setTimeout> | null = null

function logFile(): string {
  const dir = join(app.getPath('userData'), 'logs')
  try { mkdirSync(dir, { recursive: true }) } catch { /* fall through to append error */ }
  return join(dir, 'inventory-probe.log')
}

function write(text: string): void {
  try { appendFileSync(logFile(), text, 'utf8') } catch { /* a probe must never break the session */ }
}

function closeWindow(): void {
  if (!capturing) return
  if (timer) { clearTimeout(timer); timer = null }
  capturing = false

  const elapsed  = Date.now() - sentAt
  const sawTree  = captured.includes('<inventoryManager')
  const sawItem  = captured.includes('<inventoryViewItem')
  const verdict  = sawTree ? 'GOT <inventoryManager>'
                 : sawItem ? 'GOT <inventoryViewItem>'
                 : captured.trim() ? 'no inventory XML — see the raw bytes above'
                 : 'NOTHING received'
  const summary  = `--- ${verdict} (${captured.length} bytes in ${elapsed}ms) ---`

  write(captured + '\n' + summary + '\n\n')
  console.log(`[inventory-probe] "${sentCmd}" → ${verdict}`)

  captured = ''
}

/** Hook for GameConnection's 'sent'. Opens a window on `_inventory …`, ignores everything else. */
export function probeSent(cmd: string): void {
  if (!inventoryProbeEnabled) return
  if (!/^\s*_inventory\b/i.test(cmd)) return

  closeWindow()   // a second probe before the first window expires closes it out first

  capturing = true
  captured  = ''
  sentCmd   = cmd.trim()
  sentAt    = Date.now()
  timer     = setTimeout(closeWindow, WINDOW_MS)

  write(`\n=== ${new Date().toISOString()}  SENT: ${sentCmd} ===\n`)
  console.log(`[inventory-probe] sent "${sentCmd}" — capturing ${WINDOW_MS}ms → ${logFile()}`)
}

/** Hook for GameConnection's 'raw'. Only accumulates while a window is open. */
export function probeRaw(chunk: string): void {
  if (!capturing) return
  captured += chunk
  if (captured.length >= MAX_BYTES) closeWindow()
}
