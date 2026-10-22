#!/usr/bin/env node
// Ships the exercise still images inside the mobile app, so they show with no connection.
//
//   node scripts/mobile-images.mjs        (run by `npm run build:mobile`, after `vite build`)
//
// The stills are ~8.5 MB for all 1,324 exercises; the animations are ~123 MB and stay on the
// CDN (the app keeps the ones you open — see lib/mobile.js cachedGif). Downloads go to a local
// cache first, so only the first build touches the network; then they are copied to dist/img/,
// which is where the default IMG_BASE ('img/') points.

import { mkdirSync, existsSync, copyFileSync, writeFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Same dataset commit the build:mobile script uses for the animations.
const DATASET = 'https://cdn.jsdelivr.net/gh/hasaneyldrm/exercises-dataset@7455efae41b330c265e7cd4b78dfa848e7ce5ebd/images/'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.media-cache', 'img')
const OUT = join(ROOT, 'dist', 'img')
const PARALLEL = 12

const { EXDB } = await import(pathToFileURL(join(ROOT, 'src', 'lib', 'exercises-data.js')).href)
const names = [...new Set(EXDB.map(e => e.img).filter(Boolean))]
mkdirSync(CACHE, { recursive: true })

const missing = names.filter(n => !existsSync(join(CACHE, n)))
let failed = 0
async function fetchOne(name) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(DATASET + encodeURIComponent(name))
      if (!res.ok) throw new Error('HTTP ' + res.status)
      writeFileSync(join(CACHE, name), Buffer.from(await res.arrayBuffer()))
      return
    } catch (e) {
      if (attempt === 3) { failed++; console.warn(`  ✗ ${name}: ${e.message}`) }
    }
  }
}
if (missing.length) {
  console.log(`Downloading ${missing.length} exercise images…`)
  const queue = [...missing]
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    while (queue.length) await fetchOne(queue.shift())
  }))
}

mkdirSync(OUT, { recursive: true })
for (const n of readdirSync(CACHE)) copyFileSync(join(CACHE, n), join(OUT, n))
console.log(`✓ ${names.length - failed} of ${names.length} exercise images bundled into dist/img/`)
if (failed) process.exit(1)
