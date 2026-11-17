import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO } from '../lib/format.js'
import { nutritionOf, duplicateMeal, frequentFoods, favoriteMeals, normName } from '../lib/nutrition.js'
import { removeMeal } from '../lib/food-flow.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, SearchField } from '../components/ui.jsx'
import { MealRow, MEAL_LABEL, kcal } from '../components/Food.jsx'

const PAGE = 40

// Everything logged, newest first — and the two shortcuts a food log earns over time: the
// foods you eat most, and whole meals you starred to log again in one tap. All of it works
// offline; none of it involves the model.
export default function FoodHistory() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { toast, openSheet } = useUI()
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(PAGE)
  const all = nutritionOf(S).meals
  const needle = normName(q)
  const meals = (needle ? all.filter(m => normName(m.name).includes(needle) || m.items.some(i => normName(i.name).includes(needle))) : all).slice().reverse()
  const favorites = favoriteMeals(S)
  const frequent = frequentFoods(S, 12)

  const again = m => {
    let copy = null
    update(s => { copy = duplicateMeal(s, m.id) })
    if (copy) toast(t('Logged again for now'))
    return copy
  }
  const actions = m => openSheet(close => <>
    <h3>{m.name || t(MEAL_LABEL[m.mealType])}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{kcal(m.totalMacros.kcal)} kcal · {new Date(m.timestamp).toLocaleDateString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short' })}</div>
    <div className="sect-b">
      <button className="lrow tap" onClick={() => { close(); nav('/nutrition/meal/' + m.id) }}><span className="lrow-i"><Icon name="list" /></span><span className="lrow-m"><span className="lrow-t">{t('Open')}</span></span></button>
      <button className="lrow tap" onClick={() => { close(); nav('/nutrition/edit/m/' + m.id) }}><span className="lrow-i"><Icon name="pencil" /></span><span className="lrow-m"><span className="lrow-t">{t('Edit')}</span></span></button>
      <button className="lrow tap" onClick={() => { close(); again(m) }}><span className="lrow-i"><Icon name="plus" /></span><span className="lrow-m"><span className="lrow-t">{t('Log again')}</span></span></button>
      <button className="lrow tap danger" onClick={() => { close(); confirmSheet({ title: t('Delete this meal?'), message: t('The meal and its photos are removed from this phone.'), confirmText: t('Delete'), danger: true, onConfirm: () => removeMeal(m.id) }) }}>
        <span className="lrow-i"><Icon name="trash" /></span><span className="lrow-m"><span className="lrow-t">{t('Delete')}</span></span></button>
    </div>
    <div style={{ height: 8 }} />
  </>)

  let lastDay = null
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/nutrition')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Food history')}</h1><div className="sub">{t(all.length === 1 ? '{0} meal logged' : '{0} meals logged', all.length)}</div></div>
    </div>

    {favorites.length > 0 && <>
      <h4 className="sec">{t('Favorite meals')}</h4>
      <div className="list">{favorites.slice(0, 6).map(m => <div key={m.id} className="item">
        <span className="lrow-i" style={{ '--tint': 'var(--yellow)' }}><Icon name="starFill" /></span>
        <div className="grow" onClick={() => nav('/nutrition/meal/' + m.id)}><div className="tt">{m.name || t(MEAL_LABEL[m.mealType])}</div><div className="ss">{kcal(m.totalMacros.kcal)} kcal · {t(m.items.length === 1 ? '{0} item' : '{0} items', m.items.length)}</div></div>
        <Button size="sm" icon="plus" onClick={() => again(m)}>{t('Log')}</Button>
      </div>)}</div>
    </>}

    {frequent.length > 0 && <>
      <h4 className="sec">{t('Foods you log often')}</h4>
      <div className="chips">{frequent.map(f => <button key={f.item.id} className="chip"
        onClick={() => nav('/nutrition/edit/new/' + todayISO(), { state: { items: [f.item] } })}>{f.item.name} · {f.count}×</button>)}</div>
    </>}

    <h4 className="sec">{t('All meals')}</h4>
    {all.length > 0 && <><SearchField value={q} onChange={e => { setQ(e.target.value); setShown(PAGE) }} onClear={() => setQ('')} placeholder={t('Search meals and foods')} /><div style={{ height: 10 }} /></>}
    {meals.length ? <div className="list">{meals.slice(0, shown).map(m => {
      const head = m.d !== lastDay
      lastDay = m.d
      return <div key={m.id}>
        {head && <div className="small muted" style={{ margin: '8px 4px 6px', textTransform: 'capitalize' }}>{m.d === todayISO() ? t('Today') : new Date(m.d + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })}</div>}
        <MealRow meal={m} onClick={() => actions(m)} />
      </div>
    })}</div> : <div className="empty"><div className="ico"><Icon name="history" /></div>{needle ? t('No meal matches that.') : t('No meals yet — scan one or add it by hand.')}</div>}
    {meals.length > shown && <><div style={{ height: 10 }} /><Button onClick={() => setShown(n => n + PAGE)}>{t('Show more')}</Button></>}
    <div style={{ height: 30 }} />
  </div>
}
