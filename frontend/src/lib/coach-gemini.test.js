import { describe, it, expect, vi, beforeEach } from 'vitest'

// Under vitest the server modules run on real Node, so the payload handle's secret has to exist.
vi.mock('node:fs', async orig => {
  const m = await orig()
  const readFileSync = (p, ...a) => String(p).endsWith('secret') ? 'test-secret' : m.default.readFileSync(p, ...a)
  return { ...m, default: { ...m.default, readFileSync } }
})

const mem = new Map()
globalThis.localStorage = {
  getItem: k => mem.has(k) ? mem.get(k) : null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k)
}

const { runJob, callGemini, buildPrompt, DEFAULT_MODEL } = await import('./coach-gemini.js')

const S = {
  lang: 'es', unit: 'kg',
  routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }],
  week: { 1: 'r1' },
  workouts: [],
  coach: { consent: { agreedAt: '2026-10-01T00:00:00Z', version: 1 } }
}
const settings = { key: 'k-123', model: DEFAULT_MODEL }
const answer = text => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) })

beforeEach(() => { mem.clear(); globalThis.fetch = vi.fn() })

describe('Gemini Coach on the phone', () => {
  it('defaults to Gemini 3.5 Flash-Lite', () => {
    expect(DEFAULT_MODEL).toBe('gemini-3.5-flash-lite')
  })

  it('sends the key as a header and asks for JSON', async () => {
    fetch.mockResolvedValue(answer('{"ok":true}'))
    const r = await callGemini('hi', settings)
    expect(r.text).toBe('{"ok":true}')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toContain('/models/gemini-3.5-flash-lite:generateContent')
    expect(url).not.toContain('k-123')
    expect(init.headers['x-goog-api-key']).toBe('k-123')
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json')
  })

  it('builds the prompt from the server prompts and payload', () => {
    const p = buildPrompt('review', { plan: {} }, null)
    expect(p).toContain('## Payload')
    expect(p).toContain('Output is JSON and nothing else')
  })

  it('turns a valid review into a pending proposal', async () => {
    fetch.mockResolvedValue(answer(JSON.stringify({
      coach_contract: 1, summary: 'Más volumen.',
      changes: [{ type: 'sets', target: { routineId: 'r1', exId: '0001' }, after: 4, why: 'Cumpliste todas las series.' }]
    })))
    const r = await runJob(S, { kind: 'review' }, settings)
    expect(r.outcome).toBe('ready')
    expect(r.pending.kind).toBe('review')
    expect(r.pending.changes).toHaveLength(1)
    expect(r.pending.planHash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('gives the model one repair round, then accepts', async () => {
    fetch.mockResolvedValueOnce(answer('not json at all'))
      .mockResolvedValueOnce(answer('{"coach_contract":1,"nochange":true,"reading":"Todo bien."}'))
    const r = await runJob(S, { kind: 'review' }, settings)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetch.mock.calls[1][1].body).contents[0].parts[0].text).toContain('REPAIR REQUEST')
    expect(r.outcome).toBe('nochange')
  })

  it('reports a rejected key as an auth failure without retrying', async () => {
    fetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }) })
    const r = await runJob(S, { kind: 'review' }, settings)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ outcome: 'failed', errorClass: 'auth' })
  })

  it('refuses to call out without a key', async () => {
    const r = await callGemini('hi', { key: '' })
    expect(r.errorClass).toBe('auth')
    expect(fetch).not.toHaveBeenCalled()
  })
})
