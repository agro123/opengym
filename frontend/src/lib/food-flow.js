// The food scanner's moving parts, kept out of the screens: a photo analysis runs to its end
// (and its result is held) whether or not the screen that started it is still open, and every
// step is written to the state first, so an app killed half-way finds its place again.
//
//   draft ──analyse──▶ analyzing ──▶ review ──approve──▶ a saved meal
//     │                    │
//     └──queue (offline)   └──▶ failed / back to queued
//
// A queued analysis never starts on its own: coming back online only makes "Analyse now"
// work again. Sending photos off the phone is something the person does, each time.
import { useStore } from '../store/useStore.js'
import { nutritionOf, putPending, removePending, saveMeal, deleteMeal, dropMealPhotos, mealTypeAt } from './nutrition.js'
import { loadPhoto, savePhoto, deletePhotos, listPhotos } from './food-photos.js'
import { analyzeFood, MAX_PHOTOS } from './food-ai.js'
import { processImage } from './food-image.js'
import { getLang } from './i18n.js'
import { uid } from './format.js'

const st = () => useStore.getState()
const change = fn => st().update(fn, true)
export const pendingById = id => nutritionOf(st().S).pending.find(p => p.id === id) || null
const running = new Set()

/** A new, empty draft. Photos are added to it as they are picked. */
export function newDraft(now = Date.now()) {
  let p = null
  change(s => { p = putPending(s, { id: uid(), status: 'draft', mealType: mealTypeAt(now), timestamp: now, note: '', photoIds: [] }, now) })
  return p
}
export const patchPending = (id, patch) => change(s => { if (pendingById(id)) putPending(s, { id, ...patch }) })

/**
 * Add picked files to a draft: each goes through the image pipeline and lands on disk before
 * its id is written to the state. Returns the reasons of the files that were turned away
 * ('type' | 'size' | 'empty' | 'decode' | 'limit' | 'storage').
 */
export async function addPhotos(id, files) {
  const errors = []
  for (const file of files) {
    const p = pendingById(id)
    if (!p) break
    if (p.photoIds.length >= MAX_PHOTOS) { errors.push('limit'); break }
    try {
      const img = await processImage(file)
      const photoId = uid()
      try { await savePhoto(photoId, img.data) } catch (e) { errors.push('storage'); continue }
      patchPending(id, { photoIds: [...(pendingById(id)?.photoIds || []), photoId] })
    } catch (e) { errors.push(e.message || 'decode') }
  }
  return errors
}
export function removePhoto(id, photoId) {
  const p = pendingById(id)
  if (!p) return
  patchPending(id, { photoIds: p.photoIds.filter(x => x !== photoId) })
  deletePhotos([photoId])
}

/** Send a draft's (or a queued entry's) photos to Gemini. Resolves when the outcome is stored. */
export async function runAnalysis(id) {
  const p = pendingById(id)
  if (!p || running.has(id) || !p.photoIds.length) return
  running.add(id)
  patchPending(id, { status: 'analyzing', error: null, attempts: (p.attempts || 0) + 1 })
  // back to where it came from: a queued entry stays queued, a draft becomes a failure to retry
  const fail = error => patchPending(id, { status: p.consentAt && error === 'offline' ? 'queued' : 'failed', error })
  try {
    const datas = await Promise.all(p.photoIds.map(loadPhoto))
    if (datas.some(d => !d)) return fail('photos')
    const r = await analyzeFood({
      images: datas.map(data => ({ mime: 'image/jpeg', data })),
      mealType: p.mealType, timestamp: p.timestamp, lang: getLang(), note: p.note, scale: p.scale || null, known: p.known || []
    })
    if (!pendingById(id)) return                   // discarded while it ran
    if (r.ok) patchPending(id, { status: 'review', requestId: r.requestId, analysis: r.analysis, error: null })
    else fail(r.errorClass)
  } catch (e) {
    fail('provider')
  } finally { running.delete(id) }
}
/** The person agreed to keep these photos for later — the only way into the queue. */
export const queuePending = id => patchPending(id, { status: 'queued', consentAt: Date.now(), error: null })

/** Throw a draft, a queued entry or an unapproved result away, photos included. */
export function discardPending(id) {
  let photos = []
  change(s => { photos = removePending(s, id) })
  deletePhotos(photos)
}
/**
 * The explicit approval: an analysed (and possibly edited) result becomes a logged meal.
 * Saving is idempotent on the analysis' request id, so approving twice logs once.
 */
export function approveAnalysis(id) {
  const p = pendingById(id)
  if (!p || p.status !== 'review' || !p.analysis) return null
  const keep = nutritionOf(st().S).prefs.keepPhotos
  let meal = null
  change(s => {
    meal = saveMeal(s, {
      name: p.analysis.mealName, mealType: p.analysis.mealType, timestamp: p.timestamp, source: 'ai_scan',
      items: p.analysis.items, photoIds: keep ? p.photoIds : [], requestId: p.requestId,
      assumptions: p.analysis.assumptions, uncertainties: p.analysis.uncertainties
    })
    removePending(s, id)
  })
  if (!keep) deletePhotos(p.photoIds)
  return meal
}

export function removeMeal(id) {
  let photos = []
  change(s => { photos = deleteMeal(s, id) })
  deletePhotos(photos)
}
export function removeMealPhotos(id) {
  const m = nutritionOf(st().S).meals.find(x => x.id === id)
  if (!m) return
  change(s => dropMealPhotos(s, id))
  deletePhotos(m.photoIds)
}
/** Photos on disk that nothing points at any more (a crash between two writes) — and the rest. */
export async function photoUsage() {
  const n = nutritionOf(st().S)
  const used = new Set([...n.meals, ...n.pending].flatMap(x => x.photoIds || []))
  const all = await listPhotos()
  const orphans = all.filter(p => !used.has(p.id)).map(p => p.id)
  if (orphans.length) await deletePhotos(orphans)
  const kept = all.filter(p => used.has(p.id))
  return { count: kept.length, bytes: kept.reduce((s, p) => s + p.bytes, 0) }
}
export async function deleteAllMealPhotos() {
  const ids = nutritionOf(st().S).meals.flatMap(m => m.photoIds || [])
  change(s => { nutritionOf(s).meals.forEach(m => dropMealPhotos(s, m.id)) })
  await deletePhotos(ids)
}
