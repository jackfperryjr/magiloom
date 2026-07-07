import { useLayoutEffect, useRef, useState } from 'react'
import { cropImgStyle, type AvatarCrop } from '../../lib/avatar'

// Circular avatar that applies a saved crop (pan/zoom) over the full image,
// measuring its own rendered size so the same crop reproduces at any diameter.
// With no crop it falls back to a centered object-fit: cover.
export function CircleAvatar({ src, crop, className = '', alt = '', onClick, title }: {
  src:        string
  crop?:      AvatarCrop
  className?: string
  alt?:       string
  onClick?:   () => void
  title?:     string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null)
  const [box, setBox] = useState(0)
  useLayoutEffect(() => { if (ref.current) setBox(ref.current.clientWidth) }, [src, className])

  const style = crop && nat && box > 0
    ? cropImgStyle(nat, box, crop)
    : { width: '100%', height: '100%', objectFit: 'cover' as const }

  return (
    <span ref={ref} className={`circle-avatar ${className}`} onClick={onClick} data-tooltip={title}>
      <img
        src={src} alt={alt} draggable={false} style={style}
        onLoad={e => setNat({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
      />
    </span>
  )
}
