// The Coach, in the mobile build: Google Gemini, called straight from the phone.
//
// The mobile app has no backend, so this module plays the part api/coach/jobs.js plays on a
// server — build the payload, prompt the model, validate, one repair round, hold the
// proposal — and answers the same calls coach-api.js makes there. It reuses the server's own
// payload builder, validator and prompts (vite.config.js shims their two Node touchpoints),
// so what leaves the phone and what is accepted back are exactly what a server would do.
//
// The API key is the phone owner's own, entered in the Coach screen and kept in this app's
// storage only. It is never part of the training state, so an export or share cannot carry it.
//
// Nothing here ships in a web bundle: every entry point is behind MOBILE.

import * as payloadLib from '../../../api/coach/payload.js'
import { extractJSON, validatePlan, validateReview, contractOK } from '../../../api/coach/validate.js'
import COMMON from '../../../api/coach/prompts/common.md?raw'
import CREATE from '../../../api/coach/prompts/create.md?raw'
import REFINE from '../../../api/coach/prompts/refine.md?raw'
import REVIEW from '../../../api/coach/prompts/review.md?raw'
import REPAIR from '../../../api/coach/prompts/repair.md?raw'
import { planHash } from './coach.js'
import { t } from './i18n.js'

export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/'
const TIMEOUT_MS = 5 * 60000
const PENDING_DAYS = 14
const SETTINGS = 'opengym-coach-gemini'
const STORE = 'opengym-coach-local'
const SYSTEM_PROMPT = [
  'You are the openGym Coach.',
  'Answer only the supplied task and return exactly the requested JSON.',
  'You have no tools, filesystem access, external services, or persistent memory.'
].join(' ')

/* ---------------- settings and the held proposal ---------------- */

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }

export const geminiSettings = () => ({ key: '', model: DEFAULT_MODEL, ...read(SETTINGS, {}) })
export function saveGeminiSettings({ key, model }) {
  write(SETTINGS, { key: String(key || '').trim(), model: String(model || '').trim() || DEFAULT_MODEL })
}

let job = null
let lastError = null
const pendingOf = () => {
  const p = read(STORE, {}).pending || null
  if (p && p.expiresAt && p.expiresAt < Date.now()) { write(STORE, {}); return null }
  return p
}

/* ---------------- prompt + provider ---------------- */

export function buildPrompt(kind, payload, repair) {
  const task = kind === 'review' ? REVIEW : payload.refine ? REFINE : CREATE
  let out = COMMON + '\n\n---\n\n' + task +
    '\n\n---\n\n## Payload\n\n```json\n' + JSON.stringify(payload, null, 1) + '\n```\n'
  if (repair) {
    out += '\n\n---\n\n' + REPAIR
      .replace('{{PREVIOUS}}', String(repair.previous || '').slice(0, 4000))
      .replace('{{ERRORS}}', repair.errors.map(e => '- ' + e).join('\n'))
  }
  return out
}

/** One generateContent round-trip. Resolves to { text } or { errorClass, detail }. */
export async function callGemini(prompt, { key, model }, timeoutMs = TIMEOUT_MS) {
  if (!key) return { errorClass: 'auth', detail: 'no Gemini API key set' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(ENDPOINT + encodeURIComponent(model || DEFAULT_MODEL) + ':generateContent', {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      const detail = body?.error?.message || 'HTTP ' + res.status
      const authish = res.status === 401 || res.status === 403 || /api key|API_KEY/i.test(detail)
      return { errorClass: authish ? 'auth' : res.status === 429 ? 'cap' : 'provider', detail }
    }
    const text = (body.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim()
    if (!text) return { errorClass: 'unusable', detail: body.promptFeedback?.blockReason || 'empty answer' }
    return { text }
  } catch (e) {
    return ctl.signal.aborted ? { errorClass: 'timeout' } : { errorClass: 'provider', detail: String(e?.message || e) }
  } finally {
    clearTimeout(timer)
  }
}

/* ---------------- running a job (mirrors jobs.js execute/invoke) ---------------- */

async function attempt(kind, payload, settings, repair) {
  const r = await callGemini(buildPrompt(kind, payload, repair), settings)
  if (r.errorClass) return { ok: false, errorClass: r.errorClass, detail: r.detail }

  const parsed = extractJSON(r.text)
  if (parsed.error) return { ok: false, repairable: !repair, errors: [parsed.error], raw: r.text, errorClass: 'unusable' }
  if (!contractOK(parsed.value)) {
    return { ok: false, repairable: !repair, errors: [`coach_contract must be ${payloadLib.CONTRACT}`], raw: r.text, errorClass: 'unusable' }
  }
  const v = kind === 'review'
    ? validateReview(parsed.value, payload.plan)
    : validatePlan(parsed.value, { workingWeights: payload.history?.workingWeights, daysPerWeek: payload.coachProfile?.daysPerWeek })
  if (!v.ok) return { ok: false, repairable: !repair, errors: v.errors, raw: r.text, errorClass: 'unusable' }
  if (v.nochange) return { ok: true, nochange: true }
  return { ok: true, result: v.proposal ? v.proposal : { bundle: v.bundle, summary: v.bundle.summary } }
}

/** Run one Coach job to completion. Exported for tests; the app goes through `start`. */
export async function runJob(S, opts, settings = geminiSettings()) {
  const previous = opts.refine ? pendingOf() : null
  const payload = payloadLib.build(S, 'this-phone', {
    kind: opts.kind, intake: opts.intake, note: opts.note, refine: opts.refine, previous: previous?.bundle || null
  })
  let a = await attempt(opts.kind, payload, settings, null)
  // One repair round, then done — the same rule the server keeps.
  if (!a.ok && a.repairable) a = await attempt(opts.kind, payload, settings, { previous: a.raw, errors: a.errors })
  if (!a.ok) return { outcome: 'failed', errorClass: a.errorClass, detail: a.detail || a.errors?.join('; ') }
  if (a.nochange) return { outcome: 'nochange' }
  return {
    outcome: 'ready',
    pending: {
      id: 'local-' + Date.now().toString(36),
      kind: opts.kind,
      createdAt: Date.now(),
      expiresAt: Date.now() + PENDING_DAYS * 86400000,
      planHash: planHash(S),
      iteration: opts.refine ? (previous?.iteration || 1) + 1 : 1,
      ...a.result
    }
  }
}

/* ---------------- the API surface coach-api.js calls ---------------- */

export const localStatus = () => ({ job, pending: pendingOf(), cap: { used: 0, limit: 0 }, lastError })

function start(S, opts) {
  if (job) throw Object.assign(new Error(t('The Coach is already thinking about your training.')), { status: 409 })
  if (!S?.coach?.consent?.agreedAt) throw Object.assign(new Error(t('The Coach needs your go-ahead first.')), { status: 403 })
  const settings = geminiSettings()
  if (!settings.key) throw Object.assign(new Error(t('Add your Gemini API key first.')), { status: 503 })

  job = { id: 'local-' + opts.kind, kind: opts.kind, state: 'running', startedAt: Date.now() }
  lastError = null
  runJob(S, opts, settings)
    .then(r => {
      if (r.outcome === 'ready') write(STORE, { pending: r.pending })
      else if (r.outcome === 'nochange') { write(STORE, {}); notify(t('The Coach found nothing worth changing right now.')) }
      else { lastError = { errorClass: r.errorClass, detail: r.detail || null }; notify(errorText(r.errorClass)) }
    })
    .catch(e => { lastError = { errorClass: 'internal', detail: String(e?.message || e) }; notify(errorText('internal')) })
    .finally(() => { job = null })
  return { job }
}

const errorText = cls => cls === 'auth'
  ? t('Gemini rejected the API key — check it in the Coach screen.')
  : cls === 'cap' ? t('Gemini’s rate limit was reached — try again later.')
    : cls === 'timeout' ? t('The Coach took too long and gave up.')
      : cls === 'unusable' ? t('The Coach answered with something the app couldn’t use.')
        : t('The Coach couldn’t reach Gemini — check your connection and try again.')

async function notify(msg) {
  const { useUI } = await import('../store/useUI.js')
  useUI.getState().toast(msg)
}

export const localReview = (S, note) => start(S, { kind: 'review', note: note ? String(note).slice(0, 1000) : null })
export const localPlan = (S, intake) => start(S, { kind: 'create', intake: intake || null })
export const localRefine = (S, text) => start(S, { kind: 'create', refine: String(text || '').slice(0, 1000) })
export const localResolve = () => { write(STORE, {}); return { ok: true } }
export const localDisclosure = () => ({ provider: 'gemini', providerLabel: 'Google Gemini', categories: payloadLib.DATA_CATEGORIES, version: 1 })
