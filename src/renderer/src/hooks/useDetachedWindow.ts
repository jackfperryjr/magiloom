import { useEffect, useRef, useState } from 'react'

/**
 * Opens a real window and returns a container element inside it to portal into.
 *
 * Electron gives `window.open` a genuine BrowserWindow and the browser gives a
 * popup, so a detached panel needs no second entry point and no IPC — the same React
 * subtree renders into another document. Three things have to be carried across:
 *
 *  - **A base URL.** The new document is `about:blank`, which has no base of its own,
 *    so every relative URL in what we clone would resolve against nothing. The web
 *    build ships its CSS as `<link href="./assets/…">` (relative, so the PWA works
 *    under /app/), which is exactly the case that breaks: the styles 404 and the
 *    window comes up blank. Writing a `<base>` first fixes every relative URL at
 *    once, and link hrefs are absolutised too so it holds either way.
 *  - **Styles.** Cloning every <style>/<link> covers both the dev build (Vite injects
 *    <style> tags) and a packaged/web build (a <link>). The copy is kept LIVE, not
 *    taken once: Monaco (the script editor) adds its own sheets to our <head> as it
 *    goes — its theme colours, and rules inserted through the CSSOM, which leave no
 *    text and fire no mutation — so a one-time clone leaves a popped-out editor
 *    unstyled. See mirrorStyles.
 *  - **Theme.** Ours lives in a class, data attributes and inline vars on <html>, which the head clone
 *    doesn't include — mirrored on open, then kept in sync with a MutationObserver so
 *    a theme change reaches the pop-out.
 *
 * Each hook gets its own window name: a shared one would make a second pop-out
 * navigate the first's window out from under it.
 *
 * Returns null until the window exists. If the popup is blocked, `onClose` fires so
 * the caller can fall back to its in-app view rather than rendering into nothing.
 */
let windowSeq = 0

/** What a <style> currently says, CSSOM-inserted rules included. */
function cssOf(el: HTMLStyleElement): string {
  try {
    const rules = el.sheet?.cssRules
    if (rules) return Array.from(rules, r => r.cssText).join('\n')
  } catch { /* unreadable sheet — fall back to its text */ }
  return el.textContent ?? ''
}

/**
 * Keeps `target`'s <head> carrying a copy of every <style>/<link> in ours, added,
 * changed and removed as ours is. A head mutation resyncs at once; `sync()` is also
 * called on a timer for the one change no observer sees, a rule inserted through the
 * CSSOM (Monaco's decorations do this), which is caught by its sheet's rule count.
 */
function mirrorStyles(target: Document): { sync: () => void; dispose: () => void } {
  const clones = new Map<Element, { node: HTMLElement; text: string | null; rules: number }>()

  const ruleCount = (el: Element): number => {
    try { return (el as HTMLStyleElement).sheet?.cssRules.length ?? 0 } catch { return 0 }
  }

  const sync = (): void => {
    const live = new Set<Element>()
    for (const el of document.head.children) {
      if (el.tagName !== 'STYLE' && el.tagName !== 'LINK') continue
      live.add(el)
      const known = clones.get(el)
      if (el.tagName === 'LINK') {
        if (known) continue
        const node = el.cloneNode(true) as HTMLElement
        const href = node.getAttribute('href')
        if (href) node.setAttribute('href', new URL(href, document.baseURI).href)
        target.head.appendChild(node)
        clones.set(el, { node, text: null, rules: 0 })
        continue
      }
      const text = el.textContent, rules = ruleCount(el)
      if (known && known.text === text && known.rules === rules) continue
      const node = known?.node ?? target.createElement('style')
      if (!known) {
        for (const attr of el.getAttributeNames()) node.setAttribute(attr, el.getAttribute(attr)!)
        target.head.appendChild(node)
      }
      node.textContent = cssOf(el as HTMLStyleElement)
      clones.set(el, { node, text, rules })
    }
    for (const [el, { node }] of clones) {
      if (!live.has(el)) { node.remove(); clones.delete(el) }
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.head, { childList: true, subtree: true, characterData: true })
  return { sync, dispose: () => observer.disconnect() }
}

export function useDetachedWindow(
  open: boolean,
  { title, features = 'popup=yes,width=980,height=760', onClose }:
  { title: string; features?: string; onClose: () => void },
): HTMLElement | null {
  const [host, setHost] = useState<HTMLElement | null>(null)
  // onClose is called from listeners that outlive their render; keep it current
  // without re-running the effect (which would close and reopen the window).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const nameRef = useRef('')
  if (!nameRef.current) nameRef.current = `lantern-detached-${++windowSeq}`

  useEffect(() => {
    if (!open) return

    const child = window.open('about:blank', nameRef.current, features)
    if (!child) { onCloseRef.current(); return }

    // Write the skeleton synchronously rather than mutating the blank document:
    // it establishes <base> before anything can resolve a URL against it, and
    // survives the popup settling its own about:blank load.
    child.document.open()
    child.document.write(
      '<!doctype html><html><head>' +
      `<base href="${document.baseURI}">` +
      `<title>${title.replace(/[<&]/g, c => (c === '<' ? '&lt;' : '&amp;'))}</title>` +
      '</head><body></body></html>',
    )
    child.document.close()

    const styles = mirrorStyles(child.document)

    const mount = child.document.createElement('div')
    mount.className = 'detached-root'
    child.document.body.replaceChildren(mount)
    child.document.body.style.margin = '0'

    // data-theme/data-mode too: theme CSS keys on them (`:root[data-mode="light"]`).
    const THEME_ATTRS = ['class', 'style', 'data-theme', 'data-mode']
    const syncTheme = (): void => {
      for (const attr of THEME_ATTRS) {
        const v = document.documentElement.getAttribute(attr)
        if (v === null) child.document.documentElement.removeAttribute(attr)
        else child.document.documentElement.setAttribute(attr, v)
      }
    }
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: THEME_ATTRS })

    const handleClosed = (): void => onCloseRef.current()
    child.addEventListener('beforeunload', handleClosed)
    // A pop-out outliving its opener would be orphaned — no store, no theme sync.
    const closeChild = (): void => child.close()
    window.addEventListener('beforeunload', closeChild)
    // The browser can also close it out from under us (user hits the X on the popup);
    // polling is the only cross-platform signal that doesn't depend on beforeunload
    // firing, which popups are inconsistent about.
    const watch = setInterval(() => {
      if (child.closed) onCloseRef.current()
      else styles.sync()
    }, 1000)

    setHost(mount)

    return () => {
      clearInterval(watch)
      observer.disconnect()
      styles.dispose()
      child.removeEventListener('beforeunload', handleClosed)
      window.removeEventListener('beforeunload', closeChild)
      setHost(null)
      if (!child.closed) child.close()
    }
  }, [open, title, features])

  return host
}
