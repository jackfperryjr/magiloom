import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

type PosType = 'br' | 'bl' | 'ar' | 'al' | 'left'

// Hover-intent delay before a tooltip appears.
const HOVER_DELAY = 120

export function Tooltip({ children, text, placement = 'auto' }: {
  children: React.ReactElement
  text: string
  placement?: 'auto' | 'left'   // 'left': anchor to the element's left, arrow points right
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [box, setBox] = useState<DOMRect | null>(null)   // anchor rect for 'left' mode
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Cursor-following placement (default, used everywhere else).
  const show = useCallback((e: React.MouseEvent) => {
    const x = e.clientX; const y = e.clientY
    timer.current = setTimeout(() => setPos({ x, y }), HOVER_DELAY)
  }, [])

  const move = useCallback((e: React.MouseEvent) => {
    setPos(p => p ? { x: e.clientX, y: e.clientY } : null)
  }, [])

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setPos(null)
  }, [])

  // Anchored 'left' placement (used by the panel rail): sits to the left of the
  // element, vertically centred, and stays put while hovering (Discord-style).
  // The wrapper is display:contents, so we measure its first real child element.
  const showLeft = useCallback((e: React.MouseEvent) => {
    const child = (e.currentTarget as HTMLElement).firstElementChild
    const rect = child?.getBoundingClientRect() ?? null
    timer.current = setTimeout(() => setBox(rect), HOVER_DELAY)
  }, [])

  const hideLeft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setBox(null)
  }, [])

  if (placement === 'left') {
    const style = box ? {
      right: window.innerWidth - box.left + 10,
      top:   box.top + box.height / 2,
    } : {}
    return (
      <>
        <span style={{ display: 'contents' }} onMouseEnter={showLeft} onMouseLeave={hideLeft}>
          {children}
        </span>
        {box && createPortal(
          <div className="tooltip-custom" data-pos="left" style={style}>{text}</div>,
          document.body
        )}
      </>
    )
  }

  const nearRight  = pos ? pos.x > window.innerWidth  * 0.65 : false
  const nearBottom = pos ? pos.y > window.innerHeight * 0.80 : false

  const posType: PosType = nearRight && nearBottom ? 'al'
    : nearRight  ? 'bl'
    : nearBottom ? 'ar'
    : 'br'

  const style = pos ? {
    left:   nearRight  ? undefined : pos.x + 14,
    right:  nearRight  ? window.innerWidth  - pos.x + 14 : undefined,
    top:    nearBottom ? undefined : pos.y + 20,
    bottom: nearBottom ? window.innerHeight - pos.y + 10 : undefined,
  } : {}

  return (
    <>
      <span style={{ display: 'contents' }} onMouseEnter={show} onMouseMove={move} onMouseLeave={hide}>
        {children}
      </span>
      {pos && createPortal(
        <div className="tooltip-custom" data-pos={posType} style={style}>{text}</div>,
        document.body
      )}
    </>
  )
}
