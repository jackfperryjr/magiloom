import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Build for magiloom.com/tools — the companion tools that aren't the game client:
// the log analyzer (account-gated), the TDP planner and the circle calculator
// (both open to anyone, no sign-in, nothing stored).
//
// Deliberately a THIRD bundle rather than routes inside the web app: the planner and
// calculator should load for someone who has never signed in and may not even play
// through Magiloom, and folding them into src/web would drag the whole game client —
// WebSocket transport, service worker, push — into a page that needs none of it.
// Deploys into docs/tools so the existing GitHub Pages workflow serves it alongside
// docs/app, and a relative base keeps assets working under that subpath.
//
// Routing is hash-based (#/analyzer, #/planner, #/circles) because Pages has no
// rewrite rules — a real path would 404 on refresh.

export default defineConfig({
  root: resolve(__dirname, 'src/tools'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'docs/tools'),
    emptyOutDir: true,
  },
  server: { port: 5181 },
})
