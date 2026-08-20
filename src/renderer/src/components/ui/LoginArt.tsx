import { useEffect, useRef, useState } from 'react'
import { pickScene, dailyRoll, SCENE, SCENES } from '../../lib/loginScene'

import downpour   from '../../assets/login-art/downpour.jpg'
import snowfall   from '../../assets/login-art/snowfall.jpg'
import clearday   from '../../assets/login-art/clearday.jpg'
import threemoons from '../../assets/login-art/threemoons.jpg'
import grove      from '../../assets/login-art/grove.jpg'
import forge      from '../../assets/login-art/forge.jpg'
import deepwater  from '../../assets/login-art/deepwater.jpg'
import blossom    from '../../assets/login-art/blossom.jpg'
import harvest    from '../../assets/login-art/harvest.jpg'
import hallows    from '../../assets/login-art/hallows.jpg'
import yule       from '../../assets/login-art/yule.jpg'
import fireworks  from '../../assets/login-art/fireworks.jpg'
import clearnight from '../../assets/login-art/clearnight.jpg'

/**
 * The art behind the sign-in card.
 *
 * ONE SCENE PER DAY. The pick comes from the calendar and clock (lib/loginScene.ts)
 * off a roll seeded by the date, so it is the same all day — across reloads, a
 * re-login, and two windows at once — and different tomorrow. It does not rotate
 * while you sit here; an earlier version cycled every 90 seconds, which changed the
 * art under anyone who left the screen open and made "today's scene" mean nothing.
 *
 * The scenes are painted images (docs/login-art/ holds the prompts that generated
 * them, and the notes on how they're framed: the composition stays quiet on the
 * left so the sign-in card can sit over it). They replaced a set of procedurally
 * drawn canvas scenes — lib/loginScenes.ts still holds that code, now unused.
 *
 * Two stacked <img> layers remain so the dev cycler below can crossfade between
 * scenes; in normal use the second one is never filled.
 */

/** Indexed by SCENE — the order in lib/loginScene.ts, which the settings pin uses. */
const SCENE_ART: Record<number, string> = {
  [SCENE.downpour]:   downpour,
  [SCENE.snowfall]:   snowfall,
  [SCENE.clearDay]:   clearday,
  [SCENE.moons]:      threemoons,
  [SCENE.grove]:      grove,
  [SCENE.forge]:      forge,
  [SCENE.deep]:       deepwater,
  [SCENE.blossom]:    blossom,
  [SCENE.harvest]:    harvest,
  [SCENE.hallows]:    hallows,
  [SCENE.yule]:       yule,
  [SCENE.fireworks]:  fireworks,
  [SCENE.clearNight]: clearnight,
}

interface Prefs {
  on:       boolean
  /** Scene key to pin, or null to follow the calendar. */
  pinned:   string | null
  holidays: boolean
}

const DEFAULTS: Prefs = { on: true, pinned: null, holidays: true }

function choose(prefs: Prefs): number {
  const now = new Date()
  return pickScene(now, dailyRoll(now), { holidays: prefs.holidays, pinned: prefs.pinned }).scene
}

/** Resolve once the bitmap is decoded, so a crossfade never reveals a half-drawn image. */
function preload(src: string): Promise<void> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = img.onerror = () => resolve()
    img.src = src
  })
}

export function LoginArt(): React.JSX.Element | null {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [srcs,  setSrcs]  = useState<[string, string]>(['', ''])
  const [front, setFront] = useState(0)
  const [shown, setShown] = useState<number | null>(null)
  // Dev-only: hold one scene on screen instead of following the calendar, so the
  // whole set can be flipped through without waiting out the 90-second hold.
  const [pinned, setPinned] = useState<number | null>(null)
  // Which layer is in front, kept in a ref so alternation survives the effect
  // re-running (which it does on every dev-pin change).
  const sideRef = useRef(1)

  // Settings are global (no character is chosen yet at the login screen).
  useEffect(() => {
    let live = true
    window.dr.settings.getAll().then(s => {
      if (!live) return
      setPrefs({
        on:       s.loginArt !== false,
        pinned:   s.loginArtScene && s.loginArtScene !== 'calendar' ? s.loginArtScene : null,
        holidays: s.loginArtHolidays !== false,
      })
    }).catch(() => { if (live) setPrefs(DEFAULTS) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!prefs || !prefs.on) return
    let live = true

    const idx = pinned ?? choose(prefs)
    const src = SCENE_ART[idx] ?? SCENE_ART[SCENE.clearNight]
    preload(src).then(() => {
      if (!live) return
      // Alternate layers so the dev cycler crossfades instead of cutting.
      const target = 1 - sideRef.current
      sideRef.current = target
      setSrcs(prev => {
        const next = [...prev] as [string, string]
        next[target] = src
        return next
      })
      setFront(target)
      setShown(idx)
    })

    return () => { live = false }
  }, [prefs, pinned])

  if (!prefs || !prefs.on) return null

  const cycle = (step: number): void => {
    const order = SCENES.map(s => s.index)
    const at    = order.indexOf((pinned ?? shown ?? order[0]) as (typeof order)[number])
    setPinned(order[(at + step + order.length) % order.length])
  }
  const label = SCENES.find(s => s.index === shown)

  return (
    <>
      <div className="login-art" aria-hidden>
        {srcs.map((src, i) => (
          <img key={i} src={src || undefined} alt=""
            className={front === i && src ? 'is-on' : undefined} />
        ))}
      </div>
      {/* Dev build only — `import.meta.env.DEV` is a compile-time constant, so this
          whole block is dropped from a production bundle. */}
      {import.meta.env.DEV && (
        <div className="login-art-dev">
          <button onClick={() => cycle(-1)} title="Previous scene">‹</button>
          <span className="login-art-dev-name">
            {label ? label.name : '…'}
            <em>{pinned === null ? 'calendar' : `${SCENES.findIndex(s => s.index === pinned) + 1}/${SCENES.length}`}</em>
          </span>
          <button onClick={() => cycle(1)} title="Next scene">›</button>
          <button onClick={() => setPinned(null)} disabled={pinned === null}
            title="Back to the calendar pick">auto</button>
        </div>
      )}
    </>
  )
}
