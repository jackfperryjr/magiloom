import { useState, useEffect, type ReactNode } from 'react'
import { regexStatus, type RegexStatus } from '../../lib/regexSafety'

// Shared pieces for the rule editors: the "Test" box that every editor carries, and
// the warning a row shows when its pattern is unusable.
//
// The point of the Test box is that it runs the REAL engine — each editor passes a
// render function that calls the same matcher the live client calls — so what it
// shows is what will actually happen, not a second implementation that drifts.

// ── Row warning ──────────────────────────────────────────────────────────────────
// Stress-testing a pattern costs a few milliseconds the first time it is seen, and
// typing produces a new pattern on every keystroke, so hold off until the user
// pauses rather than testing every prefix as it is typed.
function useDebounced<T>(value: T, ms = 300): T {
  const [held, setHeld] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setHeld(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return held
}

const STATUS_LABEL: Record<Exclude<RegexStatus, 'ok'>, string> = {
  invalid: 'Not a valid pattern',
  benched: 'Switched off — too slow',
}

/**
 * Amber warning under a rule row whose regex is unusable. Renders nothing for a
 * healthy pattern, a blank one, or a plain-substring rule.
 */
export function RegexWarning({ pattern, isRegex }: { pattern: string; isRegex: boolean }) {
  const settled = useDebounced(pattern)
  if (!isRegex || !settled.trim()) return null
  const { status, reason } = regexStatus(settled)
  if (status === 'ok') return null
  return (
    <div className={'rule-warn rule-warn-' + status} role="status">
      <span className="rule-warn-tag">{STATUS_LABEL[status]}</span>
      <span className="rule-warn-msg">{reason}</span>
    </div>
  )
}

// ── Test box ─────────────────────────────────────────────────────────────────────

/**
 * The Test box. `render` is called with whatever the user typed and returns the
 * outcome to display — it should call the live engine directly.
 */
export function RuleTester({
  placeholder = 'Test: type a line the game might send',
  hint,
  render,
}: {
  placeholder?: string
  hint?: string
  render: (input: string) => ReactNode
}) {
  const [input, setInput] = useState('')
  return (
    <div className="rule-tester">
      <input
        className="settings-input settings-input-mono rule-tester-input"
        placeholder={placeholder}
        value={input}
        spellCheck={false}
        onChange={e => setInput(e.target.value)}
      />
      <div className="rule-tester-out">
        {input.trim()
          ? render(input)
          : <span className="rule-tester-idle">{hint ?? 'Type a line above to see what your rules would do with it.'}</span>}
      </div>
    </div>
  )
}

/** "Nothing matches" — the common idle result. */
export function NoMatch({ what = 'No rule matches this line.' }: { what?: string }) {
  return <span className="rule-tester-none">{what}</span>
}
