import { useEffect, useRef, useState } from 'react'
import { pickScene, dailyRoll, SCENE, SCENES } from '../../lib/loginScene'
import { SCENE_FX, fitCanvas, type Fx } from '../../lib/loginArtFx'

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
// Empty sky: every burst on this scene is animated (see SCENE_FX.fireworks), so
// the painting deliberately has none of its own.
import fireworks  from '../../assets/login-art/fireworks2.jpg'
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
 *
 * Over the image sits a transparent canvas carrying whatever moves in that scene —
 * rain, snow, embers, birds (lib/loginArtFx.ts). Not every scene has one, and none
 * of it runs under prefers-reduced-motion or while the window is hidden.
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
  const fxRef   = useRef<HTMLCanvasElement>(null)

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

  // ── The moving layer ────────────────────────────────────────────────────────
  // Restarts whenever the scene changes (a dev-cycler step; never otherwise, since
  // the daily pick doesn't rotate).
  useEffect(() => {
    const cv = fxRef.current
    if (shown === null || !cv) return
    const key = SCENES.find(s => s.index === shown)?.key
    const make = key ? SCENE_FX[key] : undefined
    if (!make) return
    // Motion is the whole point of this layer, so reduced-motion gets nothing at
    // all rather than a frozen frame of particles over an already-finished
    // painting.
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const fx: Fx = make()
    let raf: number | null = null
    let last = 0, t = 0
    let w = 0, h = 0

    const first = fitCanvas(cv)
    if (!first) return
    let ctx = first.ctx

    // Re-fit only when the element actually changes size: fitCanvas resets the
    // backing store and the DPR transform, which is not free to do every frame.
    const resize = (): void => {
      const f = fitCanvas(cv)
      if (!f) return
      ctx = f.ctx
      if (f.w !== w || f.h !== h) { w = f.w; h = f.h; fx.seed(w, h) }
    }

    const frame = (now: number): void => {
      if (cv.clientWidth !== w || cv.clientHeight !== h) resize()
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      t += dt
      ctx.clearRect(0, 0, w, h)
      fx.draw(ctx, w, h, t, dt)
      raf = requestAnimationFrame(frame)
    }

    const stop = (): void => { if (raf !== null) { cancelAnimationFrame(raf); raf = null } }
    const start = (): void => { if (raf === null) { last = 0; raf = requestAnimationFrame(frame) } }

    resize()
    start()
    // Nothing should animate behind a hidden window — this runs on a phone too.
    const onVis = (): void => { if (document.hidden) stop(); else start() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('resize', resize)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('resize', resize)
      stop()
      ctx.clearRect(0, 0, w, h)
    }
  }, [shown])

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
        <canvas ref={fxRef} className={shown !== null ? 'is-on' : undefined} />
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
