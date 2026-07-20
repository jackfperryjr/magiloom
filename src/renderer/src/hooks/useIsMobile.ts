import { useState, useEffect } from 'react'

// True on phone viewports — portrait phones (narrow width) OR landscape phones
// (short height + touch), so JS behaviour flips with the layout when a phone turns
// sideways. Tablets in landscape stay non-mobile (height > 500px). Keep this query
// in sync with the mobile-layout media query in mobile.css.
export function useIsMobile(query = '(max-width: 768px), (max-height: 500px) and (pointer: coarse)'): boolean {
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
