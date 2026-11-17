import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import {
  nutritionOf, saveMeal, putPending, newItem, setQuantity, setWeight, setUnit, setRawCooked, setPer100, calcItem,
  markIncluded, mealTotals, frequentFoods, reuseItem, mealTypeAt, MEAL_TYPES, UNITS, MACROS, MICROS, UNIT_GRAMS
} from '../lib/nutrition.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, TextField, NumberField, Stepper, Switch } from '../components/ui.jsx'
import { MacroLine, MicroList, Confidence, MEAL_LABEL, UNIT_LABEL, MACRO_META, kcal, toLocalInput, fromLocalInput } from '../components/Food.jsx'

// The fats and sauces a photo hides best, with textbook values per 100 g, so adding the
// spoonful of oil a dish was fried in is two taps and no typing.
const EXTRAS = [
  ['Olive oil', 'tbsp', 14, { kcal: 884, fat: 100, satFat: 14 }],
  ['Vegetable oil', 'tbsp', 14, { kcal: 884, fat: 100, satFat: 10 }],
  ['Butter', 'tsp', 5, { kcal: 717, protein: 0.9, carbs: 0.1, fat: 81, satFat: 51, sodium: 11 }],
  ['Mayonnaise', 'tbsp', 14, { kcal: 680, protein: 1, carbs: 0.6, fat: 75, satFat: 12, sodium: 635 }],
  ['Salad dressing', 'tbsp', 15, { kcal: 450, carbs: 6, fat: 47, satFat: 7, sugar: 5, sodium: 900 }],
  ['Ketchup', 'tbsp', 17, { kcal: 101, protein: 1.2, carbs: 26, fat: 0.1, sugar: 21, sodium: 907 }],
  ['Sour cream', 'tbsp', 15, { kcal: 193, protein: 2.4, carbs: 4.6, fat: 19, satFat: 11, sugar: 3.4, sodium: 80 }],
  ['Hogao (tomato and onion sauce)', 'tbsp', 20, { kcal: 95, protein: 1.3, carbs: 7, fat: 7, satFat: 1, fiber: 1.5, sugar: 4, sodium: 300 }],
  ['Sugar', 'tsp', 4, { kcal: 387, carbs: 100, sugar: 100 }]
]
const STEP = { g: 10, ml: 10, oz: 1, cup: 0.25, tbsp: 0.5, tsp: 0.5 }

function ItemCard({ item, owner, onChange, onRemove }) {
  const [open, setOpen] = useState(!item.name)
  const openSheet = useUI(s => s.openSheet)
  const pickUnit = () => openSheet(close => <>
    <h3>{t('Unit')}</h3>
    <div className="sect-b">{UNITS.map(u => <button key={u} className="lrow tap" onClick={() => { close(); onChange(setUnit(item, u)) }}>
      <span className="lrow-m"><span className="lrow-t">{t(UNIT_LABEL[u])}</span>
        {UNIT_GRAMS[u] && u !== 'g' && <span className="lrow-s">≈ {UNIT_GRAMS[u]} g</span>}</span>
      {u === item.unit && <Icon name="check" className="lrow-k" />}
    </button>)}</div>
    <div style={{ height: 8 }} />
  </>)
  const cooked = item.rawOrCooked
  return <div className={'fitem' + (item.includedIn ? ' out' : '')}>
    <div className="row" style={{ gap: 8 }}>
      <TextField value={item.name} placeholder={t('Food name')} maxLength={120} style={{ flex: 1 }}
        onChange={e => onChange({ ...item, name: e.target.value })} />
      <button className="iconbtn" onClick={onRemove} aria-label={t('Remove')}><Icon name="trash" /></button>
    </div>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      <Confidence value={item.aiConfidence} measured={item.measured} />
      <span className="tag plainc">{kcal(item.calculatedMacros.kcal)} kcal</span>
    </div>

    <div className="frow">
      <Stepper label={t('Quantity')} value={item.quantity} step={STEP[item.unit] || 0.5} onChange={v => onChange({ ...setQuantity(item, v), measured: false })} />
      <div className="stp-w"><span className="stp-l">{t('Unit')}</span>
        <button className="field" style={{ textAlign: 'left' }} onClick={pickUnit}>{t(UNIT_LABEL[item.unit])}</button></div>
    </div>
    <div className="frow">
      <Stepper label={t('Weight')} unit="g" value={item.estimatedWeightGrams} step={10} onChange={v => onChange({ ...setWeight(item, v), measured: false })} />
    </div>

    <div style={{ marginTop: 10 }}>
      <Segmented value={cooked} onChange={v => onChange(setRawCooked(item, v))} options={[
        { value: 'raw', label: t('Raw') }, { value: 'cooked', label: t('Cooked') }, { value: 'not_applicable', label: t('n/a') }]} />
      {cooked !== 'not_applicable' && <div className="dim small" style={{ marginTop: 6, lineHeight: 1.4 }}>
        {item.cookedYield && item.cookedYield !== 1
          ? t('The weight above is the food {0}. Switching converts the values per 100 g — the same portion weighs differently raw and cooked.', t(cooked === 'raw' ? 'raw' : 'cooked'))
          : t('Says which state the weight refers to. Check that the values per 100 g are for the same state.')}
      </div>}
    </div>
    <div style={{ marginTop: 10 }}>
      <TextField value={item.preparationMethod || ''} maxLength={120} placeholder={t('How it was prepared (fried, grilled, boiled…)')}
        onChange={e => onChange({ ...item, preparationMethod: e.target.value })} />
    </div>

    {item.includedIn && <div className="note-w"><Icon name="link" /><span>{t('Already part of “{0}” — not counted twice.', owner?.name || '')}</span></div>}
    {(item.includedIn || item.countSeparately) && <div className="row between" style={{ marginTop: 8 }}>
      <span className="small">{t('Count it separately')}</span>
      <Switch checked={!!item.countSeparately} onChange={v => onChange({ ...item, countSeparately: v })} />
    </div>}
    {item.note && <div className="note-w"><Icon name="info" /><span>{item.note}</span></div>}

    <button className="btn ghost sm" style={{ marginTop: 8, padding: '6px 0' }} onClick={() => setOpen(o => !o)}>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} /><span>{t('Nutrition per 100 g')}</span>
    </button>
    {open && <div className="p100">
      {[...MACROS, ...MICROS].map(k => <label key={k}>{t(MACRO_META[k][0])} ({MACRO_META[k][1]})
        <NumberField value={item.macrosPer100g[k]} onChange={v => onChange(setPer100(item, k, v))} />
      </label>)}
    </div>}
  </div>
}

// One editor, three jobs: correcting an analysis before it is approved (`p`), editing a saved
// meal (`m`), and entering one by hand (`new`). Every edit recomputes the item and the meal
// right here — nothing on this screen calls a model or needs a connection.
export default function PortionEditor() {
  const nav = useNavigate()
  const loc = useLocation()
  const { kind, id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { toast, openSheet } = useUI()
  const N = nutritionOf(S)
  const pending = kind === 'p' ? N.pending.find(x => x.id === id) : null
  const saved = kind === 'm' ? N.meals.find(x => x.id === id) : null

  const initial = useMemo(() => {
    if (pending?.analysis) return { name: pending.analysis.mealName, mealType: pending.analysis.mealType, timestamp: pending.timestamp, items: pending.analysis.items }
    if (saved) return { name: saved.name, mealType: saved.mealType, timestamp: saved.timestamp, items: saved.items }
    // by hand: on the day it was opened from, at the current time of day
    const day = /^\d{4}-\d\d-\d\d$/.test(id || '') ? id : todayISO()
    const now = new Date()
    const ts = new Date(`${day}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`).getTime()
    const items = loc.state?.items?.length ? loc.state.items.map(reuseItem) : [newItem()]
    return { name: loc.state?.name || '', mealType: mealTypeAt(ts), timestamp: ts, items }
  }, [])
  const [meal, setMeal] = useState(initial)
  const missing = (kind === 'p' && !pending?.analysis) || (kind === 'm' && !saved)
  useEffect(() => { if (missing) nav('/nutrition', { replace: true }) }, [missing])
  if (missing) return null

  const items = markIncluded(meal.items.map(calcItem))
  const total = mealTotals(items)
  const setItems = fn => setMeal(m => ({ ...m, items: fn(m.items) }))
  const change = it => setItems(list => list.map(x => (x.id === it.id ? it : x)))
  const add = it => setItems(list => [...list, it])
  const addExtra = () => openSheet(close => <>
    <h3>{t('Add oil, butter, sauce or dressing')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('Cooking fat rarely shows in a photo, and it is often the largest thing missing.')}</div>
    <div className="sect-b">{EXTRAS.map(([name, unit, g, per100]) => <button key={name} className="lrow tap" onClick={() => {
      close(); add(newItem({ name: t(name), unit, quantity: 1, estimatedWeightGrams: g, macrosPer100g: per100, preparationMethod: '' }))
    }}>
      <span className="lrow-m"><span className="lrow-t">{t(name)}</span><span className="lrow-s">1 {t(UNIT_LABEL[unit])} · {Math.round(per100.kcal * g / 100)} kcal</span></span>
      <Icon name="plus" className="lrow-c" />
    </button>)}</div>
    <div style={{ height: 8 }} />
  </>)
  const frequent = frequentFoods(S, 10)

  const valid = items.length > 0 && items.every(i => i.name.trim() && i.estimatedWeightGrams > 0)
  const save = () => {
    if (!valid) { toast(t('Every item needs a name and a weight.')); return }
    const name = meal.name.trim() || items.filter(i => !i.includedIn).slice(0, 3).map(i => i.name.trim()).join(', ')
    if (kind === 'p') {
      // Still not a meal: the corrected breakdown goes back to the review screen for approval.
      update(s => putPending(s, { id: pending.id, mealType: meal.mealType, timestamp: meal.timestamp,
        analysis: { ...pending.analysis, mealName: name, mealType: meal.mealType, items } }))
      nav('/nutrition/review/' + pending.id, { replace: true })
      return
    }
    let out = null
    update(s => { out = saveMeal(s, { ...(saved || { source: 'manual' }), name, mealType: meal.mealType, timestamp: meal.timestamp, items }) })
    toast(t('Meal saved'))
    nav('/nutrition/meal/' + out.id, { replace: true })
  }

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{kind === 'new' ? t('Add a meal') : t('Edit portions')}</h1></div>
    </div>

    <div className="card">
      <TextField value={meal.name} maxLength={120} placeholder={t('Meal name (optional)')} onChange={e => setMeal(m => ({ ...m, name: e.target.value }))} />
      <div style={{ height: 10 }} />
      <Segmented value={meal.mealType} onChange={v => setMeal(m => ({ ...m, mealType: v }))} options={MEAL_TYPES.map(k => ({ value: k, label: t(MEAL_LABEL[k]) }))} />
      <div style={{ height: 10 }} />
      <input className="field" type="datetime-local" value={toLocalInput(meal.timestamp)}
        onChange={e => setMeal(m => ({ ...m, timestamp: fromLocalInput(e.target.value, m.timestamp) }))} />
    </div>

    {items.map(i => <ItemCard key={i.id} item={i} owner={items.find(x => x.id === i.includedIn)} onChange={change}
      onRemove={() => setItems(list => list.filter(x => x.id !== i.id))} />)}

    <div className="row">
      <Button icon="plus" onClick={() => add(newItem())}>{t('Add food')}</Button>
      <Button icon="plus" onClick={addExtra}>{t('Oil or sauce')}</Button>
    </div>
    {frequent.length > 0 && <>
      <h4 className="sec">{t('Foods you log often')}</h4>
      <div className="chips">{frequent.map(f => <button key={f.item.id} className="chip" onClick={() => add(reuseItem(f.item))}>{f.item.name}</button>)}</div>
    </>}

    <div style={{ height: 14 }} />
    <div className="card sticky-sum">
      <div className="row between">
        <div className="big" style={{ fontSize: 24 }}>{kcal(total.kcal)} <span className="muted" style={{ fontSize: '.9rem' }}>kcal</span></div>
        <Button size="sm" variant="primary" icon="check" onClick={save}>{kind === 'p' ? t('Done') : t('Save')}</Button>
      </div>
      <div style={{ height: 6 }} />
      <MacroLine m={total} />
    </div>
    <div className="card"><h2>{t('Also in this meal')}</h2><MicroList m={total} /></div>
    <div style={{ height: 30 }} />
  </div>
}
