import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Web / PWA build of the same React renderer used by the desktop app. Instead of
// the Electron preload, src/web/main.tsx installs a WebSocket-backed window.dr
// (src/web/dr.ts) that talks to the headless server.
//
// Deploys into docs/app so the existing GitHub Pages workflow serves it at
// magiloom.com/app/. Relative base keeps assets working under that subpath.
export default defineConfig({
  root: resolve(__dirname, 'src/web'),
  base: './',
  // Reuse the desktop renderer's static assets (icon.png, panels/*.jpg, …).
  publicDir: resolve(__dirname, 'src/renderer/public'),
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'docs/app'),
    emptyOutDir: true,
  },
  server: { port: 5180 },
})
