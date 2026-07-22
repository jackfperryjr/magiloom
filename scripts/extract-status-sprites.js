// Extract the per-condition status sprites from the ragdoll status spritesheet.
//
// Source: src/renderer/src/assets/emoji-ragdoll-2.png — a 4-column grid of ragdoll
// frames (rows 0-3 postures; rows 4-8 conditions). The sheet is hand-made and NOT a
// perfectly even grid, so we detect the real row/column boxes from the transparent
// gaps rather than assuming even division, then crop each mapped frame tightly.
//
// Output: src/renderer/src/assets/status/<id>.png — imported by StatusIcons.tsx and
// shown muted (greyscale) until the condition is active, then full colour.
//
// Run from the repo root:  node scripts/extract-status-sprites.js
// Requires: jimp (already a dependency).
const Jimp = require('jimp')
const path = require('path')

const ROOT  = path.join(__dirname, '..')
const SHEET = path.join(ROOT, 'src/renderer/src/assets/emoji-ragdoll-2.png')
const OUT   = path.join(ROOT, 'src/renderer/src/assets/status')

// [id, row, col] — 0-indexed, per the sheet layout.
const FRAMES = [
  ['hidden',   0, 2], ['stunned',  1, 1], ['bleeding', 2, 1],
  ['poisoned', 3, 0], ['diseased', 3, 2], ['webbed',   4, 1], ['dead', 4, 2],
]

const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t) }

// Extend the webbed figure's silk off the body to the frame edges + a couple of
// concentric threads, so it reads as pinned into a web anchored to the background.
// Returns a new (expanded) Jimp; the body is composited onto a padded canvas first.
function augmentWebbed(fig) {
  const fw = fig.bitmap.width, fh = fig.bitmap.height
  // Strands are drawn CHUNKY at full res so they survive the ~13x downscale to a
  // ~30px icon (thin strands vanish). padX/Y set how far the web reaches off the body.
  const mx = 58, my = 46, W = fw + mx * 2, H = fh + my * 2
  const c = new Jimp(W, H, 0x00000000); c.composite(fig, mx, my)
  const d = c.bitmap.data
  const put = (x, y, r, g, b, a) => { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return; const i = (y * W + x) * 4; const da = d[i + 3] / 255, oa = a + da * (1 - a); if (oa <= 0) return; d[i] = (r * a + d[i] * da * (1 - a)) / oa; d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa; d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa; d[i + 3] = oa * 255 }
  const COL = [238, 243, 250]
  const strand = (x0, y0, x1, y1, w, a0, a1) => {
    const minX = Math.floor(Math.min(x0, x1) - w), maxX = Math.ceil(Math.max(x0, x1) + w)
    const minY = Math.floor(Math.min(y0, y1) - w), maxY = Math.ceil(Math.max(y0, y1) + w)
    const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      let t = ((x - x0) * dx + (y - y0) * dy) / L2; t = Math.max(0, Math.min(1, t))
      const px = x0 + t * dx, py = y0 + t * dy, dist = Math.hypot(x - px, y - py)
      const cov = 1 - smooth(w / 2 - 1.1, w / 2, dist); if (cov <= 0) continue
      put(x, y, COL[0], COL[1], COL[2], (a0 + (a1 - a0) * t) * cov)
    }
  }
  const cx = mx + fw / 2, cy = my + fh / 2, rx = fw / 2, ry = fh / 2
  const targets = [[0, 0], [W, 0], [0, H], [W, H], [W / 2, 0], [W / 2, H], [0, H / 2], [W, H / 2]]
  const starts = []
  for (const [tx, ty] of targets) {
    let dx = tx - cx, dy = ty - cy; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l
    const er = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2), sx = cx + dx * er * 0.8, sy = cy + dy * er * 0.8
    starts.push([sx, sy]); strand(sx, sy, tx, ty, 15, 0.9, 0.6)
  }
  const ang = starts.map(([sx, sy]) => Math.atan2(sy - cy, sx - cx)), order = [...starts.keys()].sort((a, b) => ang[a] - ang[b])
  for (const ring of [0.4, 0.68]) for (let k = 0; k < order.length; k++) {
    const i = order[k], j = order[(k + 1) % order.length]
    const ax = starts[i][0] + (targets[i][0] - starts[i][0]) * ring, ay = starts[i][1] + (targets[i][1] - starts[i][1]) * ring
    const bx = starts[j][0] + (targets[j][0] - starts[j][0]) * ring, by = starts[j][1] + (targets[j][1] - starts[j][1]) * ring
    strand(ax, ay, bx, by, 9, 0.6, 0.6)
  }
  c.autocrop(0.001, false)
  return c
}

;(async () => {
  const img = await Jimp.read(SHEET)
  const W = img.bitmap.width, H = img.bitmap.height, d = img.bitmap.data
  const alpha = (x, y) => d[(y * W + x) * 4 + 3]

  // Vertical bands: contiguous runs of rows that hold content (alpha>60), split by
  // the transparent gaps between figure rows.
  const bands = []; let inB = false, s = 0
  const MINROW = Math.round(W * 0.004)
  for (let y = 0; y < H; y++) {
    let n = 0; for (let x = 0; x < W; x++) if (alpha(x, y) > 60) n++
    const has = n > MINROW
    if (has && !inB) { s = y; inB = true } else if (!has && inB) { bands.push([s, y]); inB = false }
  }
  if (inB) bands.push([s, H])

  // Column segments within a band, same gap-detection horizontally.
  const colsFor = ([y0, y1]) => {
    const MIN = Math.round((y1 - y0) * 0.02)
    const segs = []; let inC = false, cs = 0
    for (let x = 0; x < W; x++) {
      let n = 0; for (let y = y0; y < y1; y++) if (alpha(x, y) > 60) n++
      const has = n > MIN
      if (has && !inC) { cs = x; inC = true } else if (!has && inC) { segs.push([cs, x]); inC = false }
    }
    if (inC) segs.push([cs, W])
    return segs
  }

  for (const [id, row, col] of FRAMES) {
    const [y0, y1] = bands[row]
    const [x0, x1] = colsFor(bands[row])[col]
    const px = 3   // tiny margin, then autocrop cleans the AA edge
    const cx = Math.max(0, x0 - px), cy = Math.max(0, y0 - px)
    const cw = Math.min(W, x1 + px) - cx, ch = Math.min(H, y1 + px) - cy
    let cell = img.clone().crop(cx, cy, cw, ch)
    cell.autocrop(0.0005, false)
    if (id === 'webbed') cell = augmentWebbed(cell)   // extend the silk to the frame
    await cell.writeAsync(path.join(OUT, id + '.png'))
    console.log(`${id.padEnd(9)} ${cell.bitmap.width}x${cell.bitmap.height}`)
  }
  console.log('Done — status sprites written to src/renderer/src/assets/status/')
})().catch(e => { console.error(e); process.exit(1) })
