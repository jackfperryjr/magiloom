import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, readdirSync, statSync, existsSync, createReadStream } from 'fs'

// Web / PWA build of the same React renderer used by the desktop app. Instead of
// the Electron preload, src/web/main.tsx installs a WebSocket-backed window.dr
// (src/web/dr.ts) that talks to the headless server.
//
// Deploys into docs/app so the existing GitHub Pages workflow serves it at
// magiloom.com/app/. Relative base keeps assets working under that subpath.

// A per-build id: the deploy's commit sha (CI provides GITHUB_SHA), else a build-time
// stamp so every local build differs (makes the update flow testable without a
// commit). Baked into the bundle AND written to version.json so the running PWA can
// notice a newer deploy and offer to reload (see updater.ts).
const buildId = process.env.GITHUB_SHA?.slice(0, 7) || Date.now().toString(36)

// App version baked from package.json at build time — the SAME source the desktop
// ships. So bumping package.json + deploying the PWA updates the version the web
// client shows, with no manual server variable to keep in sync.
const appVersion = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).version as string

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  // Reuse the desktop renderer's static assets (icon.png, panels/*.jpg, …).
  publicDir: resolve(__dirname, 'src/renderer/public'),
  define: { __BUILD_ID__: JSON.stringify(buildId), __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) })
      },
    },
    // Serve the prebaked map dataset on the web client.
    //
    // The desktop app gets it over IPC from the main process, which the web build
    // has no equivalent of, so the renderer falls back to fetching /map-data/…
    // (see lib/mapSeed.ts). The files live in resources/ rather than the shared
    // publicDir on purpose: publicDir is also the desktop renderer's, and copying
    // ~12 MB in there would bake a second copy into the packaged app alongside the
    // one extraResources already ships.
    {
      name: 'serve-map-data',
      configureServer(server) {
        server.middlewares.use('/map-data', (req, res, next) => {
          const rel = (req.url ?? '').split('?')[0].replace(/^\/+/, '')
          const file = resolve(__dirname, 'resources/map-data', rel)
          // Keep the traversal inside the dataset dir.
          if (!file.startsWith(resolve(__dirname, 'resources/map-data')) || !existsSync(file)) return next()
          res.setHeader('Content-Type', 'application/json')
          createReadStream(file).pipe(res)
        })
      },
      generateBundle() {
        const dir = resolve(__dirname, 'resources/map-data')
        if (!existsSync(dir)) {
          // Not fatal: the web client simply maps live, exactly as it did before.
          this.warn('no resources/map-data — web build ships without a prebaked map (npm run map:all)')
          return
        }
        for (const instance of readdirSync(dir)) {
          const sub = resolve(dir, instance)
          if (!statSync(sub).isDirectory()) continue
          for (const name of readdirSync(sub)) {
            this.emitFile({
              type: 'asset',
              fileName: `map-data/${instance}/${name}`,
              source: readFileSync(resolve(sub, name)),
            })
          }
        }
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, 'docs/app'),
    emptyOutDir: true,
  },
  server: { port: 5180 },
})
