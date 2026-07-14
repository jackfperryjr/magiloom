import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

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

export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  // Reuse the desktop renderer's static assets (icon.png, panels/*.jpg, …).
  publicDir: resolve(__dirname, 'src/renderer/public'),
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  plugins: [
    react(),
    {
      name: 'emit-version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: buildId }) })
      },
    },
  ],
  build: {
    outDir: resolve(__dirname, 'docs/app'),
    emptyOutDir: true,
  },
  server: { port: 5180 },
})
