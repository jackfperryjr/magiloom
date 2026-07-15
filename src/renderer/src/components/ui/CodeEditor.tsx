import { useMemo, useRef } from 'react'

// A plain-text code editor with a line-number gutter. Backs the in-app Lich (.lic)
// and native (.cmd) script editors. It's a controlled <textarea> with a scroll-synced
// gutter beside it — no syntax parsing, just numbering. Lines don't wrap (wrap="off")
// so every logical line is exactly one row and the numbers stay aligned; long lines
// scroll horizontally instead. The gutter and textarea MUST share font/line-height/
// top-padding for the numbers to line up (see .code-editor in global.css).

export function CodeEditor({ value, onChange, placeholder, spellCheck = false }: {
  value:        string
  onChange:     (v: string) => void
  placeholder?: string
  spellCheck?:  boolean
}) {
  const taRef     = useRef<HTMLTextAreaElement>(null)
  const gutterRef = useRef<HTMLDivElement>(null)

  // An empty file still shows line 1; a trailing newline adds a final empty line,
  // matching how the textarea renders it.
  const lineCount = useMemo(() => (value === '' ? 1 : value.split('\n').length), [value])

  // Keep the gutter's vertical scroll locked to the textarea's as it scrolls.
  const syncScroll = () => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop
  }

  return (
    <div className="code-editor">
      <div className="code-gutter" ref={gutterRef} aria-hidden="true">
        {Array.from({ length: lineCount }, (_, i) => (
          <div key={i} className="code-gutter-num">{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={taRef}
        className="code-textarea"
        spellCheck={spellCheck}
        wrap="off"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onScroll={syncScroll}
      />
    </div>
  )
}
