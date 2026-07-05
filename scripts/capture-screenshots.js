// Renders the docs-site screenshots from the HTML mockups in this folder using
// headless Chrome/Edge. Run: node scripts/capture-screenshots.js
//
// The mockups pull fonts from Google Fonts, so --virtual-time-budget gives them
// time to load before the screenshot is taken. If Chrome isn't found
// automatically, set the CHROME env var to your browser path.
const { execFileSync } = require('child_process')
const path = require('path')
const fs   = require('fs')
const os   = require('os')

const CHROME_PATHS = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean)

function findBrowser() {
  for (const p of CHROME_PATHS) if (fs.existsSync(p)) return p
  return null
}

const browser = findBrowser()
if (!browser) {
  console.error('Chrome or Edge not found. Set CHROME env var to your browser path.')
  process.exit(1)
}

const SHOTS = [
  { html: 'screenshot-game.html',  out: 'screenshot-game.png',  w: 1280, h: 800 },
  { html: 'screenshot-login.html', out: 'screenshot-login.png', w: 1100, h: 760 },
]

const docsDir = path.join(__dirname, '..', 'docs')
console.log(`Browser: ${browser}`)

for (const shot of SHOTS) {
  const htmlFile = path.join(__dirname, shot.html)
  const outFile  = path.join(docsDir, shot.out)
  const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'magiloom-shot-'))
  console.log(`Capturing ${shot.html} → docs/${shot.out} (${shot.w}×${shot.h})`)
  execFileSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=2',       // 2× for a crisp retina screenshot
    '--virtual-time-budget=6000',          // let webfonts + the identicon script settle
    `--window-size=${shot.w},${shot.h}`,
    `--screenshot=${outFile}`,
    `--user-data-dir=${tmpDir}`,
    `file:///${htmlFile.replace(/\\/g, '/')}`,
  ], { stdio: 'inherit' })
}

console.log('Done.')
