import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

// The mobile build runs the Coach on the phone (lib/coach-gemini.js) using the server's own
// payload builder and validator from api/coach, so the two cannot drift. Those modules touch
// Node in exactly two places — the payload handle's secret and loading library.json — and
// this shim answers both from the bundle instead.
const PAYLOAD = fileURLToPath(new URL('../api/coach/payload.js', import.meta.url))
const SHIM = '\0coach-node-shim'
const coachNodeShim = {
  name: 'coach-node-shim',
  apply: 'build',     // tests import api/coach under real Node, and must keep doing so
  enforce: 'pre',     // ahead of Vite's own empty browser stub for node: builtins
  config: () => ({ define: { 'process.env.DATA_DIR': 'undefined' } }),
  resolveId(id, importer) {
    if (id.startsWith('node:') && importer === PAYLOAD) return SHIM
  },
  load(id) {
    if (id !== SHIM) return
    return `import { EXDB } from ${JSON.stringify(fileURLToPath(new URL('./src/lib/exercises-data.js', import.meta.url)))}
const exercises = EXDB.map(({ id, n, bp, tg, eq }) => ({ id, n, bp, tg, eq }))
export const createRequire = () => () => ({ exercises })
export default {
  readFileSync: () => '',
  join: (...p) => p.join('/'),
  createHmac: () => ({ update() { return this }, digest: () => 'this-phone' })
}`
  }
}

export default defineConfig({
  plugins: [react(), coachNodeShim],
  base: './',
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: { chunkSizeWarningLimit: 1500 }
})
