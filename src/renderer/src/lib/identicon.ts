// Deterministic identicon generator — a GitHub-style 5×5 symmetric grid rendered
// as an inline SVG data URL. The same name always produces the same identicon on
// every client, so avatars agree across players with no server or shared state.
// This is the universal fallback the (future) server-backed custom images layer
// on top of.

const cache = new Map<string, string>()

// FNV-1a 32-bit hash — cheap, well-distributed, dependency-free. Math.imul keeps
// the multiply in 32-bit space.
function hash32(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const GRID = 5                    // cells per side
const HALF = Math.ceil(GRID / 2)  // left columns we fill; the rest is mirrored

// Returns an SVG data URL for the given name. Transparent background so it sits
// on any panel color; caller clips it to a circle.
export function identiconDataUrl(name: string): string {
  const key = name.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  const h = hash32(key)
  // Hue from the hash; fixed saturation/lightness so every identicon reads well
  // on the dark panels.
  const fg = `hsl(${h % 360} 55% 60%)`

  const cell = 100 / GRID
  let rects = ''
  for (let col = 0; col < HALF; col++) {
    const mirror = GRID - 1 - col
    const cols = col === mirror ? [col] : [col, mirror]
    for (let row = 0; row < GRID; row++) {
      // 15 unique cells → 15 low bits of the hash decide fill.
      if ((h >>> (col * GRID + row)) & 1) {
        for (const c of cols) {
          rects +=
            `<rect x="${(c * cell).toFixed(2)}" y="${(row * cell).toFixed(2)}" ` +
            `width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`
        }
      }
    }
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" shape-rendering="crispEdges">` +
    `<g fill="${fg}">${rects}</g></svg>`
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
  cache.set(key, url)
  return url
}
