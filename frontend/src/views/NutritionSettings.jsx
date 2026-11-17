import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtNum } from '../lib/format.js'
import { MOBILE } from '../lib/mobile.js'
import { nutritionOf, setPrefs, removeContainer } from '../lib/nutrition.js'
import { containerSheet } from './FoodScanner.jsx'
import { KIND_LABEL } from '../components/Food.jsx'
import { photoUsage, deleteAllMealPhotos } from '../lib/food-flow.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row, Switch, TextField } from '../components/ui.jsx'

// The scanner has no AI settings of its own to keep in sync: it uses the Coach's Gemini key
// and provider (lib/coach-gemini.js). The one thing it adds is which model reads the photos.
function VisionCard() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [mod, setMod] = useState(null)
  const [g, setG] = useState(null)
  const [model, setModel] = useState('')
  useEffect(() => { import('../lib/coach-gemini.js').then(m => { const s = m.geminiSettings(); setMod(m); setG(s); setModel(s.visionModel || '') }) }, [])
  if (!g) return null
  const save = () => { mod.saveVisionModel(model); setG(mod.geminiSettings()); toast(model.trim() ? t('Vision model saved') : t('Using the Coach’s model')) }
  return <Section title={t('Photo analysis')} footer={t('Photos are read by Google Gemini with the same API key as the Coach. Leave the model empty to use the Coach’s model ({0}); name another only if it should differ — it must accept images.', g.model)}>
    <Row icon={g.key ? 'check' : 'key'} iconTint={g.key ? 'var(--acc)' : 'var(--orange)'}
      title={g.key ? t('Gemini key is set') : t('No Gemini key yet')} subtitle={t('Managed in the Coach screen')} accessory="chevron" onClick={() => nav('/coach')} />
    <div className="lrow" style={{ gap: 8 }}>
      <TextField value={model} placeholder={g.model} autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flex: 1 }} onChange={e => setModel(e.target.value)} />
      <Button size="sm" onClick={save}>{t('Save')}</Button>
    </div>
  </Section>
}

export default function NutritionSettings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { toast, openSheet } = useUI()
  const N = nutritionOf(S)
  const [usage, setUsage] = useState(null)
  const refresh = () => photoUsage().then(setUsage).catch(() => setUsage({ count: 0, bytes: 0 }))
  useEffect(() => { refresh() }, [N.meals.length, N.pending.length])
  const pref = p => update(s => setPrefs(s, p))
  const wipe = () => confirmSheet({
    title: t('Delete all meal photos?'), message: t('Your logged meals and their numbers stay; every photo attached to them is removed from this phone.'),
    confirmText: t('Delete photos'), danger: true, onConfirm: async () => { await deleteAllMealPhotos(); await refresh(); toast(t('Photos deleted')) }
  })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/nutrition')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 10 }}><h1>{t('Nutrition settings')}</h1></div>
    </div>

    {MOBILE && <VisionCard />}

    <Section title={t('My plates and bowls')} footer={t('Pick one when you scan and the analysis knows how big the plate is — the largest single source of error in a photo.')}>
      {(N.prefs.containers || []).map(c => <Row key={c.id} icon="fork" iconTint="var(--orange)" title={c.name}
        subtitle={t(KIND_LABEL[c.kind]) + ' · ' + fmtNum(c.cm) + ' cm' + (c.ml ? ' · ' + c.ml + ' ml' : '')} accessory="chevron"
        onClick={() => openSheet(close => <>
          <h3>{c.name}</h3>
          <div className="sect-b">
            <button className="lrow tap" onClick={() => { close(); containerSheet(null, c) }}><span className="lrow-i"><Icon name="pencil" /></span><span className="lrow-m"><span className="lrow-t">{t('Edit')}</span></span></button>
            <button className="lrow tap danger" onClick={() => { close(); update(s => removeContainer(s, c.id)) }}><span className="lrow-i"><Icon name="trash" /></span><span className="lrow-m"><span className="lrow-t">{t('Remove')}</span></span></button>
          </div>
          <div style={{ height: 8 }} />
        </>)} />)}
      <Row icon="plus" iconTint="var(--acc)" title={t('Add a plate or bowl')} onClick={() => containerSheet(null)} />
    </Section>

    <Section title={t('Privacy')} footer={t('Meals, goals and photos are stored on this phone only. A photo leaves it once, when you tap “Analyse” — sent to Google Gemini with your own key, never to openGym. Queued photos are not sent until you start the analysis yourself.')}>
      <Row icon="image" iconTint="var(--blue)" title={t('Keep photos with saved meals')} subtitle={t('Off: photos are deleted as soon as a meal is saved.')}>
        <Switch checked={N.prefs.keepPhotos} onChange={v => pref({ keepPhotos: v })} />
      </Row>
      <Row icon="folder" iconTint="var(--grey)" title={t('Photos on this phone')}
        value={usage ? t(usage.count === 1 ? '{0} photo' : '{0} photos', usage.count) + (usage.bytes ? ' · ' + fmtNum(usage.bytes / 1048576) + ' MB' : '') : '…'} />
      <Row icon="trash" iconTint="var(--red)" title={t('Delete all meal photos')} danger onClick={wipe} />
    </Section>

    <Section title={t('Coach')} footer={t('On: when you ask the Coach for a review, it also receives your calorie and macro goals, daily totals for the last 14 days and the names and macros of your last 10 meals — never photos. It can comment on them; it cannot change your food log.')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Let the Coach read your nutrition')}>
        <Switch checked={N.prefs.coach} onChange={v => pref({ coach: v })} />
      </Row>
    </Section>

    <Section title={t('Good to know')}>
      <Row icon="info" iconTint="var(--orange)" title={t('Estimates, not measurements')} subtitle={t('A photo cannot show weight, hidden oil or what is under the rice. Treat every analysed number as a starting point and correct it.')} />
      <Row icon="heart" iconTint="var(--red)" title={t('Not medical advice')} subtitle={t('For allergies, medical conditions or a prescribed diet, rely on a professional and on product labels.')} />
    </Section>
    <div style={{ height: 30 }} />
  </div>
}
