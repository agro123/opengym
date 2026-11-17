// Nutrition: the data model and all of its arithmetic. Pure functions over the state object S
// (and over single meals/items), so every number on screen is recomputed on the phone the
// moment something is edited — no model call is ever needed to change a portion.
//
// Shapes (all stored under S.nutrition, see emptyNutrition):
//
//   FoodMeal   { id, name, mealType, timestamp, d, source, totalMacros, items[], photoIds[],
//                requestId?, favorite?, assumptions?, uncertainties?, createdAt, updatedAt }
//   FoodItem   { id, name, quantity, unit, estimatedWeightGrams, preparationMethod,
//                rawOrCooked, macrosPer100g, calculatedMacros, source, aiConfidence,
//                cookedYield, ingredients[], extras[], note, includedIn?, countSeparately? }
//   NutritionalGoals        { kcal, protein, carbs, fat }
//   PendingFoodAnalysis     { id, requestId, status, photoIds[], mealType, timestamp, note,
//                             consentAt, analysis?, error?, attempts, createdAt, updatedAt }
//
// Everything is normalised to 100 g: an item carries its nutrients per 100 g and a weight in
// grams, and `calculatedMacros` is always per100 × grams / 100. A quantity and a unit are how
// people think about a portion ("2 slices"); the weight is what the maths runs on.
import { isoOf, uid } from './format.js'

export const MACROS = ['kcal', 'protein', 'carbs', 'fat']
export const MICROS = ['satFat', 'fiber', 'sugar', 'sodium']    // grams, except sodium in mg
export const NUTRIENTS = [...MACROS, ...MICROS]
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack']
export const SOURCES = ['ai_scan', 'manual', 'duplicate']
export const STATES = ['raw', 'cooked', 'not_applicable']
export const UNITS = ['g', 'ml', 'piece', 'slice', 'cup', 'tbsp', 'tsp', 'oz', 'serving']
// Units with a fixed weight. Volumes are taken at water's density — an honest approximation
// that the gram field next to them can always correct. The rest are counts ("piece",
// "slice", "serving"), whose weight belongs to the food and is carried by the item itself.
export const UNIT_GRAMS = { g: 1, ml: 1, oz: 28.35, cup: 240, tbsp: 15, tsp: 5 }
export const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 230, fat: 65 }
// Sanity ceilings per 100 g. Pure fat is 900 kcal; nothing edible goes past these.
export const PER100_MAX = { kcal: 900, protein: 100, carbs: 100, fat: 100, satFat: 100, fiber: 100, sugar: 100, sodium: 40000 }
export const MAX_GRAMS = 5000

const r1 = n => Math.round(n * 10) / 10
const pos = v => (Number.isFinite(+v) && +v > 0 ? +v : 0)

export const zeroMacros = () => Object.fromEntries(NUTRIENTS.map(k => [k, 0]))
/** Any object → the eight nutrients as finite, non-negative, capped numbers. */
export const cleanMacros = m => Object.fromEntries(NUTRIENTS.map(k => [k, Math.min(PER100_MAX[k], r1(pos(m && m[k])))]))
export const scaleMacros = (per100, grams) => Object.fromEntries(NUTRIENTS.map(k => [k, r1(pos(per100 && per100[k]) * pos(grams) / 100)]))
export const sumMacros = list => {
  const out = zeroMacros()
  list.forEach(m => NUTRIENTS.forEach(k => { out[k] += pos(m && m[k]) }))
  NUTRIENTS.forEach(k => { out[k] = r1(out[k]) })
  return out
}
/** Energy implied by the macros (Atwater 4/4/9) — what the goals screen balances against. */
export const kcalOf = m => Math.round(4 * pos(m.protein) + 4 * pos(m.carbs) + 9 * pos(m.fat))

/* ---------------- items ---------------- */

export function newItem(over = {}) {
  return calcItem({
    id: uid(), name: '', quantity: 100, unit: 'g', estimatedWeightGrams: 100, preparationMethod: '',
    rawOrCooked: 'not_applicable', macrosPer100g: zeroMacros(), source: 'manual', aiConfidence: null,
    cookedYield: 1, ingredients: [], extras: [], note: '', ...over
  })
}
export function calcItem(item) {
  const grams = Math.min(MAX_GRAMS, r1(pos(item.estimatedWeightGrams)))
  const per100 = cleanMacros(item.macrosPer100g)
  return { ...item, estimatedWeightGrams: grams, macrosPer100g: per100, calculatedMacros: scaleMacros(per100, grams) }
}
const isCount = unit => !(unit in UNIT_GRAMS)
/** Grams one unit of this item weighs: fixed for g/ml/cup…, the item's own for a count. */
export const gramsPerUnit = item => UNIT_GRAMS[item.unit] || (pos(item.quantity) ? pos(item.estimatedWeightGrams) / pos(item.quantity) : pos(item.estimatedWeightGrams))

// The three portion edits. Each keeps the other two fields consistent, so whichever one the
// person reaches for, the weight — and with it every nutrient — follows at once.
export function setQuantity(item, q) {
  const quantity = pos(q)
  return calcItem({ ...item, quantity, estimatedWeightGrams: quantity * gramsPerUnit(item) })
}
/** A new weight: a count keeps its number of pieces (they are just heavier), g/ml/cup follow. */
export function setWeight(item, g) {
  const grams = pos(g)
  return calcItem({ ...item, estimatedWeightGrams: grams, quantity: isCount(item.unit) ? item.quantity : r1(grams / UNIT_GRAMS[item.unit]) })
}
/** A new unit never changes how much food there is — only how it is counted. */
export function setUnit(item, unit) {
  if (!UNITS.includes(unit) || unit === item.unit) return item
  const grams = pos(item.estimatedWeightGrams)
  const quantity = isCount(unit) ? (isCount(item.unit) ? item.quantity : 1) : r1(grams / UNIT_GRAMS[unit])
  return calcItem({ ...item, unit, quantity })
}
export const setPer100 = (item, key, v) => calcItem({ ...item, macrosPer100g: { ...item.macrosPer100g, [key]: v } })

/**
 * Raw or cooked says which state the weight was taken in — and the same food is a different
 * number per 100 g in each: rice triples its weight in water, meat loses a third of it.
 * `cookedYield` is cooked grams per raw gram (rice ≈ 2.8, chicken ≈ 0.7). Switching state
 * keeps the weight the person typed and converts the density, so 150 g "raw" and 150 g
 * "cooked" stop being the same calories. With no yield known (1) only the label changes.
 */
export function setRawCooked(item, state) {
  if (!STATES.includes(state) || state === item.rawOrCooked) return item
  const y = pos(item.cookedYield) || 1
  const from = item.rawOrCooked
  let per100 = item.macrosPer100g
  if (y !== 1 && from !== 'not_applicable' && state !== 'not_applicable') {
    const f = state === 'raw' ? y : 1 / y      // cooked → raw: thinner when y < 1 (meat), denser when y > 1 (rice)
    per100 = Object.fromEntries(NUTRIENTS.map(k => [k, pos(per100[k]) * f]))
  }
  return calcItem({ ...item, rawOrCooked: state, macrosPer100g: per100 })
}

/* ---------------- double counting ---------------- */

export const normName = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

/**
 * A compound dish already contains its ingredients. When a list holds both "arepa con queso"
 * (ingredients: arepa, queso) and a separate "queso", the cheese would be counted twice — so
 * an item named exactly like an ingredient of another is marked `includedIn` and left out of
 * the totals. It stays on screen, flagged; `countSeparately` (extra cheese on the side really
 * does exist) puts it back.
 */
export function markIncluded(items) {
  const names = (a, b) => (a.ingredients || []).some(i => normName(i) === normName(b.name))
  return items.map((b, bi) => {
    const { includedIn, ...rest } = b
    if (b.countSeparately || !normName(b.name)) return rest
    // two dishes naming each other would each swallow the other — the earlier one stays counted
    const owner = items.find((a, ai) => a.id !== b.id && names(a, b) && !(names(b, a) && bi < ai))
    return owner ? { ...rest, includedIn: owner.id } : rest
  })
}
export const countedItems = items => items.filter(i => !i.includedIn)
export const mealTotals = items => sumMacros(countedItems(items).map(i => i.calculatedMacros))

/* ---------------- meals ---------------- */

export const mealTypeAt = ts => {
  const h = new Date(ts).getHours()
  return h < 11 ? 'breakfast' : h < 16 ? 'lunch' : h < 22 ? 'dinner' : 'snack'
}
/** A meal with every derived field recomputed: items, double-count marks, totals, local day. */
export function buildMeal(m, now = Date.now()) {
  const items = markIncluded((m.items || []).map(calcItem))
  const timestamp = Number.isFinite(+m.timestamp) ? +m.timestamp : now
  return {
    ...m,
    id: m.id || uid(),
    name: String(m.name || '').trim().slice(0, 120),
    mealType: MEAL_TYPES.includes(m.mealType) ? m.mealType : mealTypeAt(timestamp),
    timestamp,
    d: isoOf(new Date(timestamp)),
    source: SOURCES.includes(m.source) ? m.source : 'manual',
    items,
    totalMacros: mealTotals(items),
    photoIds: m.photoIds || [],
    createdAt: m.createdAt || now,
    updatedAt: now
  }
}

/* ---------------- state ---------------- */

export const emptyNutrition = () => ({
  goals: null,          // null until the person sets them; DEFAULT_GOALS stand in meanwhile
  meals: [],
  pending: [],          // PendingFoodAnalysis: drafts, the offline queue, results awaiting approval
  // containers: "my plates" — the plates and bowls someone eats from, measured once and
  // picked as the scale reference for a scan (lib/food-ai.js describeScale)
  prefs: { keepPhotos: true, coach: false, disclosedAt: null, containers: [] }
})
/** S.nutrition, whole — older states (and backups) have none, or only part of one. */
export function nutritionOf(S) {
  const n = (S && S.nutrition) || {}
  const e = emptyNutrition()
  return { goals: n.goals || null, meals: n.meals || [], pending: n.pending || [], prefs: { ...e.prefs, ...(n.prefs || {}) } }
}
export const goalsOf = S => ({ ...DEFAULT_GOALS, ...(nutritionOf(S).goals || {}) })
const edit = (s, fn) => { const n = nutritionOf(s); fn(n); s.nutrition = n }

/**
 * Save a meal. Idempotent on `requestId`: approving the same analysis twice — a double tap, a
 * retry after the app was killed mid-save — updates the one meal instead of logging a second.
 */
export function saveMeal(s, meal, now = Date.now()) {
  let saved = null
  edit(s, n => {
    const i = n.meals.findIndex(x => x.id === meal.id || (meal.requestId && x.requestId === meal.requestId))
    const prev = i >= 0 ? n.meals[i] : null
    saved = buildMeal({ ...meal, id: prev ? prev.id : meal.id, createdAt: prev ? prev.createdAt : meal.createdAt }, now)
    if (prev) n.meals[i] = saved; else n.meals.push(saved)
    n.meals.sort((a, b) => a.timestamp - b.timestamp)
  })
  return saved
}
/** Remove a meal; returns its photo ids so the caller can delete the files. */
export function deleteMeal(s, id) {
  let photos = []
  edit(s, n => {
    const m = n.meals.find(x => x.id === id)
    photos = m ? m.photoIds || [] : []
    n.meals = n.meals.filter(x => x.id !== id)
  })
  return photos
}
/** Log a past meal again, now: same food, new identity, no photos and no request to dedupe on. */
export function duplicateMeal(s, id, now = Date.now()) {
  const src = nutritionOf(s).meals.find(x => x.id === id)
  if (!src) return null
  const { requestId, assumptions, uncertainties, favorite, ...rest } = src
  return saveMeal(s, {
    ...rest, id: uid(), source: 'duplicate', timestamp: now, mealType: mealTypeAt(now), photoIds: [], createdAt: now,
    items: src.items.map(i => ({ ...i, id: uid(), source: 'duplicate' }))
  }, now)
}
export const setFavorite = (s, id, on) => edit(s, n => { const m = n.meals.find(x => x.id === id); if (m) m.favorite = !!on })
export const dropMealPhotos = (s, id) => edit(s, n => { const m = n.meals.find(x => x.id === id); if (m) m.photoIds = [] })
export function setGoals(s, g) {
  edit(s, n => { n.goals = Object.fromEntries(MACROS.map(k => [k, Math.round(pos(g[k]))])) })
}
export const setPrefs = (s, p) => edit(s, n => { n.prefs = { ...n.prefs, ...p } })

/* ---------------- scale references ---------------- */

export const CONTAINER_KINDS = ['plate', 'bowl', 'cup', 'box']
// A ruler the model can see in the photo, with its real size. Kept to objects whose size is
// standard enough to measure against: a bank card is ISO/IEC 7810 ID-1 everywhere.
export const REFERENCES = { card: '85.6 × 54 mm bank card', fork: 'dinner fork, about 19 cm long' }
/** A saved plate or bowl. `cm` is the rim diameter (or the long side of a box). */
export function cleanContainer(c) {
  const cm = Math.min(60, Math.round(pos(c.cm) * 10) / 10)
  const ml = Math.min(5000, Math.round(pos(c.ml)))
  return { id: c.id || uid(), name: String(c.name || '').trim().slice(0, 40), kind: CONTAINER_KINDS.includes(c.kind) ? c.kind : 'plate', cm, ...(ml ? { ml } : {}) }
}
export function saveContainer(s, c) {
  let out = null
  edit(s, n => {
    out = cleanContainer(c)
    const list = n.prefs.containers || []
    const i = list.findIndex(x => x.id === out.id)
    n.prefs.containers = i >= 0 ? list.map(x => (x.id === out.id ? out : x)) : [...list, out]
  })
  return out
}
export const removeContainer = (s, id) => edit(s, n => { n.prefs.containers = (n.prefs.containers || []).filter(x => x.id !== id) })

/** Weights someone measured: trimmed, deduplicated by name, positive, bounded. */
export function cleanKnown(list) {
  const seen = new Set()
  return (list || []).map(k => ({ name: String(k.name || '').trim().slice(0, 80), grams: Math.min(MAX_GRAMS, Math.round(pos(k.grams))) }))
    .filter(k => k.name && k.grams > 0 && !seen.has(normName(k.name)) && seen.add(normName(k.name))).slice(0, 12)
}
/**
 * The model's items with the measured weights put back in. A weighed food is not an estimate:
 * the matching item (same name, or one name containing the other) takes the measured grams,
 * keeps its density, and is marked `measured`. Weights that match no item come back in
 * `unmatched`, to be said out loud rather than dropped.
 */
export function applyKnown(items, known) {
  const unmatched = []
  let out = items
  cleanKnown(known).forEach(k => {
    const key = normName(k.name)
    const hit = out.find(i => normName(i.name) === key) ||
      out.find(i => normName(i.name).includes(key) || key.includes(normName(i.name)))
    if (!hit) { unmatched.push(k); return }
    out = out.map(i => (i.id === hit.id ? { ...setWeight(i, k.grams), measured: true } : i))
  })
  return { items: markIncluded(out), unmatched }
}

/* ---------------- the pending list (drafts, offline queue, results to approve) ---------------- */

export function putPending(s, p, now = Date.now()) {
  let out = null
  edit(s, n => {
    const i = n.pending.findIndex(x => x.id === p.id)
    out = { attempts: 0, photoIds: [], createdAt: now, ...(i >= 0 ? n.pending[i] : {}), ...p, updatedAt: now }
    if (i >= 0) n.pending[i] = out; else n.pending.push(out)
  })
  return out
}
export function removePending(s, id) {
  let photos = []
  edit(s, n => {
    const p = n.pending.find(x => x.id === id)
    photos = p ? p.photoIds || [] : []
    n.pending = n.pending.filter(x => x.id !== id)
  })
  return photos
}
/**
 * After a restart nothing is in flight any more: an analysis that was running when the app
 * died goes back to the queue, where it waits to be started again by hand. Nothing is ever
 * re-sent on its own.
 */
export function recoverPending(s) {
  if (!nutritionOf(s).pending.some(p => p.status === 'analyzing')) return false
  edit(s, n => { n.pending = n.pending.map(p => (p.status === 'analyzing' ? { ...p, status: 'queued', error: 'interrupted' } : p)) })
  return true
}

/* ---------------- reading it back ---------------- */

export const mealsOn = (S, d) => nutritionOf(S).meals.filter(m => m.d === d)
export const dayTotals = (S, d) => sumMacros(mealsOn(S, d).map(m => m.totalMacros))
/** The seven days ending on `d`, oldest first, plus the average over the days that have meals. */
export function weekStats(S, d) {
  const end = new Date(d + 'T12:00:00')
  const days = []
  for (let i = 6; i >= 0; i--) {
    const day = new Date(end); day.setDate(end.getDate() - i)
    const iso = isoOf(day)
    const meals = mealsOn(S, iso)
    days.push({ d: iso, meals: meals.length, ...sumMacros(meals.map(m => m.totalMacros)) })
  }
  const logged = days.filter(x => x.meals)
  const avg = zeroMacros()
  if (logged.length) NUTRIENTS.forEach(k => { avg[k] = r1(logged.reduce((n, x) => n + x[k], 0) / logged.length) })
  return { days, logged: logged.length, avg }
}
/** The foods logged most often, each as its most recent version — one tap to add it again. */
export function frequentFoods(S, limit = 12) {
  const seen = new Map()
  nutritionOf(S).meals.forEach(m => countedItems(m.items).forEach(i => {
    const k = normName(i.name)
    if (!k) return
    const e = seen.get(k) || { count: 0, item: i, last: 0 }
    e.count++
    if (m.timestamp >= e.last) { e.item = i; e.last = m.timestamp }
    seen.set(k, e)
  }))
  return [...seen.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, limit)
}
export const favoriteMeals = S => nutritionOf(S).meals.filter(m => m.favorite).reverse()
/** A stored item as a fresh one, for adding it to another meal. */
export const reuseItem = i => calcItem({ ...i, id: uid(), source: 'manual', aiConfidence: null, includedIn: undefined, countSeparately: undefined })
