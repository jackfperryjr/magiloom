// Deterministic monogram avatar — the first letter of the name on a filled
// circle whose color is derived from the name hash, rendered as an inline SVG
// data URL. The same name always produces the same avatar on every client, so
// avatars agree across players with no server or shared state. This is the
// universal fallback the (future) server-backed custom images layer on top of.

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

// Returns an SVG data URL for the given name: an uppercase initial in white on a
// hash-colored fill. Lightness is kept low enough that the large bold letter
// stays legible across every hue; the caller clips the square to a circle.
export function letterAvatarDataUrl(name: string): string {
  const key = name.trim().toLowerCase()
  const cached = cache.get(key)
  if (cached) return cached

  const h = hash32(key)
  const bg = `hsl(${h % 360} 50% 42%)`
  const letter = (key[0] ?? '?').toUpperCase()

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<rect width="100" height="100" fill="${bg}"/>` +
    `<text x="50" y="50" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Arial, Helvetica, sans-serif" font-size="55" font-weight="700" ` +
    `fill="#ffffff">${letter}</text>` +
    `</svg>`
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`
  cache.set(key, url)
  return url
}
