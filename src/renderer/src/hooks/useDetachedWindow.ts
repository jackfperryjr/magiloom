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
 *    <style> tags) and a packaged/web build (a <link>).
 *  - **Theme.** Ours lives in a class and inline vars on <html>, which the head clone
 *    doesn't include — mirrored on open, then kept in sync with a MutationObserver so
 *    a theme change reaches the pop-out.
 *
 * Returns null until the window exists. If the popup is blocked, `onClose` fires so
 * the caller can fall back to its in-app view rather than rendering into nothing.
 */
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

  useEffect(() => {
    if (!open) return

    const child = window.open('about:blank', 'lantern-detached', features)
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

    for (const el of [...document.head.children]) {
      if (el.tagName !== 'STYLE' && el.tagName !== 'LINK') continue
      const clone = el.cloneNode(true) as HTMLElement
      const href = clone.getAttribute('href')
      if (href) clone.setAttribute('href', new URL(href, document.baseURI).href)
      child.document.head.appendChild(clone)
    }

    const mount = child.document.createElement('div')
    mount.className = 'detached-root'
    child.document.body.replaceChildren(mount)
    child.document.body.style.margin = '0'

    const syncTheme = (): void => {
      child.document.documentElement.className = document.documentElement.className
      child.document.documentElement.style.cssText = document.documentElement.style.cssText
    }
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })

    const handleClosed = (): void => onCloseRef.current()
    child.addEventListener('beforeunload', handleClosed)
    // A pop-out outliving its opener would be orphaned — no store, no theme sync.
    const closeChild = (): void => child.close()
    window.addEventListener('beforeunload', closeChild)
    // The browser can also close it out from under us (user hits the X on the popup);
    // polling is the only cross-platform signal that doesn't depend on beforeunload
    // firing, which popups are inconsistent about.
    const watch = setInterval(() => { if (child.closed) onCloseRef.current() }, 1000)

    setHost(mount)

    return () => {
      clearInterval(watch)
      observer.disconnect()
      child.removeEventListener('beforeunload', handleClosed)
      window.removeEventListener('beforeunload', closeChild)
      setHost(null)
      if (!child.closed) child.close()
    }
  }, [open, title, features])

  return host
}
