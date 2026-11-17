import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { nutritionOf, mealTotals } from '../lib/nutrition.js'
import { approveAnalysis, discardPending } from '../lib/food-flow.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { Photos, MacroLine, MicroList, Confidence, MEAL_LABEL, UNIT_LABEL, kcal, grams } from '../components/Food.jsx'

// What the model made of the photos — shown as what it is: an estimate to be checked. Nothing
// on this screen is a logged meal until "Save meal" is tapped.
export default function FoodAnalysisResults() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const p = nutritionOf(S).pending.find(x => x.id === id)
  const ready = p && p.status === 'review' && p.analysis
  useEffect(() => { if (!ready) nav(p ? '/nutrition/scan/' + p.id : '/nutrition', { replace: true }) }, [!!ready])
  if (!ready) return null

  const a = p.analysis
  const total = mealTotals(a.items)
  const unsure = a.items.filter(i => i.aiConfidence != null && i.aiConfidence < 0.5 && !i.includedIn).length
  const save = () => {
    const meal = approveAnalysis(p.id)
    if (meal) { toast(t('Meal saved')); nav('/nutrition/meal/' + meal.id, { replace: true }) }
  }
  const discard = () => confirmSheet({
    title: t('Discard this scan?'), message: t('Its photos are deleted from this phone.'),
    confirmText: t('Discard'), danger: true, onConfirm: () => { discardPending(p.id); nav('/nutrition', { replace: true }) }
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/nutrition')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Check the result')}</h1><div className="sub">{t(MEAL_LABEL[a.mealType])}</div></div>
    </div>

    <div className="card">
      <Photos ids={p.photoIds} wide />
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-.02em', margin: '12px 0 4px' }}>{a.mealName}</div>
      <div className="big">≈ {kcal(total.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
      <div style={{ height: 8 }} />
      <MacroLine m={total} />
      <MicroList m={total} />
      <div className="note-w"><Icon name="info" /><span>{t('Estimated from the photos — weights are a visual guess, not a measurement. Check the portions before you save.')}</span></div>
      {unsure > 0 && <div className="note-w" style={{ color: 'var(--red)' }}><Icon name="flag" /><span>{t(unsure === 1 ? '{0} item is a low-confidence guess — look at it first.' : '{0} items are low-confidence guesses — look at them first.', unsure)}</span></div>}
    </div>

    <h4 className="sec">{t(a.items.length === 1 ? '{0} item' : '{0} items', a.items.length)}</h4>
    {a.items.map(i => <div key={i.id} className={'fitem' + (i.includedIn ? ' out' : '')}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{i.name}</div>
          <div className="muted small">{grams(i.quantity)} {t(UNIT_LABEL[i.unit])} · ≈ {grams(i.estimatedWeightGrams)} g{i.preparationMethod ? ' · ' + i.preparationMethod : ''}</div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}><div style={{ fontWeight: 600 }}>{kcal(i.calculatedMacros.kcal)}</div><div className="dim" style={{ fontSize: 11 }}>kcal</div></div>
      </div>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <Confidence value={i.aiConfidence} measured={i.measured} />
        {i.rawOrCooked !== 'not_applicable' && <span className="tag plainc">{t(i.rawOrCooked === 'raw' ? 'Weighed raw' : 'Weighed cooked')}</span>}
        {(i.extras || []).map(x => <span key={x} className="tag plainc">{x}</span>)}
      </div>
      {i.includedIn && <div className="note-w"><Icon name="link" /><span>{t('Already part of “{0}” — not counted twice.', a.items.find(x => x.id === i.includedIn)?.name || '')}</span></div>}
      {i.ingredients?.length > 0 && <div className="dim small" style={{ marginTop: 8 }}>{t('Contains:')} {i.ingredients.join(', ')}</div>}
      {i.note && <div className="note-w"><Icon name="info" /><span>{i.note}</span></div>}
    </div>)}

    {a.uncertainties.length > 0 && <div className="card">
      <h2>{t('What it couldn’t tell')}</h2>
      <ul className="bullets">{a.uncertainties.map((x, k) => <li key={k}>{x}</li>)}</ul>
    </div>}
    {a.assumptions.length > 0 && <div className="card">
      <h2>{t('What it assumed')}</h2>
      <ul className="bullets">{a.assumptions.map((x, k) => <li key={k}>{x}</li>)}</ul>
    </div>}

    <Button icon="pencil" onClick={() => nav('/nutrition/edit/p/' + p.id)}>{t('Edit portions and ingredients')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="primary" icon="check" onClick={save}>{t('Looks right — save meal')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={discard}>{t('Discard')}</Button>
    <div style={{ height: 30 }} />
  </div>
}
