import { useEffect, useRef, useState } from 'react'
import * as monaco from 'monaco-editor/editor/editor.api'
// Every editor feature (find/replace, multi-cursor, folding, the command palette,
// the context menu…) but none of the language SERVICES — those are the TypeScript/
// JSON/CSS/HTML workers, which is most of Monaco's weight and nothing here edits.
import 'monaco-editor/features/register.all'
import 'monaco-editor/languages/definitions/yaml/register'
import 'monaco-editor/languages/definitions/ruby/register'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'

// The editor VS Code is built on, behind CodeEditor. This module is only ever
// reached through a lazy import (see CodeEditor.tsx): it is a few MB, and most
// sessions never open a script.

// Monaco does diffing and link detection off the main thread. `?worker` has the
// bundler emit it as a same-origin file, which is all the CSP (script-src 'self')
// allows — a blob: or CDN worker would be refused.
self.MonacoEnvironment = { getWorker: () => new EditorWorker() }

// ── Languages ────────────────────────────────────────────────────────────────
const GENIE = 'genie'

// Genie/Wizard `.cmd` scripts have no Monaco grammar, so this is one. The language
// is line-oriented — a command word, then free text — so a word is only coloured as
// a command where a command can stand: first on its line, or straight after `then`
// or an `if_N`. Colouring every `if`, `move` or `wait` would light up half the text
// players send to the game. The command list mirrors the engine's own
// (src/main/cmd-script-engine.ts).
//
// It is deliberately written without tokenizer states. "Rest of the line" is the
// obvious state to want, but Monarch never runs a rule at the end of a line it has
// already consumed, so a `/$/` pop doesn't fire and the state leaks into the next
// line — which then loses its label or its command. Anchoring on `^` needs no state.
const COMMAND = { cases: { '@commands': 'keyword', '@default': '' } }
monaco.languages.register({ id: GENIE, extensions: ['.cmd'], aliases: ['Genie Script'] })
monaco.languages.setMonarchTokensProvider(GENIE, {
  ignoreCase: true,
  commands: [
    'put', 'send', 'echo', 'goto', 'gosub', 'return', 'match', 'matchre', 'matchwait',
    'waitfor', 'waitforre', 'wait', 'nextroom', 'move', 'pause', 'setvariable', 'setv',
    'var', 'deletevariable', 'delvariable', 'unvar', 'math', 'counter', 'random', 'save',
    'if', 'else', 'exit', 'shutdown',
  ],
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/^\s*[A-Za-z_][\w.-]*:/, 'type'],                           // a label
      [/^(\s*if_\d+)(\s+)([A-Za-z_]\w*)/, ['keyword', '', COMMAND]],
      [/^\s*if_\d+/, 'keyword'],
      [/^(\s*)([A-Za-z_]\w*)/, ['', COMMAND]],
      [/(\bthen)(\s+)([A-Za-z_]\w*)/, ['keyword', '', COMMAND]],
      [/\bthen\b/, 'keyword'],
      [/[%$][A-Za-z_]\w*|[%$]\d+/, 'variable'],
      [/"[^"]*"/, 'string'],
      [/\b\d+(?:\.\d+)?\b/, 'number'],
    ],
  },
})
monaco.languages.setLanguageConfiguration(GENIE, {
  comments: { lineComment: '#' },
  brackets: [['(', ')'], ['{', '}'], ['[', ']']],
  autoClosingPairs: [{ open: '(', close: ')' }, { open: '{', close: '}' }, { open: '"', close: '"' }],
})

const LANGUAGES: Record<string, { id: string; name: string }> = {
  cmd:  { id: GENIE,  name: 'Genie Script' },
  lic:  { id: 'ruby', name: 'Ruby' },
  rb:   { id: 'ruby', name: 'Ruby' },
  yaml: { id: 'yaml', name: 'YAML' },
  yml:  { id: 'yaml', name: 'YAML' },
}
const languageFor = (path: string) =>
  LANGUAGES[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? { id: 'plaintext', name: 'Plain Text' }

// ── Theme ────────────────────────────────────────────────────────────────────
// Monaco has its own theme system and knows nothing about ours, so the active
// Lantern theme is translated into one. It is rebuilt whenever the theme changes —
// which, with the Appearance tab's live preview, can happen while an editor is open.
const THEME = 'lantern'

/** A CSS colour as the `#rrggbb[aa]` Monaco insists on, or `fallback` when the value
 *  is something a colour slot can't hold (Final Fantasy's panels are gradients). */
function toHex(value: string, fallback: string): string {
  const v = value.trim()
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return v
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map(c => c + c).join('')
  const m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/)
  if (!m) return fallback
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, '0')
  return '#' + h(+m[1]) + h(+m[2]) + h(+m[3]) + (m[4] !== undefined ? h(+m[4] * 255) : '')
}

function applyEditorTheme(): void {
  const root = document.documentElement
  const css  = getComputedStyle(root)
  const v = (name: string, fallback: string): string => toHex(css.getPropertyValue(name), fallback)
  // With an alpha suffix, for washes. Only ever applied to the opaque colours.
  const a = (hex: string, alpha: string): string => hex.slice(0, 7) + alpha

  const light  = root.dataset.mode === 'light'
  const bg     = v('--bg-input', light ? '#ffffff' : '#101014')
  const shell  = v('--bg-shell', bg)
  const text   = v('--text-main', light ? '#222222' : '#dddddd')
  const dim    = v('--text-dim', '#777777')
  const bright = v('--text-bright', text)
  const accent = v('--accent', '#6467dc')
  const border = v('--border', dim)
  const soft   = v('--border-soft', border)
  const dimAcc = v('--accent-dim', shell)
  const bold   = v('--color-bold', accent)
  const tok = (c: string): string => c.slice(1, 7)   // token rules take hex without '#'

  monaco.editor.defineTheme(THEME, {
    base: light ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      { token: '',         foreground: tok(text) },
      { token: 'comment',  foreground: tok(dim), fontStyle: 'italic' },
      { token: 'keyword',  foreground: tok(accent) },
      { token: 'string',   foreground: tok(v('--color-speech', text)) },
      { token: 'number',   foreground: tok(bold) },
      { token: 'variable', foreground: tok(v('--color-whisper', text)) },
      { token: 'type',     foreground: tok(v('--color-thought', text)) },
      { token: 'tag',      foreground: tok(v('--color-thought', text)) },
      { token: 'constant', foreground: tok(bold) },
      { token: 'regexp',   foreground: tok(v('--color-warning', text)) },
    ],
    colors: {
      'editor.background':                    bg,
      'editor.foreground':                    text,
      'editorGutter.background':              bg,
      'minimap.background':                   bg,
      'editorStickyScroll.background':        bg,
      'editorLineNumber.foreground':          dim,
      'editorLineNumber.activeForeground':    bright,
      'editorCursor.foreground':              accent,
      'editor.selectionBackground':           a(accent, '55'),
      'editor.inactiveSelectionBackground':   a(accent, '2a'),
      'editor.selectionHighlightBackground':  a(accent, '22'),
      'editor.wordHighlightBackground':       a(accent, '22'),
      'editor.lineHighlightBackground':       a(text, '0d'),
      'editor.lineHighlightBorder':           '#00000000',
      'editor.findMatchBackground':           a(bold, '66'),
      'editor.findMatchHighlightBackground':  a(bold, '2e'),
      'editorBracketMatch.background':        a(accent, '22'),
      'editorBracketMatch.border':            a(accent, '99'),
      'editorIndentGuide.background1':        soft,
      'editorIndentGuide.activeBackground1':  border,
      'editorWhitespace.foreground':          a(dim, '66'),
      'editorWidget.background':              shell,
      'editorWidget.border':                  border,
      'editorHoverWidget.background':         shell,
      'editorHoverWidget.border':             border,
      'editorSuggestWidget.background':       shell,
      'editorSuggestWidget.border':           border,
      'editorSuggestWidget.selectedBackground': dimAcc,
      'input.background':                     bg,
      'input.foreground':                     bright,
      'input.border':                         soft,
      'inputOption.activeBorder':             accent,
      'inputOption.activeBackground':         a(accent, '33'),
      'focusBorder':                          v('--border-accent', accent),
      'quickInput.background':                shell,
      'quickInput.foreground':                text,
      'list.hoverBackground':                 a(text, '0f'),
      'list.activeSelectionBackground':       dimAcc,
      'list.activeSelectionForeground':       bright,
      'list.focusBackground':                 dimAcc,
      'list.highlightForeground':             accent,
      'menu.background':                      shell,
      'menu.foreground':                      text,
      'menu.selectionBackground':             dimAcc,
      'menu.selectionForeground':             bright,
      'menu.separatorBackground':             soft,
      'scrollbarSlider.background':           a(dim, '44'),
      'scrollbarSlider.hoverBackground':      a(dim, '77'),
      'scrollbarSlider.activeBackground':     a(dim, 'aa'),
      'scrollbar.shadow':                     '#00000000',
      'editorOverviewRuler.border':           '#00000000',
    },
  })
  monaco.editor.setTheme(THEME)
}

// ── Component ────────────────────────────────────────────────────────────────
export interface CodeEditorProps {
  value:        string
  onChange:     (v: string) => void
  /** The file being edited. Picks the language, and a change of path is a change of
   *  document: undo history and cursor start over. */
  path?:        string
  /** Ctrl/Cmd+S. */
  onSave?:      () => void
  placeholder?: string
  spellCheck?:  boolean
}

export default function MonacoEditor({ value, onChange, path = '', onSave }: CodeEditorProps) {
  const hostRef   = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Latest props, for callbacks Monaco holds on to for the editor's whole life.
  const latest    = useRef({ value, onChange, onSave })
  // Set while WE are writing the model, so that write isn't echoed back as an edit.
  const applying  = useRef(false)
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 })
  const language = languageFor(path)

  // Declared first so it runs first: the effects below read `latest`.
  useEffect(() => { latest.current = { value, onChange, onSave } })

  useEffect(() => {
    applyEditorTheme()
    const css = getComputedStyle(document.documentElement)
    const editor = monaco.editor.create(hostRef.current!, {
      model: null,
      theme: THEME,
      // The app's own monospace choice (Settings → Appearance → Font family).
      fontFamily: `${css.getPropertyValue('--font-game').trim() || 'Consolas'}, Consolas, 'Courier New', monospace`,
      fontSize: 13,
      lineHeight: 20,
      automaticLayout: true,
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      renderWhitespace: 'selection',
      renderLineHighlight: 'all',
      bracketPairColorization: { enabled: true },
      guides: { indentation: true, bracketPairs: true },
      stickyScroll: { enabled: true },
      minimap: { enabled: true, renderCharacters: false },
      padding: { top: 8, bottom: 8 },
      // Popups (find, hover, the context menu) are positioned against the window
      // rather than the editor, so the rounded, clipped pane can't cut them off.
      fixedOverflowWidgets: true,
    })
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => latest.current.onSave?.())
    const onCursor = editor.onDidChangeCursorSelection(e => {
      const model = editor.getModel()
      setCursor({
        line: e.selection.positionLineNumber,
        col:  e.selection.positionColumn,
        selected: model ? model.getValueInRange(e.selection).length : 0,
      })
    })

    // Follow theme changes (Appearance previews them live while this is open).
    const themeWatch = new MutationObserver(applyEditorTheme)
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-mode', 'style'] })
    // Monaco measures glyph widths once. If the webfont arrives after that, every
    // column is off until it is told to measure again.
    void document.fonts?.ready.then(() => monaco.editor.remeasureFonts())

    return () => {
      themeWatch.disconnect()
      onCursor.dispose()
      editor.getModel()?.dispose()
      editor.dispose()
      editorRef.current = null
    }
  }, [])

  // One model per file, so switching files doesn't let Ctrl+Z walk back into the
  // previous one.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const model = monaco.editor.createModel(latest.current.value, languageFor(path).id)
    model.updateOptions({ tabSize: 2, insertSpaces: true })
    const sub = model.onDidChangeContent(() => {
      if (!applying.current) latest.current.onChange(model.getValue())
    })
    editor.setModel(model)
    setCursor({ line: 1, col: 1, selected: 0 })
    return () => { sub.dispose(); model.dispose() }
  }, [path])

  // The parent replaced the text (a reload of the same file). Typing never lands
  // here: by the time the prop comes back round it already equals the model.
  useEffect(() => {
    const model = editorRef.current?.getModel()
    if (!model || model.getValue() === value) return
    applying.current = true
    model.setValue(value)
    applying.current = false
  }, [value])

  return (
    <div className="code-editor code-editor-rich">
      <div className="code-monaco" ref={hostRef} />
      <div className="code-status">
        <span>Ln {cursor.line}, Col {cursor.col}{cursor.selected ? ` (${cursor.selected} selected)` : ''}</span>
        <span className="code-status-gap" />
        <span>Spaces: 2</span>
        <span>{language.name}</span>
      </div>
    </div>
  )
}
