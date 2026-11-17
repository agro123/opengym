// Where meal photos live: on this device, and nowhere else. They are not part of the training
// state — a photo in there would bloat every save, every sync and every backup — so the state
// holds only their ids. In the mobile app a photo is a file in the app's private data
// directory; in a browser it is a row in IndexedDB. Deleting a meal, or the photo itself,
// removes the file.
import { MOBILE } from './mobile.js'
import { useEffect, useState } from 'react'

const DIR = 'food/'
const fs = async () => {
  const { Filesystem, Directory } = await import('@capacitor/filesystem')
  return { Filesystem, Directory }
}

/* ---------------- IndexedDB (browser builds) ---------------- */
let dbp = null
const db = () => dbp || (dbp = new Promise((ok, fail) => {
  const r = indexedDB.open('opengym-food', 1)
  r.onupgradeneeded = () => r.result.createObjectStore('photos')
  r.onsuccess = () => ok(r.result)
  r.onerror = () => fail(r.error)
}))
const idb = async (mode, fn) => {
  const d = await db()
  return new Promise((ok, fail) => {
    const tx = d.transaction('photos', mode)
    const req = fn(tx.objectStore('photos'))
    tx.oncomplete = () => ok(req && req.result)
    tx.onerror = () => fail(tx.error)
  })
}

/** Store a processed photo (base64 JPEG) under an id. */
export async function savePhoto(id, data) {
  if (MOBILE) {
    const { Filesystem, Directory } = await fs()
    await Filesystem.writeFile({ path: DIR + id + '.jpg', directory: Directory.Data, data, recursive: true })
  } else await idb('readwrite', s => s.put(data, id))
}
/** The photo's base64, or null if it is gone. */
export async function loadPhoto(id) {
  try {
    if (MOBILE) {
      const { Filesystem, Directory } = await fs()
      return (await Filesystem.readFile({ path: DIR + id + '.jpg', directory: Directory.Data })).data || null
    }
    return (await idb('readonly', s => s.get(id))) || null
  } catch (e) { return null }
}
export async function deletePhotos(ids) {
  for (const id of ids || []) {
    try {
      if (MOBILE) {
        const { Filesystem, Directory } = await fs()
        await Filesystem.deleteFile({ path: DIR + id + '.jpg', directory: Directory.Data })
      } else await idb('readwrite', s => s.delete(id))
    } catch (e) { /* already gone */ }
  }
}
/** Every stored photo id — for the settings screen's count, and for sweeping orphans. */
export async function listPhotos() {
  try {
    if (MOBILE) {
      const { Filesystem, Directory } = await fs()
      const r = await Filesystem.readdir({ path: DIR, directory: Directory.Data })
      return r.files.map(f => ({ id: f.name.replace(/\.jpg$/, ''), bytes: f.size || 0 }))
    }
    const keys = await idb('readonly', s => s.getAllKeys())
    const vals = await idb('readonly', s => s.getAll())
    return keys.map((id, i) => ({ id, bytes: Math.round(String(vals[i] || '').length * 0.75) }))
  } catch (e) { return [] }
}

/** <img src> for a stored photo; '' while loading, null if it is gone. */
export function usePhoto(id) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    setSrc('')
    if (!id) { setSrc(null); return }
    loadPhoto(id).then(d => { if (live) setSrc(d ? 'data:image/jpeg;base64,' + d : null) })
    return () => { live = false }
  }, [id])
  return src
}
