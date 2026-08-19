/**
 * Procedural login-screen scenes, drawn to a canvas at runtime.
 *
 * No image assets: every scene is gradients, particles and shapes, so the login
 * screen costs nothing to download, themes correctly, and can vary with the
 * calendar. Which scene is shown is decided in lib/loginScene.ts — this module
 * only knows how to draw them.
 *
 * Each scene is a factory returning a draw function, so per-scene state (particle
 * fields, cached ground, star fields) lives in the closure and is seeded once per
 * canvas size rather than rebuilt on every frame.
 */

export type Ctx = CanvasRenderingContext2D

/** Draw one frame. `t` is seconds since mount, `dt` seconds since the last frame. */
export type SceneDraw = (ctx: Ctx, w: number, h: number, t: number, dt: number) => void

export type HatKind = 'santa' | 'witch' | 'pilgrim' | 'sam' | 'party'

/**
 * Mutable per-mount state the scenes read at draw time. Loomy needs to know which
 * hat to wear, and that is decided by the calendar rather than by the scene.
 */
export interface SceneEnv { hat: HatKind | null }

interface Pal { body: string; shade: string; hi: string; line: string }
interface LimbStyle { fill: string; line: string; shade: string; hi: string }
interface Pose {
  lean?: number; armF?: number; armB?: number; legF?: number; legB?: number
  crouch?: number; headX?: number; hatTilt?: number
}
interface Look { shade?: number; into?: number[]; rim?: string; rimDir?: number; lantern?: boolean }
interface PlaceCfg {
  s: number; x: number; y: number; shadow?: number; wave?: boolean
  pose: Pose; look: Look
}
interface GroundCfg {
  key: string; top: number; amp: number; phase: number; seed?: number
  fill: string; edge?: string; tuftColor?: string; speckColor?: string
  specks?: number; stones?: number; tufts?: number; litter?: number
}
interface GroundFeatures {
  prof: number[]
  yAt: (x: number) => number
  specks: { x: number; y: number; r: number; a: number }[]
  stones: { x: number; y: number; rx: number; ry: number; rot: number; a: number }[]
  tufts: { x: number; y: number; n: number; hgt: number; spread: number; ph: number }[]
  litter: { x: number; y: number; rx: number; rot: number; a: number; warm: number }[]
}

/**
 * Scene-local particle scratch. Every scene invents its own fields — a raindrop
 * has a depth, a bat has a wingbeat, an ember has a lifetime — and none of it
 * leaves the closure it is seeded in, so a dozen throwaway interfaces would be
 * ceremony rather than safety.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Scratch = any

/** One of the three moons, with its cached surface features. */
interface Moon {
  name: string; c: string; g: string
  ax: number; r: number; lit: number; sp: number
  _surf?: { maria: Scratch; craters: Scratch }
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a)

// Scenes read the live env at draw time; buildScenes() binds it.
let ENV: SceneEnv = { hat: null }

/* ── Finishing pass ─────────────────────────────────────────────────────────
   Applied over every scene, which is most of what separates "some shapes on a
   gradient" from something that looks photographed. Two parts:

   • Film grain. Flat canvas gradients band visibly on a large panel; a little
     noise breaks the bands up and gives the whole set a common surface. Blended
     with `overlay` so mid-grey is neutral — it textures both the dark scenes and
     Clear Day without lightening or dirtying either.
   • Vignette. Pulls the corners down so the eye lands on the card.

   The grain is re-offset ~12 times a second rather than every frame: at 60fps it
   shimmers, which is noise, not texture.
*/
let _grainTile: HTMLCanvasElement | null = null
const GRAIN = new WeakMap<Ctx, CanvasPattern>()
function grainTile(): HTMLCanvasElement {
  if (_grainTile) return _grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const d = g.createImageData(128, 128);
  for (let i = 0; i < d.data.length; i += 4) {
    // Two summed uniforms ≈ a triangular distribution: fewer extreme specks than
    // flat white noise, which reads finer.
    const v = 128 + (Math.random() - 0.5) * 46 + (Math.random() - 0.5) * 46;
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    d.data[i + 3] = 255;
  }
  g.putImageData(d, 0, 0);
  _grainTile = c;
  return c;
}

export function finishFrame(ctx: Ctx, w: number, h: number, t: number, reduce: boolean): void {
  let pat = GRAIN.get(ctx);
  if (!pat) { pat = ctx.createPattern(grainTile(), 'repeat')!; GRAIN.set(ctx, pat); }
  const step = reduce ? 0 : Math.floor(t * 12);
  const ox = (step * 37) % 128, oy = (step * 61) % 128;
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.05;
  ctx.translate(-ox, -oy);
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, w + 128, h + 128);
  ctx.restore();

  const v = ctx.createRadialGradient(w * 0.5, h * 0.46, Math.min(w, h) * 0.26,
                                   w * 0.5, h * 0.5,  Math.max(w, h) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.62, 'rgba(0,0,0,0.10)');
  v.addColorStop(1, 'rgba(0,0,0,0.34)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
}

/* ── Canvas plumbing ────────────────────────────────────────────────────── */
export function fit(cv: HTMLCanvasElement): { ctx: Ctx; w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const r = cv.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (cv.width !== w * dpr || cv.height !== h * dpr) {
    cv.width = w * dpr; cv.height = h * dpr;
  }
  const ctx = cv.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx: ctx, w: w, h: h };
}

/* ── Scene 0 · Downpour ─────────────────────────────────────────────────── */
function downpour(density: number): SceneDraw {
  let drops: Scratch = null, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    drops = [];
    const n = Math.max(46, Math.round(density * (w * h) / 6800));
    const sc = Math.max(0.5, Math.min(1.2, h / 460));   // streaks scale with the canvas
    for (let i = 0; i < n; i++) {
      const d = Math.pow(Math.random(), 1.4);       // bias toward far drops
      drops.push({
        x: Math.random() * w, y: Math.random() * h, d: d,
        len: (12 + d * 24) * sc, sp: (340 + d * 520) * sc, w: 0.6 + d * 1.9, a: 0.18 + d * 0.7
      });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!drops || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0e0b26'); sky.addColorStop(0.55, '#161139'); sky.addColorStop(1, '#1d1748');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Lantern light pooling below the card.
    const glow = ctx.createRadialGradient(w * 0.5, h * 0.92, 0, w * 0.5, h * 0.92, h * 0.75);
    glow.addColorStop(0, 'rgba(240,162,74,0.16)');
    glow.addColorStop(0.45, 'rgba(154,149,255,0.07)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

    const tilt = 0.16;
    for (let i = 0; i < drops.length; i++) {
      const p = drops[i];
      p.y += p.sp * dt; p.x += p.sp * tilt * dt;
      if (p.y - p.len > h) { p.y = -p.len - Math.random() * h * 0.3; p.x = Math.random() * (w + 120) - 60; }
      if (p.x > w + 40) p.x -= w + 80;
      ctx.strokeStyle = 'rgba(190,205,255,' + p.a.toFixed(3) + ')';
      ctx.lineWidth = p.w;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - p.len);
      ctx.lineTo(p.x + p.len * tilt, p.y);
      ctx.stroke();
      if (p.d > 0.72) {                            // bright head on near drops
        ctx.strokeStyle = 'rgba(226,234,255,' + (p.a * 0.9).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(p.x + p.len * tilt * 0.72, p.y - p.len * 0.28);
        ctx.lineTo(p.x + p.len * tilt, p.y);
        ctx.stroke();
      }
    }

    // Wet sheen along the bottom edge.
    const sheen = ctx.createLinearGradient(0, h * 0.86, 0, h);
    sheen.addColorStop(0, 'rgba(0,0,0,0)'); sheen.addColorStop(1, 'rgba(150,160,220,0.10)');
    ctx.fillStyle = sheen; ctx.fillRect(0, h * 0.86, w, h * 0.14);
  };
}

/* ── Scene 1 · Three Moons ──────────────────────────────────────────────── */
// `lit` is the illuminated fraction, 0 new → 1 full. Avoid exactly 0.5: a
// half-lit moon has a zero-width terminator ellipse, i.e. a dead-straight
// shadow line. `sp` is drift in screen-widths per second.
const MOONS: Moon[] = [
  { name: 'Katamba', c: '#8d8798', g: 'rgba(150,140,170,.42)', ax: 0.20, r: 0.033, lit: 0.22, sp: 0.0026 },
  { name: 'Xibar',   c: '#8fb6e8', g: 'rgba(140,185,235,.50)', ax: 0.54, r: 0.042, lit: 0.88, sp: 0.0034 },
  { name: 'Yavash',  c: '#d06a6a', g: 'rgba(210,90,95,.45)',   ax: 0.83, r: 0.028, lit: 0.68, sp: 0.0021 }
];
function moons(): SceneDraw {
  let stars: Scratch = null, clouds: Scratch = null, shoot: Scratch = null, nextShoot = 4, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    stars = [];
    const n = Math.round((w * h) / 5200);
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * w, y: Math.random() * h * 0.78,
                   r: rand(0.4, 1.25), a: rand(0.18, 0.75), s: rand(0.4, 1.5), o: Math.random() * 6.28 });
    }
    // Thin cloud banks — the scene's readable motion. The moons themselves
    // drift too, but at a real sky's pace you only notice it over a long hold.
    clouds = [];
    for (let j = 0; j < 5; j++) {
      clouds.push({ x: Math.random() * w * 1.4 - w * 0.2, y: h * rand(0.08, 0.60),
                    w: w * rand(0.26, 0.56), h: h * rand(0.028, 0.055),
                    sp: rand(3.5, 11), a: rand(0.04, 0.10) });
    }
    w0 = w; h0 = h;
  }
  // Surface features in unit-disc coordinates, generated once per moon from a
  // fixed seed and cached — a moon whose craters move is worse than no craters.
  function surface(m: Moon, idx: number) {
    if (m._surf) return m._surf;
    let s = 1013 + idx * 7717;
    const rnd = function () { s = (s * 16807 + 49297) % 233280; return s / 233280; };
    const f: { maria: Scratch; craters: Scratch } = { maria: [], craters: [] };
    for (let i = 0, nm = 3 + ((rnd() * 3) | 0); i < nm; i++) {
      const a = rnd() * 6.2832, d = rnd() * 0.58;
      f.maria.push({ x: Math.cos(a) * d, y: Math.sin(a) * d,
                     rx: 0.18 + rnd() * 0.28, ry: 0.13 + rnd() * 0.22,
                     rot: rnd() * 3.1416, a: 0.09 + rnd() * 0.15 });
    }
    // sqrt() on the radius spreads craters evenly over the disc's AREA; without
    // it they bunch in the middle.
    for (let j = 0, nc = 7 + ((rnd() * 8) | 0); j < nc; j++) {
      const a2 = rnd() * 6.2832, d2 = Math.sqrt(rnd()) * 0.84;
      f.craters.push({ x: Math.cos(a2) * d2, y: Math.sin(a2) * d2,
                       r: 0.035 + rnd() * 0.095, a: 0.10 + rnd() * 0.20 });
    }
    m._surf = f;
    return f;
  }
  function disc(ctx: Ctx, cx: number, cy: number, r: number, m: Moon, t: number, idx: number) {
    const halo = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 4.6);
    halo.addColorStop(0, m.g); halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(cx, cy, r * 4.6, 0, 6.2832); ctx.fill();

    const f = surface(m, idx);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.clip();

    ctx.fillStyle = m.c;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);

    // Maria: broad, soft, low-contrast darkening.
    for (let i = 0; i < f.maria.length; i++) {
      const ma = f.maria[i];
      ctx.fillStyle = 'rgba(0,0,0,' + ma.a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.ellipse(cx + ma.x * r, cy + ma.y * r, ma.rx * r, ma.ry * r, ma.rot, 0, 6.2832);
      ctx.fill();
    }
    // Craters: a dark floor with a lit rim on the sunward (left) side, which is
    // what actually makes a disc read as a sphere rather than a sticker.
    for (let j = 0; j < f.craters.length; j++) {
      const c = f.craters[j];
      const ccx = cx + c.x * r, ccy = cy + c.y * r, cr = c.r * r;
      ctx.fillStyle = 'rgba(0,0,0,' + c.a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, 6.2832); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,' + (c.a * 0.7).toFixed(3) + ')';
      ctx.lineWidth = Math.max(0.5, cr * 0.28);
      ctx.beginPath(); ctx.arc(ccx, ccy, cr * 0.92, Math.PI * 0.72, Math.PI * 1.56); ctx.stroke();
    }
    // Limb darkening, offset toward the light.
    const ld = ctx.createRadialGradient(cx - r * 0.28, cy - r * 0.28, r * 0.08, cx, cy, r * 1.02);
    ld.addColorStop(0, 'rgba(255,255,255,0.13)');
    ld.addColorStop(0.58, 'rgba(0,0,0,0)');
    ld.addColorStop(1, 'rgba(0,0,0,0.44)');
    ctx.fillStyle = ld;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    ctx.restore();

    // Terminator. The unlit region is the left semicircle joined to an ellipse
    // of half-width r*|k|, where k = 1-2*lit runs +1 (new) to -1 (full). The
    // ellipse bulges right when k>0 (shadow past half → crescent) and left when
    // k<0 (shadow short of half → gibbous), which is the sweep flag below.
    const k = 1 - 2 * m.lit;
    ctx.fillStyle = 'rgba(9,7,24,0.93)';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, true);
    ctx.ellipse(cx, cy, r * Math.abs(k), r, 0, Math.PI / 2, -Math.PI / 2, k > 0);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.stroke();
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!stars || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a0820'); sky.addColorStop(0.62, '#141033'); sky.addColorStop(1, '#241d54');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const a = s.a * (0.62 + 0.38 * Math.sin(t * s.s + s.o));
      ctx.fillStyle = 'rgba(226,231,255,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }

    // Shooting star: rare punctuation, never twice at once.
    nextShoot -= dt;
    if (!shoot && nextShoot <= 0) {
      shoot = { x: rand(w * 0.1, w * 0.8), y: rand(h * 0.05, h * 0.35),
                vx: rand(140, 240), vy: rand(48, 96), life: 0, max: rand(0.7, 1.1) };
      nextShoot = rand(11, 22);
    }
    if (shoot) {
      shoot.life += dt;
      if (shoot.life > shoot.max) { shoot = null; }
      else {
        const k = shoot.life / shoot.max;
        const sx = shoot.x + shoot.vx * shoot.life, sy = shoot.y + shoot.vy * shoot.life;
        let tail = 46 * (1 - k * 0.5);
        const g = ctx.createLinearGradient(sx, sy, sx - shoot.vx * 0.19, sy - shoot.vy * 0.19);
        g.addColorStop(0, 'rgba(236,240,255,' + (0.85 * Math.sin(k * Math.PI)).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(236,240,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        ctx.lineTo(sx - shoot.vx * 0.19, sy - shoot.vy * 0.19); ctx.stroke();
        if (tail < 0) tail = 0;
      }
    }

    for (let j = 0; j < MOONS.length; j++) {
      const m = MOONS[j];
      // Drift across the sky, wrapping well outside the frame so a moon never
      // pops in at the edge. Arc height follows the horizontal position.
      const span = 1.34, px = ((m.ax + 0.17 + t * m.sp) % span + span) % span - 0.17;
      const arc = Math.sin(Math.max(0, Math.min(1, px)) * Math.PI);
      disc(ctx, w * px, h * (0.70 - arc * 0.44), Math.max(5, h * m.r), m, t, j);
    }

    // Cloud banks drift over the moons, so they read as being in front.
    for (let c = 0; c < clouds.length; c++) {
      const cl = clouds[c];
      cl.x += cl.sp * dt;
      if (cl.x - cl.w > w) cl.x = -cl.w - Math.random() * w * 0.3;
      const cg = ctx.createRadialGradient(cl.x, cl.y, 0, cl.x, cl.y, cl.w);
      cg.addColorStop(0, 'rgba(150,146,200,' + cl.a.toFixed(3) + ')');
      cg.addColorStop(0.55, 'rgba(120,116,175,' + (cl.a * 0.45).toFixed(3) + ')');
      cg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.save();
      ctx.translate(cl.x, cl.y); ctx.scale(1, cl.h / cl.w); ctx.translate(-cl.x, -cl.y);
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(cl.x, cl.y, cl.w, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

    // Horizon: two soft ridges, back one lighter.
    ctx.fillStyle = '#191340';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.80);
    ctx.quadraticCurveTo(w * 0.30, h * 0.70, w * 0.55, h * 0.79);
    ctx.quadraticCurveTo(w * 0.80, h * 0.87, w, h * 0.76);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

    ctx.fillStyle = '#0d0a26';
    ctx.beginPath();
    ctx.moveTo(0, h);
    ctx.lineTo(0, h * 0.90);
    ctx.quadraticCurveTo(w * 0.38, h * 0.82, w * 0.66, h * 0.92);
    ctx.quadraticCurveTo(w * 0.85, h * 0.98, w, h * 0.89);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  };
}

/* ── Scene 2 · Forge ────────────────────────────────────────────────────── */
function forge(density: number): SceneDraw {
  let ps: Scratch = null, w0 = 0, h0 = 0;
  function spawn(w: number, h: number) {
    const sc = Math.max(0.6, Math.min(1.15, h / 460));
    return { x: rand(w * 0.18, w * 0.82), y: h * rand(0.86, 1.0),
             vy: rand(16, 52) * sc, vx: rand(-7, 7), o: Math.random() * 6.28,
             r: rand(0.9, 2.5) * sc, life: 0, max: rand(3.2, 7.5) };
  }
  function seed(w: number, h: number) {
    ps = [];
    const n = Math.max(34, Math.round(density * (w * h) / 15000));
    for (let i = 0; i < n; i++) { const p = spawn(w, h); p.life = Math.random() * p.max; p.y = rand(0, h); ps.push(p); }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!ps || w !== w0 || h !== h0) seed(w, h);

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b0818'); bg.addColorStop(0.55, '#170f24'); bg.addColorStop(1, '#2a1526');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    const flick = 0.86 + 0.14 * Math.sin(t * 2.7) * Math.sin(t * 1.13);
    const coals = ctx.createRadialGradient(w * 0.5, h * 1.02, 0, w * 0.5, h * 1.02, h * 0.82);
    coals.addColorStop(0, 'rgba(255,150,44,' + (0.42 * flick).toFixed(3) + ')');
    coals.addColorStop(0.35, 'rgba(224,90,30,' + (0.19 * flick).toFixed(3) + ')');
    coals.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = coals; ctx.fillRect(0, 0, w, h);

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life += dt;
      if (p.life > p.max || p.y < -10) { ps[i] = spawn(w, h); continue; }
      p.y -= p.vy * dt;
      p.x += (p.vx + Math.sin(t * 1.6 + p.o) * 11) * dt;
      const k = p.life / p.max;                       // 0 hot → 1 spent
      const a = Math.sin(Math.min(1, k * 1.05) * Math.PI) * 0.9;
      const col = k < 0.45 ? '255,196,96' : k < 0.75 ? '246,132,44' : '206,60,32';
      ctx.fillStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.45), 0, 6.2832); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = 'rgba(6,4,14,0.92)';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.94);
    ctx.quadraticCurveTo(w * 0.5, h * 0.86, w, h * 0.95);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  };
}

/* ── Scene 3 · Deep Water ───────────────────────────────────────────────── */
function deep(density: number): SceneDraw {
  let bs: Scratch = null, motes: Scratch = null, w0 = 0, h0 = 0;
  function spawn(w: number, h: number) {
    const sc = Math.max(0.55, Math.min(1.15, h / 460));
    return { x: Math.random() * w, y: h + rand(0, h * 0.5),
             r: rand(1.4, 6.5) * sc, vy: rand(18, 46) * sc, o: Math.random() * 6.28, sw: rand(6, 20) * sc };
  }
  function seed(w: number, h: number) {
    bs = [];
    const n = Math.max(30, Math.round(density * (w * h) / 14000));
    for (let i = 0; i < n; i++) { const b = spawn(w, h); b.y = Math.random() * h; bs.push(b); }
    // Marine snow — suspended matter. This is what tells you the water is a
    // volume you're inside of rather than a flat blue field.
    motes = [];
    const mn = Math.max(50, Math.round(density * (w * h) / 5200));
    for (let j = 0; j < mn; j++) {
      motes.push({ x: Math.random() * w, y: Math.random() * h, r: rand(0.4, 1.5),
                   a: rand(0.10, 0.42), vy: rand(-5, 9), o: Math.random() * 6.28, sw: rand(3, 12) });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!bs || w !== w0 || h !== h0) seed(w, h);

    const surge = Math.sin(t * 0.34) * w * 0.012 + Math.sin(t * 0.13) * w * 0.008;

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#1d6a86'); bg.addColorStop(0.22, '#144a68');
    bg.addColorStop(0.55, '#122a4e'); bg.addColorStop(1, '#080d26');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

    // ── Surface, seen from below ──────────────────────────────────────────
    const surf = h * 0.085;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(w, 0);
    ctx.lineTo(w, surf);
    for (let sx = w; sx >= 0; sx -= 8) {
      ctx.lineTo(sx, surf + Math.sin(sx * 0.021 + t * 1.5) * h * 0.012
                          + Math.sin(sx * 0.047 - t * 0.9) * h * 0.007);
    }
    ctx.closePath();
    ctx.clip();
    const sg = ctx.createLinearGradient(0, 0, 0, surf * 1.6);
    sg.addColorStop(0, 'rgba(186,240,255,0.42)'); sg.addColorStop(1, 'rgba(120,200,235,0.05)');
    ctx.fillStyle = sg; ctx.fillRect(0, 0, w, surf * 1.6);
    ctx.restore();

    // ── Caustics: crossing sine bands just under the surface ──────────────
    ctx.globalCompositeOperation = 'lighter';
    for (let c = 0; c < 3; c++) {
      ctx.strokeStyle = 'rgba(170,235,255,' + (0.042 - c * 0.011).toFixed(3) + ')';
      ctx.lineWidth = 2 + c;
      ctx.beginPath();
      for (let cx = 0; cx <= w; cx += 10) {
        const cy = h * (0.13 + c * 0.075)
               + Math.sin(cx * 0.017 + t * (1.1 + c * 0.4)) * h * 0.028
               + Math.sin(cx * 0.038 - t * 0.7) * h * 0.014;
        if (cx === 0) ctx.moveTo(cx, cy); else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }

    // Light shafts from the surface, wavering out of phase.
    for (let s = 0; s < 5; s++) {
      const base = w * (0.10 + s * 0.20) + Math.sin(t * 0.28 + s * 1.7) * w * 0.05;
      const wide = w * (0.045 + 0.02 * Math.sin(t * 0.4 + s));
      const g = ctx.createLinearGradient(base, 0, base + w * 0.10, h);
      g.addColorStop(0, 'rgba(150,215,255,0.15)');
      g.addColorStop(0.6, 'rgba(120,180,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(base - wide, 0); ctx.lineTo(base + wide, 0);
      ctx.lineTo(base + w * 0.10 + wide * 2.4, h); ctx.lineTo(base + w * 0.10 - wide * 2.4, h);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    // ── Marine snow ───────────────────────────────────────────────────────
    for (let mi = 0; mi < motes.length; mi++) {
      const mo = motes[mi];
      mo.y -= mo.vy * dt;
      if (mo.y < -2) { mo.y = h + 2; mo.x = Math.random() * w; }
      else if (mo.y > h + 2) { mo.y = -2; mo.x = Math.random() * w; }
      ctx.fillStyle = 'rgba(206,236,255,' + mo.a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(mo.x + Math.sin(t * 0.5 + mo.o) * mo.sw + surge * 0.5, mo.y, mo.r, 0, 6.2832);
      ctx.fill();
    }

    // Floor.
    ctx.fillStyle = 'rgba(6,14,30,0.9)';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.975);
    ctx.quadraticCurveTo(w * 0.45, h * 0.935, w, h * 0.97);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

    for (let i = 0; i < bs.length; i++) {
      const b = bs[i];
      b.y -= b.vy * dt;
      if (b.y < -b.r * 2) bs[i] = spawn(w, h);
      const x = b.x + Math.sin(t * 1.1 + b.o) * b.sw + surge;
      ctx.strokeStyle = 'rgba(190,230,255,0.34)'; ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(160,215,255,0.09)';
      ctx.beginPath(); ctx.arc(x, b.y, b.r, 0, 6.2832); ctx.fill(); ctx.stroke();
      ctx.fillStyle = 'rgba(235,250,255,0.42)';
      ctx.beginPath(); ctx.arc(x - b.r * 0.3, b.y - b.r * 0.36, Math.max(0.5, b.r * 0.24), 0, 6.2832); ctx.fill();
    }

    const vig = ctx.createRadialGradient(w * 0.5, h * 0.42, h * 0.2, w * 0.5, h * 0.5, h * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(4,8,26,0.55)');
    ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);
  };
}

/* ── Scene 4 · Snowfall ─────────────────────────────────────────────────── */
function snowfall(density: number): SceneDraw {
  let fl: Scratch = null, w0 = 0, h0 = 0;
  const GLYPHS = ['❄', '❅', '❆'];
  function seed(w: number, h: number) {
    fl = [];
    const n = Math.max(44, Math.round(density * (w * h) / 8200));
    const sc = Math.max(0.5, Math.min(1.2, h / 460));
    for (let i = 0; i < n; i++) {
      const d = Math.pow(Math.random(), 1.3);
      fl.push({
        x: Math.random() * w, y: Math.random() * h, d: d,
        size: (5 + d * 13) * sc, vy: (13 + d * 34) * sc,
        o: Math.random() * 6.28, sw: (7 + d * 16) * sc,
        rot: Math.random() * 6.28, rs: rand(-0.5, 0.5),
        a: 0.22 + d * 0.62, g: GLYPHS[(Math.random() * 3) | 0]
      });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!fl || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0d1130'); sky.addColorStop(0.5, '#182047'); sky.addColorStop(1, '#2b3465');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Cold haze rising off the snow.
    const haze = ctx.createLinearGradient(0, h * 0.55, 0, h);
    haze.addColorStop(0, 'rgba(0,0,0,0)'); haze.addColorStop(1, 'rgba(196,214,255,0.16)');
    ctx.fillStyle = haze; ctx.fillRect(0, h * 0.55, w, h * 0.45);

    // Drifted ground.
    ctx.fillStyle = 'rgba(214,226,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.93);
    ctx.quadraticCurveTo(w * 0.30, h * 0.885, w * 0.58, h * 0.925);
    ctx.quadraticCurveTo(w * 0.82, h * 0.955, w, h * 0.905);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i < fl.length; i++) {
      const p = fl[i];
      p.y += p.vy * dt;
      p.rot += p.rs * dt;
      if (p.y - p.size > h) { p.y = -p.size; p.x = Math.random() * w; }
      const x = p.x + Math.sin(t * 0.6 + p.o) * p.sw;
      ctx.save();
      ctx.translate(x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = 'rgba(232,240,255,' + p.a.toFixed(3) + ')';
      ctx.font = p.size.toFixed(1) + 'px serif';
      ctx.fillText(p.g, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  };
}

/* ── Scene 5 · Clear Day ────────────────────────────────────────────────── */
function daylight(): SceneDraw {
  let cl: Scratch = null, birds: Scratch = null, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    cl = [];
    for (let i = 0; i < 6; i++) {
      cl.push({ x: Math.random() * w * 1.3 - w * 0.15, y: h * rand(0.10, 0.52),
                w: w * rand(0.14, 0.34), f: rand(0.30, 0.52),
                sp: rand(4, 13), a: rand(0.30, 0.72) });
    }
    birds = [];
    for (let j = 0; j < 5; j++) {
      birds.push({ x: Math.random() * w, y: h * rand(0.18, 0.42),
                   sp: rand(11, 24), s: rand(5, 9), o: Math.random() * 6.28 });
    }
    w0 = w; h0 = h;
  }
  function puff(ctx: Ctx, cx: number, cy: number, r: number, f: number, a: number) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, 'rgba(255,253,248,' + a.toFixed(3) + ')');
    g.addColorStop(0.62, 'rgba(250,247,255,' + (a * 0.92).toFixed(3) + ')');
    g.addColorStop(0.84, 'rgba(238,236,250,' + (a * 0.34).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(238,236,250,0)');
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, f); ctx.translate(-cx, -cy);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 6.2832); ctx.fill();
    ctx.restore();
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!cl || w !== w0 || h !== h0) seed(w, h);

    // Late afternoon rather than blazing noon, so the dark card still sits
    // comfortably on it.
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#2f5fa8'); sky.addColorStop(0.42, '#6f9ed0');
    sky.addColorStop(0.74, '#b9cfe2'); sky.addColorStop(1, '#e8d3a8');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    const sunX = w * 0.78, sunY = h * 0.26;
    const halo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, h * 0.72);
    halo.addColorStop(0, 'rgba(255,244,206,0.95)');
    halo.addColorStop(0.09, 'rgba(255,232,168,0.62)');
    halo.addColorStop(0.34, 'rgba(255,222,160,0.20)');
    halo.addColorStop(1, 'rgba(255,222,160,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,252,236,0.95)';
    ctx.beginPath(); ctx.arc(sunX, sunY, Math.max(6, h * 0.032), 0, 6.2832); ctx.fill();

    for (let i = 0; i < cl.length; i++) {
      const c = cl[i];
      c.x += c.sp * dt;
      if (c.x - c.w * 1.6 > w) c.x = -c.w * 1.6 - Math.random() * w * 0.2;
      // Three offset puffs read as one cloud with a flat base.
      puff(ctx, c.x, c.y, c.w * 0.62, c.f, c.a);
      puff(ctx, c.x + c.w * 0.44, c.y + c.w * 0.05, c.w * 0.46, c.f, c.a * 0.9);
      puff(ctx, c.x - c.w * 0.40, c.y + c.w * 0.06, c.w * 0.40, c.f, c.a * 0.85);
    }

    for (let b = 0; b < birds.length; b++) {
      const bd = birds[b];
      bd.x += bd.sp * dt;
      if (bd.x - 20 > w) { bd.x = -20; bd.y = h * rand(0.18, 0.42); }
      const flap = Math.sin(t * 5.5 + bd.o) * 0.5 + 0.75;
      const by = bd.y + Math.sin(t * 0.5 + bd.o) * h * 0.012;
      ctx.strokeStyle = 'rgba(44,54,80,0.60)'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(bd.x - bd.s, by);
      ctx.quadraticCurveTo(bd.x - bd.s * 0.4, by - bd.s * flap, bd.x, by);
      ctx.quadraticCurveTo(bd.x + bd.s * 0.4, by - bd.s * flap, bd.x + bd.s, by);
      ctx.stroke();
    }

    // Hazy distance so the horizon doesn't cut hard.
    const hz = ctx.createLinearGradient(0, h * 0.72, 0, h);
    hz.addColorStop(0, 'rgba(232,211,168,0)'); hz.addColorStop(1, 'rgba(240,222,185,0.55)');
    ctx.fillStyle = hz; ctx.fillRect(0, h * 0.72, w, h * 0.28);
  };
}

/* ── Scene 6 · Grove ────────────────────────────────────────────────────── */
function grove(density: number): SceneDraw {
  let trees: Scratch = null, leaves: Scratch = null, w0 = 0, h0 = 0;
  function spawnLeaf(w: number, h: number) {
    return { x: Math.random() * w, y: rand(-h * 0.1, h * 0.75),
             r: rand(1.2, 3.0), vy: rand(7, 22), o: Math.random() * 6.28,
             sw: rand(10, 34), a: rand(0.25, 0.65) };
  }
  function seed(w: number, h: number) {
    trees = [];
    const n = 5;
    for (let i = 0; i < n; i++) {
      const d = i / (n - 1);                     // 0 far → 1 near
      trees.push({ x: w * (0.10 + 0.20 * i) + rand(-w * 0.035, w * 0.035),
                   hh: h * (0.34 + 0.30 * ((i % 2) ? d : 1 - d * 0.5)),
                   d: (i % 2) ? d : 1 - d * 0.6, ph: Math.random() * 6.28 });
    }
    leaves = [];
    const m = Math.max(16, Math.round(density * (w * h) / 20000));
    for (let j = 0; j < m; j++) leaves.push(spawnLeaf(w, h));
    w0 = w; h0 = h;
  }
  // Recursive limbs. Sway grows toward the tips, which is what makes it read
  // as a breeze moving through the crown rather than the whole tree rocking.
  function limb(ctx: Ctx, x: number, y: number, len: number, ang: number, wid: number, depth: number, t: number, ph: number, gust: number) {
    if (depth <= 0 || len < 1.6) return;
    const a = ang + Math.sin(t * 1.15 + ph + depth * 0.7) * gust * (8 - depth) * 0.016;
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    ctx.lineWidth = Math.max(0.5, wid);
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
    limb(ctx, x2, y2, len * 0.75, a - rand(0.34, 0.46), wid * 0.66, depth - 1, t, ph, gust);
    limb(ctx, x2, y2, len * 0.73, a + rand(0.32, 0.44), wid * 0.66, depth - 1, t, ph, gust);
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!trees || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#161238'); sky.addColorStop(0.46, '#2b2350');
    sky.addColorStop(0.80, '#6b4560'); sky.addColorStop(1, '#c07a4e');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.34, h * 0.92, 0, w * 0.34, h * 0.92, h * 0.62);
    glow.addColorStop(0, 'rgba(255,186,110,0.34)'); glow.addColorStop(1, 'rgba(255,186,110,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);

    // One shared gust so every tree leans together, as wind actually works.
    const gust = 0.55 + 0.45 * Math.sin(t * 0.27) + 0.22 * Math.sin(t * 0.73 + 1.3);

    for (let i = 0; i < trees.length; i++) {
      const tr = trees[i];
      // Atmospheric perspective: distant trees are hazier and bluer.
      const op = 0.34 + tr.d * 0.56;
      ctx.strokeStyle = 'rgba(14,10,30,' + op.toFixed(3) + ')';
      ctx.lineCap = 'round';
      // rand() inside limb() must be deterministic per frame or the tree
      // shivers, so re-seed the branch angles from the tree's own phase.
      const save = Math.random;
      let s = tr.ph * 1000;
      Math.random = function () { s = (s * 16807 + 49297) % 233280; return s / 233280; };
      limb(ctx, tr.x, h, tr.hh * 0.36, -Math.PI / 2, 3.4 + tr.d * 3.2, 7, t, tr.ph, gust * (0.5 + tr.d * 0.7));
      Math.random = save;
    }
    ctx.lineCap = 'butt';

    // Ground.
    ctx.fillStyle = 'rgba(10,7,22,0.94)';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.965);
    ctx.quadraticCurveTo(w * 0.5, h * 0.99, w, h * 0.955);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();

    for (let j = 0; j < leaves.length; j++) {
      const lf = leaves[j];
      lf.y += lf.vy * dt;
      lf.x += (6 + gust * 14) * dt;
      if (lf.y > h || lf.x > w + 10) { leaves[j] = spawnLeaf(w, h); leaves[j].x = -8; continue; }
      ctx.fillStyle = 'rgba(236,168,104,' + lf.a.toFixed(3) + ')';
      ctx.save();
      ctx.translate(lf.x + Math.sin(t * 1.3 + lf.o) * lf.sw, lf.y);
      ctx.rotate(t * 1.6 + lf.o);
      ctx.beginPath(); ctx.ellipse(0, 0, lf.r * 1.7, lf.r * 0.8, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
  };
}

/* ── Scene 7 · Blossom (spring) ─────────────────────────────────────────── */
function blossom(density: number): SceneDraw {
  let ps: Scratch = null, w0 = 0, h0 = 0;
  function spawn(w: number, h: number) {
    return { x: Math.random() * w * 1.2 - w * 0.1, y: Math.random() * -h * 0.2,
             r: rand(2.2, 5.4), vy: rand(14, 34), vx: rand(6, 22),
             rot: Math.random() * 6.28, rs: rand(-1.6, 1.6),
             o: Math.random() * 6.28, sw: rand(8, 26), warm: Math.random() };
  }
  function seed(w: number, h: number) {
    ps = [];
    const n = Math.max(30, Math.round(density * (w * h) / 11000));
    for (let i = 0; i < n; i++) { const p = spawn(w, h); p.y = Math.random() * h; ps.push(p); }
    w0 = w; h0 = h;
  }
  // A bough reaching in from the edge, so the petals have somewhere to come from.
  // Drawn as a bezier walked in short segments with a shrinking line width — a
  // branch that doesn't taper reads as a drawn line, and one made of straight
  // pieces kinks at every joint.
  function qpt(x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, u: number) {
    const m = 1 - u;
    return { x: m * m * x0 + 2 * m * u * cx + u * u * x1,
             y: m * m * y0 + 2 * m * u * cy + u * u * y1 };
  }
  // Five petals round a yellow centre. Blossom grows in clusters on the wood;
  // scattering single dots near a branch just looks like dirt.
  function cluster(ctx: Ctx, x: number, y: number, r: number, seed: number) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 6.2832 + seed;
      ctx.fillStyle = (i % 2) ? 'rgba(255,229,238,0.95)' : 'rgba(246,193,213,0.95)';
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85,
                  r * 0.62, r * 0.46, a, 0, 6.2832);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(250,214,126,0.92)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.26, 0, 6.2832); ctx.fill();
  }
  function limb(ctx: Ctx, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, wid: number, t: number, phase: number, blooms: boolean, w: number, h: number) {
    ctx.strokeStyle = 'rgba(48,32,34,0.82)';
    ctx.lineCap = 'round';
    const N = 22; const pts: { x: number; y: number }[] = [];
    let prev = qpt(x0, y0, cx, cy, x1, y1, 0);
    for (let i = 1; i <= N; i++) {
      const u = i / N;
      const p = qpt(x0, y0, cx, cy, x1, y1, u);
      // Sway grows toward the tip, as with the grove's crowns.
      p.y += Math.sin(t * 0.7 + phase + u * 2.6) * h * 0.008 * u * u;
      p.x += Math.cos(t * 0.5 + phase + u * 2.1) * w * 0.004 * u * u;
      ctx.lineWidth = Math.max(0.8, wid * (1 - u * 0.78));
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      pts.push(p); prev = p;
    }
    ctx.lineCap = 'butt';
    if (blooms) {
      for (let j = 0; j < pts.length; j++) {
        const u2 = (j + 1) / N;
        if (u2 < 0.34) continue;                       // bare near the trunk
        if (j % 3) continue;
        cluster(ctx, pts[j].x, pts[j].y + h * 0.006, Math.max(2.2, h * 0.011 * (1.15 - u2 * 0.4)), u2 * 9);
      }
      cluster(ctx, pts[N - 1].x, pts[N - 1].y, Math.max(2.4, h * 0.012), 1.7);
    }
    return pts;
  }
  function bough(ctx: Ctx, w: number, h: number, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, wid: number, t: number, phase: number) {
    const pts = limb(ctx, x0, y0, cx, cy, x1, y1, wid, t, phase, true, w, h);
    // A couple of twigs off the main run, each ending in blossom.
    for (let k = 0; k < 2; k++) {
      const at = pts[6 + k * 7];
      if (!at) continue;
      const dx = (x1 - x0) * 0.16, dy = h * (k ? 0.10 : 0.07);
      limb(ctx, at.x, at.y, at.x + dx * 0.5, at.y + dy * 0.3,
           at.x + dx, at.y + dy, wid * 0.42, t, phase + 1.4 + k, true, w, h);
    }
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!ps || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#7fb2d8'); sky.addColorStop(0.45, '#b9d5e4');
    sky.addColorStop(0.78, '#e3e4d4'); sky.addColorStop(1, '#cfd9ab');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    const haze = ctx.createLinearGradient(0, h * 0.62, 0, h);
    haze.addColorStop(0, 'rgba(150,190,120,0)'); haze.addColorStop(1, 'rgba(126,172,96,0.42)');
    ctx.fillStyle = haze; ctx.fillRect(0, h * 0.62, w, h * 0.38);

    // Deterministic per-frame randomness for the boughs (see grove()).
    const save = Math.random; let s = 4242;
    Math.random = function () { s = (s * 16807 + 49297) % 233280; return s / 233280; };
    // Deliberately not a mirrored pair — the long one sweeps in from the left and
    // dips; the short one comes down from the right and stays high.
    bough(ctx, w, h, -w * 0.04, h * 0.06, w * 0.20, h * 0.30, w * 0.46, h * 0.24, 8.0, t, 0);
    bough(ctx, w, h, w * 1.04, h * 0.02, w * 0.86, h * 0.10, w * 0.70, h * 0.20, 5.6, t, 2.1);
    Math.random = save;

    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.y += p.vy * dt; p.x += p.vx * dt; p.rot += p.rs * dt;
      if (p.y - p.r > h || p.x - p.r > w) ps[i] = spawn(w, h);
      ctx.save();
      ctx.translate(p.x + Math.sin(t * 0.9 + p.o) * p.sw, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.warm > 0.5 ? 'rgba(255,222,232,0.92)' : 'rgba(246,186,208,0.92)';
      ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * 0.58, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
  };
}

/* ── Scene 8 · Harvest (autumn / Thanksgiving) ──────────────────────────── */
function harvest(density: number): SceneDraw {
  let stalks: Scratch = null, chaff: Scratch = null, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    stalks = [];
    const n = Math.max(26, Math.round(w / 14));
    for (let i = 0; i < n; i++) {
      stalks.push({ x: (i / n) * w * 1.06 - w * 0.03 + rand(-6, 6),
                    h: h * rand(0.16, 0.34), ph: Math.random() * 6.28,
                    lean: rand(-0.10, 0.10), d: Math.random() });
    }
    chaff = [];
    const m = Math.max(14, Math.round(density * (w * h) / 26000));
    for (let j = 0; j < m; j++) {
      chaff.push({ x: Math.random() * w, y: Math.random() * h * 0.9,
                   r: rand(0.6, 1.8), vy: rand(-4, 6), vx: rand(5, 16),
                   o: Math.random() * 6.28, a: rand(0.2, 0.55) });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!stalks || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1e1330'); sky.addColorStop(0.38, '#4a2440');
    sky.addColorStop(0.68, '#a8543a'); sky.addColorStop(1, '#e0913f');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // The harvest moon: big, low and amber.
    const mx = w * 0.26, my = h * 0.44, mr = Math.max(10, h * 0.062);
    const halo = ctx.createRadialGradient(mx, my, mr * 0.7, mx, my, mr * 4.2);
    halo.addColorStop(0, 'rgba(255,190,110,0.34)'); halo.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, mr * 4.2, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#f8c979';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();

    const gust = 0.6 + 0.4 * Math.sin(t * 0.31) + 0.2 * Math.sin(t * 0.83);

    for (let j = 0; j < chaff.length; j++) {
      const c = chaff[j];
      c.x += (c.vx + gust * 12) * dt; c.y -= c.vy * dt;
      if (c.x > w + 4) { c.x = -4; c.y = Math.random() * h * 0.9; }
      ctx.fillStyle = 'rgba(255,214,150,' + c.a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(c.x, c.y + Math.sin(t * 0.8 + c.o) * 6, c.r, 0, 6.2832); ctx.fill();
    }

    drawGround(ctx, w, h, {
      key: 'harvest', top: 0.945, amp: 0.012, phase: 1.1, seed: 8123,
      fill: 'rgba(38,18,12,0.94)', edge: 'rgba(196,120,52,0.35)',
      stones: 16, tufts: 22, litter: 10, tuftColor: 'rgba(78,42,20,0.75)',
    });

    placeLoomy(ctx, w, h, t, {
      s: 0.30, x: 0.82, y: 0.955, shadow: 0.22,
      pose: { armF: 0.24, armB: -0.20, legF: 0.09, legB: -0.09, hatTilt: -0.05 },
      look: { shade: 0.42, into: [46, 20, 22], rim: 'rgba(255,206,130,0.6)', rimDir: 1 },
    });

    // Wheat, leaning together on the gust.
    for (let i = 0; i < stalks.length; i++) {
      const st = stalks[i];
      const sway = Math.sin(t * 1.05 + st.ph) * 0.5 + gust * 0.55;
      const tipX = st.x + (st.lean + sway * 0.22) * st.h;
      const tipY = h - st.h;
      ctx.strokeStyle = 'rgba(46,24,16,' + (0.55 + st.d * 0.4).toFixed(2) + ')';
      ctx.lineWidth = 1 + st.d * 1.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(st.x, h);
      ctx.quadraticCurveTo(st.x + (st.lean + sway * 0.1) * st.h * 0.5, h - st.h * 0.55, tipX, tipY);
      ctx.stroke();
      // Grain head.
      ctx.fillStyle = 'rgba(58,30,18,' + (0.6 + st.d * 0.35).toFixed(2) + ')';
      ctx.save();
      ctx.translate(tipX, tipY);
      ctx.rotate((st.lean + sway * 0.22) * 0.9);
      ctx.beginPath(); ctx.ellipse(0, -st.h * 0.05, 2 + st.d * 1.6, st.h * 0.075, 0, 0, 6.2832); ctx.fill();
      ctx.restore();
    }
    ctx.lineCap = 'butt';
  };
}

/* ── Scene 9 · Hallows (Halloween) ──────────────────────────────────────── */
function hallows(_density: number): SceneDraw {
  let bats: Scratch = null, fog: Scratch = null, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    bats = [];
    for (let i = 0; i < 7; i++) {
      bats.push({ x: Math.random() * w, y: h * rand(0.10, 0.48),
                  sp: rand(20, 50), s: rand(8, 15), o: Math.random() * 6.28,
                  bob: rand(0.4, 1.1) });
    }
    fog = [];
    for (let j = 0; j < 5; j++) {
      fog.push({ x: Math.random() * w * 1.3 - w * 0.15, y: h * (0.86 + j * 0.035),
                 w: w * rand(0.22, 0.42), h: h * rand(0.022, 0.05),
                 sp: rand(4, 12), a: rand(0.05, 0.11) });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!bats || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#0a0716'); sky.addColorStop(0.5, '#1a1024');
    sky.addColorStop(0.82, '#391c24'); sky.addColorStop(1, '#160b16');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Low, bloated moon.
    const mx = w * 0.22, my = h * 0.24, mr = Math.max(9, h * 0.055);
    const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 5);
    halo.addColorStop(0, 'rgba(255,166,74,0.28)'); halo.addColorStop(1, 'rgba(255,166,74,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, mr * 5, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#f7c073';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, 6.2832); ctx.fill();
    // A couple of dark maria so it isn't a flat disc.
    ctx.fillStyle = 'rgba(180,110,50,0.35)';
    ctx.beginPath(); ctx.arc(mx - mr * 0.3, my - mr * 0.2, mr * 0.3, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + mr * 0.35, my + mr * 0.3, mr * 0.2, 0, 6.2832); ctx.fill();

    for (let i = 0; i < bats.length; i++) {
      const b = bats[i];
      b.x += b.sp * dt;
      if (b.x - 20 > w) { b.x = -20; b.y = h * rand(0.10, 0.48); }
      const flap = Math.sin(t * 8 + b.o);
      const by = b.y + Math.sin(t * b.bob + b.o) * h * 0.03;
      ctx.strokeStyle = 'rgba(10,7,14,0.92)'; ctx.lineWidth = 2.4; ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(b.x - b.s, by);
      ctx.quadraticCurveTo(b.x - b.s * 0.5, by - b.s * (0.5 + flap * 0.55), b.x, by);
      ctx.quadraticCurveTo(b.x + b.s * 0.5, by - b.s * (0.5 + flap * 0.55), b.x + b.s, by);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    // Jack-o'-lantern glow, guttering.
    const flick = 0.75 + 0.25 * Math.sin(t * 5.3) * Math.sin(t * 2.1);
    const pg = ctx.createRadialGradient(w * 0.5, h * 1.06, 0, w * 0.5, h * 1.06, h * 0.45);
    pg.addColorStop(0, 'rgba(255,146,32,' + (0.26 * flick).toFixed(3) + ')');
    pg.addColorStop(0.4, 'rgba(226,86,20,' + (0.09 * flick).toFixed(3) + ')');
    pg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pg; ctx.fillRect(0, 0, w, h);

    drawGround(ctx, w, h, {
      key: 'hallows', top: 0.945, amp: 0.014, phase: 2.7, seed: 5507,
      fill: 'rgba(16,10,16,0.95)', edge: 'rgba(150,90,40,0.30)',
      stones: 14, tufts: 16, litter: 18,
      tuftColor: 'rgba(46,32,26,0.85)',
    });

    placeLoomy(ctx, w, h, t, {
      s: 0.30, x: 0.83, y: 0.955, shadow: 0.34,
      pose: { armF: 1.05, armB: -0.55, legF: 0.48, legB: -0.44, lean: 0.10, hatTilt: -0.16 },
      look: { shade: 0.60, into: [26, 14, 22], rim: 'rgba(255,172,84,0.65)', rimDir: -1, lantern: true },
    });

    // Ground fog, drifting in slabs.
    for (let f = 0; f < fog.length; f++) {
      const fg = fog[f];
      fg.x += fg.sp * dt;
      if (fg.x - fg.w > w) fg.x = -fg.w - Math.random() * w * 0.2;
      const g = ctx.createRadialGradient(fg.x, fg.y, 0, fg.x, fg.y, fg.w);
      g.addColorStop(0, 'rgba(178,186,200,' + fg.a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(178,186,200,0)');
      ctx.save();
      ctx.translate(fg.x, fg.y); ctx.scale(1, fg.h / fg.w); ctx.translate(-fg.x, -fg.y);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(fg.x, fg.y, fg.w, 0, 6.2832); ctx.fill();
      ctx.restore();
    }

  };
}

/* ── Scene 10 · Yule ────────────────────────────────────────────────────── */
function yule(density: number): SceneDraw {
  let fl: Scratch = null, lights: Scratch = null, firs: Scratch = null, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    fl = [];
    const n = Math.max(40, Math.round(density * (w * h) / 9000));
    const sc = Math.max(0.5, Math.min(1.2, h / 460));
    for (let i = 0; i < n; i++) {
      const d = Math.pow(Math.random(), 1.3);
      fl.push({ x: Math.random() * w, y: Math.random() * h, r: (0.9 + d * 2.2) * sc,
                vy: (11 + d * 30) * sc, o: Math.random() * 6.28, sw: (5 + d * 14) * sc,
                a: 0.3 + d * 0.6 });
    }
    firs = [];
    const m = 9;
    for (let j = 0; j < m; j++) {
      const tiers = 4 + ((Math.random() * 3) | 0);
      const jit = [];
      for (let q = 0; q < tiers; q++) jit.push(rand(-w * 0.004, w * 0.004));
      const back = Math.random();
      firs.push({ x: w * (j / (m - 1)) + rand(-w * 0.03, w * 0.03),
                  h: h * (0.20 + (1 - back) * 0.26), wd: rand(0.30, 0.46),
                  tiers: tiers, jit: jit, back: back });
    }
    lights = [];
    for (let k = 0; k < 26; k++) {
      lights.push({ x: Math.random() * w, y: h * rand(0.60, 0.90),
                    r: rand(1.4, 3.0), o: Math.random() * 6.28, sp: rand(0.6, 2.2),
                    warm: Math.random() });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!fl || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#08102a'); sky.addColorStop(0.5, '#102040');
    sky.addColorStop(1, '#1c3352');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Warmth spilling from somewhere off-frame.
    const warm = ctx.createRadialGradient(w * 0.5, h * 0.98, 0, w * 0.5, h * 0.98, h * 0.7);
    warm.addColorStop(0, 'rgba(255,186,104,0.20)'); warm.addColorStop(1, 'rgba(255,186,104,0)');
    ctx.fillStyle = warm; ctx.fillRect(0, 0, w, h);

    function drift(baseY: number, amp: number, fill: string|CanvasGradient, phase: number) {
      // fill may be a gradient; callers build it against the bank height.
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, h); ctx.lineTo(0, h * baseY);
      for (let x = 0; x <= w + 1; x += w / 14) {
        ctx.lineTo(x, h * baseY
          + Math.sin(x / w * 5.2 + phase) * h * amp
          + Math.sin(x / w * 11.3 + phase * 1.7) * h * amp * 0.45);
      }
      ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
    }
    // Behind the trees.
    drift(0.895, 0.032, 'rgba(150,174,214,0.30)', 0.6);

    // Firs. Each tier is a dark bough with snow lying on its upper surface —
    // that snow is what makes them read as winter trees rather than green
    // triangles, and it ties them to the drifts they stand in.
    for (let j = 0; j < firs.length; j++) {
      const f = firs[j];
      // Atmospheric perspective: the further back, the more the night air
      // washes them toward the sky colour.
      const dark = 'rgba(' + Math.round(8 + f.back * 14) + ',' +
                           Math.round(26 + f.back * 18) + ',' +
                           Math.round(24 + f.back * 30) + ',0.97)';
      const snowA = 0.42 - f.back * 0.18;
      for (let k = 0; k < f.tiers; k++) {
        const frac = k / f.tiers;
        const apex = h - f.h * (1 - frac * 0.58) + f.jit[k];
        const hem  = h - f.h * (0.46 - frac * 0.44);       // where the bough ends
        const half = f.h * f.wd * (0.34 + frac * 0.70);
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.moveTo(f.x + f.jit[k] * 0.6, apex);
        ctx.lineTo(f.x - half, hem);
        ctx.lineTo(f.x + half, hem);
        ctx.closePath(); ctx.fill();

        // Snow caught on the bough: the same wedge, shorter and narrower, so it
        // sits along the top edges instead of covering the whole tier.
        ctx.fillStyle = 'rgba(226,238,255,' + snowA.toFixed(2) + ')';
        ctx.beginPath();
        ctx.moveTo(f.x + f.jit[k] * 0.6, apex + f.h * 0.008);
        ctx.lineTo(f.x - half * 0.44, hem - (hem - apex) * 0.60);
        ctx.lineTo(f.x - half * 0.20, hem - (hem - apex) * 0.70);
        ctx.lineTo(f.x + half * 0.24, hem - (hem - apex) * 0.66);
        ctx.lineTo(f.x + half * 0.48, hem - (hem - apex) * 0.58);
        ctx.closePath(); ctx.fill();
      }
    }

    // Drifted up over the trunks, so the firs are planted in it.
    placeLoomy(ctx, w, h, t, {
      s: 0.30, x: 0.83, y: 0.940, shadow: 0.16, wave: true,
      pose: { armF: 1.95, armB: -0.28, legF: 0.07, legB: -0.07 },
      look: { shade: 0.30, into: [28, 44, 78], rim: 'rgba(216,238,255,0.6)', rimDir: 1, lantern: false },
    });

    const bank = ctx.createLinearGradient(0, h * 0.90, 0, h);
    bank.addColorStop(0, '#c9d8f2');
    bank.addColorStop(0.45, '#dfe9fb');
    bank.addColorStop(1, '#eef4ff');
    drift(0.925, 0.024, bank, 2.3);

    // Lights strung through them, breathing out of phase.
    for (let m = 0; m < lights.length; m++) {
      const l = lights[m];
      const a = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t * l.sp + l.o));
      const col = l.warm > 0.62 ? '255,196,110' : l.warm > 0.3 ? '255,138,110' : '150,226,190';
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 5);
      g.addColorStop(0, 'rgba(' + col + ',' + (a * 0.75).toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r * 5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = 'rgba(' + col + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(l.x, l.y, l.r, 0, 6.2832); ctx.fill();
    }

    for (let i = 0; i < fl.length; i++) {
      const p = fl[i];
      p.y += p.vy * dt;
      if (p.y - p.r > h) { p.y = -p.r; p.x = Math.random() * w; }
      ctx.fillStyle = 'rgba(232,242,255,' + p.a.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(t * 0.55 + p.o) * p.sw, p.y, p.r, 0, 6.2832); ctx.fill();
    }

  };
}

/* ── Scene 11 · Fireworks (New Year) ────────────────────────────────────── */
function fireworks(): SceneDraw {
  let shells: Scratch = null, sparks: Scratch = null, stars: Scratch = null, next = 0.4, w0 = 0, h0 = 0;
  const HUES = ['255,206,120', '255,132,150', '150,200,255', '186,150,255', '150,255,196'];
  function seed(w: number, h: number) {
    shells = []; sparks = [];
    stars = [];
    const n = Math.round((w * h) / 7000);
    for (let i = 0; i < n; i++) {
      stars.push({ x: Math.random() * w, y: Math.random() * h * 0.8, r: rand(0.3, 1.1), a: rand(0.12, 0.5) });
    }
    burst(w * rand(0.18, 0.44), h * rand(0.20, 0.34), w, h, rand(0.10, 0.30));
    burst(w * rand(0.56, 0.86), h * rand(0.24, 0.42), w, h, rand(0.25, 0.55));
    shells.push({ x: w * rand(0.2, 0.8), y: h * 0.72,
                  vy: -h * 0.40, top: h * rand(0.18, 0.36) });
    next = rand(0.2, 0.6);
    w0 = w; h0 = h;
  }
  function burst(x: number, y: number, w: number, h: number, age?: number) {
    const hue = HUES[(Math.random() * HUES.length) | 0];
    const n = 34 + ((Math.random() * 26) | 0);
    const speed = h * rand(0.12, 0.26);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.2832 + rand(-0.05, 0.05);
      const v = speed * rand(0.55, 1);
      const p = { x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
                life: 0, max: rand(1.3, 2.2), hue: hue, r: rand(1.4, 2.9) };
      // Fast-forward, so a freshly-mounted scene is already mid-bloom rather
      // than opening on an empty sky for the first second and a half.
      if (age) {
        const steps = Math.round(age / 0.016);
        for (let k = 0; k < steps; k++) {
          p.x += p.vx * 0.016; p.y += p.vy * 0.016;
          p.vy += h * 0.16 * 0.016;
          p.vx *= 1 - 0.9 * 0.016; p.vy *= 1 - 0.35 * 0.016;
        }
        p.life = age;
      }
      sparks.push(p);
    }
  }
  return function(ctx: Ctx, w: number, h: number, t: number, dt: number) {
    if (!shells || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#070a20'); sky.addColorStop(0.6, '#0e1436'); sky.addColorStop(1, '#1a1c48');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    for (let s = 0; s < stars.length; s++) {
      ctx.fillStyle = 'rgba(220,228,255,' + stars[s].a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(stars[s].x, stars[s].y, stars[s].r, 0, 6.2832); ctx.fill();
    }

    next -= dt;
    if (next <= 0) {
      shells.push({ x: rand(w * 0.15, w * 0.85), y: h,
                    vy: -h * rand(0.34, 0.46), top: h * rand(0.16, 0.44) });
      next = rand(0.30, 1.05);
    }

    ctx.globalCompositeOperation = 'lighter';

    for (let i = shells.length - 1; i >= 0; i--) {
      const sh = shells[i];
      sh.y += sh.vy * dt;
      sh.vy += h * 0.10 * dt;                    // gravity slows the climb
      ctx.fillStyle = 'rgba(255,226,180,0.9)';
      ctx.beginPath(); ctx.arc(sh.x, sh.y, 1.8, 0, 6.2832); ctx.fill();
      const trail = ctx.createLinearGradient(sh.x, sh.y, sh.x, sh.y + h * 0.06);
      trail.addColorStop(0, 'rgba(255,206,140,0.5)'); trail.addColorStop(1, 'rgba(255,206,140,0)');
      ctx.fillStyle = trail; ctx.fillRect(sh.x - 1, sh.y, 2, h * 0.06);
      if (sh.y <= sh.top || sh.vy >= 0) { burst(sh.x, sh.y, w, h); shells.splice(i, 1); }
    }

    for (let j = sparks.length - 1; j >= 0; j--) {
      const p = sparks[j];
      p.life += dt;
      if (p.life > p.max) { sparks.splice(j, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vy += h * 0.16 * dt;                     // fall
      p.vx *= 1 - 0.9 * dt; p.vy *= 1 - 0.35 * dt;   // air drag
      const k = p.life / p.max;
      const a = (1 - k * k) * (0.78 + 0.22 * Math.sin(p.life * 34));  // twinkle as they die
      ctx.fillStyle = 'rgba(' + p.hue + ',' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.4), 0, 6.2832); ctx.fill();
    }

    ctx.globalCompositeOperation = 'source-over';

    drawGround(ctx, w, h, {
      key: 'fireworks', top: 0.940, amp: 0.013, phase: 0.4, seed: 3391,
      fill: 'rgba(10,12,30,0.96)', edge: 'rgba(150,170,230,0.22)',
      stones: 8, tufts: 26,
      tuftColor: 'rgba(40,50,86,0.9)',
    });

    placeLoomy(ctx, w, h, t, {
      s: 0.29, x: 0.82, y: 0.950, shadow: 0.30,
      pose: { armF: 2.05, armB: -2.00, legF: 0.11, legB: -0.11, hatTilt: -0.04 },
      look: { shade: 0.68, into: [12, 14, 38], rim: 'rgba(206,224,255,0.55)', rimDir: 1 },
    });
  };
}

/* ── Scene 12 · Clear Night ─────────────────────────────────────────────────
   The night counterpart to Clear Day. Deliberately moonless — Three Moons owns
   the moons; this one is just depth, so it can be the quiet default that any
   night falls back to without competing with anything.
*/
function clearNight(): SceneDraw {
  let stars: Scratch = null, band: Scratch = null, w0 = 0, h0 = 0;
  function seed(w: number, h: number) {
    stars = [];
    const n = Math.round((w * h) / 2600);
    for (let i = 0; i < n; i++) {
      // Squared brightness: mostly faint pinpricks with a few real standouts,
      // which is what a real sky looks like. Uniform brightness reads as static.
      const b = Math.pow(Math.random(), 2.2);
      stars.push({ x: Math.random() * w, y: Math.random() * h * 0.88,
                   r: 0.35 + b * 1.5, a: 0.14 + b * 0.8,
                   s: 0.3 + Math.random() * 1.5, o: Math.random() * 6.28,
                   warm: Math.random() });
    }
    // A denser drift of stars across the diagonal stands in for the galactic band.
    band = [];
    const m = Math.round((w * h) / 4200);
    for (let j = 0; j < m; j++) {
      const u = Math.random();
      const bx = u * w * 1.2 - w * 0.1;
      const by = h * 0.16 + u * h * 0.42 + (Math.random() - 0.5) * h * 0.20;
      band.push({ x: bx, y: by, r: 0.3 + Math.random() * 0.8, a: 0.08 + Math.random() * 0.3 });
    }
    w0 = w; h0 = h;
  }
  return function(ctx: Ctx, w: number, h: number, t: number) {
    if (!stars || w !== w0 || h !== h0) seed(w, h);

    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#05061a'); sky.addColorStop(0.45, '#0b1030');
    sky.addColorStop(0.80, '#182050'); sky.addColorStop(1, '#2b3162');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h);

    // Faint airglow along the horizon.
    const glow = ctx.createLinearGradient(0, h * 0.62, 0, h);
    glow.addColorStop(0, 'rgba(90,120,190,0)');
    glow.addColorStop(1, 'rgba(120,146,214,0.24)');
    ctx.fillStyle = glow; ctx.fillRect(0, h * 0.62, w, h * 0.38);

    const mw = ctx.createLinearGradient(0, h * 0.10, w, h * 0.66);
    mw.addColorStop(0, 'rgba(150,160,220,0)');
    mw.addColorStop(0.5, 'rgba(158,168,226,0.07)');
    mw.addColorStop(1, 'rgba(150,160,220,0)');
    ctx.fillStyle = mw; ctx.fillRect(0, 0, w, h);
    for (let j = 0; j < band.length; j++) {
      ctx.fillStyle = 'rgba(214,222,255,' + band[j].a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(band[j].x, band[j].y, band[j].r, 0, 6.2832); ctx.fill();
    }

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const a = s.a * (0.68 + 0.32 * Math.sin(t * s.s + s.o));
      ctx.fillStyle = s.warm > 0.86 ? 'rgba(255,224,196,' + a.toFixed(3) + ')'
                    : s.warm < 0.12 ? 'rgba(198,216,255,' + a.toFixed(3) + ')'
                                    : 'rgba(236,240,255,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.2832); ctx.fill();
    }

    // Low ridgeline, so the sky has a floor.
    ctx.fillStyle = '#0a0c22';
    ctx.beginPath();
    ctx.moveTo(0, h); ctx.lineTo(0, h * 0.88);
    ctx.quadraticCurveTo(w * 0.26, h * 0.83, w * 0.52, h * 0.89);
    ctx.quadraticCurveTo(w * 0.78, h * 0.95, w, h * 0.86);
    ctx.lineTo(w, h); ctx.closePath(); ctx.fill();
  };
}

/* ── Loomy ──────────────────────────────────────────────────────────────────
   The mascot turns up for holidays, wearing the appropriate hat. He stands off
   to the left, clear of the sign-in card, and the hats are drawn procedurally
   against his head geometry so one artwork covers every occasion.
*/
/* ── Ground ─────────────────────────────────────────────────────────────────
   A figure standing on a flat band reads as pasted on, however well he's drawn,
   so each holiday scene gets a real surface: an uneven profile plus scattered
   debris appropriate to the place. Everything is generated once per size from a
   fixed seed and cached — ground that reshuffles every frame is worse than flat
   ground.
*/
function seededRnd(seed: number): () => number {
  let s = seed % 233280;
  return function () { s = (s * 16807 + 49297) % 233280; return s / 233280; };
}

const _ground: Record<string, GroundFeatures> = {};
function groundFeatures(key: string, w: number, h: number, cfg: GroundCfg): GroundFeatures {
  const k = key + '|' + Math.round(w) + 'x' + Math.round(h);
  if (_ground[k]) return _ground[k];
  const rnd = seededRnd(cfg.seed || 4211);
  const N = 28; const prof: number[] = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    prof.push(h * cfg.top
      + Math.sin(u * 6.3 + cfg.phase) * h * cfg.amp
      + Math.sin(u * 15.7 + cfg.phase * 2.1) * h * cfg.amp * 0.42
      + (rnd() - 0.5) * h * cfg.amp * 0.5);
  }
  const yAt = function(x: number) {
    const u = Math.max(0, Math.min(0.9999, x / w)) * N;
    const i0 = Math.floor(u), f = u - i0;
    return prof[i0] * (1 - f) + prof[Math.min(N, i0 + 1)] * f;
  };
  const pick = function(n: number, make: (px: number, py: number, r: () => number) => Scratch) {
    const out = [];
    for (let j = 0; j < n; j++) {
      const px = rnd() * w;
      out.push(make(px, yAt(px), rnd));
    }
    return out;
  };
  const f = {
    prof: prof, yAt: yAt,
    specks: pick(cfg.specks || 0, function(px: number, py: number, r: () => number) {
      return { x: px, y: py + r() * (h - py) * 0.92, r: 0.35 + r() * 1.15, a: 0.15 + r() * 0.6 };
    }),
    stones: pick(cfg.stones || 0, function(px: number, py: number, r: () => number) {
      return { x: px, y: py + r() * (h - py) * 0.75, rx: h * (0.004 + r() * 0.010),
               ry: h * (0.002 + r() * 0.005), rot: r() * 3.14, a: 0.35 + r() * 0.45 };
    }),
    tufts: pick(cfg.tufts || 0, function(px: number, py: number, r: () => number) {
      return { x: px, y: py + r() * (h - py) * 0.85, n: 3 + ((r() * 3) | 0),
               hgt: h * (0.012 + r() * 0.030), spread: r() * 0.5 + 0.2, ph: r() * 6.28 };
    }),
    litter: pick(cfg.litter || 0, function(px: number, py: number, r: () => number) {
      return { x: px, y: py + r() * (h - py) * 0.9, rx: h * (0.004 + r() * 0.007),
               rot: r() * 3.14, a: 0.3 + r() * 0.5, warm: r() };
    }),
  };
  _ground[k] = f;
  return f;
}

function drawGround(ctx: Ctx, w: number, h: number, cfg: GroundCfg): void {
  const f = groundFeatures(cfg.key, w, h, cfg);

  ctx.fillStyle = cfg.fill;
  ctx.beginPath();
  ctx.moveTo(0, h);
  ctx.lineTo(0, f.prof[0]);
  for (let i = 1; i < f.prof.length; i++) ctx.lineTo(w * (i / (f.prof.length - 1)), f.prof[i]);
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();

  // A lit lip along the crest separates ground from sky far better than a
  // colour change alone.
  if (cfg.edge) {
    ctx.strokeStyle = cfg.edge;
    ctx.lineWidth = Math.max(1, h * 0.004);
    ctx.beginPath();
    ctx.moveTo(0, f.prof[0]);
    for (let j = 1; j < f.prof.length; j++) ctx.lineTo(w * (j / (f.prof.length - 1)), f.prof[j]);
    ctx.stroke();
  }

  for (let a = 0; a < f.stones.length; a++) {
    const st = f.stones[a];
    ctx.fillStyle = 'rgba(0,0,0,' + st.a.toFixed(2) + ')';
    ctx.beginPath(); ctx.ellipse(st.x, st.y, st.rx, st.ry, st.rot, 0, 6.2832); ctx.fill();
  }
  for (let b = 0; b < f.tufts.length; b++) {
    const tu = f.tufts[b];
    ctx.strokeStyle = cfg.tuftColor || 'rgba(0,0,0,0.5)';
    ctx.lineWidth = Math.max(0.7, h * 0.0022);
    ctx.lineCap = 'round';
    for (let c = 0; c < tu.n; c++) {
      const ang = (c / (tu.n - 1 || 1) - 0.5) * tu.spread;
      ctx.beginPath();
      ctx.moveTo(tu.x, tu.y);
      ctx.quadraticCurveTo(tu.x + ang * tu.hgt * 0.7, tu.y - tu.hgt * 0.6,
                           tu.x + ang * tu.hgt * 1.7, tu.y - tu.hgt);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }
  for (let d = 0; d < f.litter.length; d++) {
    const li = f.litter[d];
    ctx.fillStyle = li.warm > 0.5
      ? 'rgba(196,120,58,' + li.a.toFixed(2) + ')'
      : 'rgba(150,86,44,' + li.a.toFixed(2) + ')';
    ctx.beginPath();
    ctx.ellipse(li.x, li.y, li.rx, li.rx * 0.45, li.rot, 0, 6.2832);
    ctx.fill();
  }
  for (let e = 0; e < f.specks.length; e++) {
    const sp = f.specks[e];
    ctx.fillStyle = (cfg.speckColor || 'rgba(255,255,255,') + sp.a.toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(sp.x, sp.y, sp.r, 0, 6.2832); ctx.fill();
  }
}

// Loomy is DRAWN, not pasted: a pasted sprite always reads as a sticker on top
// of the scene, and it cannot be re-posed. Built from capsules and circles off
// the reference art, so each scene can pose him and light him for itself.
const LOOMY_BASE = { body: [232,167,44], shade: [201,135,28], hi: [247,207,106], line: [91,58,23] };

function mix(rgb: number[], into: number[], t: number): string {
  const r = Math.round(rgb[0] + (into[0] - rgb[0]) * t);
  const g = Math.round(rgb[1] + (into[1] - rgb[1]) * t);
  const b = Math.round(rgb[2] + (into[2] - rgb[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// shade pushes him toward the scene's shadow colour, so he sits in the same
// light as everything around him instead of glowing at full saturation at night.
function loomyPal(shade: number, into?: number[]): Pal {
  into = into || [12, 10, 28];
  return {
    body:  mix(LOOMY_BASE.body,  into, shade),
    shade: mix(LOOMY_BASE.shade, into, shade),
    hi:    mix(LOOMY_BASE.hi,    into, shade * 0.75),
    line:  mix(LOOMY_BASE.line,  into, shade * 0.5),
  };
}

/** Five-pointed star, point up. */
function star(ctx: Ctx, cx: number, cy: number, r: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + i * Math.PI / 5;
    const rad = i % 2 ? r * 0.42 : r;
    const px = cx + Math.cos(a) * rad, py = cy + Math.sin(a) * rad;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fill();
}

function hat(ctx: Ctx, kind: HatKind, hx: number, hy: number, hr: number, lean: number): void {
  ctx.save();
  ctx.translate(hx, hy - hr * 0.86);
  ctx.rotate(lean);
  const stroke = function () {
    ctx.strokeStyle = 'rgba(58,36,20,0.85)';
    ctx.lineWidth = Math.max(1, hr * 0.075);
    ctx.stroke();
  };
  if (kind === 'santa') {
    ctx.fillStyle = '#c8202c';
    ctx.beginPath();
    ctx.moveTo(-hr * 0.92, 0);
    ctx.quadraticCurveTo(-hr * 0.30, -hr * 1.75, hr * 1.02, -hr * 1.30);
    ctx.quadraticCurveTo(hr * 0.30, -hr * 0.72, hr * 0.86, 0);
    ctx.closePath(); ctx.fill(); stroke();
    ctx.fillStyle = '#f4f2ee';
    ctx.beginPath();
    ctx.ellipse(-hr * 0.03, -hr * 0.12, hr * 1.02, hr * 0.30, 0, 0, 6.2832);
    ctx.fill(); stroke();
    ctx.beginPath(); ctx.arc(hr * 1.02, -hr * 1.30, hr * 0.30, 0, 6.2832); ctx.fill(); stroke();
  } else if (kind === 'witch') {
    ctx.fillStyle = '#221a33';
    ctx.beginPath();
    ctx.moveTo(-hr * 0.62, -hr * 0.10);
    ctx.quadraticCurveTo(-hr * 0.30, -hr * 1.60, hr * 0.34, -hr * 2.25);
    ctx.quadraticCurveTo(hr * 0.34, -hr * 1.10, hr * 0.66, -hr * 0.10);
    ctx.closePath(); ctx.fill(); stroke();
    ctx.beginPath();
    ctx.ellipse(0, 0, hr * 1.40, hr * 0.34, 0, 0, 6.2832);
    ctx.fill(); stroke();
    ctx.fillStyle = '#7b5cc4';
    ctx.beginPath();
    ctx.ellipse(0, -hr * 0.22, hr * 0.66, hr * 0.17, 0, 0, 6.2832);
    ctx.fill();
  } else if (kind === 'pilgrim') {
    ctx.fillStyle = '#1d1a20';
    ctx.beginPath();
    ctx.ellipse(0, 0, hr * 1.34, hr * 0.32, 0, 0, 6.2832);
    ctx.fill(); stroke();
    ctx.beginPath();
    ctx.moveTo(-hr * 0.60, 0);
    ctx.lineTo(-hr * 0.52, -hr * 1.24);
    ctx.lineTo(hr * 0.52, -hr * 1.24);
    ctx.lineTo(hr * 0.60, 0);
    ctx.closePath(); ctx.fill(); stroke();
    ctx.fillStyle = '#f0ece2';
    ctx.fillRect(-hr * 0.62, -hr * 0.52, hr * 1.24, hr * 0.30);
    ctx.fillStyle = '#e0b23c';
    ctx.fillRect(-hr * 0.20, -hr * 0.58, hr * 0.40, hr * 0.42);
    ctx.fillStyle = '#1d1a20';
    ctx.fillRect(-hr * 0.10, -hr * 0.48, hr * 0.20, hr * 0.22);
  } else if (kind === 'sam') {
    // Uncle Sam's topper: a tall stovepipe, white with VERTICAL red stripes and
    // a navy star band at the base. The stripes run up the crown, not around it —
    // getting that wrong makes it read as a generic carnival hat.
    const crownH = hr * 1.72, topHalf = hr * 0.70, botHalf = hr * 0.60;
    const crown = function () {
      ctx.beginPath();
      ctx.moveTo(-botHalf, 0);
      ctx.lineTo(-topHalf, -crownH);
      ctx.lineTo(topHalf, -crownH);
      ctx.lineTo(botHalf, 0);
      ctx.closePath();
    };
    // Brim first, so the crown sits on it.
    ctx.fillStyle = '#f4f2ee';
    ctx.beginPath();
    ctx.ellipse(0, 0, hr * 1.34, hr * 0.30, 0, 0, 6.2832);
    ctx.fill(); stroke();

    ctx.fillStyle = '#f4f2ee';
    crown(); ctx.fill();

    ctx.save();
    crown(); ctx.clip();
    ctx.fillStyle = '#c8202c';
    for (let s = 0; s < 4; s++) {
      const sx0 = -topHalf + hr * 0.20 + s * hr * 0.36;
      ctx.fillRect(sx0, -crownH - 2, hr * 0.17, crownH + 4);
    }
    // Navy band with stars, over the stripes.
    ctx.fillStyle = '#1e3a7a';
    ctx.fillRect(-hr, -hr * 0.62, hr * 2, hr * 0.62);
    ctx.fillStyle = '#f4f2ee';
    for (let k = 0; k < 3; k++) star(ctx, -hr * 0.36 + k * hr * 0.36, -hr * 0.31, hr * 0.15);
    ctx.restore();

    crown(); stroke();
    // Slight crown top, so it reads as a cylinder rather than a flat shape.
    ctx.fillStyle = '#f4f2ee';
    ctx.beginPath();
    ctx.ellipse(0, -crownH, topHalf, hr * 0.15, 0, 0, 6.2832);
    ctx.fill(); stroke();
  } else if (kind === 'party') {
    const g = ctx.createLinearGradient(-hr, 0, hr, -hr * 1.9);
    g.addColorStop(0, '#6467dc'); g.addColorStop(1, '#f0a24a');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-hr * 0.70, 0);
    ctx.lineTo(hr * 0.16, -hr * 2.05);
    ctx.lineTo(hr * 0.74, 0);
    ctx.closePath(); ctx.fill(); stroke();
    ctx.fillStyle = '#f7e39a';
    ctx.beginPath(); ctx.arc(hr * 0.16, -hr * 2.05, hr * 0.22, 0, 6.2832); ctx.fill(); stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath(); ctx.arc(-hr * 0.16, -hr * 0.70, hr * 0.11, 0, 6.2832); ctx.fill();
    ctx.beginPath(); ctx.arc(hr * 0.30, -hr * 1.24, hr * 0.09, 0, 6.2832); ctx.fill();
  }
  ctx.restore();
}


// A stitched seam: short ticks along a line. Loomy is a ragdoll, and the
// stitching is most of what says so.
function seam(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, n: number, len: number, colour: string, lw: number): void {
  ctx.strokeStyle = colour; ctx.lineWidth = lw; ctx.lineCap = 'round';
  const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L * len, ny = dx / L * len;
  for (let i = 0; i <= n; i++) {
    const u = i / n, px = x1 + dx * u, py = y1 + dy * u;
    ctx.beginPath();
    ctx.moveTo(px - nx, py - ny); ctx.lineTo(px + nx, py + ny);
    ctx.stroke();
  }
}

function capsule(ctx: Ctx, x1: number, y1: number, x2: number, y2: number, w: number, pal: LimbStyle, lw: number): void {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = pal.line; ctx.lineWidth = w + lw * 2;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.strokeStyle = pal.fill; ctx.lineWidth = w;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function lantern(ctx: Ctx, x: number, y: number, s: number, pal: LimbStyle, glow: boolean): void {
  const lw = Math.max(0.8, s * 0.018);
  if (glow) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, s * 1.9);
    g.addColorStop(0, 'rgba(255,196,110,0.55)');
    g.addColorStop(0.4, 'rgba(255,170,70,0.18)');
    g.addColorStop(1, 'rgba(255,170,70,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, s * 1.9, 0, 6.2832); ctx.fill();
  }
  ctx.strokeStyle = pal.line; ctx.lineWidth = lw;
  ctx.beginPath(); ctx.arc(x, y - s * 0.52, s * 0.20, Math.PI, 0); ctx.stroke();
  ctx.fillStyle = pal.shade;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.20, y - s * 0.32);
  ctx.lineTo(x + s * 0.20, y - s * 0.32);
  ctx.lineTo(x + s * 0.26, y + s * 0.30);
  ctx.lineTo(x - s * 0.26, y + s * 0.30);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = glow ? 'rgba(255,214,140,0.95)' : pal.hi;
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.15, s * 0.20, 0, 0, 6.2832); ctx.fill();
}

/**
 * Draw Loomy at (x, y) with y at his feet, `s` tall.
 *
 * pose angles are radians from straight-down, positive swinging outward, so a
 * scene can raise an arm or take a stride without any new artwork.
 */
function loomy(ctx: Ctx, x: number, y: number, s: number, pose: Pose, look: Look): { headX: number; headY: number; headR: number } {
  const p = pose || {}, k = look || {};
  const pal0 = loomyPal(k.shade || 0, k.into);
  const pal  = { fill: pal0.body,  line: pal0.line, shade: pal0.shade, hi: pal0.hi };
  const back = { fill: pal0.shade, line: pal0.line, shade: pal0.shade, hi: pal0.hi };
  const lw = Math.max(0.9, s * 0.014);

  // Proportions taken off the reference art: the head is nearly half his total
  // height and the body is small under it. Getting this ratio wrong is what
  // turns him into a blob — the torso must not climb into the head.
  const lean   = p.lean || 0;
  const hipY   = y - s * 0.20;
  const shY    = y - s * 0.42;
  const headR  = s * 0.23;
  const headY  = y - s * 0.70 + (p.crouch || 0) * s;
  const headX  = x + Math.sin(lean) * s * 0.10 + (p.headX || 0) * s;

  const limb = function(ax: number, ay: number, ang: number, len: number, wid: number, style: LimbStyle) {
    capsule(ctx, ax, ay, ax + Math.sin(ang) * len, ay + Math.cos(ang) * len, wid, style, lw);
    return { x: ax + Math.sin(ang) * len, y: ay + Math.cos(ang) * len };
  };

  // Back limbs first, in the shadow tone, so the figure has depth.
  limb(x - s * 0.105, shY, -(p.armB === undefined ? 0.35 : p.armB), s * 0.19, s * 0.068, back);
  limb(x - s * 0.060, hipY, -(p.legB === undefined ? 0.12 : p.legB), s * 0.20, s * 0.078, back);

  // Front leg.
  limb(x + s * 0.060, hipY, (p.legF === undefined ? 0.10 : p.legF), s * 0.20, s * 0.085, pal);

  // Torso.
  ctx.fillStyle = pal.fill; ctx.strokeStyle = pal.line; ctx.lineWidth = lw * 1.6;
  ctx.beginPath();
  ctx.ellipse(x + Math.sin(lean) * s * 0.04, y - s * 0.33, s * 0.135, s * 0.150, lean, 0, 6.2832);
  ctx.fill(); ctx.stroke();
  seam(ctx, x - s * 0.095, y - s * 0.26, x + s * 0.095, y - s * 0.28, 4, s * 0.020, pal.line, lw * 0.8);

  // Front arm, and whatever it is holding.
  const hand = limb(x + s * 0.105, shY,
                  (p.armF === undefined ? 0.30 : p.armF), s * 0.19, s * 0.072, pal);
  if (k.lantern) lantern(ctx, hand.x, hand.y + s * 0.09, s * 0.20, pal, true);

  // Head.
  ctx.fillStyle = pal.fill; ctx.strokeStyle = pal.line; ctx.lineWidth = lw * 1.7;
  ctx.beginPath(); ctx.arc(headX, headY, headR, 0, 6.2832); ctx.fill(); ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = pal.hi;
  ctx.beginPath();
  ctx.ellipse(headX + headR * 0.34, headY - headR * 0.42, headR * 0.28, headR * 0.15, -0.55, 0, 6.2832);
  ctx.fill();
  ctx.restore();
  seam(ctx, headX - headR * 0.1, headY + headR * 0.72, headX + headR * 0.28, headY + headR * 0.55,
       2, headR * 0.10, pal.line, lw * 0.7);

  // Rim light from the scene's key light — the cheapest way to seat a figure in
  // its surroundings rather than have it sit on top of them.
  if (k.rim) {
    ctx.save();
    ctx.strokeStyle = k.rim;
    ctx.lineWidth = Math.max(1, s * 0.017);
    const a0 = (k.rimDir || 0) < 0 ? Math.PI * 0.62 : -Math.PI * 0.42;
    ctx.beginPath(); ctx.arc(headX, headY, headR - lw * 0.4, a0, a0 + Math.PI * 0.78); ctx.stroke();
    ctx.restore();
  }

  if (ENV.hat) hat(ctx, ENV.hat, headX, headY, headR, (p.hatTilt === undefined ? -0.10 : p.hatTilt) + lean * 0.5);
  return { headX: headX, headY: headY, headR: headR };
}

/**
 * Place Loomy in a scene. Called from inside each holiday scene at the point in
 * its own draw order where he belongs — before the snow bank in Yule, before the
 * wheat in Harvest, before the fog in Hallows — so the scene's foreground closes
 * over him. That layering, not the drawing, is what stops him floating.
 */
function placeLoomy(ctx: Ctx, w: number, h: number, t: number, cfg: PlaceCfg): void {
  if (!ENV.hat) return;
  const s = h * cfg.s;
  const x = w * cfg.x;
  const yb = h * cfg.y + Math.sin(t * 1.05) * h * 0.004;
  loomyShadow(ctx, x, yb, s, cfg.shadow);
  const pose: Pose = {};
  type PoseMap = Record<string, number | undefined>
  for (const key in cfg.pose) (pose as PoseMap)[key] = (cfg.pose as PoseMap)[key];
  pose.lean = (cfg.pose.lean || 0) + Math.sin(t * 0.6) * 0.02;
  if (cfg.wave) pose.armF = (cfg.pose.armF || 0) + Math.sin(t * 2.4) * 0.22;
  loomy(ctx, x, yb, s, pose, cfg.look);
}

/** Soft contact shadow. Without one he hovers, whatever else is right. */
function loomyShadow(ctx: Ctx, x: number, y: number, s: number, alpha?: number): void {
  ctx.save();
  ctx.globalAlpha = alpha === undefined ? 0.28 : alpha;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(x, y, s * 0.20, s * 0.030, 0, 0, 6.2832);
  ctx.fill();
  ctx.restore();
}

// Order matches the tabs and the cards below.
export function buildScenes(d: number, env: SceneEnv): SceneDraw[] {
  ENV = env
  return [
    downpour(d), snowfall(d), daylight(), moons(), grove(d), forge(d), deep(d),
    blossom(d), harvest(d), hallows(d), yule(d), fireworks(), clearNight(),
  ];
}

