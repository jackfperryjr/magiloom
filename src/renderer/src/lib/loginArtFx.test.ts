/**
 * Login-art overlay tests.
 *
 * These effects can't be eyeballed from a terminal, and the failure modes that
 * matter aren't aesthetic anyway: a NaN coordinate silently draws nothing, a
 * particle pool that never recycles leaks until the tab dies, and a composite mode
 * left on 'lighter' tints every later frame. So the canvas context is stubbed, each
 * effect is run for a few hundred frames at two sizes, and every number that
 * reaches the context is checked.
 *
 * Run: npm run test:tools
 */

import { SCENE_FX, type Ctx } from './loginArtFx'

let passed = 0
const failures: string[] = []
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) passed++
  else failures.push(name + (detail ? ` — ${detail}` : ''))
}
const eq = (name: string, got: unknown, want: unknown): void =>
  check(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)

interface Recorder {
  ctx: Ctx
  draws: number
  bad: string[]
  strokesThisFrame: number
  resetFrame(): void
}

/** A 2D context that records instead of rasterising, and rejects bad numbers. */
function recorder(): Recorder {
  const r: Recorder = {
    ctx: null as unknown as Ctx,
    draws: 0,
    bad: [],
    strokesThisFrame: 0,
    resetFrame() { r.strokesThisFrame = 0 },
  }

  const num = (where: string, ...vs: number[]): void => {
    for (const v of vs) {
      if (typeof v !== 'number' || !Number.isFinite(v)) r.bad.push(`${where}: ${v}`)
    }
  }
  // rgba(...) with a NaN alpha silently paints nothing, which is the single most
  // likely way one of these effects fails invisibly.
  const colour = (where: string, v: unknown): void => {
    if (typeof v !== 'string') return                    // a gradient object
    const m = /^rgba?\(([^)]*)\)$/.exec(v)
    if (!m) { r.bad.push(`${where}: unparseable ${v}`); return }
    const parts = m[1].split(',').map(s => Number(s.trim()))
    if (parts.some(n => !Number.isFinite(n))) r.bad.push(`${where}: ${v}`)
    if (parts.length === 4 && (parts[3] < 0 || parts[3] > 1)) r.bad.push(`${where}: alpha ${parts[3]}`)
    for (const c of parts.slice(0, 3)) {
      if (c < 0 || c > 255) r.bad.push(`${where}: channel ${c}`)
    }
  }

  const grad = {
    addColorStop: (o: number, c: string) => { num('gradient stop', o); colour('gradient stop', c) },
  }

  const ctx = {
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    _fill: '' as unknown,
    _stroke: '' as unknown,
    set fillStyle(v: unknown)   { colour('fillStyle', v); ctx._fill = v },
    get fillStyle()             { return ctx._fill },
    set strokeStyle(v: unknown) { colour('strokeStyle', v); ctx._stroke = v },
    get strokeStyle()           { return ctx._stroke },

    beginPath()  {},
    closePath()  {},
    save()       {},
    restore()    {},
    moveTo: (x: number, y: number) => num('moveTo', x, y),
    lineTo: (x: number, y: number) => num('lineTo', x, y),
    quadraticCurveTo: (a: number, b: number, c: number, d: number) => num('quadraticCurveTo', a, b, c, d),
    arc: (x: number, y: number, rad: number) => {
      num('arc', x, y, rad)
      if (rad < 0) r.bad.push(`arc radius ${rad}`)
    },
    ellipse: (x: number, y: number, rx: number, ry: number) => {
      num('ellipse', x, y, rx, ry)
      if (rx < 0 || ry < 0) r.bad.push(`ellipse radius ${rx},${ry}`)
    },
    rect:       (x: number, y: number, w: number, h: number) => num('rect', x, y, w, h),
    clearRect:  (x: number, y: number, w: number, h: number) => num('clearRect', x, y, w, h),
    fillRect:   (x: number, y: number, w: number, h: number) => num('fillRect', x, y, w, h),
    translate:  (x: number, y: number) => num('translate', x, y),
    rotate:     (a: number) => num('rotate', a),
    scale:      (x: number, y: number) => {
      num('scale', x, y)
      if (x === 0 || y === 0) r.bad.push('scale by zero')
    },
    fill()   { r.draws++ },
    stroke() { r.draws++; r.strokesThisFrame++ },
    createLinearGradient: (...v: number[]) => { num('createLinearGradient', ...v); return grad },
    createRadialGradient: (...v: number[]) => { num('createRadialGradient', ...v); return grad },
  }

  r.ctx = ctx as unknown as Ctx
  return r
}

const SIZES: [number, number][] = [[1440, 800], [420, 900]]   // desktop, phone portrait
const FRAMES = 400                                            // ~6.7s at 60fps

for (const [key, make] of Object.entries(SCENE_FX)) {
  for (const [w, h] of SIZES) {
    const r = recorder()
    const fx = make()
    let peakStrokes = 0
    let threw = ''
    try {
      fx.seed(w, h)
      let t = 0
      for (let i = 0; i < FRAMES; i++) {
        const dt = 1 / 60
        t += dt
        r.resetFrame()
        r.ctx.clearRect(0, 0, w, h)
        fx.draw(r.ctx, w, h, t, dt)
        peakStrokes = Math.max(peakStrokes, r.strokesThisFrame)
        // Every effect must hand the context back in the default mode, or the
        // next frame — and every other layer — inherits 'lighter'.
        if (r.ctx.globalCompositeOperation !== 'source-over') {
          threw = `left globalCompositeOperation as ${r.ctx.globalCompositeOperation}`
          break
        }
      }
    } catch (e) {
      threw = String(e)
    }

    const at = `${key} @${w}x${h}`
    eq(`${at} runs clean`, threw, '')
    eq(`${at} passes only finite numbers`, r.bad.slice(0, 3).join(' | '), '')
    check(`${at} actually draws`, r.draws > 0, `${r.draws} draw calls`)
    // A pool that grows without bound shows up as ever-more strokes per frame.
    check(`${at} stays bounded`, peakStrokes < 4000, `peak ${peakStrokes} strokes/frame`)
  }
}

// Fireworks is the one effect that creates particles on a timer rather than
// recycling a fixed pool, so give it a long run and watch the per-frame cost.
{
  const r = recorder()
  const fx = SCENE_FX.fireworks()
  fx.seed(1440, 800)
  let t = 0, peak = 0
  for (let i = 0; i < 60 * 90; i++) {          // 90 seconds
    const dt = 1 / 60
    t += dt
    r.resetFrame()
    fx.draw(r.ctx, 1440, 800, t, dt)
    peak = Math.max(peak, r.strokesThisFrame)
  }
  check('fireworks does not accumulate over 90s', peak < 800, `peak ${peak} strokes/frame`)
  eq('fireworks passes only finite numbers', r.bad.slice(0, 3).join(' | '), '')
}

// Reseeding mid-flight (what a window resize does) must not strand old particles
// at coordinates from the previous size.
{
  const r = recorder()
  const fx = SCENE_FX.snowfall()
  fx.seed(1440, 800)
  for (let i = 0; i < 30; i++) fx.draw(r.ctx, 1440, 800, i / 60, 1 / 60)
  fx.seed(600, 400)
  for (let i = 0; i < 30; i++) fx.draw(r.ctx, 600, 400, i / 60, 1 / 60)
  eq('reseed after resize is clean', r.bad.slice(0, 3).join(' | '), '')
}

// Every scene named in the registry must exist in the scene table, or the lookup
// in LoginArt silently finds nothing and the canvas stays empty.
{
  const keys = ['downpour', 'snowfall', 'clearDay', 'moons', 'forge', 'blossom',
                'hallows', 'yule', 'fireworks', 'clearNight']
  for (const k of keys) check(`${k} has an effect`, typeof SCENE_FX[k] === 'function')
  eq('no unexpected effects', Object.keys(SCENE_FX).sort().join(','), [...keys].sort().join(','))
}

if (failures.length) {
  console.error(`loginArtFx: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error('  ✗ ' + f)
  process.exit(1)
}
console.log(`loginArtFx: ${passed} assertions passed`)
