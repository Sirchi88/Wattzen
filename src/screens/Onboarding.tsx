import { useState } from 'react'
import type { Series } from '../calc/engine'
import { db, loadDemo, saveSettings, uid } from '../db'
import { todayIso } from '../lib/dates'
import type { Model } from '../types'
import { NumInput, Wordmark } from '../ui/bits'
import { EntryForm } from './Entry'

export function Onboarding({ model, series }: { model: Model; series: Series }) {
  const [step, setStep] = useState(model.tariffs.length ? 1 : 0)
  const [ap, setAp] = useState<number>()
  const [grund, setGrund] = useState<number>()
  const [anbieter, setAnbieter] = useState('')
  const [from, setFrom] = useState(`${todayIso().slice(0, 4)}-01-01`)
  const [verg, setVerg] = useState<number>()
  const [abschlag, setAbschlag] = useState<number>()
  const [abDate, setAbDate] = useState(`${todayIso().slice(0, 8)}01`)
  const [err, setErr] = useState('')

  async function saveTarif() {
    if (ap === undefined) return setErr('Der Arbeitspreis fehlt.')
    await db.transaction('rw', db.tariffs, db.feedins, db.abschlaege, async () => {
      await db.tariffs.put({ id: uid(), kind: 'haushalt', from, arbeitspreis: ap, grundgebuehr: grund ?? 0, anbieter: anbieter || undefined })
      if (verg !== undefined) await db.feedins.put({ id: uid(), from, ct: verg })
      if (abschlag !== undefined) await db.abschlaege.put({ id: uid(), from: abDate, betrag: abschlag })
    })
    setStep(1)
  }

  return (
    <main className="onb">
      <header className="onb-head">
        <Wordmark big />
        <ol className="steps" aria-label="Fortschritt">
          {['Tarif', 'Ablesung', 'Fertig'].map((s, i) => (
            <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="num">{i + 1}</span> {s}
            </li>
          ))}
        </ol>
      </header>

      <div className="onb-body" key={step}>
        {step === 0 && (
          <>
            <h1>Was kostet dein Strom?</h1>
            <p className="muted">Daraus werden Kosten, Vergütung und die Prognose gerechnet. Alles lässt sich später ändern.</p>
            <div className="edit-grid">
              <label>
                <span>Arbeitspreis</span>
                <NumInput value={ap} onChange={setAp} unit="ct/kWh" placeholder="32,5" autoFocus />
              </label>
              <label>
                <span>Grundgebühr</span>
                <NumInput value={grund} onChange={setGrund} unit="€/Monat" placeholder="12,90" />
              </label>
              <label>
                <span>Gültig seit</span>
                <input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
              </label>
              <label>
                <span>
                  Anbieter <small>optional</small>
                </span>
                <input type="text" value={anbieter} onChange={(e) => setAnbieter(e.target.value)} />
              </label>
              <label>
                <span>
                  Einspeisevergütung <small>optional</small>
                </span>
                <NumInput value={verg} onChange={setVerg} unit="ct/kWh" placeholder="8,11" />
              </label>
              <label>
                <span>
                  Monatlicher Abschlag <small>optional</small>
                </span>
                <NumInput value={abschlag} onChange={setAbschlag} unit="€" placeholder="120" />
              </label>
              {abschlag !== undefined && (
                <label>
                  <span>Erste Abschlagszahlung am</span>
                  <input type="date" value={abDate} onChange={(e) => e.target.value && setAbDate(e.target.value)} />
                </label>
              )}
            </div>
            {err && <p className="note warn">{err}</p>}
            <div className="entry-actions">
              <button type="button" className="btn primary big" onClick={() => void saveTarif()}>
                Weiter
              </button>
              <button type="button" className="btn ghost" onClick={() => setStep(1)}>
                Später eintragen
              </button>
            </div>
            <p className="fineprint center">
              Nur mal schauen?{' '}
              <button type="button" className="link" onClick={() => void loadDemo()}>
                Demo-Daten laden
              </button>
            </p>
          </>
        )}

        {step === 1 && (
          <>
            <h1>Deine erste Ablesung</h1>
            <p className="muted">Netzbezug und Einspeisung vom Hauptzähler genügen. Der Rest macht die Auswertung genauer.</p>
            <EntryForm model={model} series={series} saveLabel="Speichern und weiter" inline onSaved={() => setStep(2)} />
            {model.readings.length > 0 && (
              <button type="button" className="btn ghost" onClick={() => setStep(2)}>
                Überspringen
              </button>
            )}
          </>
        )}

        {step === 2 && (
          <div className="onb-done">
            <div className="empty-mark" aria-hidden />
            <h1>Fertig.</h1>
            <p className="muted">Noch eine Ablesung, dann gibt’s die erste Auswertung. Tarife, Abschläge, Zähler und dein Haus richtest du unter „Meister“ unten rechts ein.</p>
            <button type="button" className="btn primary big" onClick={() => void saveSettings({ onboarded: true })}>
              Los geht’s
            </button>
          </div>
        )}
      </div>
    </main>
  )
}
