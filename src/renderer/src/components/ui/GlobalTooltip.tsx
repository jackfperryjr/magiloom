import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type PosType = 'br' | 'bl' | 'ar' | 'al'

// A single app-wide tooltip driven by `data-tooltip="…"` attributes, delegated
// off the document so any number of elements (including the thousands of inline
// game/room links) share one styled popover with zero per-element React state.
// Mount once at the app root. Visually identical to the <Tooltip> wrapper — both
// render `.tooltip-custom`.
//
// `doc` is for a pop-out window (useDetachedWindow): its events never reach the main
// document, so each window that shows `data-tooltip` content mounts its own copy.
export function GlobalTooltip({ doc = document }: { doc?: Document } = {}) {
  const win = doc.defaultView ?? window
  const [state, setState] = useState<{ x: number; y: number; text: string } | null>(null)
  const timer  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const target = useRef<Element | null>(null)

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null }
    }
    const reset = () => { target.current = null; clearTimer(); setState(null) }

    const onOver = (e: MouseEvent) => {
      const t = e.target as Element | null
      const el = t && typeof t.closest === 'function' ? t.closest('[data-tooltip]') : null
      if (el === target.current) return
      target.current = el
      clearTimer()
      setState(null)
      const text = el?.getAttribute('data-tooltip')
      if (!el || !text) return
      const x = e.clientX, y = e.clientY
      timer.current = setTimeout(() => setState({ x, y, text }), 350)
    }
    const onMove = (e: MouseEvent) => {
      if (!target.current) return
      setState(s => (s ? { ...s, x: e.clientX, y: e.clientY } : s))
    }
    const onOut = (e: MouseEvent) => {
      if (!target.current) return
      const to = e.relatedTarget as Node | null
      if (to && target.current.contains(to)) return
      reset()
    }

    doc.addEventListener('mouseover', onOver, true)
    doc.addEventListener('mousemove', onMove, true)
    doc.addEventListener('mouseout',  onOut,  true)
    return () => {
      doc.removeEventListener('mouseover', onOver, true)
      doc.removeEventListener('mousemove', onMove, true)
      doc.removeEventListener('mouseout',  onOut,  true)
      clearTimer()
    }
  }, [doc])

  if (!state) return null

  const nearRight  = state.x > win.innerWidth  * 0.65
  const nearBottom = state.y > win.innerHeight * 0.80
  const posType: PosType = nearRight && nearBottom ? 'al'
    : nearRight  ? 'bl'
    : nearBottom ? 'ar'
    : 'br'

  const style = {
    left:   nearRight  ? undefined : state.x + 14,
    right:  nearRight  ? win.innerWidth  - state.x + 14 : undefined,
    top:    nearBottom ? undefined : state.y + 20,
    bottom: nearBottom ? win.innerHeight - state.y + 10 : undefined,
  }

  return createPortal(
    <div
      className="tooltip-custom"
      data-pos={posType}
      data-multiline={state.text.includes('\n') ? '' : undefined}
      style={style}
    >{state.text}</div>,
    doc.body,
  )
}
