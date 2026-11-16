// Mobile build, Android only: the running workout as an ongoing notification you can drive
// without opening the app — step the next set's two numbers and check it off, trim, extend or
// skip the rest that follows, and finish the session once nothing is left.
//
// The session stays the single source of truth. The native side (WorkoutNotificationPlugin +
// WorkoutService) only draws what it is handed and reports taps back as `action` events; every
// tap lands in the same store calls the workout screen makes, and the notification is redrawn
// from the resulting state. A foreground service keeps the WebView alive in the background,
// so that round trip works with the app out of sight. The one thing native owns is the
// countdown itself (a chronometer, so nothing ticks here) and noticing that it ran out.
import { registerPlugin, Capacitor } from '@capacitor/core'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { exOr, imgSrc } from './exercises.js'
import { supersetUnits, unitOf, modeOf, setCols, stepField, setsDoneActive, setLabel } from './history.js'
import { fmtNum, ACCENTS } from './format.js'
import { t } from './i18n.js'
import { toggleSet, finishWorkout } from '../sheets.jsx'

const Native = registerPlugin('WorkoutNotification')

const REST_STEP = 15
const modeAt = e => modeOf({ ...(e.target || {}), id: e.id })
// exercise names are stored lower-case and capitalised in CSS — there is no CSS out here
const title = s => String(s || '').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')

// The set the notification is about: the next open one in the unit on screen, else in the
// units after it (wrapping round). Inside a superset the exercise with the fewest sets done
// is up — that is the back-to-back order the screen asks for.
export function upNext(A) {
  if (!A || !A.entries.length) return null
  const units = supersetUnits(A.entries)
  const cur = Math.min(A.cur, A.entries.length - 1)
  const start = Math.max(0, units.findIndex(u => u.includes(cur)))
  for (let k = 0; k < units.length; k++) {
    let best = null
    for (const idx of units[(start + k) % units.length]) {
      const sets = A.entries[idx].sets
      const i = sets.findIndex(s => !s.done)
      if (i < 0) continue
      const n = sets.filter(s => s.done).length
      if (!best || n < best.n) best = { idx, i, n }
    }
    if (best) return best
  }
  return null
}

// "Bench Press 60 kg × 8" — a set spelled out, for the line that says what comes next.
const spell = (S, entry, set) => title(exOr(entry.id).n) + ' ' + (modeAt(entry) === 'reps'
  ? fmtNum(set.w || 0) + ' ' + S.unit + ' × ' + (set.r || 0)
  : setLabel(entry.id, set, entry.target))
const nextLine = (S, A, at) => at ? t('Next') + ': ' + spell(S, A.entries[at.idx], A.entries[at.idx].sets[at.i]) : ''
// The set that will be up once `at` is checked off.
function after(A, at) {
  const entries = A.entries.map((e, k) => k !== at.idx ? e : { ...e, sets: e.sets.map((x, j) => j === at.i ? { ...x, done: true } : x) })
  return upNext({ ...A, cur: at.idx, entries })
}

// The one number the notification can step: it has room for three buttons, so it gets the
// value that moves from set to set — reps, or the duration of a timed or cardio set.
// (Weight comes from the progression engine and is set in the app.)
const stepCol = mode => mode === 'reps' ? 2 : 1

// What the notification should show right now — everything already formatted and translated,
// so the native side holds no wording and no workout logic. `progress` and `start` feed the
// notification's header (sets done in the session, and a clock counting up from its start);
// `img` is the exercise picture's file name, swapped for a local file before it is sent;
// `chip` is the few characters the Live Update chip in the status bar shows. `accent` colours
// the notification like the app; `segs` (sets per exercise) and `doneSets` draw the session's
// progress bar.
export function describe(S, timer) {
  const A = S.active
  const at = upNext(A)
  const entry = at && A.entries[at.idx]
  const total = A.entries.reduce((n, e) => n + e.sets.length, 0)
  const doneSets = setsDoneActive(A)
  const session = { progress: t('{0} sets', doneSets + '/' + total), start: A.start,
    accent: ACCENTS[S.accent] || ACCENTS.lime, segs: A.entries.map(e => e.sets.length), doneSets }
  if (!entry) {
    // nothing left to check off: the one useful thing left is to finish
    return { mode: 'idle', title: A.name, text: session.progress, ...session, ...(total ? { done: t('Finish workout') } : {}) }
  }
  const img = exOr(entry.id).img
  if (timer) {
    return { mode: 'rest', title: t('Rest'), text: nextLine(S, A, at), endsAt: timer.endsAt,
      minus: '−' + REST_STEP + 's', plus: '+' + REST_STEP + 's', skip: t('Skip'), ...session, img }
  }
  const mode = modeAt(entry)
  const [c1, c2] = setCols(mode)
  const set = entry.sets[at.i]
  const v1 = fmtNum(set[c1.f] || 0), v2 = fmtNum(set[c2.f] || 0)
  const pos = t('Set {0}', (at.i + 1) + '/' + entry.sets.length)
  const f = stepCol(mode)
  const hd = t((f === 1 ? c1 : c2).hd, S.unit)
  // the set's numbers with their units — the part of the line drawn in bold
  const value = mode === 'reps' ? v1 + ' ' + S.unit + ' × ' + v2 : v1 + ' · ' + v2
  return { mode: 'set', title: title(exOr(entry.id).n), text: pos + ' · ' + v1 + (mode === 'reps' ? ' × ' : ' · ') + v2, value, pos,
    step: f, down: hd + ' −', up: hd + ' +', done: t('Done'), chip: v1 + (mode === 'reps' ? '×' : '·') + v2,
    next: nextLine(S, A, after(A, at)), ...session, img }
}

function onAction({ action }) {
  const ui = useUI.getState()
  if (action === 'rest-') return ui.addRest(-REST_STEP)
  if (action === 'rest+') return ui.addRest(REST_STEP)
  if (action === 'skip') return ui.stopRest()
  if (action === 'restEnd') return ui.pokeRest()
  const { S, update } = useStore.getState()
  const A = S.active
  const at = upNext(A)
  // only offered once every set is checked off, so this finishes without a prompt
  if (action === 'finish') { if (A && !at) finishWorkout(); return }
  if (!at) return
  if (action === 'done') {
    // the notification may have moved on to the next exercise ahead of the screen — bring
    // the screen along, so opening the app shows the set that was just checked off
    if (!unitOf(supersetUnits(A.entries), A.cur).includes(at.idx)) update(s => { s.active.cur = at.idx }, true)
    return toggleSet(at.idx, at.i)
  }
  const m = /^f([12])([+-])$/.exec(action)
  if (!m) return
  const col = setCols(modeAt(A.entries[at.idx]))[m[1] - 1]
  update(s => {
    const set = s.active.entries[at.idx].sets[at.i]
    set[col.f] = stepField(set[col.f], col.step, m[2] === '+' ? 1 : -1)
  }, true)
}

// Android 13+ shows nothing without the notification permission. Asked once per launch, when
// a workout is actually running — the same prompt the workout-day reminder uses.
async function askPermission() {
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const p = await LocalNotifications.checkPermissions()
    if (p.display.startsWith('prompt')) await LocalNotifications.requestPermissions()
  } catch (e) { /* the controls just stay hidden */ }
}

// The exercise picture shown beside the controls. A notification can only draw a file that is
// on the phone, and the mobile build leaves media on the CDN — so each picture is saved to the
// app's data directory the first time its exercise comes up, and read from there afterwards.
// Stills only: Android does not animate images inside a notification.
const kept = new Map()   // file name → local uri; null while fetching, or when it failed
function thumb(name) {
  if (!name) return null
  if (kept.has(name)) return kept.get(name)
  kept.set(name, null)
  keepImg(name).then(uri => {
    if (uri) { kept.set(name, uri); sync() }
    else setTimeout(() => kept.delete(name), 60000)   // offline: try again in a while
  })
  return null
}
async function keepImg(name) {
  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    const file = { path: 'img/' + name, directory: Directory.Data }
    try { await Filesystem.stat(file) } catch (e) {
      const res = await fetch(imgSrc({ img: name }))
      if (!res.ok) return null
      const blob = await res.blob()
      const data = await new Promise((ok, fail) => {
        const r = new FileReader()
        r.onload = () => ok(String(r.result).split(',')[1])
        r.onerror = fail
        r.readAsDataURL(blob)
      })
      await Filesystem.writeFile({ ...file, data, recursive: true })
    }
    return (await Filesystem.getUri(file)).uri
  } catch (e) { return null }
}

let shown = ''
let asked = false
function sync() {
  const S = useStore.getState().S
  if (!S.active) {
    if (shown) { shown = ''; Native.clear().catch(() => {}) }
    return
  }
  const { img, ...d } = describe(S, useUI.getState().timer)
  const image = thumb(img)
  if (image) d.image = image
  const key = JSON.stringify(d)
  if (key === shown) return
  shown = key
  Native.update(d).catch(() => {})
  // a notification posted before the permission was granted is dropped — post it again after
  if (!asked) { asked = true; askPermission().then(() => { shown = ''; sync() }) }
}

export function initWorkoutNotif() {
  if (Capacitor.getPlatform() !== 'android') return
  Native.addListener('action', onAction)
  useStore.subscribe(sync)
  useUI.subscribe(sync)
  sync()
}
