/**
 * Calendar backdrop selection tests. Run: npm run test:tools
 *
 * The blend has to be continuous: at every daylight value the picture must be
 * the same just below and just above, or the panel visibly jumps at the seams.
 */
import { skyArtLayers, skyArtSet, type ArtLayer } from './skyArt'

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

if (failures.length) {
  console.error(`\n✗ skyArt: ${failures.length} failed, ${passed} passed`)
  for (const f of failures) console.error(`   ${f}`)
  process.exit(1)
}
console.log(`✓ skyArt: ${passed} passed`)
