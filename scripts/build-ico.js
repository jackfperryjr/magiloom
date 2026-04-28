// Generates build/icon.ico from resources/icon.png.
// Produces a multi-resolution ICO with bicubic downsampling at each size
// so the Windows taskbar icon stays crisp at 16, 32, 48, 64, 256, and 512 px.
// Run: node scripts/build-ico.js
const Jimp = require('jimp')
const fs   = require('fs')
const path = require('path')

const SIZES = [256, 128, 64, 48, 32, 24, 16]
const SRC   = path.join(__dirname, '..', 'resources', 'icon.png')
const OUT   = path.join(__dirname, '..', 'build', 'icon.ico')

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  const src = await Jimp.read(SRC)

  const pngs = []
  for (const size of SIZES) {
    const buf = await src.clone()
      .resize(size, size, Jimp.RESIZE_BICUBIC)
      .getBufferAsync(Jimp.MIME_PNG)
    pngs.push({ size, buf })
  }

  // ICO with embedded PNG data (Windows Vista+ compatible).
  // Each ICONDIRENTRY points directly to a PNG blob — no BMP conversion needed.
  const count    = pngs.length
  let dataOffset = 6 + 16 * count  // header + all directory entries

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)      // reserved
  header.writeUInt16LE(1, 2)      // type = ICO
  header.writeUInt16LE(count, 4)

  const entries = pngs.map(({ size, buf }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size   // 0 encodes 256
    e[1] = size >= 256 ? 0 : size
    e[2] = 0                          // color count (0 = no palette)
    e[3] = 0                          // reserved
    e.writeUInt16LE(1,  4)            // planes
    e.writeUInt16LE(32, 6)            // bit depth
    e.writeUInt32LE(buf.length,  8)
    e.writeUInt32LE(dataOffset,  12)
    dataOffset += buf.length
    return e
  })

  fs.writeFileSync(OUT, Buffer.concat([header, ...entries, ...pngs.map(p => p.buf)]))
  console.log(`Written ${OUT}  (sizes: ${SIZES.join(', ')} px)`)
}

main().catch(e => { console.error(e); process.exit(1) })
