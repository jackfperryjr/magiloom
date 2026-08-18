// Shared timing primitives for the ambient overlay (see components/game/AmbientOverlay).
//
// Every ambient layer has the same two problems, and each layer used to solve them
// itself:
//
//   1. Fading in and out needs the element MOUNTED at its hidden state for one paint
//      before the visible state is applied. Mount it already at the target and the
//      CSS transition has no start value, so it cuts instead of easing. Unmount it
//      the moment the state clears and the fade-out never plays at all.
//   2. Room-driven effects change on every step. Walking a corridor whose rooms
//      classify differently would strobe the overlay, so a change has to prove it
//      is where you actually ARE before it is allowed on screen.
//
// These are the two hooks. Weather and death deliberately do NOT dwell — they are
// events rather than places, and a storm that takes five seconds to show up reads
// as a bug.

import { useEffect, useRef, useState } from 'react'

/**
 * Keep `next` mounted across its own fade-out.
 *
 * Returns the value to RENDER — which lags `next` by `fadeMs` when it clears, so the
 * outgoing layer stays on screen long enough to fade — plus whether it should be
 * painted in its hidden state right now.
 *
 * The two-frame ramp is load-bearing: one `requestAnimationFrame` only guarantees we
 * run before the next paint, not that a paint of the hidden state has happened. The
 * second frame is what makes the browser commit `hidden` first, giving the CSS
 * transition a real start value to ease from.
 */
export function useFadeMount<T>(next: T | null, fadeMs: number): { shown: T | null; hidden: boolean } {
  const [shown, setShown] = useState<T | null>(next)
  const [hidden, setHidden] = useState(true)   // start hidden so the first paint fades in

  useEffect(() => {
    if (next !== null) {
      setShown(next)
      let inner = 0
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setHidden(false)) })
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner) }
    }
    setHidden(true)                            // fade out, then unmount
    const t = window.setTimeout(() => setShown(null), fadeMs)
    return () => window.clearTimeout(t)
  }, [next, fadeMs])

  return { shown, hidden }
}

/**
 * Hold `value` back until it has been stable for `ms`, so a room-driven effect only
 * switches once you have settled somewhere rather than on every step through it.
 *
 * Two deliberate exemptions, both of which the overlay needs to feel right:
 *   • The FIRST value applies immediately — on connect there is nothing on screen to
 *     protect from flicker, and waiting would show the wrong ambient for five seconds.
 *   • `immediate(next, prev)` opts a specific transition out of the delay. Death is
 *     the case that matters: it has to land the instant it happens.
 */
export function useDwell<T>(
  value: T,
  ms: number,
  immediate?: (next: T, prev: T) => boolean,
): T {
  const [settled, setSettled] = useState(value)
  const first = useRef(true)
  // Both refs exist so that re-rendering with a fresh `immediate` closure, or with an
  // unchanged `value`, can never restart the timer — only a real change of `value`
  // should. Reading `settled` through a ref keeps it out of the effect's deps for the
  // same reason.
  const urgent = useRef(immediate)
  const current = useRef(settled)
  urgent.current = immediate
  current.current = settled

  useEffect(() => {
    if (value === current.current) return
    // Cleared on the first real change whichever branch takes it — otherwise a first
    // change that went through the timer would leave the flag set and let the SECOND
    // change skip the dwell too.
    const wasFirst = first.current
    first.current = false
    if (wasFirst || urgent.current?.(value, current.current)) { setSettled(value); return }
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])

  return settled
}
