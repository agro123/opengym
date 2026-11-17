import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { isoOf } from '../lib/format.js'
import { nutritionOf, setPrefs, saveContainer, cleanKnown, MEAL_TYPES, CONTAINER_KINDS } from '../lib/nutrition.js'
import { FOOD_ERRORS, MAX_PHOTOS, isOffline } from '../lib/food-ai.js'
import { newDraft, patchPending, addPhotos, removePhoto, runAnalysis, queuePending, discardPending } from '../lib/food-flow.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, TextArea, TextField, Stepper, NumberField } from '../components/ui.jsx'
import { Photos, MEAL_LABEL, KIND_LABEL, toLocalInput, fromLocalInput } from '../components/Food.jsx'

const PICK_ERRORS = {
  type: 'That file is not a photo the app can read (JPEG, PNG, WebP or HEIC).',
  size: 'That photo is too large (25 MB at most).',
  empty: 'That photo is empty.',
  decode: 'That photo could not be opened.',
  limit: 'A meal takes up to {0} photos.',
  storage: 'The photo could not be saved on this phone — storage may be full.'
}

// What leaves the phone, said before the first photo does. Agreeing is remembered; the same
// text stays readable in Nutrition settings.
export function disclosureSheet(onAgree) {
  useUI.getState().openSheet(close => <>
    <h3>{t('Before your first scan')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, display: 'grid', gap: 9, marginBottom: 14 }}>
      <div>{t('To analyse a meal, this phone sends the photos you choose — and the note you add — to Google Gemini, using your own API key. Nothing else is sent: no name, no training data, no location.')}</div>
      <div>{t('Photos are resized on the phone first, and are stored only on this phone. Google handles what it receives under the terms of your Gemini account.')}</div>
      <div>{t('What comes back is a visual estimate, not a measurement. You check and correct every portion before anything is logged.')}</div>
    </div>
    <Button variant="primary" onClick={() => { close(); onAgree() }}>{t('I understand — continue')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Not now')}</Button>
  </>)
}

/** Measure a plate or bowl once and keep it. Calls `onSaved(container)`. */
export function containerSheet(onSaved, start = {}) {
  useUI.getState().openSheet(close => <ContainerForm start={start} close={close} onSaved={onSaved} />)
}
function ContainerForm({ start, close, onSaved }) {
  const update = useStore(s => s.update)
  const [c, setC] = useState({ name: '', kind: 'plate', cm: 26, ml: 0, ...start })
  const save = () => {
    if (!(c.cm > 0)) return
    let out = null
    update(s => { out = saveContainer(s, { ...c, name: c.name.trim() || t(KIND_LABEL[c.kind]) + ' ' + c.cm + ' cm' }) })
    close(); onSaved && onSaved(out)
  }
  return <>
    <h3>{start.id ? t('Edit plate') : t('Add a plate or bowl')}</h3>
    <div className="muted small" style={{ marginBottom: 12, lineHeight: 1.45 }}>{t('Measure straight across the top, from rim to rim. Once is enough — it is kept for every scan.')}</div>
    <Segmented value={c.kind} onChange={v => setC(x => ({ ...x, kind: v }))} options={CONTAINER_KINDS.map(k => ({ value: k, label: t(KIND_LABEL[k]) }))} />
    <div style={{ height: 12 }} />
    <TextField value={c.name} maxLength={40} placeholder={t('Name (e.g. white dinner plate)')} onChange={e => setC(x => ({ ...x, name: e.target.value }))} />
    <div style={{ height: 12 }} />
    <Stepper label={c.kind === 'box' ? t('Long side') : t('Diameter')} unit="cm" value={c.cm} step={0.5} onChange={v => setC(x => ({ ...x, cm: v }))} />
    {c.kind !== 'plate' && <><div style={{ height: 10 }} /><Stepper label={t('Holds (optional)')} unit="ml" value={c.ml || 0} step={50} decimal={false} onChange={v => setC(x => ({ ...x, ml: v }))} /></>}
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={!(c.cm > 0)} onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </>
}

// What the camera can't see: how big the plate is, how high the food is piled, and what was
// already weighed. All optional; each one narrows the model's guess.
function ScaleCard({ p, containers }) {
  const s = p.scale
  const pick = scale => patchPending(p.id, { scale })
  const fromSaved = c => ({ type: 'container', id: c.id, name: c.name, kind: c.kind, cm: c.cm, ...(c.ml ? { ml: c.ml } : {}) })
  const on = k => (k === 'none' ? !s : k === 'card' || k === 'fork' ? s?.type === k : s?.type === 'container' && s.id === k)
  return <div className="card">
    <h2>{t('Scale (optional)')}</h2>
    <div className="muted small" style={{ marginBottom: 10, lineHeight: 1.45 }}>{t('The biggest error in a photo is size. Tell it what the food is on, or put a card or fork in the shot.')}</div>
    <div className="chips" style={{ flexWrap: 'wrap' }}>
      <button className={'chip' + (on('none') ? ' on' : '')} onClick={() => pick(null)}>{t('None')}</button>
      {containers.map(c => <button key={c.id} className={'chip' + (on(c.id) ? ' on' : '')} style={{ textTransform: 'none' }} onClick={() => pick(fromSaved(c))}>{c.name}</button>)}
      <button className={'chip' + (on('card') ? ' on' : '')} onClick={() => pick({ type: 'card' })}>{t('Bank card in photo')}</button>
      <button className={'chip' + (on('fork') ? ' on' : '')} onClick={() => pick({ type: 'fork' })}>{t('Fork in photo')}</button>
      <button className="chip" onClick={() => containerSheet(c => pick(fromSaved(c)))}><Icon name="plus" /> {t('Measure a plate')}</button>
    </div>
  </div>
}

function KnownCard({ p }) {
  const [name, setName] = useState('')
  const [grams, setGrams] = useState(null)
  const known = p.known || []
  const add = () => {
    const next = cleanKnown([...known, { name, grams }])
    if (next.length === known.length) return
    patchPending(p.id, { known: next }); setName(''); setGrams(null)
  }
  return <div className="card">
    <h2>{t('Weighed anything? (optional)')}</h2>
    <div className="muted small" style={{ marginBottom: 10, lineHeight: 1.45 }}>{t('A weight from a kitchen scale or a package is used exactly; only the rest is estimated.')}</div>
    {known.map((k, i) => <div key={k.name} className="row between" style={{ padding: '6px 0' }}>
      <span>{k.name}</span>
      <span className="row" style={{ gap: 8 }}><b style={{ fontWeight: 500 }}>{k.grams} g</b>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 14 }} aria-label={t('Remove')} onClick={() => patchPending(p.id, { known: known.filter((_, j) => j !== i) })}><Icon name="xmark" /></button></span>
    </div>)}
    <div className="row" style={{ gap: 8, marginTop: known.length ? 6 : 0 }}>
      <TextField value={name} maxLength={80} placeholder={t('Food (e.g. rice)')} style={{ flex: 2, minWidth: 0 }} onChange={e => setName(e.target.value)} />
      <span className="row" style={{ flex: 1, gap: 4, minWidth: 0 }}>
        <NumberField className="field" decimal={false} nullable value={grams} placeholder="g" onChange={setGrams} style={{ width: '100%', textAlign: 'left' }} />
      </span>
      <button className="iconbtn" disabled={!name.trim() || !(grams > 0)} aria-label={t('Add')} onClick={add}><Icon name="plus" /></button>
    </div>
  </div>
}

export default function FoodScanner() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const cam = useRef(null), gal = useRef(null)
  const [busy, setBusy] = useState(false)
  const N = nutritionOf(S)
  const p = id ? N.pending.find(x => x.id === id) : null

  // A result that arrived (here or while away) belongs on the review screen.
  useEffect(() => { if (p?.status === 'review') nav('/nutrition/review/' + p.id, { replace: true }) }, [p?.status])
  // An id that no longer exists (discarded, already saved): start over.
  useEffect(() => { if (id && !p) nav('/nutrition/scan', { replace: true }) }, [id, !!p])

  const pick = async e => {
    const files = [...(e.target.files || [])]
    e.target.value = ''                       // picking the same photo again must fire again
    if (!files.length) return                 // cancelled, or the camera permission was refused
    setBusy(true)
    const draft = p || newDraft()
    if (!p) nav('/nutrition/scan/' + draft.id, { replace: true })
    const errors = await addPhotos(draft.id, files)
    setBusy(false)
    if (errors.length) toast(t(PICK_ERRORS[errors[0]] || PICK_ERRORS.decode, MAX_PHOTOS))
  }
  const analyse = () => {
    if (isOffline()) {
      confirmSheet({
        title: t('You’re offline'),
        message: t('Keep these photos on this phone and analyse them later? Nothing is sent until you tap “Analyse now” yourself.'),
        confirmText: t('Keep for later'),
        onConfirm: () => { queuePending(p.id); toast(t('Queued — find it under Nutrition')); nav('/nutrition') }
      })
      return
    }
    runAnalysis(p.id)
  }
  const start = () => {
    if (!N.prefs.disclosedAt) { disclosureSheet(() => { update(s => setPrefs(s, { disclosedAt: Date.now() })); analyse() }); return }
    analyse()
  }
  // Leaving keeps a draft that has photos — it waits on the Nutrition screen, where it can be
  // finished or discarded. An empty one is just dropped.
  const leave = () => {
    if (p && !p.photoIds.length) discardPending(p.id)
    nav('/nutrition')
  }

  const analysing = p?.status === 'analyzing'
  const n = p ? p.photoIds.length : 0
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={leave} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Scan a meal')}</h1></div>
    </div>

    <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pick} />
    <input ref={gal} type="file" accept="image/*" multiple hidden onChange={pick} />

    <div className="card">
      {n > 0
        ? <Photos ids={p.photoIds} labels={[t('From above'), t('From the side')]} onRemove={analysing ? null : pid => removePhoto(p.id, pid)} />
        : <div className="empty" style={{ padding: '26px 10px' }}><div className="ico"><Icon name="camera" /></div>{t('Photograph the whole plate from above, in good light. Add a second angle if food is stacked or hidden.')}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <Button icon="camera" disabled={busy || analysing || n >= MAX_PHOTOS} onClick={() => cam.current.click()}>{t('Take photo')}</Button>
        <Button icon="image" disabled={busy || analysing || n >= MAX_PHOTOS} onClick={() => gal.current.click()}>{t('Gallery')}</Button>
      </div>
      <div className="dim small" style={{ marginTop: 8, lineHeight: 1.4 }}>{busy ? t('Preparing the photo…')
        : n === 0 ? t('Photo 1: from above.') : n === 1 ? t('Photo 2 (recommended): from the side, at plate height — it shows how high the food is piled.')
        : t('{0} of {1} photos · all of the same meal', n, MAX_PHOTOS)}</div>
    </div>

    {p && <>
      <div className="card">
        <h2>{t('Which meal?')}</h2>
        <Segmented value={p.mealType} onChange={v => patchPending(p.id, { mealType: v })}
          options={MEAL_TYPES.map(k => ({ value: k, label: t(MEAL_LABEL[k]) }))} />
        <div style={{ height: 12 }} />
        <label className="small muted" style={{ display: 'block', marginBottom: 5 }}>{t('When')}</label>
        <input className="field" type="datetime-local" value={toLocalInput(p.timestamp)} max={toLocalInput(Date.now() + 86400000)}
          onChange={e => patchPending(p.id, { timestamp: fromLocalInput(e.target.value, p.timestamp) })} />
        <div style={{ height: 12 }} />
        <label className="small muted" style={{ display: 'block', marginBottom: 5 }}>{t('Anything the photo doesn’t show? (optional)')}</label>
        <TextArea value={p.note || ''} maxLength={500} style={{ minHeight: 64 }} placeholder={t('e.g. cooked in butter, half the rice is underneath')}
          onChange={e => patchPending(p.id, { note: e.target.value })} />
      </div>

      {!analysing && <ScaleCard p={p} containers={N.prefs.containers || []} />}
      {!analysing && <KnownCard p={p} />}

      {p.status === 'failed' && p.error && <div className="card" style={{ borderColor: 'var(--red)' }}>
        <div style={{ color: 'var(--red)', fontWeight: 500, marginBottom: 4 }}>{t('Analysis failed')}</div>
        <div className="muted small">{t(FOOD_ERRORS[p.error] || FOOD_ERRORS.provider)}</div>
        {p.error === 'nokey' && <><div style={{ height: 10 }} /><Button size="sm" onClick={() => nav('/coach')}>{t('Open the Coach screen')}</Button></>}
      </div>}

      <Button variant="primary" icon="sparkles" disabled={!n || analysing || busy} onClick={start}>
        {analysing ? t('Reading your plate…') : p.status === 'failed' ? t('Try again') : t('Analyse with Gemini')}
      </Button>
      <div className="dim small" style={{ margin: '8px 4px 0', lineHeight: 1.4 }}>{t('Sends these photos to Google Gemini with your own key. You review the result before anything is saved.')}</div>
      <div style={{ height: 12 }} />
    </>}
    <Button variant="ghost" onClick={() => nav('/nutrition/edit/new/' + (p ? isoOf(new Date(p.timestamp)) : 'today'))}>{t('Enter the meal by hand instead')}</Button>
    <div style={{ height: 30 }} />
  </div>
}
