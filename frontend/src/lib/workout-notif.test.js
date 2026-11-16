import { describe as suite, it, expect, vi } from 'vitest'

// (the made-up exercise ids resolve to the catalogue's "unknown exercise" placeholder)
// The module registers a native plugin and pulls in the sheets (React) at import time; neither
// matters to the two pure functions under test.
vi.mock('@capacitor/core', () => ({ registerPlugin: () => ({}), Capacitor: { getPlatform: () => 'web' } }))
vi.mock('../sheets.jsx', () => ({ toggleSet: () => {}, finishWorkout: () => {} }))
vi.mock('../store/useStore.js', () => ({ useStore: {} }))
vi.mock('../store/useUI.js', () => ({ useUI: {} }))

const { upNext, describe } = await import('./workout-notif.js')

const sets = (...done) => done.map(d => ({ w: 60, r: 8, done: !!d }))
const entry = (id, s, sg) => ({ id, sg, target: { mode: 'reps', reps: 8 }, sets: s })

suite('upNext', () => {
  it('is the first open set of the exercise on screen', () => {
    const A = { cur: 1, entries: [entry('a', sets(0, 0)), entry('b', sets(1, 0, 0))] }
    expect(upNext(A)).toMatchObject({ idx: 1, i: 1 })
  })
  it('alternates inside a superset', () => {
    const A = { cur: 0, entries: [entry('a', sets(1, 0), 'x'), entry('b', sets(0, 0), 'x')] }
    expect(upNext(A)).toMatchObject({ idx: 1, i: 0 })
    A.entries[1].sets[0].done = true
    expect(upNext(A)).toMatchObject({ idx: 0, i: 1 })
  })
  it('moves on when the exercise on screen is finished, wrapping round', () => {
    const A = { cur: 1, entries: [entry('a', sets(0)), entry('b', sets(1, 1))] }
    expect(upNext(A)).toMatchObject({ idx: 0, i: 0 })
  })
  it('is null when nothing is left, or nothing was added yet', () => {
    expect(upNext({ cur: 0, entries: [entry('a', sets(1))] })).toBeNull()
    expect(upNext({ cur: 0, entries: [] })).toBeNull()
    expect(upNext(null)).toBeNull()
  })
})

suite('describe', () => {
  const S = { unit: 'kg', active: { name: 'Push', start: 5, cur: 0, entries: [entry('a', sets(1, 0)), entry('b', sets(0))] } }
  it('shows the next set with both of its numbers, and what follows it', () => {
    expect(describe(S, null)).toMatchObject({ mode: 'set', text: 'Set 2/2 · 60 × 8', step: 2, down: 'Reps −', up: 'Reps +', chip: '60×8', value: '60 kg × 8', pos: 'Set 2/2', segs: [2, 1], doneSets: 1,
      next: 'Next: Unknown Exercise 60 kg × 8', progress: '1/3 sets', start: 5 })
  })
  it('steps the duration of a timed set', () => {
    const plank = { unit: 'kg', active: { name: 'Core', start: 5, cur: 0, entries: [{ id: 'p', target: { mode: 'time' }, sets: [{ sec: 45, w: 0, done: false }] }] } }
    expect(describe(plank, null)).toMatchObject({ step: 1, down: 'Seconds −', up: 'Seconds +' })
  })
  it('has nothing to follow the very last set', () => {
    const last = { unit: 'kg', active: { name: 'Push', start: 5, cur: 0, entries: [entry('a', sets(1, 0))] } }
    expect(describe(last, null).next).toBe('')
  })
  it('switches to the countdown while resting, naming the set the rest leads into', () => {
    expect(describe(S, { endsAt: 123 })).toMatchObject({ mode: 'rest', endsAt: 123, minus: '−15s', plus: '+15s', text: 'Next: Unknown Exercise 60 kg × 8' })
  })
  it('offers to finish once every set is done', () => {
    const done = { unit: 'kg', active: { name: 'Push', start: 5, cur: 0, entries: [entry('a', sets(1, 1))] } }
    expect(describe(done, null)).toEqual({ mode: 'idle', title: 'Push', text: '2/2 sets', progress: '2/2 sets', start: 5, done: 'Finish workout',
      accent: '#30d158', segs: [2], doneSets: 2 })
  })
  it('has nothing to finish in an empty freestyle session', () => {
    expect(describe({ unit: 'kg', active: { name: 'Freestyle', start: 5, cur: 0, entries: [] } }, null).done).toBeUndefined()
  })
})
