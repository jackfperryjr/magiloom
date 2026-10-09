import { Component, Suspense, lazy, useMemo, useRef, type ReactNode } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { CodeEditorProps } from './MonacoEditor'

// The code editor behind the in-app Lich (.lic/.yaml) and native (.cmd) script
// editors. There are two of them behind this one name:
//
//   • Monaco — the editor VS Code is built on — wherever there is a keyboard and a
//     pointer. It is several MB, so it is loaded on first use, not with the app.
//   • The plain line-numbered textarea below, on a phone (Monaco is close to
//     unusable on a touch keyboard), while Monaco is still loading, and if it fails
//     to load at all — a web client that was updated underneath an open tab can no
//     longer fetch the old chunk, and that must cost you the fancy editor, not the
//     ability to edit your script.

const MonacoEditor = lazy(() => import('./MonacoEditor'))

// A controlled <textarea> with a scroll-synced gutter beside it — no syntax parsing,
// just numbering. Lines don't wrap (wrap="off") so every logical line is exactly one
// row and the numbers stay aligned; long lines scroll horizontally instead. The
// gutter and textarea MUST share font/line-height/top-padding for the numbers to
// line up (see .code-editor in modals.css).
function PlainCodeEditor({ value, onChange, onSave, placeholder, spellCheck = false }: CodeEditorProps) {
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
        onKeyDown={e => {
          if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && onSave) { e.preventDefault(); onSave() }
        }}
      />
    </div>
  )
}

/** Swaps in the plain editor if Monaco can't be loaded or throws while mounting. */
class EditorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(err: unknown) { console.warn('[editor] falling back to the plain editor:', err) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

export function CodeEditor(props: CodeEditorProps) {
  const isMobile = useIsMobile()
  const plain = <PlainCodeEditor {...props} />
  if (isMobile) return plain
  return (
    <EditorBoundary fallback={plain}>
      <Suspense fallback={plain}>
        <MonacoEditor {...props} />
      </Suspense>
    </EditorBoundary>
  )
}
