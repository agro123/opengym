import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { todayISO, isoOf, DAYS } from '../lib/format.js'
import { MOBILE } from '../lib/mobile.js'
import { nutritionOf, goalsOf, mealsOn, dayTotals, weekStats, MEAL_TYPES } from '../lib/nutrition.js'
import { FOOD_ERRORS, isOffline } from '../lib/food-ai.js'
import { runAnalysis, discardPending } from '../lib/food-flow.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { MacroBar, MacroLine, MealRow, MEAL_LABEL, kcal } from '../components/Food.jsx'

const PENDING_TEXT = {
  draft: 'Unfinished scan',
  queued: 'Waiting to be analysed',
  analyzing: 'Reading your plate…',
  review: 'Ready for you to check',
  failed: 'Analysis failed'
}

// Scans that are not meals yet: a draft left half-way, photos queued while offline, a result
// waiting for approval. Nothing here is ever sent on its own — "Analyse now" is a tap.
function PendingCard({ p, nav }) {
  const toast = useUI(s => s.toast)
  const n = p.photoIds.length
  const analyse = () => {
    if (isOffline()) { toast(t('Still offline — the photos stay in the queue.')); return }
    runAnalysis(p.id)
  }
  const discard = () => confirmSheet({
    title: t('Discard this scan?'), message: t('Its photos are deleted from this phone.'),
    confirmText: t('Discard'), danger: true, onConfirm: () => discardPending(p.id)
  })
  return <div className="card" style={p.status === 'review' ? { borderColor: 'var(--acc)' } : null}>
    <div className="row" style={{ gap: 10 }}>
      <span className="lrow-i" style={{ background: p.status === 'failed' ? 'var(--red)' : p.status === 'review' ? 'var(--acc)' : 'var(--orange)' }}>
        <Icon name={p.status === 'review' ? 'check' : p.status === 'analyzing' ? 'sparkles' : 'camera'} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 500 }}>{t(PENDING_TEXT[p.status] || PENDING_TEXT.draft)}</div>
        <div className="muted small">{t(n === 1 ? '{0} photo' : '{0} photos', n)} · {t(MEAL_LABEL[p.mealType])} · {new Date(p.timestamp).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })}</div>
        {p.error && p.status !== 'analyzing' && <div className="small" style={{ color: 'var(--orange)', marginTop: 3 }}>{t(FOOD_ERRORS[p.error] || FOOD_ERRORS.provider)}</div>}
      </div>
    </div>
    {p.status !== 'analyzing' && <div className="row" style={{ marginTop: 12, gap: 8 }}>
      {p.status === 'review' && <Button size="sm" variant="primary" onClick={() => nav('/nutrition/review/' + p.id)}>{t('Review')}</Button>}
      {p.status === 'draft' && <Button size="sm" variant="primary" onClick={() => nav('/nutrition/scan/' + p.id)}>{t('Continue')}</Button>}
      {(p.status === 'queued' || p.status === 'failed') && <Button size="sm" variant="primary" icon="sparkles" onClick={analyse}>{t('Analyse now')}</Button>}
      {p.status === 'failed' && <Button size="sm" onClick={() => nav('/nutrition/scan/' + p.id)}>{t('Edit')}</Button>}
      <Button size="sm" variant="ghost" className="dim" onClick={discard}>{t('Discard')}</Button>
    </div>}
  </div>
}

export default function Nutrition() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const [day, setDay] = useState(todayISO())
  const N = nutritionOf(S)
  const goals = goalsOf(S)
  const total = dayTotals(S, day)
  const meals = mealsOn(S, day)
  const week = weekStats(S, day)
  const isToday = day === todayISO()
  const left = goals.kcal - total.kcal
  const shift = n => { const d = new Date(day + 'T12:00:00'); d.setDate(d.getDate() + n); setDay(isoOf(d)) }
  const label = isToday ? t('Today') : new Date(day + 'T12:00:00').toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'long' })
  const top = Math.max(goals.kcal, ...week.days.map(d => d.kcal), 1)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Home')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Nutrition')}</h1></div>
      <button className="iconbtn" onClick={() => nav('/nutrition/settings')} aria-label={t('Settings')}><Icon name="gear" /></button>
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 10 }}>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15 }} onClick={() => shift(-1)} aria-label={t('Previous day')}><Icon name="chevronLeft" /></button>
        <div className="small muted" style={{ fontWeight: 500, textTransform: 'capitalize' }}>{label}</div>
        <button className="iconbtn" style={{ width: 30, height: 30, fontSize: 15, visibility: isToday ? 'hidden' : 'visible' }} onClick={() => shift(1)} aria-label={t('Next day')}><Icon name="chevronRight" /></button>
      </div>
      <div className="row between" style={{ alignItems: 'flex-end' }}>
        <div>
          <div className="big">{kcal(total.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>/ {kcal(goals.kcal)} kcal</span></div>
          <div className="small" style={{ marginTop: 3, color: left < 0 ? 'var(--red)' : 'var(--label-2)' }}>
            {left >= 0 ? t('{0} kcal left', kcal(left)) : t('{0} kcal over', kcal(-left))}
          </div>
        </div>
        <Button size="sm" icon="target" onClick={() => nav('/nutrition/goals')}>{t('Goals')}</Button>
      </div>
      <div className={'kcal-t' + (left < 0 ? ' over' : '')}><i style={{ width: Math.min(100, total.kcal / Math.max(1, goals.kcal) * 100) + '%' }} /></div>
      <MacroBar k="protein" value={total.protein} goal={goals.protein} />
      <MacroBar k="carbs" value={total.carbs} goal={goals.carbs} />
      <MacroBar k="fat" value={total.fat} goal={goals.fat} />
      {!N.goals && <div className="dim small" style={{ marginTop: 10 }}>{t('These are starting goals — set your own to make the bars mean something.')}</div>}
    </div>

    <div className="row" style={{ marginBottom: 12 }}>
      {MOBILE && <Button variant="primary" icon="camera" onClick={() => nav('/nutrition/scan')}>{t('Scan a meal')}</Button>}
      <Button variant={MOBILE ? 'plain' : 'primary'} icon="plus" onClick={() => nav('/nutrition/edit/new/' + day)}>{t('Add by hand')}</Button>
    </div>
    {!MOBILE && <div className="dim small" style={{ margin: '-4px 4px 12px' }}>{t('Photo analysis is part of the mobile app, where it runs on your own Gemini key.')}</div>}

    {N.pending.map(p => <PendingCard key={p.id} p={p} nav={nav} />)}

    {meals.length ? MEAL_TYPES.map(type => {
      const list = meals.filter(m => m.mealType === type)
      if (!list.length) return null
      return <div key={type}>
        <h4 className="sec">{t(MEAL_LABEL[type])} · {kcal(list.reduce((n, m) => n + m.totalMacros.kcal, 0))} kcal</h4>
        <div className="list">{list.map(m => <MealRow key={m.id} meal={m} onClick={() => nav('/nutrition/meal/' + m.id)} />)}</div>
      </div>
    }) : <div className="empty"><div className="ico"><Icon name="fork" /></div>{isToday ? t('Nothing logged today yet.') : t('Nothing logged on this day.')}</div>}

    <div style={{ height: 14 }} />
    <div className="card">
      <div className="row between">
        <h2 style={{ margin: 0 }}>{t('Last 7 days')}</h2>
        <span className="dim small">{t(week.logged === 1 ? '{0} day logged' : '{0} days logged', week.logged)}</span>
      </div>
      <div className="wk">
        <div className="g" style={{ bottom: 21 + (goals.kcal / top) * 62 }} />
        {week.days.map(d => <div key={d.d} className={'c' + (d.meals ? (d.kcal > goals.kcal * 1.1 ? ' over' : ' on') : '') + (d.d === todayISO() ? ' today' : '')} onClick={() => setDay(d.d)}>
          <i style={{ height: Math.max(2, d.kcal / top * 62) }} />
          <span>{t(DAYS[new Date(d.d + 'T12:00:00').getDay()])}</span>
        </div>)}
      </div>
      {week.logged > 0 && <>
        <div className="divider" />
        <div className="small muted" style={{ marginBottom: 5 }}>{t('Daily average')}</div>
        <MacroLine m={week.avg} withKcal />
      </>}
    </div>

    <Button icon="history" onClick={() => nav('/nutrition/history')}>{t('Food history')}</Button>
    <div style={{ height: 30 }} />
  </div>
}
