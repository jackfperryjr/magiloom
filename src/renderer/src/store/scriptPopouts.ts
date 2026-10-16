import { atom } from 'jotai'

// ── Script editor pop-outs ───────────────────────────────────────────────────
// A script file (native .cmd, or a Lich .lic/.yaml) open in its own window, so it
// can be edited beside the game rather than inside Settings. The windows are drawn by
// ScriptPopouts at the app root, so closing Settings doesn't close them; the Settings
// editors read this list to show "open in its own window" for a file that's out.
//
// The text lives here, not in the window: handing a file over (Settings → window →
// back) carries unsaved edits with it, and a window closed with unsaved edits leaves
// them behind to be saved or thrown away rather than silently losing them.

export type ScriptKind = 'cmd' | 'lich'

export interface ScriptPopout {
  key:     string        // `${kind}:${path}` — one window per file
  kind:    ScriptKind
  /** The id the file API uses: a .cmd script's basename, a Lich file's `dir/name`. */
  path:    string
  content: string
  /** What's on disk, as far as we know — `content !== saved` is "unsaved changes". */
  saved:   string
  /** Its window was closed with unsaved changes; waiting on Save or Discard. */
  orphaned?: boolean
}

export const scriptPopoutKey = (kind: ScriptKind, path: string): string => `${kind}:${path}`

export const scriptPopoutsAtom = atom<ScriptPopout[]>([])

/** The two file APIs, behind one shape. */
export const SCRIPT_FILES: Record<ScriptKind, {
  read:  (path: string) => Promise<string>
  write: (path: string, content: string) => Promise<void>
  label: (path: string) => string
}> = {
  cmd: {
    read:  async p => (await window.dr.script.readFile(p)).content,
    write: async (p, c) => { await window.dr.script.writeFile(p, c) },
    label: p => p + '.cmd',
  },
  lich: {
    read:  async p => (await window.dr.lich.readFile(p)).content,
    write: async (p, c) => { await window.dr.lich.writeFile(p, c) },
    // `custom/foo.lic` → `foo.lic`; the folder is Settings' grouping, not the name.
    label: p => p.slice(p.lastIndexOf('/') + 1),
  },
}
