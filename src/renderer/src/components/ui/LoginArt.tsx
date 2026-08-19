import { useEffect, useRef, useState } from 'react'
import { buildScenes, finishFrame, fit, type SceneEnv, type HatKind } from '../../lib/loginScenes'
import { pickScene, SCENE_HAT } from '../../lib/loginScene'

/**
 * The animated art behind the sign-in card.
 *
 * One scene is chosen on mount from the calendar and clock (lib/loginScene.ts) and
 * held for 90 seconds — almost every login is shorter than that, so in practice you
 * see exactly one scene and it never changes under you. If a session does linger,
 * it crossfades to a fresh pick rather than cutting.
 *
 * Two stacked canvases exist only to make that crossfade possible; the second one
 * is idle (and undrawn) except during a fade.
 */

const HOLD_MS = 90_000
const FADE_MS = 1100

interface Prefs {
  on:       boolean
  /** Scene key to pin, or null to follow the calendar. */
  pinned:   string | null
  holidays: boolean
}

const DEFAULTS: Prefs = { on: true, pinned: null, holidays: true }

interface Shown { idx: number; hat: HatKind | null }

function choose(prefs: Prefs): Shown {
  const p = pickScene(new Date(), Math.random(), { holidays: prefs.holidays, pinned: prefs.pinned })
  return { idx: p.scene, hat: p.hat ?? SCENE_HAT[p.scene] ?? null }
}

export function LoginArt(): React.JSX.Element | null {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const aRef = useRef<HTMLCanvasElement | null>(null)
  const bRef = useRef<HTMLCanvasElement | null>(null)

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
    const canvases = [aRef.current, bRef.current]
    if (!canvases[0] || !canvases[1]) return
    const el = canvases as HTMLCanvasElement[]

    const reduce = typeof matchMedia === 'function'
      && matchMedia('(prefers-reduced-motion: reduce)').matches

    // The scenes read `env.hat` while drawing, so it is set immediately before each
    // canvas is drawn — during a crossfade the two layers can want different hats.
    const env: SceneEnv = { hat: null }
    const scenes = buildScenes(1, env)

    let cur: Shown = choose(prefs)
    let next: Shown | null = null
    let front = 0
    el[0].classList.add('is-on')
    el[1].classList.remove('is-on')

    let raf: number | null = null
    let hold: ReturnType<typeof setTimeout> | null = null
    let swap: ReturnType<typeof setTimeout> | null = null
    let t0 = 0, last = 0

    const paint = (canvas: HTMLCanvasElement, shown: Shown, t: number, dt: number): void => {
      env.hat = shown.hat
      const f = fit(canvas)
      scenes[shown.idx](f.ctx, f.w, f.h, t, dt)
      finishFrame(f.ctx, f.w, f.h, t, reduce)
    }

    const frame = (now: number): void => {
      if (!t0) t0 = now
      const t = (now - t0) / 1000
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016
      last = now
      paint(el[front], cur, t, dt)
      if (next) paint(el[1 - front], next, t, dt)
      raf = requestAnimationFrame(frame)
    }

    const stop = (): void => {
      if (raf !== null) { cancelAnimationFrame(raf); raf = null }
    }
    const start = (): void => {
      if (raf !== null) return
      last = 0
      raf = requestAnimationFrame(frame)
    }

    // Reduced motion gets one composed still frame — the particles are distributed
    // as if mid-flight, so it reads as a paused scene rather than an empty one.
    if (reduce) {
      paint(el[front], cur, 3, 0.016)
    } else {
      start()
      const rotate = (): void => {
        next = choose(prefs)
        el[1 - front].classList.add('is-on')
        el[front].classList.remove('is-on')
        swap = setTimeout(() => {
          cur = next as Shown
          next = null
          front = 1 - front
          hold = setTimeout(rotate, HOLD_MS)
        }, FADE_MS)
      }
      hold = setTimeout(rotate, HOLD_MS)
    }

    // Nothing should animate behind a hidden window — this runs on a phone too.
    const onVis = (): void => {
      if (reduce) return
      if (document.hidden) stop(); else start()
    }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      document.removeEventListener('visibilitychange', onVis)
      stop()
      if (hold !== null) clearTimeout(hold)
      if (swap !== null) clearTimeout(swap)
    }
  }, [prefs])

  if (!prefs || !prefs.on) return null
  return (
    <div className="login-art" aria-hidden>
      <canvas ref={aRef} />
      <canvas ref={bRef} />
    </div>
  )
}
