// Renders social-preview.html to a 1280×640 PNG using Chrome headless.
// Run: node scripts/capture-social-preview.js
//
// If Chrome is not found automatically, set CHROME env var:
//   CHROME="C:\path\to\chrome.exe" node scripts/capture-social-preview.js
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
  for (const p of CHROME_PATHS) {
    if (fs.existsSync(p)) return p
  }
  return null
}

const browser = findBrowser()
if (!browser) {
  console.error('Chrome or Edge not found. Set CHROME env var to your browser path.')
  process.exit(1)
}

const htmlFile = path.join(__dirname, 'social-preview.html')
const outFile  = path.join(__dirname, '..', 'resources', 'social-preview.png')
const tmpDir   = fs.mkdtempSync(path.join(os.tmpdir(), 'magiloom-preview-'))

console.log(`Browser: ${browser}`)
console.log(`Capturing ${htmlFile} → ${outFile}`)

execFileSync(browser, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--window-size=1280,640`,
  `--screenshot=${outFile}`,
  `--user-data-dir=${tmpDir}`,
  `file:///${htmlFile.replace(/\\/g, '/')}`,
], { stdio: 'inherit' })

console.log(`Done → ${outFile}`)
