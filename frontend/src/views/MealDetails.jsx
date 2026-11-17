import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { nutritionOf, duplicateMeal, setFavorite } from '../lib/nutrition.js'
import { removeMeal, removeMealPhotos } from '../lib/food-flow.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { Photos, MacroLine, MicroList, Confidence, MEAL_LABEL, UNIT_LABEL, SOURCE_LABEL, kcal, grams } from '../components/Food.jsx'

export default function MealDetails() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const m = nutritionOf(S).meals.find(x => x.id === id)
  useEffect(() => { if (!m) nav('/nutrition', { replace: true }) }, [!!m])
  if (!m) return null

  const again = () => {
    let copy = null
    update(s => { copy = duplicateMeal(s, m.id) })
    if (copy) { toast(t('Logged again for now')); nav('/nutrition/meal/' + copy.id, { replace: true }) }
  }
  const del = () => confirmSheet({
    title: t('Delete this meal?'), message: t('The meal and its photos are removed from this phone.'),
    confirmText: t('Delete'), danger: true, onConfirm: () => { removeMeal(m.id); nav('/nutrition', { replace: true }) }
  })
  const delPhotos = () => confirmSheet({
    title: t('Delete the photos?'), message: t('The meal stays in your log; only its photos are removed from this phone.'),
    confirmText: t('Delete photos'), danger: true, onConfirm: () => { removeMealPhotos(m.id); toast(t('Photos deleted')) }
  })
  const when = new Date(m.timestamp).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10, minWidth: 0 }}><h1 style={{ fontSize: 26 }}>{m.name || t(MEAL_LABEL[m.mealType])}</h1><div className="sub">{t(MEAL_LABEL[m.mealType])} · {when}</div></div>
      <button className="iconbtn" style={m.favorite ? { color: 'var(--yellow)' } : null} aria-label={t('Favorite')}
        onClick={() => update(s => setFavorite(s, m.id, !m.favorite))}><Icon name={m.favorite ? 'starFill' : 'star'} /></button>
    </div>

    {m.photoIds.length > 0 && <div className="card">
      <Photos ids={m.photoIds} wide />
      <div style={{ height: 10 }} />
      <Button size="sm" variant="ghost" icon="trash" className="dim" onClick={delPhotos}>{t('Delete photos')}</Button>
    </div>}

    <div className="card">
      <div className="row between">
        <div className="big">{kcal(m.totalMacros.kcal)} <span className="muted" style={{ fontSize: '1rem' }}>kcal</span></div>
        <span className="tag plainc">{t(SOURCE_LABEL[m.source] || SOURCE_LABEL.manual)}</span>
      </div>
      <div style={{ height: 8 }} />
      <MacroLine m={m.totalMacros} />
      <MicroList m={m.totalMacros} />
      {m.source === 'ai_scan' && <div className="note-w"><Icon name="info" /><span>{t('Based on a visual estimate you approved — not a measurement.')}</span></div>}
    </div>

    <h4 className="sec">{t(m.items.length === 1 ? '{0} item' : '{0} items', m.items.length)}</h4>
    {m.items.map(i => <div key={i.id} className={'fitem' + (i.includedIn ? ' out' : '')}>
      <div className="row between" style={{ alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500, textTransform: 'capitalize' }}>{i.name}</div>
          <div className="muted small">{grams(i.quantity)} {t(UNIT_LABEL[i.unit])} · {grams(i.estimatedWeightGrams)} g{i.preparationMethod ? ' · ' + i.preparationMethod : ''}
            {i.rawOrCooked !== 'not_applicable' ? ' · ' + t(i.rawOrCooked === 'raw' ? 'raw' : 'cooked') : ''}</div>
        </div>
        <div style={{ textAlign: 'right', flex: 'none' }}><div style={{ fontWeight: 600 }}>{kcal(i.calculatedMacros.kcal)}</div><div className="dim" style={{ fontSize: 11 }}>kcal</div></div>
      </div>
      <div style={{ height: 6 }} />
      <MacroLine m={i.calculatedMacros} />
      {i.source === 'ai_scan' && i.aiConfidence != null && <div style={{ marginTop: 8 }}><Confidence value={i.aiConfidence} measured={i.measured} /></div>}
      {i.includedIn && <div className="note-w"><Icon name="link" /><span>{t('Already part of “{0}” — not counted twice.', m.items.find(x => x.id === i.includedIn)?.name || '')}</span></div>}
    </div>)}

    {m.uncertainties?.length > 0 && <div className="card"><h2>{t('What it couldn’t tell')}</h2><ul className="bullets">{m.uncertainties.map((x, k) => <li key={k}>{x}</li>)}</ul></div>}

    <div className="row">
      <Button icon="pencil" onClick={() => nav('/nutrition/edit/m/' + m.id)}>{t('Edit')}</Button>
      <Button icon="plus" onClick={again}>{t('Log again')}</Button>
    </div>
    <div style={{ height: 8 }} />
    <Button variant="danger" icon="trash" onClick={del}>{t('Delete meal')}</Button>
    <div style={{ height: 30 }} />
  </div>
}
