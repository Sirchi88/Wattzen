import { ArrowRight } from 'lucide-react'
import { useMemo } from 'react'
import { aggregate, aggregateCustom, kpis, type Daily } from '../calc/engine'
import { customMeters, meterName } from '../calc/meters'
import { dayOf, parts } from '../lib/dates'
import { energy, eurDigits, kwhU, num } from '../lib/format'
import type { Model, View } from '../types'
import { Num, Ring } from '../ui/bits'
import type { WeatherState } from '../weather'
import { useAnalysis } from './analysis'
import { ContractHints, ForecastBasis, ForecastSaldo, LastReading, Tile } from './cards'

export function Overview({ model, daily, weather, go }: { model: Model; daily: Daily; weather?: WeatherState; go: (v: View) => void }) {
  const an = useAnalysis(model, daily, weather)
  const today = an.today
  const y0 = daily.days.length ? dayOf(parts(daily.end - 1).y, 0, 1) : 0
  const t = useMemo(() => aggregate(daily, y0, daily.end), [daily, y0])
  const k = kpis(t)
  const year = daily.days.length ? parts(daily.end - 1).y : parts(today).y

  if (!daily.days.length) {
    return (
      <section className="screen narrow empty">
        <ContractHints model={model} today={today} />
        <div className="empty-mark" aria-hidden />
        <h2>{model.readings.length ? 'Noch eine Ablesung, dann gibt’s die erste Auswertung.' : 'Noch keine Ablesung.'}</h2>
        <p>
          WATTZEN rechnet mit den Unterschieden zwischen zwei Zählerständen. {model.readings.length ? <LastReading model={model} today={today} /> : null}
        </p>
        <button type="button" className="btn primary" onClick={() => go('entry')}>
          Ablesung erfassen
        </button>
      </section>
    )
  }

  const pd = (v: number, n = t.days) => (n ? `${num(v / n, 1)} kWh/Tag` : undefined)
  const e = (v: number) => energy(v)
  const customs = customMeters(model).filter((c) => c.active)
  const kwp = model.settings.house.kwp

  return (
    <section className="screen overview">
      <ContractHints model={model} today={today} />

      <p className="lead">
        <LastReading model={model} today={today} />
      </p>

      <div className="card hero-card">
        <div className="hero">
          <span className="eyebrow">Netto-Bilanz {year} · seit 1.1.</span>
          <span className="hero-num">
            <Num v={k.bilanz} digits={eurDigits(k.bilanz)} />
            <em>€</em>
          </span>
          <span className="muted num">
            Strom {num(k.kosten, 0)} € − Vergütung {num(t.verg, 0)} €
          </span>
          {k.kostenEigene > 0 && <span className="muted num">Eigene Zähler zusätzlich {num(k.kostenEigene, 0)} €</span>}
        </div>
        {k.ev !== undefined && (
          <div className="pvhome">
            <span className="eyebrow acc">PV ins Haus statt ins Netz</span>
            <span className="pv-num">
              <Num v={e(k.ev).v} digits={e(k.ev).digits} />
              <em>{e(k.ev).unit}</em>
            </span>
            <span className="muted num">Gegenwert {num(t.ersparnis, 0)} €</span>
          </div>
        )}
      </div>

      <div className="rings">
        <Ring value={k.autarkie} label="Autarkie" color="acc" />
        <Ring value={k.evQuote} label="Eigenverbrauch" color="pv" />
        {t.nWp > 0 && <Ring value={k.pvAnteilWP} label="PV-Anteil WP" color="wp" />}
        {t.nWb > 0 && <Ring value={k.pvAnteilWB} label="PV-Anteil Wallbox" color="wb" />}
      </div>

      {an.fc && (
        <div className="card">
          <div className="card-head">
            <h2>Prognose bis 31.12.{an.fc.year}</h2>
            <ForecastBasis fc={an.fc} />
          </div>
          <ForecastSaldo fc={an.fc} model={model} compact />
        </div>
      )}

      <div className="tiles">
        {t.nPv > 0 && (
          <Tile icon="sun" color="pv" label="PV-Ertrag" value={e(t.pv).v} digits={e(t.pv).digits} unit={e(t.pv).unit}
            sub={kwp ? `${num(t.pv / kwp, 0)} kWh/kWp` : pd(t.pv, t.nPv)} />
        )}
        <Tile icon="zap" color="netz" label="Netzbezug" value={e(t.bezug).v} digits={e(t.bezug).digits} unit={e(t.bezug).unit} sub={pd(t.bezug)} />
        <Tile icon="export" color="einsp" label="Einspeisung" value={e(t.ze).v} digits={e(t.ze).digits} unit={e(t.ze).unit} sub={pd(t.ze)} />
        {t.nSp > 0 && (
          <Tile icon="battery" color="speicher" label="Speicher" value={e(t.spE).v} digits={e(t.spE).digits} unit={e(t.spE).unit}
            sub={k.spEff !== undefined ? `entladen · ${num(k.spEff * 100, 0)} % Wirkungsgrad` : undefined} />
        )}
        {t.nWp > 0 && <Tile icon="thermo" color="wp" label="Wärmepumpe" value={e(t.wp).v} digits={e(t.wp).digits} unit={e(t.wp).unit} sub={pd(t.wp, t.nWp)} />}
        {t.nWb > 0 && <Tile icon="plug" color="wb" label="Wallbox" value={e(t.wb).v} digits={e(t.wb).digits} unit={e(t.wb).unit} sub={pd(t.wb, t.nWb)} />}
        <Tile icon="house" color="haus" label="Haus" value={e(t.haus).v} digits={e(t.haus).digits} unit={e(t.haus).unit} sub={pd(t.haus)} />
        {customs.map((c) => {
          const ct = aggregateCustom(daily, c.id, y0, daily.end)
          if (!ct.n) return null
          return (
            <Tile key={c.id} icon={c.icon} color={c.color} label={meterName(c)} value={ct.qty} digits={Math.min(c.decimals, 1)} unit={c.unit}
              sub={`${num(ct.qty / ct.n, Math.max(1, Math.min(c.decimals, 2)))} ${c.unit}/Tag${ct.kosten ? ` · ${num(ct.kosten, 0)} €` : ''}`} />
          )
        })}
      </div>

      <button type="button" className="btn wide" onClick={() => go('dash')}>
        Zur Auswertung <ArrowRight size={16} aria-hidden />
      </button>
      {an.check?.alarm && (
        <p className="note warn">PV-Ertrag lag zwei Monate in Folge unter 85 % des wetterbasierten Solls – Verschmutzung, Defekt oder Verschattung? Details in der Auswertung.</p>
      )}
      <p className="fineprint center">Werte seit 1.1.{year} · {kwhU(t.bezug)} Netzbezug in {t.days} Tagen</p>
    </section>
  )
}
