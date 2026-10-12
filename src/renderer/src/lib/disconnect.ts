// ── Why did the connection drop, and should we try to get it back? ──────────────
// Neither the desktop main process nor the server says why a game socket closed —
// both just report "disconnected". Everything that ends a session on purpose starts
// in the renderer, though (the Disconnect menu item, a new login from the connect
// overlay, a QUIT typed at the command line), so the cause is worked out here by
// elimination: if none of those is behind a drop, the other end closed it.
//
// Pure, so the wording and the reconnect policy can be tested without a socket.

export type DropCause =
  | 'user'     // Disconnect was chosen from the character menu
  | 'quit'     // QUIT / EXIT was sent just before the game closed the session
  | 'switch'   // the connect / switch-character overlay started a new login
  | 'link'     // web: the session was gone when the link to the Magiloom server came back
  | 'error'    // the socket failed (reset, timeout, …)
  | 'remote'   // closed cleanly from the other end

export interface DropContext {
  /** Disconnect was requested from this window. */
  userRequested: boolean
  /** The connect / switch-character overlay is open and driving a login. */
  loginOpen: boolean
  /** The last command sent to the game, and how long ago (ms). */
  lastSent: string
  lastSentAgoMs: number
  /** Socket error text, when the drop was reported as an error. */
  error?: string
  /** Web: ms since the link to the Magiloom server was RE-opened; absent on desktop. */
  linkReopenedAgoMs?: number
  /** The session runs through Lich, so "the other end" may be Lich, not the game. */
  viaLich: boolean
}

export interface Drop { cause: DropCause; note: string }

// The game closes the socket within a second or two of QUIT; anything older is an
// unrelated command that just happens to be the last one sent.
const QUIT_WINDOW_MS = 15_000
// A fresh server session announces "disconnected" as soon as the link re-attaches.
const LINK_WINDOW_MS = 5_000

const ERROR_TEXT: Record<string, string> = {
  ECONNRESET:   'connection reset',
  ECONNABORTED: 'connection aborted',
  ETIMEDOUT:    'connection timed out',
  EPIPE:        'connection broken',
  ENETUNREACH:  'network unreachable',
  EHOSTUNREACH: 'host unreachable',
  ENETDOWN:     'network down',
  ENOTFOUND:    'server not found',
  EAI_AGAIN:    'DNS lookup failed',
  ECONNREFUSED: 'connection refused',
}

/** "read ECONNRESET" → "connection reset (ECONNRESET)"; unknown text passes through. */
export function describeSocketError(message: string): string {
  const code = /\b(E[A-Z_]{3,})\b/.exec(message)?.[1]
  if (code && ERROR_TEXT[code]) return `${ERROR_TEXT[code]} (${code})`
  return message.trim() || 'unknown error'
}

export function classifyDrop(ctx: DropContext): Drop {
  if (ctx.userRequested) return { cause: 'user', note: 'You disconnected' }
  if (ctx.loginOpen)     return { cause: 'switch', note: 'Closed for a new login' }
  const quit = /^\s*(quit|exit)\s*$/i.exec(ctx.lastSent)
  if (quit && ctx.lastSentAgoMs <= QUIT_WINDOW_MS) {
    return { cause: 'quit', note: `Logged out: ${quit[1].toUpperCase()} was sent` }
  }
  if (ctx.linkReopenedAgoMs !== undefined && ctx.linkReopenedAgoMs <= LINK_WINDOW_MS) {
    return { cause: 'link', note: 'Session ended while the link to the Magiloom server was down' }
  }
  if (ctx.error) return { cause: 'error', note: 'Connection lost: ' + describeSocketError(ctx.error) }
  return { cause: 'remote', note: ctx.viaLich ? 'Closed by the game server or Lich' : 'Closed by the game server' }
}

/** Only a drop nobody here asked for is worth trying to undo. */
export const shouldReconnect = (cause: DropCause): boolean =>
  cause === 'link' || cause === 'error' || cause === 'remote'

export const RECONNECT_ATTEMPTS = 3
export const RECONNECT_GAP_MS   = 10_000

/**
 * How many automatic reconnects are left.
 *
 * Deliberately NOT refilled by a reconnect succeeding — only by the player sending a
 * command (or signing in by hand). Otherwise a session the game keeps closing would
 * be reopened for ever: a character logged in from somewhere else would fight that
 * login indefinitely, and an idle character would be put back every time the game
 * timed it out, which is exactly what its idle timeout exists to prevent. With no one
 * at the keyboard the total is three, then it stays down.
 */
export class ReconnectBudget {
  private left = RECONNECT_ATTEMPTS
  get remaining(): number { return this.left }
  /** The attempt about to be made, 1-based. */
  get attempt(): number { return RECONNECT_ATTEMPTS - this.left + 1 }
  take(): boolean {
    if (this.left <= 0) return false
    this.left--
    return true
  }
  refill(): void { this.left = RECONNECT_ATTEMPTS }
}

/** One per window — each window is one character's session. */
export const reconnectBudget = new ReconnectBudget()
