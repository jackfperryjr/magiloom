/**
 * Animated overlays for the painted login art.
 *
 * The scenes themselves are paintings (assets/login-art/, see docs/login-art/ for
 * the prompts). These are the parts that move, drawn on a transparent canvas over
 * the image: rain falling through the downpour, embers off the forge, birds over
 * the summer field. Each one is anchored to what the painting already shows, so
 * the particles read as a continuation of it rather than a layer on top.
 *
 * Descended from the procedural scenes in lib/loginScenes.ts, but rewritten rather
 * than lifted: those drew their own backgrounds and were tuned against gradients,
 * where these have to sit in painted light.
 *
 * Two constraints worth knowing before adding one:
 *
 *   - The image is `object-fit: cover`, so it is cropped by a different amount at
 *     every window size. Anything anchored to a painted feature (the ember column,
 *     the fog bank) has to be generous about where that feature is, because it
 *     moves relative to the canvas as the window changes shape.
 *   - Nothing here may darken the frame. No vignette, no scrim — that was the one
 *     thing three rounds of prompt work went into keeping out of these images.
 *
 * Pure canvas 2D and no imports, so it stays testable in plain node.
 */

export type Ctx = CanvasRenderingContext2D

export interface Fx {
  /** (Re)build particle state for a canvas of this size. */
  seed(w: number, h: number): void
  /** One frame. `t` is seconds since the scene started, `dt` since the last frame. */
  draw(ctx: Ctx, w: number, h: number, t: number, dt: number): void
}

export type FxFactory = () => Fx

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

/** Size the backing store to the element's real pixels; returns CSS-pixel dims. */
export function fitCanvas(cv: HTMLCanvasElement): { ctx: Ctx; w: number; h: number } | null {
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const w = cv.clientWidth
  const h = cv.clientHeight
  const bw = Math.max(1, Math.round(w * dpr))
  const bh = Math.max(1, Math.round(h * dpr))
  if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return { ctx, w, h }
}

// ── Rain ──────────────────────────────────────────────────────────────────────
// Downpour. Long thin streaks on a slant, denser and shorter far away. The
// painting's lantern pools its light around the middle of the frame, so drops
// crossing that band are brighter — rain is only visible where light hits it.
interface Drop { x: number; y: number; len: number; v: number; a: number; w: number }

function rain(): Fx {
  let ps: Drop[] = []
  // Negative: the painted rain leans LEFT as it falls, and drawn rain going the
  // other way against it reads instantly as two different storms.
  const SLANT = -0.20
  const spawn = (w: number, h: number, above: boolean): Drop => {
    const near = Math.random()
    return {
      x: rand(-0.1 * w, 1.1 * w),
      y: above ? rand(-0.4 * h, 0) : rand(0, h),
      len: h * (0.02 + near * 0.055),
      v:   h * (0.85 + near * 0.85),
      a:   0.10 + near * 0.28,
      w:   0.7 + near * 1.1,
    }
  }
  return {
    seed(w, h) {
      const n = Math.round((w * h) / 5200)
      ps = Array.from({ length: n }, () => spawn(w, h, false))
    },
    draw(ctx, w, h, _t, dt) {
      ctx.lineCap = 'round'
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.y += p.v * dt
        p.x += p.v * SLANT * dt
        if (p.y - p.len > h) { ps[i] = spawn(w, h, true); continue }
        // Brighter through the lit middle of the frame, dim at the edges.
        const lit = 1 - Math.min(1, Math.abs(p.x / w - 0.58) / 0.42)
        ctx.strokeStyle = `rgba(206,220,246,${(p.a * (0.55 + lit * 0.8)).toFixed(3)})`
        ctx.lineWidth = p.w
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.len * SLANT, p.y - p.len)
        ctx.stroke()
      }
    },
  }
}

// ── Snow ──────────────────────────────────────────────────────────────────────
// Snowfall and Yule. Flakes wander as they fall rather than dropping straight —
// a vertical line of snow reads as static. `warm` tints the flakes on that side
// of the frame, for Yule, where the light spills in from off-frame right.
interface Flake { x: number; y: number; r: number; v: number; ph: number; sw: number; a: number }

function snow(opts: { per: number; warm?: boolean } = { per: 7000 }): Fx {
  let ps: Flake[] = []
  const spawn = (w: number, h: number, above: boolean): Flake => {
    const near = Math.random()
    return {
      x: rand(0, w),
      y: above ? rand(-0.2 * h, -2) : rand(0, h),
      r: 0.7 + near * 2.1,
      v: h * (0.035 + near * 0.075),
      ph: Math.random() * 6.28,
      sw: w * (0.008 + near * 0.02),
      a: 0.28 + near * 0.5,
    }
  }
  return {
    seed(w, h) {
      const n = Math.round((w * h) / opts.per)
      ps = Array.from({ length: n }, () => spawn(w, h, false))
    },
    draw(ctx, w, h, t, dt) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.y += p.v * dt
        if (p.y - p.r > h) { ps[i] = spawn(w, h, true); continue }
        const x = p.x + Math.sin(t * 0.6 + p.ph) * p.sw
        const warm = opts.warm ? Math.max(0, x / w - 0.45) / 0.55 : 0
        const g = 246 - warm * 10
        const b = 255 - warm * 42
        ctx.fillStyle = `rgba(255,${g.toFixed(0)},${b.toFixed(0)},${p.a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(x, p.y, p.r, 0, 6.2832)
        ctx.fill()
      }
    },
  }
}

// ── Embers ────────────────────────────────────────────────────────────────────
// Forge. The painted fire sits a little right of centre and its sparks climb the
// full height, so these spawn in a band around it and cool as they rise — hot
// yellow at the coals, dull red by the roof.
interface Ember { x: number; y: number; vx: number; vy: number; r: number; ph: number; life: number; max: number }

function embers(): Fx {
  let ps: Ember[] = []
  const spawn = (w: number, h: number, aged: boolean): Ember => ({
    x: rand(w * 0.55, w * 0.74),
    // Starts up in the painted flame rather than down at the coals: embers that
    // begin at the very bottom spend their first second crossing the fire itself,
    // where they're invisible against it.
    y: h * rand(0.66, 0.82),
    vx: rand(-6, 6),
    vy: -h * rand(0.045, 0.13),
    r: rand(0.8, 2.3),
    ph: Math.random() * 6.28,
    life: aged ? Math.random() * 5 : 0,
    max: rand(3.4, 7),
  })
  return {
    seed(w, h) {
      const n = Math.max(30, Math.round((w * h) / 16000))
      ps = Array.from({ length: n }, () => spawn(w, h, true))
    },
    draw(ctx, w, h, t, dt) {
      ctx.globalCompositeOperation = 'lighter'
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.life += dt
        if (p.life > p.max || p.y < -4) { ps[i] = spawn(w, h, false); continue }
        p.y += p.vy * dt
        p.x += (p.vx + Math.sin(t * 1.5 + p.ph) * 13) * dt
        const k = p.life / p.max                    // 0 hot → 1 spent
        const a = Math.sin(Math.min(1, k * 1.05) * Math.PI) * 0.85
        const col = k < 0.4 ? '255,206,128' : k < 0.72 ? '248,146,58' : '206,72,34'
        ctx.fillStyle = `rgba(${col},${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r * (1 - k * 0.4), 0, 6.2832)
        ctx.fill()
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

// ── Petals ────────────────────────────────────────────────────────────────────
// Blossom. The canopy runs across the top of the painting, so petals enter from
// above the frame anywhere along its width. They tumble — the ellipse is squashed
// by the cosine of its own rotation, which reads as a petal turning edge-on.
interface Petal { x: number; y: number; r: number; rot: number; vr: number; v: number; ph: number; sw: number; a: number; hue: number }

function petals(): Fx {
  let ps: Petal[] = []
  const spawn = (w: number, h: number, above: boolean): Petal => {
    const near = Math.random()
    return {
      x: rand(0, w),
      y: above ? rand(-0.15 * h, -4) : rand(0, h * 0.9),
      r: 2 + near * 3.4,
      rot: Math.random() * 6.28,
      vr: rand(-2.2, 2.2),
      v: h * (0.03 + near * 0.06),
      ph: Math.random() * 6.28,
      sw: w * (0.01 + near * 0.03),
      a: 0.45 + near * 0.45,
      hue: Math.random(),
    }
  }
  return {
    seed(w, h) {
      const n = Math.round((w * h) / 22000)
      ps = Array.from({ length: n }, () => spawn(w, h, false))
    },
    draw(ctx, w, h, t, dt) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.y += p.v * dt
        p.rot += p.vr * dt
        if (p.y - p.r > h * 0.94) { ps[i] = spawn(w, h, true); continue }
        const x = p.x + Math.sin(t * 0.5 + p.ph) * p.sw
        // Settle out just above the grass rather than vanishing mid-air. Clamped
        // at both ends: a petal is recycled a little BELOW the fade line (it has
        // to clear its own radius first), and an unclamped alpha goes negative
        // there — which browsers quietly ignore, leaving the last colour set.
        const fade = Math.max(0, Math.min(1, (h * 0.94 - p.y) / (h * 0.12)))
        ctx.save()
        ctx.translate(x, p.y)
        ctx.rotate(p.rot * 0.35)
        ctx.fillStyle = p.hue < 0.55
          ? `rgba(255,247,246,${(p.a * fade).toFixed(3)})`
          : `rgba(250,226,229,${(p.a * fade).toFixed(3)})`
        ctx.beginPath()
        ctx.ellipse(0, 0, p.r, p.r * 0.55 * Math.abs(Math.cos(p.rot)), 0, 0, 6.2832)
        ctx.fill()
        ctx.restore()
      }
    },
  }
}

// ── Birds ─────────────────────────────────────────────────────────────────────
// Clear Day. A handful of distant birds in the empty sky above the horizon, drawn
// as two short strokes whose angle flaps. Deliberately few and small: this scene
// is about the space, and a busy sky ruins it.
interface Bird { x: number; y: number; s: number; v: number; ph: number; rate: number }

function birds(): Fx {
  let ps: Bird[] = []
  const spawn = (w: number, h: number, offscreen: boolean): Bird => {
    const near = Math.random()
    return {
      x: offscreen ? -0.08 * w : rand(0, w),
      y: h * rand(0.14, 0.38),
      s: 3.5 + near * 5,
      v: w * (0.012 + near * 0.022),
      ph: Math.random() * 6.28,
      rate: rand(2.6, 4.2),
    }
  }
  return {
    seed(w, h) {
      ps = Array.from({ length: 6 }, () => spawn(w, h, false))
    },
    draw(ctx, w, h, t, dt) {
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.x += p.v * dt
        if (p.x - p.s > w * 1.08) { ps[i] = spawn(w, h, true); continue }
        // Wings sweep between a flat glide and a deep downbeat.
        const flap = Math.sin(t * p.rate + p.ph)
        const lift = p.s * (0.34 + flap * 0.42)
        ctx.strokeStyle = `rgba(48,54,66,${(0.30 + p.s * 0.035).toFixed(3)})`
        ctx.lineWidth = Math.max(0.9, p.s * 0.17)
        ctx.beginPath()
        ctx.moveTo(p.x - p.s, p.y - lift * 0.35)
        ctx.quadraticCurveTo(p.x - p.s * 0.45, p.y - lift, p.x, p.y)
        ctx.quadraticCurveTo(p.x + p.s * 0.45, p.y - lift, p.x + p.s, p.y - lift * 0.35)
        ctx.stroke()
      }
    },
  }
}

// ── Twinkle ───────────────────────────────────────────────────────────────────
// Three Moons and Clear Night. Both paintings already have a full star field, so
// this does NOT add another one — it's a sparse set of faint points that pulse,
// sitting among the painted stars. Too many and the sky starts to fizz.
interface Star { x: number; y: number; r: number; a: number; ph: number; sp: number; warm: number; glow: boolean }
interface Shoot { x: number; y: number; vx: number; vy: number; life: number; max: number }

function twinkle(opts: { skyTop: number; skyBottom: number; shooting?: boolean }): Fx {
  let ps: Star[] = []
  let shoot: Shoot | null = null
  let next = rand(6, 16)
  return {
    seed(w, h) {
      const n = Math.round((w * h) / 9000)
      ps = Array.from({ length: n }, () => {
        const b = Math.pow(Math.random(), 1.7)     // mostly faint, a few real ones
        return {
          x: rand(0, w),
          y: rand(h * opts.skyTop, h * opts.skyBottom),
          r: 0.6 + b * 1.9,
          a: 0.26 + b * 0.72,
          ph: Math.random() * 6.28,
          sp: rand(0.6, 2.2),
          warm: Math.random(),
          glow: b > 0.55,
        }
      })
      shoot = null
      next = rand(6, 16)
    },
    draw(ctx, w, h, t, dt) {
      ctx.globalCompositeOperation = 'lighter'
      for (const p of ps) {
        // Bottoms out around a fifth rather than a third: the swing is what the
        // eye catches, and a star that never dims much doesn't read as twinkling.
        const pulse = 0.22 + 0.78 * Math.pow(Math.sin(t * p.sp + p.ph) * 0.5 + 0.5, 2)
        const c = p.warm > 0.8 ? '255,232,198' : p.warm < 0.2 ? '206,224,255' : '244,248,255'
        const a = Math.min(1, p.a * pulse)
        // A soft halo on the brighter ones — a 1px dot at any alpha is too small
        // to register against a painted sky.
        if (p.glow) {
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4.5)
          g.addColorStop(0, `rgba(${c},${(a * 0.55).toFixed(3)})`)
          g.addColorStop(1, `rgba(${c},0)`)
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(p.x, p.y, p.r * 4.5, 0, 6.2832)
          ctx.fill()
        }
        ctx.fillStyle = `rgba(${c},${a.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, 6.2832)
        ctx.fill()
      }

      // Rare punctuation, never two at once.
      if (opts.shooting) {
        if (shoot) {
          shoot.life += dt
          if (shoot.life > shoot.max) shoot = null
          else {
            const k = shoot.life / shoot.max
            const x = shoot.x + shoot.vx * shoot.life
            const y = shoot.y + shoot.vy * shoot.life
            const g = ctx.createLinearGradient(x, y, x - shoot.vx * 0.16, y - shoot.vy * 0.16)
            const a = Math.sin(k * Math.PI) * 0.85
            g.addColorStop(0, `rgba(236,240,255,${a.toFixed(3)})`)
            g.addColorStop(1, 'rgba(236,240,255,0)')
            ctx.strokeStyle = g
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(x, y)
            ctx.lineTo(x - shoot.vx * 0.16, y - shoot.vy * 0.16)
            ctx.stroke()
          }
        } else {
          next -= dt
          if (next <= 0) {
            shoot = {
              x: rand(w * 0.25, w * 0.95), y: rand(h * 0.06, h * 0.3),
              vx: -rand(w * 0.22, w * 0.42), vy: rand(h * 0.10, h * 0.24),
              life: 0, max: rand(0.7, 1.2),
            }
            next = rand(10, 26)
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

// ── Fog ───────────────────────────────────────────────────────────────────────
// Hallows. The painting's fog bank lies across the middle of the frame; these are
// slow wide wisps drifting through it. Alpha is deliberately tiny — painted fog
// plus drawn fog turns the whole scene to milk very fast.
interface Wisp { x: number; y: number; w: number; h: number; a: number; v: number; ph: number }

function fog(): Fx {
  let ps: Wisp[] = []
  const spawn = (w: number, h: number, left: boolean): Wisp => ({
    x: left ? -rand(0.2, 0.5) * w : rand(-0.2 * w, w),
    y: h * rand(0.42, 0.82),
    w: w * rand(0.28, 0.62),
    h: h * rand(0.05, 0.13),
    a: rand(0.025, 0.075),
    v: w * rand(0.006, 0.018),
    ph: Math.random() * 6.28,
  })
  // A second, lower layer that slides along the ground. Wider, flatter, twice the
  // speed and a little denser than the wisps above it — near fog moves visibly
  // faster than far fog, and that difference is most of what sells the depth.
  const spawnGround = (w: number, h: number, left: boolean): Wisp => ({
    x: left ? -rand(0.4, 0.9) * w : rand(-0.4 * w, w),
    y: h * rand(0.86, 1.0),
    w: w * rand(0.45, 0.95),
    h: h * rand(0.08, 0.17),
    a: rand(0.05, 0.11),
    v: w * rand(0.02, 0.045),
    ph: Math.random() * 6.28,
  })
  return {
    seed(w, h) {
      ps = [
        ...Array.from({ length: 7 }, () => spawn(w, h, false)),
        ...Array.from({ length: 5 }, () => spawnGround(w, h, false)),
      ]
    },
    draw(ctx, w, h, t, dt) {
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]
        p.x += p.v * dt
        // Recycle each band into the layer it came from — the fast ones are the
        // ground layer, and respawning them high would drain it.
        if (p.x - p.w > w) {
          ps[i] = p.v > w * 0.019 ? spawnGround(w, h, true) : spawn(w, h, true)
          continue
        }
        const y = p.y + Math.sin(t * 0.12 + p.ph) * h * 0.012
        // Breathe, so a still frame never looks like a smear.
        const a = p.a * (0.7 + 0.3 * Math.sin(t * 0.22 + p.ph))
        const g = ctx.createRadialGradient(p.x, y, 0, p.x, y, p.w)
        g.addColorStop(0, `rgba(214,222,216,${a.toFixed(4)})`)
        g.addColorStop(0.6, `rgba(206,216,212,${(a * 0.45).toFixed(4)})`)
        g.addColorStop(1, 'rgba(200,212,208,0)')
        ctx.save()
        ctx.translate(p.x, y)
        ctx.scale(1, p.h / p.w)
        ctx.translate(-p.x, -y)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(p.x, y, p.w, 0, 6.2832)
        ctx.fill()
        ctx.restore()
      }
    },
  }
}

// ── Fireworks ─────────────────────────────────────────────────────────────────
// The fireworks painting is deliberately an EMPTY sky with the mascot watching, so
// every burst here is live. Shells rise from below the frame and open left of him
// — he is looking that way, and bursting over his head would hide him.
interface Shell { x: number; y: number; vx: number; vy: number; top: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; hue: string; r: number }
interface Flash { x: number; y: number; life: number; max: number; r: number; hue: string }

const HUES = ['255,206,120', '255,132,150', '150,200,255', '186,150,255', '150,255,196', '255,178,96']

/** Where the treeline sits in the painting — shells clear it, never rise from behind it. */
const HORIZON = 0.76

function fireworks(): Fx {
  let shells: Shell[] = []
  let sparks: Spark[] = []
  let flashes: Flash[] = []
  let next = 0.6
  // Walks rightward across the launch span, wrapping back to the left, so
  // successive bursts trace an arc across the sky rather than firing at random.
  let walk = Math.random()

  const burst = (x: number, y: number, h: number, age = 0): void => {
    const hue = HUES[(Math.random() * HUES.length) | 0]
    const n = 46 + ((Math.random() * 38) | 0)
    const speed = h * rand(0.17, 0.34)
    flashes.push({ x, y, life: age, max: 0.34, r: h * rand(0.05, 0.09), hue })
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2832 + rand(-0.06, 0.06)
      const v = speed * rand(0.45, 1)
      const p: Spark = {
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: 0, max: rand(1.6, 2.8), hue, r: rand(1.5, 3.4),
      }
      // Fast-forward, so a freshly-mounted scene opens mid-bloom instead of on an
      // empty sky for the first two seconds.
      if (age) {
        for (let k = 0; k < Math.round(age / 0.016); k++) {
          p.x += p.vx * 0.016; p.y += p.vy * 0.016
          p.vy += h * 0.17 * 0.016
          p.vx *= 1 - 0.9 * 0.016; p.vy *= 1 - 0.35 * 0.016
        }
        p.life = age
      }
      sparks.push(p)
    }
  }

  const launch = (w: number, h: number): void => {
    const u = walk
    walk = (walk + rand(0.15, 0.26)) % 1
    // Ends of the sweep burst low, the middle bursts high — the arc.
    const arc = Math.sin(u * Math.PI)
    shells.push({
      x:  w * (0.06 + u * 0.64),
      y:  h * HORIZON,
      vx: w * rand(0.02, 0.06),          // angled, always leaning right
      vy: -h * rand(0.34, 0.46),
      top: h * (0.46 - 0.28 * arc),
    })
  }

  return {
    seed(w, h) {
      shells = []
      sparks = []
      flashes = []
      // Open mid-display rather than on an empty sky, on the same left-to-right arc.
      burst(w * 0.18, h * 0.40, h, rand(0.15, 0.45))
      burst(w * 0.46, h * 0.22, h, rand(0.30, 0.70))
      launch(w, h)
      next = rand(0.8, 2.0)
    },
    draw(ctx, w, h, _t, dt) {
      ctx.globalCompositeOperation = 'lighter'

      next -= dt
      if (next <= 0 && shells.length < 3) { launch(w, h); next = rand(1.1, 3.0) }

      for (let i = shells.length - 1; i >= 0; i--) {
        const s = shells[i]
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.vy += h * 0.16 * dt
        // The trail lies along the shell's own path, so an angled climb leaves an
        // angled streak instead of a vertical one under a diagonal shell.
        const tx = s.x - s.vx * 0.14
        const ty = s.y - s.vy * 0.14
        const g = ctx.createLinearGradient(s.x, s.y, tx, ty)
        g.addColorStop(0, 'rgba(255,232,180,0.85)')
        g.addColorStop(1, 'rgba(255,190,110,0)')
        ctx.strokeStyle = g
        ctx.lineWidth = 1.8
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(tx, ty)
        ctx.stroke()
        if (s.y <= s.top || s.vy >= 0) {
          burst(s.x, s.y, h)
          shells.splice(i, 1)
        }
      }

      // The blink at the moment a shell opens. Short, and the single biggest part
      // of reading as "bright" — the sparks alone never look like an explosion.
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i]
        f.life += dt
        if (f.life > f.max) { flashes.splice(i, 1); continue }
        const k = f.life / f.max
        const a = Math.min(1, (1 - k) * (1 - k) * 0.9)
        const r = f.r * (0.4 + k * 1.5)
        const g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r)
        g.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`)
        g.addColorStop(0.35, `rgba(${f.hue},${(a * 0.7).toFixed(3)})`)
        g.addColorStop(1, `rgba(${f.hue},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(f.x, f.y, r, 0, 6.2832)
        ctx.fill()
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const p = sparks[i]
        p.life += dt
        if (p.life > p.max) { sparks.splice(i, 1); continue }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += h * 0.17 * dt          // gravity
        p.vx *= 1 - 0.9 * dt           // drag
        p.vy *= 1 - 0.35 * dt
        // Nothing survives to the treeline: a spark drifting down over the ground
        // reads as debris, not a firework. They burn out in the last stretch of
        // sky above it rather than blinking off at a hard line.
        if (p.y >= h * HORIZON) { sparks.splice(i, 1); continue }
        const clear = Math.min(1, (h * HORIZON - p.y) / (h * 0.12))
        const k = p.life / p.max
        // Holds near full brightness for the first third and then falls away,
        // rather than dimming from the instant it appears.
        const a = Math.min(1, Math.pow(1 - k, 1.5) * 1.35) * clear
        // Draw the last fraction of its path, not a dot — that's what makes a
        // burst read as trails rather than confetti.
        ctx.strokeStyle = `rgba(${p.hue},${a.toFixed(3)})`
        ctx.lineWidth = p.r * (1 - k * 0.5)
        ctx.beginPath()
        ctx.moveTo(p.x, p.y)
        ctx.lineTo(p.x - p.vx * 0.045, p.y - p.vy * 0.045)
        ctx.stroke()
      }

      ctx.globalCompositeOperation = 'source-over'
    },
  }
}

/**
 * Scene index → effect. Keyed by the SCENE table in lib/loginScene.ts; a scene with
 * no entry simply has no canvas over it (Grove, Deep Water and Harvest are painted
 * motion that overlays can't improve on).
 */
export const SCENE_FX: Record<string, FxFactory> = {
  downpour:   rain,
  snowfall:   () => snow({ per: 6200 }),
  clearDay:   birds,
  moons:      () => twinkle({ skyTop: 0.04, skyBottom: 0.62, shooting: true }),
  forge:      embers,
  blossom:    petals,
  hallows:    fog,
  yule:       () => snow({ per: 11000, warm: true }),
  fireworks:  fireworks,
  clearNight: () => twinkle({ skyTop: 0.03, skyBottom: 0.5, shooting: true }),
}
