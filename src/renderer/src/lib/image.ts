// Downscale a data URL to fit within `maxEdge` px and roughly `maxBytes`,
// preserving aspect ratio. Keeps the whole image (not a crop) small enough for
// the avatar bucket's 200KB cap while retaining decent resolution. Re-encodes as
// JPEG (photos compress far better than PNG).
export function downscaleToFit(dataUrl: string, maxEdge = 1024, maxBytes = 180 * 1024): Promise<string> {
  return new Promise(resolve => {
    const img = new Image()
    img.onerror = () => resolve(dataUrl)
    img.onload = () => {
      const ctx = document.createElement('canvas').getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      const s = Math.min(1, maxEdge / Math.max(img.width, img.height))
      let w = Math.max(1, Math.round(img.width * s))
      let h = Math.max(1, Math.round(img.height * s))
      let q = 0.9
      const draw = () => {
        ctx.canvas.width = w; ctx.canvas.height = h
        ctx.imageSmoothingQuality = 'high'
        ctx.clearRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
      }
      draw()
      let out = ctx.canvas.toDataURL('image/jpeg', q)
      // base64 length * 0.75 ≈ byte size; shrink quality then dimensions to fit.
      while (out.length * 0.75 > maxBytes && (q > 0.45 || Math.max(w, h) > 256)) {
        if (q > 0.5) q -= 0.1
        else { w = Math.round(w * 0.85); h = Math.round(h * 0.85); draw() }
        out = ctx.canvas.toDataURL('image/jpeg', q)
      }
      resolve(out)
    }
    img.src = dataUrl
  })
}
