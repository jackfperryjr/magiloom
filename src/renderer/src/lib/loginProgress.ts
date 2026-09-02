/**
 * Login progress, read off the connection log.
 *
 * The connecting screen used to print that log verbatim — Lich's stdout, the
 * socket's own notices, the FE handshake. It's the right thing to have when a
 * login fails and the wrong thing to stare at when one works, so the screen now
 * shows a progress bar and keeps the log for when it's actually needed.
 *
 * The stages are inferred from the log lines rather than reported by the main
 * process, because those lines are already emitted, already ordered, and already
 * cover both paths (with Lich and straight to the game). The strings matched here
 * are the ones emitted in src/main/game-connection.ts and src/main/lich-manager.ts
 * — if those are reworded, loginProgress.test.ts is where it shows up.
 */

export type LoginStage = 'starting' | 'lich' | 'connecting' | 'handshake' | 'entering'

export interface LoginProgress {
  stage: LoginStage
  /** What to tell the player we're doing. */
  label: string
  /** 0–1, for the bar. Never reaches 1 on its own: entering the game unmounts the screen. */
  value: number
}

const STAGES: Record<LoginStage, { label: string; value: number }> = {
  starting:   { label: 'Starting up…',              value: 0.08 },
  lich:       { label: 'Launching Lich…',           value: 0.28 },
  connecting: { label: 'Reaching DragonRealms…',    value: 0.55 },
  handshake:  { label: 'Signing in to the game…',   value: 0.82 },
  entering:   { label: 'Entering Elanthia…',        value: 1 },
}

const ORDER: LoginStage[] = ['starting', 'lich', 'connecting', 'handshake', 'entering']

/** Which stage a single log line announces, if any. */
function stageOfLine(line: string): LoginStage | null {
  // "Connected to …" must be tested before "Attempting to connect to …": both
  // mention connecting, and only the first means the socket is actually open.
  if (/Connected to /i.test(line)) return 'handshake'
  if (/Attempting to connect to /i.test(line)) return 'connecting'
  if (/Launching Lich/i.test(line)) return 'lich'
  return null
}

/**
 * The furthest stage the log has reached. Monotonic on purpose: Lich retries the
 * socket while it binds its port, so "Attempting to connect" can arrive after
 * "Connected" and the bar must not walk backwards.
 */
export function loginProgress(lines: readonly string[]): LoginProgress {
  let furthest = 0
  for (const line of lines) {
    const stage = stageOfLine(line)
    if (stage) furthest = Math.max(furthest, ORDER.indexOf(stage))
  }
  const stage = ORDER[furthest]
  return { stage, ...STAGES[stage] }
}

/**
 * How long one stage may sit before the screen admits it's slow. Only the wording
 * of the label changes — the log itself is never shown on the login card.
 */
export const STALL_MS = 15_000
