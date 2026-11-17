// The photo pipeline, entirely on the phone: check the file, turn it the right way up, shrink
// it and recompress it. A camera hands over 4–12 MB; what a model needs to read a plate is a
// few hundred kB, and that is also all that is kept on disk.
export const ACCEPT = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_SIDE = 1280
export const TARGET_BYTES = 700 * 1024
const QUALITIES = [0.82, 0.72, 0.6, 0.5]

/** Why a picked file can't be used — 'empty' | 'type' | 'size' — or null when it can. */
export function checkFile(file) {
  if (!file || !file.size) return 'empty'
  // some galleries hand over a file with no type; the extension is the next best thing
  const type = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif' })[String(file.name || '').split('.').pop().toLowerCase()] || ''
  if (!ACCEPT.includes(type)) return 'type'
  if (file.size > MAX_FILE_BYTES) return 'size'
  return null
}
/** The largest size with the same shape that fits in a `max` × `max` box (never enlarged). */
export function fitWithin(w, h, max = MAX_SIDE) {
  const k = Math.min(1, max / Math.max(w, h, 1))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

// Decoding is where the EXIF orientation is applied: `imageOrientation: 'from-image'` makes
// the bitmap come out upright, so the canvas — and the JPEG written from it, which carries
// no EXIF at all — is the picture as it was taken. The <img> fallback does the same on
// engines without createImageBitmap options.
async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch (e) { /* fall through */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise((ok, fail) => {
      const img = new Image()
      img.onload = () => ok(img)
      img.onerror = () => fail(new Error('decode'))
      img.src = url
    })
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000) }
}
const toBlob = (canvas, q) => new Promise(ok => canvas.toBlob(ok, 'image/jpeg', q))
const toBase64 = blob => new Promise((ok, fail) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result).split(',')[1])
  r.onerror = fail
  r.readAsDataURL(blob)
})

/**
 * File → { mime: 'image/jpeg', data (base64), width, height, bytes }.
 * Throws an Error whose message is 'empty' | 'type' | 'size' | 'decode'.
 */
export async function processImage(file) {
  const why = checkFile(file)
  if (why) throw new Error(why)
  let src
  try { src = await decode(file) } catch (e) { throw new Error('decode') }
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight
  if (!sw || !sh) throw new Error('decode')
  const { w, h } = fitWithin(sw, sh)
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#fff'              // a transparent PNG would otherwise go black as JPEG
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(src, 0, 0, w, h)
  if (src.close) src.close()
  let blob = null
  for (const q of QUALITIES) {
    blob = await toBlob(canvas, q)
    if (!blob) throw new Error('decode')
    if (blob.size <= TARGET_BYTES) break
  }
  return { mime: 'image/jpeg', data: await toBase64(blob), width: w, height: h, bytes: blob.size }
}
