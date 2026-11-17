import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { goalsOf, setGoals, kcalOf, DEFAULT_GOALS } from '../lib/nutrition.js'
import Icon from '../components/Icon.jsx'
import { Button, Stepper } from '../components/ui.jsx'
import { MACRO_META, kcal } from '../components/Food.jsx'

// Daily targets. Calories and the three macros are set independently, with the energy the
// macros add up to (4 / 4 / 9 kcal per gram) shown beside the calorie target, so a mismatch
// is visible rather than silently "corrected".
export default function NutritionGoals() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const [g, setG] = useState(goalsOf(S))
  const fromMacros = kcalOf(g)
  const off = Math.abs(fromMacros - g.kcal) > Math.max(50, g.kcal * 0.05)
  const set = (k, v) => setG(x => ({ ...x, [k]: v }))
  const save = () => { update(s => setGoals(s, g)); toast(t('Goals saved')); nav('/nutrition') }
  const share = k => (fromMacros ? Math.round((k === 'fat' ? 9 : 4) * g[k] / fromMacros * 100) : 0)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/nutrition')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Daily goals')}</h1></div>
    </div>

    <div className="card">
      <h2>{t('Calories')}</h2>
      <Stepper value={g.kcal} step={50} decimal={false} unit="kcal" onChange={v => set('kcal', v)} />
    </div>
    <div className="card">
      <h2>{t('Macros')}</h2>
      {['protein', 'carbs', 'fat'].map(k => <div key={k} style={{ marginBottom: 12 }}>
        <div className="row between small" style={{ marginBottom: 5 }}><span>{t(MACRO_META[k][0])}</span><span className="dim">{share(k)}%</span></div>
        <Stepper value={g[k]} step={5} decimal={false} unit="g" onChange={v => set(k, v)} />
      </div>)}
      <div className="divider" />
      <div className="row between small">
        <span className="muted">{t('Energy from these macros')}</span>
        <span style={{ fontWeight: 500, color: off ? 'var(--orange)' : 'var(--label)' }}>{kcal(fromMacros)} kcal</span>
      </div>
      {off && <>
        <div className="small" style={{ color: 'var(--orange)', margin: '8px 0 10px', lineHeight: 1.4 }}>{t('That is not the calorie goal above. Either is fine to keep — or make them agree.')}</div>
        <Button size="sm" onClick={() => set('kcal', fromMacros)}>{t('Set calories to {0}', kcal(fromMacros))}</Button>
      </>}
    </div>

    <Button variant="primary" icon="check" onClick={save}>{t('Save')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={() => setG({ ...DEFAULT_GOALS })}>{t('Back to the starting goals')}</Button>
    <div className="dim small" style={{ margin: '14px 4px 0', lineHeight: 1.45 }}>{t('These targets are yours to choose. openGym does not calculate what you should eat, and this is not medical or dietary advice.')}</div>
    <div style={{ height: 30 }} />
  </div>
}
