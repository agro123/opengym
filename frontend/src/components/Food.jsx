// Shared pieces of the nutrition screens.
import { t, dateLocale } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { usePhoto } from '../lib/food-photos.js'
import Icon from './Icon.jsx'

export const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' }
export const MEAL_ICON = { breakfast: 'sun', lunch: 'fork', dinner: 'moon', snack: 'bolt' }
export const UNIT_LABEL = { g: 'g', ml: 'ml', piece: 'piece', slice: 'slice', cup: 'cup', tbsp: 'tbsp', tsp: 'tsp', oz: 'oz', serving: 'serving' }
export const KIND_LABEL = { plate: 'Plate', bowl: 'Bowl', cup: 'Cup or glass', box: 'Container' }
export const SOURCE_LABEL = { ai_scan: 'Photo analysis', manual: 'Entered by hand', duplicate: 'Logged again' }
// label, unit, colour — in the order they are shown
export const MACRO_META = {
  kcal: ['Calories', 'kcal', 'var(--acc)'],
  protein: ['Protein', 'g', 'var(--blue)'],
  carbs: ['Carbs', 'g', 'var(--orange)'],
  fat: ['Fat', 'g', 'var(--purple)'],
  satFat: ['Saturated fat', 'g'],
  fiber: ['Fiber', 'g'],
  sugar: ['Sugar', 'g'],
  sodium: ['Sodium', 'mg']
}
export const kcal = n => Math.round(n || 0).toLocaleString(dateLocale())
export const grams = n => fmtNum(n || 0)

/** "P 32 g · C 48 g · F 14 g" */
export function MacroLine({ m, withKcal }) {
  return <div className="mline">
    {withKcal && <span><b>{kcal(m.kcal)}</b> kcal</span>}
    <span>{t('Protein')} <b>{grams(m.protein)}</b> g</span>
    <span>{t('Carbs')} <b>{grams(m.carbs)}</b> g</span>
    <span>{t('Fat')} <b>{grams(m.fat)}</b> g</span>
  </div>
}
/** One macro against its goal. */
export function MacroBar({ k, value, goal }) {
  const [label, unit, color] = MACRO_META[k]
  const pct = goal > 0 ? Math.min(100, value / goal * 100) : 0
  return <div className={'mbar' + (goal > 0 && value > goal * 1.1 ? ' over' : '')}>
    <div className="l"><span>{t(label)}</span><span><b>{grams(value)}</b>{goal > 0 ? ' / ' + grams(goal) : ''} {unit}</span></div>
    <div className="t"><i style={{ width: pct + '%', '--c': color }} /></div>
  </div>
}
/** The four secondary nutrients, as a quiet two-column list. */
export function MicroList({ m }) {
  return <div className="grid2" style={{ marginTop: 12, rowGap: 6 }}>
    {['satFat', 'fiber', 'sugar', 'sodium'].map(k => <div key={k} className="row between small">
      <span className="muted">{t(MACRO_META[k][0])}</span><span>{grams(m[k])} {MACRO_META[k][1]}</span>
    </div>)}
  </div>
}
export function Photo({ id, onRemove, label }) {
  const src = usePhoto(id)
  return <div className="ph">
    {src && <img src={src} alt="" />}
    {label && <span className="ph-l">{label}</span>}
    {src === null && <div className="center dim small" style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="image" /></div>}
    {onRemove && <button onClick={onRemove} aria-label={t('Remove photo')}><Icon name="xmark" /></button>}
  </div>
}
export function Photos({ ids, onRemove, wide, labels }) {
  if (!ids || !ids.length) return null
  return <div className={'photos' + (wide && ids.length <= 2 ? ' wide' : '')}>
    {ids.map((id, i) => <Photo key={id} id={id} label={labels && labels[i]} onRemove={onRemove ? () => onRemove(id) : null} />)}
  </div>
}
/** How sure the model said it was — worded, never as a bare percentage that looks exact. */
export function Confidence({ value, measured }) {
  if (measured) return <span className="tag plainc acc">{t('Weighed')}</span>
  if (value == null) return null
  const [cls, label] = value >= 0.75 ? ['acc', 'Likely'] : value >= 0.5 ? ['warn', 'Unsure'] : ['bad', 'Low confidence']
  return <span className={'tag plainc ' + cls}>{t(label)}</span>
}
/** A logged meal as a list row. */
export function MealRow({ meal, onClick }) {
  const time = new Date(meal.timestamp).toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  return <div className="item" onClick={onClick}>
    <span className="lrow-i"><Icon name={MEAL_ICON[meal.mealType] || 'fork'} /></span>
    <div className="grow">
      <div className="tt">{meal.name || t(MEAL_LABEL[meal.mealType])}</div>
      <div className="ss">{time} · {t('P')} {grams(meal.totalMacros.protein)} · {t('C')} {grams(meal.totalMacros.carbs)} · {t('F')} {grams(meal.totalMacros.fat)}</div>
    </div>
    {meal.favorite && <Icon name="starFill" style={{ color: 'var(--yellow)', fontSize: 14 }} />}
    <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 600 }}>{kcal(meal.totalMacros.kcal)}</div><div className="dim" style={{ fontSize: 11 }}>kcal</div></div>
  </div>
}
// <input type="datetime-local"> speaks local wall-clock time, without a zone.
export const toLocalInput = ts => {
  const d = new Date(ts), p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
export const fromLocalInput = (v, fallback) => { const n = new Date(v).getTime(); return Number.isFinite(n) ? n : fallback }
