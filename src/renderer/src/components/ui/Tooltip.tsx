import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'

type PosType = 'br' | 'bl' | 'ar' | 'al'

export function Tooltip({ children, text }: {
  children: React.ReactElement
  text: string
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((e: React.MouseEvent) => {
    const x = e.clientX; const y = e.clientY
    timer.current = setTimeout(() => setPos({ x, y }), 350)
  }, [])

  const move = useCallback((e: React.MouseEvent) => {
    setPos(p => p ? { x: e.clientX, y: e.clientY } : null)
  }, [])

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setPos(null)
  }, [])

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
