import { CalendarPlus, X } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { contractHints, type ContractHint } from '../calc/finance'
import { makeIcs } from '../calc/ics'
import type { SmartForecast } from '../calc/smart'
import { saveFile, saveSettings } from '../db'
import { fmtDay, fromDay, toDay } from '../lib/dates'
import { eur, num } from '../lib/format'
import type { ColorKey, IconKey, Model } from '../types'
import { Days, IconChip, Info, Num } from '../ui/bits'
import { useSwipe } from '../ui/hooks'

/* ───────────── Vertragsende-Hinweis (wegwischbar) ───────────── */

export function contractIcs(h: ContractHint) {
  const day = h.frist ?? h.ende
  return makeIcs([
    {
      uid: `wattzen-${h.key}@wattzen`,
      title: h.frist !== undefined ? `${h.title}: Kündigungsfrist endet` : `${h.title} läuft aus`,
      description: `${h.text}. Vertragsende ${fmtDay(h.ende)}.`,
      day,
      time: '09:00',
      alarmMin: 7 * 24 * 60,
    },
  ])
}

function HintCard({ h, today, dismiss }: { h: ContractHint; today: string; dismiss: () => void }) {
  const [gone, setGone] = useState(false)
  const { dx, drag, handlers } = useSwipe(gone, (v) => {
    if (v) {
      setGone(true)
      dismiss()
    }
  }, 160)
  return (
    <div className="hint-wrap">
      <div className={`card hint${drag ? ' drag' : ''}`} style={{ transform: `translateX(${dx}px)`, opacity: gone ? 0 : 1 }} {...handlers}>
        <div className="hint-main">
          <b>{h.text}</b>
          {h.sub && <span>{h.sub}</span>}
        </div>
        <div className="hint-act">
          <button type="button" className="icon-btn" aria-label="Termin in den Kalender" title="In den Kalender" onClick={() => saveFile(`wattzen-${h.title.toLowerCase().replace(/\W+/g, '-')}-${today}.ics`, contractIcs(h), 'text/calendar')}>
            <CalendarPlus size={18} aria-hidden />
          </button>
          <button type="button" className="icon-btn" aria-label="Hinweis für 7 Tage ausblenden" title="Für 7 Tage ausblenden" onClick={dismiss}>
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>
    </div>
  )
}

export function ContractHints({ model, today }: { model: Model; today: number }) {
  const hints = contractHints(model, today)
  if (!hints.length) return null
  const iso = fromDay(today)
  return (
    <div className="hints" aria-label="Hinweise">
      {hints.map((h) => (
        <HintCard key={h.key} h={h} today={iso} dismiss={() => void saveSettings({ dismissed: { ...model.settings.dismissed, [h.key]: iso } })} />
      ))}
    </div>
  )
}

/* ───────────── Kachel mit Icon ───────────── */

export function Tile({
  icon, color, label, value, digits, unit, sub, badge, extra,
}: {
  icon: IconKey
  color: ColorKey
  label: string
  value?: number
  digits: number
  unit: string
  sub?: ReactNode
  badge?: ReactNode
  extra?: ReactNode
}) {
  return (
    <div className="tile">
      <div className="tile-head">
        <IconChip name={icon} color={color} size={28} />
        <span className="tile-label">{label}</span>
        {badge}
      </div>
      <span className={`tile-value t-${color}`}>
        <Num v={value} digits={digits} />
        {value !== undefined && <em>{unit}</em>}
      </span>
      <span className="tile-sub num">{sub ?? ' '}</span>
      {extra}
    </div>
  )
}

/* ───────────── Prognose: Abschlagssalden ───────────── */

const range = (lo: number, hi: number) => `${num(Math.min(lo, hi), 0)} bis ${num(Math.max(lo, hi), 0)} €`

/** „voraussichtlich +84 € Nachzahlung“ – positiv heißt: du zahlst nach. */
export function SaldoText({ v, plusWord = 'Nachzahlung', minusWord = 'Gutschrift' }: { v: number; plusWord?: string; minusWord?: string }) {
  return (
    <>
      voraussichtlich{' '}
      <b className="saldo-num">
        <span className="num">
          {v >= 0 ? '+' : '−'}
          {num(Math.abs(v), 0)}
        </span>{' '}
        €
      </b>{' '}
      {v >= 0 ? plusWord : minusWord}
    </>
  )
}

export function ForecastSaldo({ fc, model, compact }: { fc: SmartForecast; model: Model; compact?: boolean }) {
  const rows: { name: string; v: number; lo: number; hi: number; plus: string; minus: string; sub: string }[] = []
  if (model.abschlaege.length)
    rows.push({
      name: 'Strom', v: fc.strom.differenz, lo: fc.strom.lo, hi: fc.strom.hi, plus: 'Nachzahlung', minus: 'Gutschrift',
      sub: `Kosten ${eur(fc.strom.kosten)} € · Abschläge ${eur(fc.strom.gezahlt + fc.strom.kommend)} €`,
    })
  if (fc.einsp)
    rows.push({
      name: 'Einspeisung', v: fc.einsp.saldo, lo: fc.einsp.lo, hi: fc.einsp.hi, plus: 'Nachzahlung an dich', minus: 'Rückforderung',
      sub: `Vergütung ${eur(fc.einsp.verg)} € · erhalten ${eur(fc.einsp.erhalten + fc.einsp.kommend)} €`,
    })
  for (const e of fc.eigene)
    if (e.gezahlt + e.kommend > 0)
      rows.push({
        name: e.name, v: e.differenz, lo: e.lo, hi: e.hi, plus: 'Nachzahlung', minus: 'Gutschrift',
        sub: `Kosten ${eur(e.kosten)} € · Abschläge ${eur(e.gezahlt + e.kommend)} €`,
      })
  if (!rows.length)
    return <p className="muted">Trag im Meisterbereich deine Abschläge ein, dann steht hier Nachzahlung oder Gutschrift.</p>
  return (
    <div className="saldo">
      <p className="saldo-main">
        <SaldoText v={fc.gesamt.differenz} />
      </p>
      <p className="fineprint num">
        Spanne {range(fc.gesamt.lo, fc.gesamt.hi)} · {rows.length > 1 ? 'Gesamtsaldo' : rows[0].name} bis 31.12.{fc.year}
      </p>
      {!compact && rows.length > 0 && (
        <ul className="saldo-rows">
          {rows.map((r) => (
            <li key={r.name}>
              <div>
                <span>{r.name}</span>
                <small className="num">{r.sub}</small>
              </div>
              <b className="num">
                {r.v >= 0 ? '+' : '−'}
                {num(Math.abs(r.v), 0)} €<small>{r.v >= 0 ? r.plus : r.minus}</small>
              </b>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function ForecastBasis({ fc }: { fc: SmartForecast }) {
  return (
    <Info label="Worauf die Prognose beruht">
      {fc.basis} Spanne ±{Math.round(fc.spanne * 100)} % auf den prognostizierten Teil.
    </Info>
  )
}

/** Tage seit der letzten Ablesung. */
export function LastReading({ model, today }: { model: Model; today: number }) {
  const last = model.readings[model.readings.length - 1]
  if (!last) return null
  const d = toDay(last.date)
  return (
    <span>
      Letzte Ablesung {fmtDay(d)} ·{' '}
      {today - d <= 0 ? <b className="days">heute</b> : <>vor <Days n={today - d} dativ /></>}
    </span>
  )
}
