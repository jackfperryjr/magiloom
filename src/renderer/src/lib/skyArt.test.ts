/**
 * Calendar backdrop selection tests. Run: npm run test:tools
 *
 * The blend has to be continuous: at every daylight value the picture must be
 * the same just below and just above, or the panel visibly jumps at the seams.
 */
import { skyArtLayers, skyArtSet, fillViewBox, paintingBox, CORE, ART_HORIZON, type ArtLayer, type Box } from './skyArt'

let passed = 0
const failures: string[] = []
function eq<T>(name: string, got: T, want: T): void {
  if (JSON.stringify(got) === JSON.stringify(want)) passed++
  else failures.push(`${name} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`)
}

// How much of each light ends up on screen for a stack (top layer over bottom).
function mix([bottom, top]: [ArtLayer, ArtLayer]): Record<string, number> {
  const out: Record<string, number> = { day: 0, twilight: 0, night: 0 }
  out[bottom.light] += bottom.opacity * (1 - top.opacity)
  out[top.light]    += top.opacity
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 1000) / 1000
  return out
}

// ── Ends and middle ──────────────────────────────────────────────────────────
eq('deep night is all night',        mix(skyArtLayers(0, false)),   { day: 0, twilight: 0, night: 1 })
eq('full day is all day',            mix(skyArtLayers(1, false)),   { day: 1, twilight: 0, night: 0 })
eq('half light is all twilight',     mix(skyArtLayers(0.5, false)), { day: 0, twilight: 1, night: 0 })
eq('a quarter is night into dusk',   mix(skyArtLayers(0.25, false)), { day: 0, twilight: 0.5, night: 0.5 })
eq('three quarters is dusk into day', mix(skyArtLayers(0.75, false)), { day: 0.5, twilight: 0.5, night: 0 })

// ── No jump at the seam ──────────────────────────────────────────────────────
{
  const below = mix(skyArtLayers(0.4999, false)), above = mix(skyArtLayers(0.5001, false))
  eq('continuous through the twilight seam', Math.abs(below.twilight - above.twilight) < 0.002, true)
}

// ── Out-of-range daylight is clamped, not extrapolated ───────────────────────
eq('below zero clamps to night', mix(skyArtLayers(-0.3, false)), mix(skyArtLayers(0, false)))
eq('above one clamps to day',    mix(skyArtLayers(1.4, false)),  mix(skyArtLayers(1, false)))

// ── Dawn mirrors the twilight painting; dusk and day/night never flip ────────
eq('dawn twilight is flipped',  skyArtLayers(0.3, true)[1].flip, true)
eq('dusk twilight is not',      skyArtLayers(0.3, false)[1].flip, false)
eq('night is never flipped',    skyArtLayers(0.3, true)[0].flip, false)
eq('day is never flipped',      skyArtLayers(0.8, true)[1].flip, false)
eq('morning twilight base flips too', skyArtLayers(0.8, true)[0].flip, true)

// ── Which set ────────────────────────────────────────────────────────────────
eq('streets are the city',              skyArtSet('urban', 'winter', null), 'city')
eq('woods are the season',              skyArtSet('forest', 'winter', 'city'), 'winter')
eq('shores are the season',             skyArtSet('water', 'spring', 'city'), 'spring')
eq('a shop in town keeps the city',     skyArtSet('indoor', 'summer', 'city'), 'city')
eq('a cave out of town keeps the season', skyArtSet('underground', 'autumn', 'autumn'), 'autumn')
eq('unknown out of town is the season', skyArtSet('default', 'autumn', null), 'autumn')
eq('the season follows the calendar',   skyArtSet('default', 'spring', 'winter'), 'spring')

// ── Geometry: the sidebar is unchanged, a pop-out fills ──────────────────────
{
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01
  const coreView = fillViewBox(400, 208)
  eq('the sidebar aspect is just the core', coreView, CORE)
  // The covering painting in the core: 200 wide, centred, as the old slice drew it.
  const p = paintingBox(CORE)
  eq('core painting spans the width', near(p.w, 200) && near(p.x, 0), true)
  eq('core painting is centred vertically', near(p.y, (104 - p.h) / 2), true)

  const covers = (v: Box, q: Box): boolean => q.x <= v.x + 1e-6 && q.y <= v.y + 1e-6 && q.x + q.w >= v.x + v.w - 1e-6 && q.y + q.h >= v.y + v.h - 1e-6
  const horizonAt = (q: Box): number => q.y + q.h * ((ART_HORIZON - p.y) / p.h)
  for (const [w, h] of [[1200, 300], [600, 900], [800, 416], [300, 1200]]) {
    const v = fillViewBox(w, h), q = paintingBox(v)
    eq(`${w}x${h}: view matches the box aspect`, near(v.w / v.h, w / h), true)
    eq(`${w}x${h}: view keeps the whole core`, v.x <= 0 && v.y <= 0 && v.x + v.w >= 200 && v.y + v.h >= 104, true)
    eq(`${w}x${h}: painting covers the view`, covers(v, q), true)
    eq(`${w}x${h}: painted horizon stays on the line`, near(horizonAt(q), ART_HORIZON), true)
  }
  eq('a tall window grows sky upward, not land downward', fillViewBox(600, 900).y + fillViewBox(600, 900).h, 104)
  eq('nonsense sizes fall back to the core', fillViewBox(0, 0), CORE)
}

if (failures.length) {
  console.error(`\n✗ skyArt: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ skyArt: ${passed} passed`)
