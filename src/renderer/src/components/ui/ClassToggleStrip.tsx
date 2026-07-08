// Genie-style class controls. A rule (alias / trigger / highlight) can carry an
// optional `class`; toggling a class off disables every rule tagged with it
// without deleting them. State is a map of className → enabled; a name absent
// from the map (or true) is ON, only an explicit false is OFF.

// Distinct, sorted class names present across a set of rules.
export function distinctClasses(rules: { class?: string }[]): string[] {
  const s = new Set<string>()
  for (const r of rules) { const c = r.class?.trim(); if (c) s.add(c) }
  return Array.from(s).sort((a, b) => a.localeCompare(b))
}

export function ClassToggleStrip({ names, states, onToggle }: {
  names: string[]
  states: Record<string, boolean>
  onToggle: (name: string) => void
}) {
  if (names.length === 0) return null
  return (
    <div className="class-strip">
      <span className="class-strip-label">Classes</span>
      {names.map(n => {
        const on = states[n] !== false
        return (
          <button
            key={n}
            className={'class-pill' + (on ? ' on' : '')}
            onClick={() => onToggle(n)}
            title={on ? `Disable “${n}”` : `Enable “${n}”`}
          >
            <span className="class-pill-dot" />
            {n}
          </button>
        )
      })}
    </div>
  )
}

// Flip one class in a states map (on ⇄ off).
export function toggleClassState(states: Record<string, boolean>, name: string): Record<string, boolean> {
  const on = states[name] !== false
  return { ...states, [name]: !on }
}
