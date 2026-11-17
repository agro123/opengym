import { describe, it, expect } from 'vitest'
import {
  newItem, calcItem, setQuantity, setWeight, setUnit, setRawCooked, setPer100, markIncluded, mealTotals, buildMeal,
  saveMeal, deleteMeal, duplicateMeal, setFavorite, setGoals, goalsOf, nutritionOf, putPending, removePending, recoverPending,
  dayTotals, mealsOn, weekStats, frequentFoods, favoriteMeals, kcalOf, cleanMacros, DEFAULT_GOALS
} from './nutrition.js'

const rice = () => newItem({ name: 'Arroz blanco', quantity: 1, unit: 'cup', estimatedWeightGrams: 160, rawOrCooked: 'cooked', cookedYield: 2.8,
  macrosPer100g: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fiber: 0.4, sodium: 1 } })
const chicken = () => newItem({ name: 'Pechuga de pollo', quantity: 150, unit: 'g', estimatedWeightGrams: 150, rawOrCooked: 'cooked', cookedYield: 0.7,
  macrosPer100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6, sodium: 74 } })
const at = (y, m, d, h = 13) => new Date(y, m - 1, d, h).getTime()

describe('one food, normalised to 100 g', () => {
  it('scales every nutrient by weight', () => {
    const c = chicken()
    expect(c.calculatedMacros).toMatchObject({ kcal: 247.5, protein: 46.5, fat: 5.4, sodium: 111 })
  })
  it('recalculates from a new weight, quantity or density without any outside help', () => {
    expect(setWeight(chicken(), 200).calculatedMacros.kcal).toBe(330)
    expect(setQuantity(chicken(), 100)).toMatchObject({ estimatedWeightGrams: 100, calculatedMacros: { protein: 31 } })
    expect(setPer100(chicken(), 'protein', 20).calculatedMacros.protein).toBe(30)
  })
  it('keeps count units honest: two pieces weigh twice one piece', () => {
    const arepa = newItem({ name: 'Arepa', quantity: 1, unit: 'piece', estimatedWeightGrams: 90, macrosPer100g: { kcal: 220, carbs: 45 } })
    const two = setQuantity(arepa, 2)
    expect(two.estimatedWeightGrams).toBe(180)
    expect(two.calculatedMacros.kcal).toBe(396)
    // a heavier arepa is still one arepa
    expect(setWeight(arepa, 120)).toMatchObject({ quantity: 1, estimatedWeightGrams: 120 })
  })
  it('never changes how much food there is when only the unit changes', () => {
    const r = rice()
    const g = setUnit(r, 'g')
    expect(g).toMatchObject({ unit: 'g', quantity: 160, estimatedWeightGrams: 160 })
    expect(g.calculatedMacros).toEqual(r.calculatedMacros)
    expect(setUnit(g, 'tbsp')).toMatchObject({ quantity: 10.7, estimatedWeightGrams: 160 })
    expect(setUnit(g, 'serving')).toMatchObject({ quantity: 1, estimatedWeightGrams: 160 })
  })
  it('refuses nonsense: negative, NaN and impossible values become bounded numbers', () => {
    const m = cleanMacros({ kcal: -50, protein: NaN, carbs: 'abc', fat: 400, sodium: Infinity })
    expect(m).toMatchObject({ kcal: 0, protein: 0, carbs: 0, fat: 100, sodium: 0 })
    expect(calcItem({ ...chicken(), estimatedWeightGrams: -3 }).calculatedMacros.kcal).toBe(0)
  })
})

describe('raw and cooked are different numbers for the same food', () => {
  it('meat: 150 g raw is fewer calories than 150 g cooked', () => {
    const cooked = chicken()
    const raw = setRawCooked(cooked, 'raw')
    expect(raw.estimatedWeightGrams).toBe(150)
    expect(raw.macrosPer100g.kcal).toBe(115.5)          // 165 × 0.7
    expect(raw.calculatedMacros.kcal).toBeLessThan(cooked.calculatedMacros.kcal)
  })
  it('rice: 160 g raw is far more than 160 g cooked', () => {
    const raw = setRawCooked(rice(), 'raw')
    expect(raw.macrosPer100g.kcal).toBe(364)             // 130 × 2.8
    expect(raw.calculatedMacros.kcal).toBe(582.4)
  })
  it('switches back to where it started', () => {
    const back = setRawCooked(setRawCooked(chicken(), 'raw'), 'cooked')
    expect(back.macrosPer100g.kcal).toBe(165)
  })
  it('only relabels when no yield is known', () => {
    const bread = newItem({ name: 'Pan', rawOrCooked: 'cooked', cookedYield: 1, macrosPer100g: { kcal: 265 } })
    expect(setRawCooked(bread, 'raw').macrosPer100g.kcal).toBe(265)
  })
})

describe('a compound dish is not counted on top of its own ingredients', () => {
  const arepaQueso = newItem({ name: 'Arepa con queso', estimatedWeightGrams: 150, ingredients: ['arepa', 'Queso'], macrosPer100g: { kcal: 260 } })
  const queso = newItem({ name: 'queso', estimatedWeightGrams: 30, macrosPer100g: { kcal: 300 } })
  const cafe = newItem({ name: 'Café', estimatedWeightGrams: 200, macrosPer100g: { kcal: 2 } })
  it('leaves the ingredient out of the total, visibly', () => {
    const items = markIncluded([arepaQueso, queso, cafe])
    expect(items[1].includedIn).toBe(arepaQueso.id)
    expect(mealTotals(items).kcal).toBe(390 + 4)
  })
  it('counts it again when the person says it really is separate', () => {
    const items = markIncluded([arepaQueso, { ...queso, countSeparately: true }, cafe])
    expect(items[1].includedIn).toBeUndefined()
    expect(mealTotals(items).kcal).toBe(390 + 90 + 4)
  })
  it('does not let two dishes swallow each other', () => {
    const a = newItem({ name: 'Arroz con pollo', ingredients: ['arroz', 'pollo'], macrosPer100g: { kcal: 150 } })
    const b = newItem({ name: 'Pollo', ingredients: ['arroz con pollo'], macrosPer100g: { kcal: 165 } })
    const items = markIncluded([a, b])
    expect(items.filter(i => i.includedIn).length).toBe(1)
  })
  it('a mixed plate broken into components sums each exactly once', () => {
    const bandeja = ['Arroz', 'Frijoles', 'Carne molida', 'Chicharrón', 'Huevo frito', 'Plátano maduro', 'Arepa', 'Aguacate']
      .map(name => newItem({ name, estimatedWeightGrams: 100, macrosPer100g: { kcal: 100, protein: 5 } }))
    const meal = buildMeal({ name: 'Bandeja paisa', items: bandeja, timestamp: at(2026, 11, 10) })
    expect(meal.totalMacros).toMatchObject({ kcal: 800, protein: 40 })
  })
})

describe('the food log', () => {
  const S = () => ({ nutrition: null })
  const meal = (over = {}) => ({ name: 'Almuerzo', mealType: 'lunch', timestamp: at(2026, 11, 10), source: 'manual', items: [chicken(), rice()], ...over })

  it('reads an old state with no nutrition at all', () => {
    expect(nutritionOf({})).toMatchObject({ meals: [], pending: [], goals: null })
    expect(goalsOf({})).toEqual(DEFAULT_GOALS)
    expect(dayTotals({}, '2026-11-10').kcal).toBe(0)
  })
  it('saves a meal with its totals and local day', () => {
    const s = S()
    const m = saveMeal(s, meal())
    expect(m).toMatchObject({ d: '2026-11-10', mealType: 'lunch', source: 'manual' })
    expect(m.totalMacros.kcal).toBe(455.5)
    expect(dayTotals(s, '2026-11-10').protein).toBe(50.8)
  })
  it('does not log a second meal when the same analysis is approved twice', () => {
    const s = S()
    const first = saveMeal(s, meal({ source: 'ai_scan', requestId: 'fa-1' }))
    const again = saveMeal(s, meal({ source: 'ai_scan', requestId: 'fa-1', name: 'Almuerzo corregido' }))
    expect(nutritionOf(s).meals.length).toBe(1)
    expect(again.id).toBe(first.id)
    expect(again.name).toBe('Almuerzo corregido')
  })
  it('edits in place, deletes, and hands back the photos to remove', () => {
    const s = S()
    const m = saveMeal(s, meal({ photoIds: ['a', 'b'] }))
    saveMeal(s, { ...m, items: [setWeight(m.items[0], 300)] })
    expect(nutritionOf(s).meals.length).toBe(1)
    expect(nutritionOf(s).meals[0].totalMacros.kcal).toBe(495)
    expect(deleteMeal(s, m.id)).toEqual(['a', 'b'])
    expect(nutritionOf(s).meals).toEqual([])
  })
  it('logs a past meal again as a new one, without its photos', () => {
    const s = S()
    const m = saveMeal(s, meal({ photoIds: ['a'], requestId: 'fa-9', source: 'ai_scan' }))
    const copy = duplicateMeal(s, m.id, at(2026, 11, 12, 20))
    expect(copy).toMatchObject({ source: 'duplicate', d: '2026-11-12', mealType: 'dinner', photoIds: [] })
    expect(copy.id).not.toBe(m.id)
    expect(copy.requestId).toBeUndefined()
    expect(copy.totalMacros).toEqual(m.totalMacros)
    expect(nutritionOf(s).meals.length).toBe(2)
  })
  it('survives a round trip through storage', () => {
    const s = S()
    saveMeal(s, meal())
    setGoals(s, { kcal: 2400.4, protein: 150, carbs: 260, fat: 80 })
    const back = JSON.parse(JSON.stringify(s))
    expect(goalsOf(back)).toEqual({ kcal: 2400, protein: 150, carbs: 260, fat: 80 })
    expect(mealsOn(back, '2026-11-10').length).toBe(1)
    expect(dayTotals(back, '2026-11-10')).toEqual(dayTotals(s, '2026-11-10'))
  })
  it('averages the week over the days that were logged', () => {
    const s = S()
    saveMeal(s, meal({ timestamp: at(2026, 11, 8) }))
    saveMeal(s, meal({ timestamp: at(2026, 11, 10) }))
    saveMeal(s, meal({ timestamp: at(2026, 11, 10, 20), mealType: 'dinner' }))
    const w = weekStats(s, '2026-11-10')
    expect(w.days.length).toBe(7)
    expect(w.days[6]).toMatchObject({ d: '2026-11-10', meals: 2, kcal: 911 })
    expect(w.logged).toBe(2)
    expect(w.avg.kcal).toBe(683.3)
  })
  it('knows the foods logged most, and the starred meals', () => {
    const s = S()
    const a = saveMeal(s, meal({ timestamp: at(2026, 11, 8) }))
    saveMeal(s, meal({ timestamp: at(2026, 11, 9), items: [chicken()] }))
    const top = frequentFoods(s)
    expect(top[0]).toMatchObject({ count: 2, item: { name: 'Pechuga de pollo' } })
    expect(top[1].count).toBe(1)
    setFavorite(s, a.id, true)
    expect(favoriteMeals(s).map(m => m.id)).toEqual([a.id])
  })
  it('balances goals against the energy of their macros', () => {
    expect(kcalOf({ protein: 150, carbs: 250, fat: 70 })).toBe(2230)
  })
})

describe('the pending list: drafts, the offline queue, results to approve', () => {
  it('queues, updates and removes entries, returning photos to delete', () => {
    const s = {}
    putPending(s, { id: 'p1', status: 'draft', photoIds: ['x'] })
    putPending(s, { id: 'p1', status: 'queued', consentAt: 5 })
    expect(nutritionOf(s).pending).toMatchObject([{ id: 'p1', status: 'queued', consentAt: 5, photoIds: ['x'], attempts: 0 }])
    expect(removePending(s, 'p1')).toEqual(['x'])
    expect(nutritionOf(s).pending).toEqual([])
  })
  it('after a restart an interrupted analysis waits in the queue — it is never resent on its own', () => {
    const s = {}
    putPending(s, { id: 'p1', status: 'analyzing', photoIds: ['x'] })
    putPending(s, { id: 'p2', status: 'review', photoIds: ['y'] })
    expect(recoverPending(s)).toBe(true)
    expect(nutritionOf(s).pending.map(p => [p.status, p.error || null])).toEqual([['queued', 'interrupted'], ['review', null]])
    expect(recoverPending(s)).toBe(false)
  })
})

describe('plates and bowls', () => {
  it('keeps a measured container, edits it in place and removes it', async () => {
    const { saveContainer, removeContainer, cleanContainer } = await import('./nutrition.js')
    const s = {}
    const c = saveContainer(s, { name: ' Plato blanco ', kind: 'plate', cm: 26.04 })
    expect(c).toMatchObject({ name: 'Plato blanco', kind: 'plate', cm: 26 })
    saveContainer(s, { ...c, cm: 27 })
    expect(nutritionOf(s).prefs.containers).toEqual([{ ...c, cm: 27 }])
    removeContainer(s, c.id)
    expect(nutritionOf(s).prefs.containers).toEqual([])
    expect(cleanContainer({ kind: 'saucer', cm: -4, ml: 99999 })).toMatchObject({ kind: 'plate', cm: 0, ml: 5000 })
  })
  it('an older state has no containers and still reads', () => {
    expect(nutritionOf({ nutrition: { prefs: { keepPhotos: false } } }).prefs).toMatchObject({ keepPhotos: false, containers: [] })
  })
})
