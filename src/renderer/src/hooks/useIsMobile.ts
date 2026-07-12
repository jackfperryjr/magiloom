import { useState, useEffect } from 'react'

// True on narrow (phone-ish) viewports. Kept in sync with the 768px breakpoint the
// CSS media queries use, so JS behaviour and layout flip together.
export function useIsMobile(query = '(max-width: 768px)'): boolean {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatch(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return match
}
