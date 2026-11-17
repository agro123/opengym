// The eight nutrition screens, rendered to a string against three states — empty, a log with
// meals, and a scan waiting for approval. No browser: this catches a screen that throws on
// the data it is actually handed, which is the failure a pure-function test cannot see.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mem = new Map()
vi.stubGlobal('localStorage', { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) })
vi.stubGlobal('navigator', { onLine: true, userAgent: 'vitest' })
vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' })
vi.stubGlobal('window', globalThis)

let useStore, N, views
beforeAll(async () => {
  ({ useStore } = await import('../store/useStore.js'))
  N = await import('../lib/nutrition.js')
  views = {
    '/nutrition': (await import('./Nutrition.jsx')).default,
    '/nutrition/scan': (await import('./FoodScanner.jsx')).default,
    '/nutrition/scan/:id': (await import('./FoodScanner.jsx')).default,
    '/nutrition/review/:id': (await import('./FoodAnalysisResults.jsx')).default,
    '/nutrition/edit/:kind/:id': (await import('./PortionEditor.jsx')).default,
    '/nutrition/meal/:id': (await import('./MealDetails.jsx')).default,
    '/nutrition/history': (await import('./FoodHistory.jsx')).default,
    '/nutrition/goals': (await import('./NutritionGoals.jsx')).default,
    '/nutrition/settings': (await import('./NutritionSettings.jsx')).default
  }
})

const show = path => renderToString(<MemoryRouter initialEntries={[path]}><Routes>
  {Object.entries(views).map(([p, V]) => <Route key={p} path={p} element={<V />} />)}
</Routes></MemoryRouter>)
// renderToString reads the store's *initial* state (zustand's server snapshot), so that is
// the one to change.
const setState = fn => { const S = JSON.parse(JSON.stringify(useStore.getState().S)); fn(S); useStore.setState({ S }); useStore.getInitialState().S = S }
const item = (name, g, kcal, over = {}) => N.newItem({ name, estimatedWeightGrams: g, quantity: g, macrosPer100g: { kcal, protein: 10, carbs: 20, fat: 5 }, ...over })

describe('nutrition screens render', () => {
  it('on a profile that has never logged food', () => {
    for (const p of ['/nutrition', '/nutrition/scan', '/nutrition/history', '/nutrition/goals', '/nutrition/settings', '/nutrition/edit/new/today']) {
      expect(show(p).length, p).toBeGreaterThan(200)
    }
    expect(show('/nutrition')).toContain('2,000')
    expect(show('/nutrition/history')).toContain('No meals yet')
  })

  it('with meals in the log', () => {
    let meal
    setState(S => {
      meal = N.saveMeal(S, { name: 'Bandeja paisa', mealType: 'lunch', timestamp: Date.now(), source: 'ai_scan', requestId: 'fa-1', photoIds: ['ph1'],
        uncertainties: ['No se ve debajo del arroz'], items: [item('Arroz', 180, 130, { source: 'ai_scan', aiConfidence: 0.9, rawOrCooked: 'cooked', cookedYield: 2.8 }), item('Chicharrón', 60, 540, { source: 'ai_scan', aiConfidence: 0.4 })] })
      N.setFavorite(S, meal.id, true)
      N.setGoals(S, { kcal: 2400, protein: 150, carbs: 250, fat: 80 })
    })
    const home = show('/nutrition')
    expect(home).toContain('Bandeja paisa')
    expect(home).toContain('2,400')
    const detail = show('/nutrition/meal/' + meal.id)
    expect(detail).toContain('Chicharrón')
    expect(detail).toContain('Low confidence')
    expect(detail).toContain('No se ve debajo del arroz')
    expect(show('/nutrition/edit/m/' + meal.id)).toContain('Nutrition per 100 g')
    const history = show('/nutrition/history')
    expect(history).toContain('Favorite meals')
    expect(history).toContain('Foods you log often')
  })

  it('with a scan in every state of the pending list', () => {
    setState(S => {
      N.putPending(S, { id: 'd1', status: 'draft', mealType: 'dinner', timestamp: Date.now(), photoIds: ['a'] })
      N.putPending(S, { id: 'q1', status: 'queued', consentAt: 1, error: 'offline', mealType: 'lunch', timestamp: Date.now(), photoIds: ['b'] })
      N.putPending(S, { id: 'f1', status: 'failed', error: 'unusable', mealType: 'lunch', timestamp: Date.now(), photoIds: ['c'] })
      N.putPending(S, { id: 'r1', status: 'review', requestId: 'fa-2', mealType: 'breakfast', timestamp: Date.now(), photoIds: ['d'], analysis: {
        mealName: 'Arepa con queso y café', mealType: 'breakfast', assumptions: ['Arepa de 12 cm'], uncertainties: ['No se sabe si el café lleva azúcar'], requiresUserConfirmation: true,
        items: N.markIncluded([item('Arepa con queso', 150, 260, { source: 'ai_scan', aiConfidence: 0.8, ingredients: ['arepa', 'queso'], extras: ['mantequilla'], note: 'Puede llevar mantequilla.' }), item('Queso', 30, 300, { source: 'ai_scan', aiConfidence: 0.6 })]) } })
    })
    const home = show('/nutrition')
    for (const label of ['Unfinished scan', 'Waiting to be analysed', 'Analysis failed', 'Ready for you to check', 'Analyse now']) expect(home).toContain(label)
    const review = show('/nutrition/review/r1')
    expect(review).toContain('Arepa con queso y café')
    expect(review).toContain('not counted twice')
    expect(review).toContain('visual guess')
    expect(review).toContain('save meal')
    expect(review).toContain('No se sabe si el café lleva azúcar')
    expect(show('/nutrition/edit/p/r1')).toContain('Count it separately')
    expect(show('/nutrition/scan/f1')).toContain('couldn’t use')
    expect(show('/nutrition/scan/d1')).toContain('Analyse with Gemini')
    setState(S => {
      N.saveContainer(S, { id: 'c1', name: 'Plato hondo', kind: 'bowl', cm: 18, ml: 600 })
      N.putPending(S, { id: 'd2', status: 'draft', mealType: 'lunch', timestamp: Date.now(), photoIds: ['a', 'b'],
        scale: { type: 'container', id: 'c1', name: 'Plato hondo', kind: 'bowl', cm: 18, ml: 600 }, known: [{ name: 'arroz', grams: 180 }] })
    })
    const scan = show('/nutrition/scan/d2')
    for (const label of ['Scale (optional)', 'Plato hondo', 'Bank card in photo', 'Weighed anything?', 'arroz', '>180<', 'From above', 'From the side']) expect(scan).toContain(label)
    const settings = show('/nutrition/settings')
    expect(settings).toContain('My plates and bowls')
    expect(settings).toContain('18 cm · 600 ml')
  })
})
