import { useMemo, useRef, useState } from 'react'
import { aggregate, aggregateCustom, intervalExtremes, kpis, plausibilitaet, type Daily, type Totals } from '../calc/engine'
import { costTable } from '../calc/finance'
import { customMeters, meterName } from '../calc/meters'
import { wpEffizienz } from '../calc/smart'
import { addMonths, dayOf, daysInMonth, fmtDay, fmtDayShort, MONTHS, MONTHS_LONG, parts } from '../lib/dates'
import { energy, eur, eurDigits, kwhU, num, pct } from '../lib/format'
import type { Model, RangeTab } from '../types'
import { Badge, Days, Fold, IconChip, Info, Num, Ring } from '../ui/bits'
import type { WeatherState } from '../weather'
import { useAnalysis } from './analysis'
import { ContractHints, ForecastBasis, ForecastSaldo, Tile } from './cards'
import { Compare, Flow, ForecastBars, Trend } from './charts'

const TABS: { value: RangeTab; label: string }[] = [
  { value: 'last', label: 'Seit letzter Ablesung' },
  { value: 'monat', label: 'Monat' },
  { value: 'halb', label: 'Halbjahr' },
  { value: 'jahr', label: 'Jahr' },
  { value: 'zwei', label: '2 Jahre' },
  { value: 'custom', label: 'Benutzerdefiniert' },
]

function Calendar({ daily, from, to, onPick }: { daily: Daily; from?: number; to?: number; onPick: (day: number) => void }) {
  const init = parts(to ?? daily.end)
  const [ym, setYm] = useState(init.y * 12 + init.m)
  const y = Math.floor(ym / 12)
  const m = ym - y * 12
  const first = dayOf(y, m, 1)
  const lead = (new Date(first * 864e5).getUTCDay() + 6) % 7
  const n = daysInMonth(y, m)
  const minYm = parts(daily.start).y * 12 + parts(daily.start).m
  const maxYm = parts(daily.end).y * 12 + parts(daily.end).m
  return (
    <div className="card cal">
      <div className="cal-head">
        <button type="button" className="icon-btn" disabled={ym <= minYm} onClick={() => setYm(ym - 1)} aria-label="Vorheriger Monat">
          ←
        </button>
        <span>
          {MONTHS_LONG[m]} <span className="num">{y}</span>
        </span>
        <button type="button" className="icon-btn" disabled={ym >= maxYm} onClick={() => setYm(ym + 1)} aria-label="Nächster Monat">
          →
        </button>
      </div>
      <div className="cal-grid num">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
          <span key={d} className="cal-wd">
            {d}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} />
        ))}
        {Array.from({ length: n }, (_, i) => {
          const day = first + i
          const out = day < daily.start || day > daily.end
          const sel = day === from || day === to
          const between = from !== undefined && to !== undefined && day > from && day < to
          const reading = daily.readingDays.has(day)
          return (
            <button
              key={day}
              type="button"
              disabled={out}
              className={`cal-day${sel ? ' sel' : ''}${between ? ' in' : ''}${reading ? ' rd' : ''}`}
              aria-label={`${fmtDay(day)}${reading ? ', Ablesung' : ''}`}
              aria-pressed={sel}
              onClick={() => onPick(day)}
            >
              {i + 1}
            </button>
          )
        })}
      </div>
      <p className="fineprint">
        <i className="cal-dot" /> Tag mit Ablesung. Andere Tage werden linear interpoliert.
      </p>
    </div>
  )
}

function Delta({ cur, prev, invert }: { cur: number; prev?: number; invert?: boolean }) {
  if (prev === undefined || Math.abs(prev) < 1e-6) return null
  const d = cur / prev - 1
  if (!Number.isFinite(d)) return null
  const good = invert ? d > 0 : d < 0
  return (
    <span className={`delta num${good ? ' good' : ''}`} title="gegenüber dem gleichen Zeitraum im Vorjahr">
      {d > 0 ? '+' : '−'}
      {num(Math.abs(d) * 100, 0)} % ggü. Vorjahr
    </span>
  )
}

function Rows({ rows }: { rows: ([string, React.ReactNode] | false | undefined)[] }) {
  return (
    <dl className="rows num">
      {rows.filter(Boolean).map((r) => {
        const [k, v] = r as [string, React.ReactNode]
        return (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        )
      })}
    </dl>
  )
}

export function Dashboard({ model, daily, weather, goEntry }: { model: Model; daily: Daily; weather?: WeatherState; goEntry: () => void }) {
  const s = model.settings
  const [tab, setTab] = useState<RangeTab>(s.defaultRange)
  const [custom, setCustom] = useState<{ from?: number; to?: number }>({})
  const tabsRef = useRef<HTMLDivElement>(null)
  const an = useAnalysis(model, daily, weather)

  const range = useMemo(() => {
    const end = daily.end
    const zb = daily.series.bezug
    let from = daily.start
    let to = end
    if (tab === 'last') from = zb.length > 1 ? zb[zb.length - 2].day : daily.start
    else if (tab === 'monat') from = addMonths(end, -1)
    else if (tab === 'halb') from = addMonths(end, -6)
    else if (tab === 'jahr') from = dayOf(parts(end - 1).y, 0, 1)
    else if (tab === 'zwei') from = addMonths(end, -24)
    else {
      from = custom.from ?? addMonths(end, -3)
      to = custom.to ?? (custom.from !== undefined ? custom.from : end)
    }
    const wanted = from
    from = Math.max(from, daily.start)
    to = Math.min(Math.max(to, from), end)
    return { from, to, clipped: wanted < daily.start }
  }, [tab, custom, daily])

  const t = useMemo(() => aggregate(daily, range.from, range.to), [daily, range])
  const k = useMemo(() => kpis(t), [t])
  const prev: Totals | undefined = useMemo(() => {
    if (!s.yoy || tab === 'zwei') return undefined
    const pf = addMonths(range.from, -12)
    if (pf < daily.start || t.days < 1) return undefined
    return aggregate(daily, pf, addMonths(range.to, -12))
  }, [s.yoy, tab, range, daily, t.days])
  const pk = prev ? kpis(prev) : undefined
  const warnings = useMemo(() => plausibilitaet(t, s.toleranz), [t, s.toleranz])
  const costs = useMemo(() => costTable(daily, range.from, range.to), [daily, range])
  const wpE = useMemo(() => wpEffizienz(daily, range.from, range.to, an.wx, an.clim, s.heizgrenze), [daily, range, an.wx, an.clim, s.heizgrenze])

  if (!daily.days.length) {
    return (
      <section className="screen narrow empty">
        <div className="empty-mark" aria-hidden />
        <h2>{model.readings.length ? 'Noch eine Ablesung, dann gibt’s die erste Auswertung.' : 'Noch keine Ablesung.'}</h2>
        <p>
          {model.readings.length
            ? 'WATTZEN rechnet mit den Unterschieden zwischen zwei Zählerständen. Komm in ein paar Tagen wieder an den Zähler.'
            : 'Trag deine ersten Zählerstände ein – ab der zweiten Ablesung gibt es Verbräuche, Kosten und PV-Kennzahlen.'}
        </p>
        <button type="button" className="btn primary" onClick={goEntry}>
          Ablesung erfassen
        </button>
      </section>
    )
  }

  const h = s.house
  const pd = (v: number, n = t.days) => (n ? `${num(v / n, 1)} kWh/Tag` : undefined)
  const pp = (v: number) => (h.personen ? ` · ${num(v / h.personen, 0)} kWh/Person` : '')
  const E = (v: number) => energy(v)
  const startCalc = s.markCalc && !daily.readingDays.has(range.from)
  const endCalc = s.markCalc && !daily.readingDays.has(range.to)
  const ap = t.nPv && k.ev ? t.ersparnis / k.ev : undefined
  const waiting = tab === 'custom' && custom.from !== undefined && custom.to === undefined
  const customs = customMeters(model).filter((c) => c.active)
  const fixMonat = t.days ? ((t.kGrund + t.kWPGrund + t.kCustGrund) / t.days) * 30.44 : 0
  const extremes = [
    { key: 'zb' as const, name: 'Netzbezug' },
    { key: 'pv' as const, name: 'PV-Ertrag' },
    { key: 'wp' as const, name: 'Wärmepumpe' },
    { key: 'wb' as const, name: 'Wallbox' },
  ]
    .map((x) => ({ ...x, r: intervalExtremes(daily, x.key, range.from, range.to) }))
    .filter((x) => x.r && x.r.max.v > 0.05)

  return (
    <section className="screen dash">
      <div className="tabs-wrap">
        <div className="tabs" ref={tabsRef} role="tablist" aria-label="Zeitraum">
          {TABS.map((x) => (
            <button
              key={x.value}
              type="button"
              role="tab"
              className={x.value === tab ? 'on' : ''}
              aria-selected={x.value === tab}
              onClick={(e) => {
                setTab(x.value)
                const el = e.currentTarget
                const bar = tabsRef.current
                if (bar) bar.scrollTo({ left: el.offsetLeft - (bar.clientWidth - el.clientWidth) / 2, behavior: 'smooth' })
              }}
            >
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'custom' && (
        <Calendar
          daily={daily}
          from={custom.from ?? range.from}
          to={custom.from !== undefined && custom.to === undefined ? undefined : range.to}
          onPick={(day) =>
            setCustom((c) => {
              if (c.from === undefined || c.to !== undefined) return { from: day }
              if (day === c.from) return c
              return day < c.from ? { from: day, to: c.from } : { from: c.from, to: day }
            })
          }
        />
      )}

      <p className="range num">
        {waiting ? (
          'Ende wählen …'
        ) : (
          <>
            {fmtDay(range.from)}
            {startCalc && <span className="calc">berechnet</span>} – {fmtDay(range.to)}
            {endCalc && <span className="calc">berechnet</span>} · <Days n={t.days} />
            {range.clipped && tab !== 'custom' && <span className="dim"> · Daten ab {fmtDay(daily.start)}</span>}
          </>
        )}
      </p>

      {t.days > 0 && !waiting && (
        <div className="dash-body" key={`${tab}-${range.from}-${range.to}`}>
          {tab === 'jahr' && <ContractHints model={model} today={an.today} />}

          <div className="card hero-card">
            <div className="hero">
              <span className="eyebrow">Netto-Bilanz Strom</span>
              <span className="hero-num">
                <Num v={k.bilanz} digits={eurDigits(k.bilanz)} />
                <em>€</em>
              </span>
              <Rows
                rows={[
                  ['Bezugskosten', `${eur(k.kosten)} €`],
                  ['Einspeisevergütung', `−${eur(t.verg)} €`],
                  k.kostenEigene > 0 && ['Eigene Zähler', `${eur(k.kostenEigene)} €`],
                  t.nPv > 0 && ['Ersparnis durch PV', <span className="acc">{eur(t.ersparnis)} €</span>],
                ]}
              />
              <Delta cur={k.bilanz} prev={pk?.bilanz} />
            </div>
            <div className="pvhome">
              <span className="eyebrow acc">PV ins Haus statt ins Netz</span>
              {k.ev !== undefined ? (
                <>
                  <span className="pv-num">
                    <Num v={E(k.ev).v} digits={E(k.ev).digits} />
                    <em>{E(k.ev).unit}</em>
                  </span>
                  <div className="quota" role="img" aria-label={`Eigenverbrauchsquote ${pct(k.evQuote ?? 0)} Prozent`}>
                    <i style={{ width: `${Math.min(100, Math.max(0, (k.evQuote ?? 0) * 100))}%` }} />
                  </div>
                  <Rows
                    rows={[
                      ['Eigenverbrauchsquote', k.evQuote !== undefined ? `${pct(k.evQuote)} %` : '–'],
                      [`Gegenwert${ap ? ` bei ${num(ap * 100, 1)} ct/kWh` : ''}`, `${eur(t.ersparnis)} €`],
                    ]}
                  />
                  {k.pvTeilweise && <p className="fineprint">PV-Ertrag liegt nur für {t.nPv} von {t.days} Tagen vor.</p>}
                  <Delta cur={k.ev} prev={pk?.ev} invert />
                </>
              ) : (
                <p className="muted">Sobald zwei Ablesungen den PV-Ertrag enthalten, steht hier dein Eigenverbrauch.</p>
              )}
            </div>
          </div>

          {warnings.map((w) => (
            <p className="note warn" key={w}>
              {w}
            </p>
          ))}

          <div className="rings card">
            <Ring value={k.autarkie} label="Autarkie" color="acc" />
            <Ring value={k.evQuote} label="Eigenverbrauch" color="pv" />
            {t.nWp > 0 && <Ring value={k.pvAnteilWP} label="PV-Anteil WP" color="wp" sub={<Badge kind="geschätzt" />} />}
            {t.nWb > 0 && <Ring value={k.pvAnteilWB} label="PV-Anteil Wallbox" color="wb" sub={<Badge kind="geschätzt" />} />}
          </div>

          <h2 className="sec-title">Energie</h2>
          <div className="tiles">
            {t.nPv > 0 && (
              <Tile icon="sun" color="pv" label="PV-Ertrag" value={E(t.pv).v} digits={E(t.pv).digits} unit={E(t.pv).unit}
                sub={`${pd(t.pv, t.nPv)}${h.kwp ? ` · ${num(t.pv / h.kwp, 0)} kWh/kWp` : ''}`}
                extra={<Delta cur={t.pv} prev={prev?.nPv ? prev.pv : undefined} invert />} />
            )}
            <Tile icon="zap" color="netz" label="Netzbezug" value={E(t.bezug).v} digits={E(t.bezug).digits} unit={E(t.bezug).unit}
              sub={pd(t.bezug)} extra={<Delta cur={t.bezug} prev={prev?.bezug} />} />
            <Tile icon="export" color="einsp" label="Einspeisung" value={E(t.ze).v} digits={E(t.ze).digits} unit={E(t.ze).unit}
              sub={pd(t.ze)} extra={<Delta cur={t.ze} prev={prev?.ze} invert />} />
            {k.gesamt !== undefined && (
              <Tile icon="gauge" color="haus" label="Gesamtverbrauch" value={E(k.gesamt).v} digits={E(k.gesamt).digits} unit={E(k.gesamt).unit}
                sub={`${pd(k.gesamt, t.nPv)}${pp(k.gesamt)}`} />
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Netzbezug nach Verbraucher</h2>
            </div>
            <div className="split-rows">
              {[
                { name: 'Haus', icon: 'house' as const, color: 'haus' as const, v: Math.max(0, t.netzHaus), est: !t.nImp },
                ...(t.nWp ? [{ name: 'Wärmepumpe', icon: 'thermo' as const, color: 'wp' as const, v: t.netzWP, est: true }] : []),
                ...(t.nWb ? [{ name: 'Wallbox', icon: 'plug' as const, color: 'wb' as const, v: t.netzWB, est: true }] : []),
              ].map((r) => (
                <div className="split-row" key={r.name}>
                  <IconChip name={r.icon} color={r.color} size={28} />
                  <span>{r.name}</span>
                  <Badge kind={r.est ? 'geschätzt' : 'gemessen'} />
                  <b className="num">{kwhU(r.v)}</b>
                  <i className="split-bar" aria-hidden>
                    <i className={`f-${r.color}`} style={{ width: `${t.bezug > 0 ? Math.min(100, (r.v / t.bezug) * 100) : 0}%` }} />
                  </i>
                </div>
              ))}
            </div>
            {t.nImp > 0 && (
              <p className="fineprint">
                Gemessen über den WechselRichter-Import: Haus {kwhU(t.netzHaus)}, Wärmepumpe und Wallbox zusammen {kwhU(t.mNetz)}. Geschätzt ist nur die Aufteilung zwischen Wärmepumpe und Wallbox.
                {k.plausPct !== undefined && (
                  <>
                    {' '}
                    Abgleich mit den Zählern: <span className="num">{k.plausDiff! >= 0 ? '+' : '−'}{num(Math.abs(k.plausDiff!), 1)} kWh ({k.plausPct >= 0 ? '+' : '−'}{num(Math.abs(k.plausPct) * 100, 1)} %)</span>
                    {Math.abs(k.plausPct) <= s.toleranz ? ' – innerhalb der Toleranz.' : ' – außerhalb der Toleranz.'}
                  </>
                )}
              </p>
            )}
            {!t.nImp && (t.nWp > 0 || t.nWb > 0) && (
              <p className="fineprint">Ohne WechselRichter-Import ist der Netzanteil von Haus, Wärmepumpe und Wallbox geschätzt.</p>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Energiefluss</h2>
              <Info label="So wird der PV-Anteil geschätzt">
                PV-Strom für Wärmepumpe und Wallbox ist die Differenz zwischen dem Export laut WechselRichter und der Einspeisung am Zähler – das ist gemessen. Geschätzt ist nur, wie er sich verteilt:
                {s.splitMethod === 'saison'
                  ? ' nach Verbrauch, die Wärmepumpe gewichtet mit einem Saisonfaktor je Monat'
                  : s.splitMethod === 'anteilig'
                    ? ' anteilig nach Verbrauch'
                    : ' zuerst an die Wallbox, der Rest an die Wärmepumpe'}
                ; was ein Verbraucher nicht aufnehmen kann, geht an den anderen.
              </Info>
            </div>
            <Flow t={t} k={k} />
          </div>

          <div className="consumers">
            <div className="card consumer">
              <h2 className="consumer-head">
                <IconChip name="house" color="haus" size={28} /> Haus
              </h2>
              <span className="consumer-num">{kwhU(t.haus)}</span>
              <Rows
                rows={[
                  ['PV-Anteil', k.pvAnteilHaus !== undefined ? `${pct(k.pvAnteilHaus)} %` : '–'],
                  ['Kosten', `${eur(t.kHaus)} €`],
                  ['pro Tag', `${num(t.haus / t.days, 1)} kWh`],
                  !!h.personen && ['pro Person', `${num(t.haus / h.personen, 0)} kWh`],
                ]}
              />
            </div>
            {t.nWp > 0 && (
              <div className="card consumer">
                <h2 className="consumer-head">
                  <IconChip name="thermo" color="wp" size={28} /> Wärmepumpe
                </h2>
                <span className="consumer-num">{kwhU(t.wp)}</span>
                <Rows
                  rows={[
                    ['PV-Anteil', k.pvAnteilWP !== undefined ? `${pct(k.pvAnteilWP)} %` : '–'],
                    ['Kosten', `${eur(t.kWP + t.kWPGrund)} €`],
                    ['pro Tag', `${num(t.wp / t.nWp, 1)} kWh`],
                    !!h.flaeche && ['pro m²', `${num(t.wp / h.flaeche, 1)} kWh`],
                    wpE?.kwhProHgt !== undefined && ['je Heizgradtag', `${num(wpE.kwhProHgt, 2)} kWh`],
                    k.jaz !== undefined && ['Jahresarbeitszahl', num(k.jaz, 2)],
                  ]}
                />
                {t.nSep > 0 && <p className="fineprint">eigener WP-Tarif</p>}
              </div>
            )}
            {t.nWb > 0 && (
              <div className="card consumer">
                <h2 className="consumer-head">
                  <IconChip name="plug" color="wb" size={28} /> Wallbox
                </h2>
                <span className="consumer-num">{kwhU(t.wb)}</span>
                <Rows
                  rows={[
                    ['PV-Anteil', k.pvAnteilWB !== undefined ? `${pct(k.pvAnteilWB)} %` : '–'],
                    ['Kosten', `${eur(t.kWB)} €`],
                    ['pro Tag', `${num(t.wb / t.nWb, 1)} kWh`],
                    k.kwh100km !== undefined && ['pro 100 km', `${num(k.kwh100km, 1)} kWh`],
                    !!h.autoAkku && ['Vollladungen', num(t.wb / h.autoAkku, 1)],
                  ]}
                />
              </div>
            )}
            {t.nSp > 0 && (
              <div className="card consumer">
                <h2 className="consumer-head">
                  <IconChip name="battery" color="speicher" size={28} /> Speicher
                </h2>
                <span className="consumer-num">{kwhU(t.spE)}</span>
                <Rows
                  rows={[
                    ['geladen', kwhU(t.spL)],
                    ['entladen', kwhU(t.spE)],
                    ['Wirkungsgrad', k.spEff !== undefined ? `${pct(k.spEff)} %` : '–'],
                    !!h.speicherKwh && ['Vollzyklen', num(t.spE / h.speicherKwh, 0)],
                  ]}
                />
              </div>
            )}
            {customs.map((c) => {
              const ct = aggregateCustom(daily, c.id, range.from, range.to)
              if (!ct.n) return null
              const pc = prev ? aggregateCustom(daily, c.id, addMonths(range.from, -12), addMonths(range.to, -12)) : undefined
              const dd = Math.max(1, Math.min(c.decimals, 2))
              return (
                <div className="card consumer" key={c.id}>
                  <h2 className="consumer-head">
                    <IconChip name={c.icon} color={c.color} size={28} /> {meterName(c)}
                  </h2>
                  <span className="consumer-num">
                    {num(ct.qty, Math.min(c.decimals, 1))} {c.unit}
                  </span>
                  <Rows
                    rows={[
                      ['pro Tag', `${num(ct.qty / ct.n, dd)} ${c.unit}`],
                      !!h.personen && ['pro Person', `${num(ct.qty / h.personen, 1)} ${c.unit}`],
                      ct.kosten > 0 && ['Kosten', `${eur(ct.kosten)} €`],
                      ct.grund > 0 && ['davon Grundgebühr', `${eur(ct.grund)} €`],
                    ]}
                  />
                  {pc && pc.n > 0 && <Delta cur={ct.qty / ct.n} prev={pc.qty / pc.n} />}
                </div>
              )
            })}
          </div>

          {tab === 'jahr' && an.fc && (
            <div className="card">
              <div className="card-head">
                <h2>Prognose bis 31.12.{an.fc.year}</h2>
                <ForecastBasis fc={an.fc} />
              </div>
              <ForecastSaldo fc={an.fc} model={model} />
              <ForecastBars months={an.fc.months} />
              <Rows
                rows={[
                  ['Stromkosten im Jahr', `${eur(an.fc.jahr.kosten)} €`],
                  ['Netzbezug im Jahr', kwhU(an.fc.jahr.bezug)],
                  ['Einspeisung im Jahr', kwhU(an.fc.jahr.einsp)],
                  ['Vergütung im Jahr', `${eur(an.fc.jahr.verg)} €`],
                  an.fc.jahr.eigene > 0 && ['Eigene Zähler im Jahr', `${eur(an.fc.jahr.eigene)} €`],
                ]}
              />
              <h3 className="sub-title">Nächste 12 Monate</h3>
              <Rows
                rows={[
                  ['Netzbezug', kwhU(an.fc.next12.bezug)],
                  ['PV-Ertrag', kwhU(an.fc.next12.pv)],
                  ['Stromkosten', `${eur(an.fc.next12.kosten)} € (±${Math.round(an.fc.spanne * 100)} %)`],
                  ['Vergütung', `${eur(an.fc.next12.verg)} €`],
                  an.fc.next12.abschlaege > 0 && ['Abschläge Strom', `${eur(an.fc.next12.abschlaege)} €`],
                  an.fc.next12.eigene > 0 && ['Eigene Zähler', `${eur(an.fc.next12.eigene)} €`],
                ]}
              />
              {an.fc.teiljahr && <p className="fineprint">Daten erst ab {fmtDay(daily.start)} – Abschläge zählen ab Datenbeginn.</p>}
            </div>
          )}

          <Fold title="Kosten pro Monat" aside={`${eur(costs.sum.saldo)} €`}>
            <div className="table-scroll">
              <table className="costs num">
                <thead>
                  <tr>
                    <th>Monat</th>
                    <th>Fixkosten</th>
                    <th>Arbeit Strom</th>
                    <th>davon WP / Wallbox</th>
                    <th>Vergütung</th>
                    <th>Eigene Zähler</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {costs.rows.map((r) => (
                    <tr key={r.start}>
                      <th>
                        {MONTHS[parts(r.start).m]} {String(parts(r.start).y).slice(2)}
                        {r.to - r.from < addMonths(r.start, 1) - r.start && <small> {r.to - r.from} T.</small>}
                      </th>
                      <td>{eur(r.fix)}</td>
                      <td>{eur(r.arbeit)}</td>
                      <td>
                        {eur(r.wp)} / {eur(r.wb)}
                      </td>
                      <td>−{eur(r.verg)}</td>
                      <td>{eur(r.eigene)}</td>
                      <td>
                        <b>{eur(r.saldo)}</b>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Summe</th>
                    <td>{eur(costs.sum.fix)}</td>
                    <td>{eur(costs.sum.arbeit)}</td>
                    <td>
                      {eur(costs.sum.wp)} / {eur(costs.sum.wb)}
                    </td>
                    <td>−{eur(costs.sum.verg)}</td>
                    <td>{eur(costs.sum.eigene)}</td>
                    <td>
                      <b>{eur(costs.sum.saldo)}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="fineprint">Alle Beträge in €. Fixkosten = alle Grundgebühren (Strom, WP-Tarif, eigene Zähler).</p>
            <Rows
              rows={[
                ['Fixkosten pro Monat', `${eur(fixMonat)} €`],
                k.ctProKwh !== undefined && ['Ø Strompreis inkl. Grundgebühr', `${num(k.ctProKwh, 1)} ct/kWh`],
                t.nPv > 0 && ['Ersparnis durch PV', `${eur(t.ersparnis)} €`],
              ]}
            />
          </Fold>

          {extremes.length > 0 && (
            <Fold title="Höchster und niedrigster Tagesdurchschnitt">
              <Rows
                rows={extremes.flatMap((x) => [
                  [`${x.name} höchster`, <>{num(x.r!.max.v, 1)} kWh/Tag <small className="dim">{fmtDayShort(x.r!.max.from)}–{fmtDayShort(x.r!.max.to)}</small></>] as [string, React.ReactNode],
                  [`${x.name} niedrigster`, <>{num(x.r!.min.v, 1)} kWh/Tag <small className="dim">{fmtDayShort(x.r!.min.from)}–{fmtDayShort(x.r!.min.to)}</small></>] as [string, React.ReactNode],
                ])}
              />
              <p className="fineprint">Über alle vollständigen Ableseintervalle im Zeitraum.</p>
            </Fold>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Verlauf</h2>
            </div>
            <Trend daily={daily} from={range.from} to={range.to} yoy={s.yoy} />
          </div>

          <Fold title="Vergleich zweier Zähler">
            <Compare model={model} daily={daily} from={range.from} to={range.to} />
          </Fold>

          {an.check && (
            <Fold title="PV-Anlagen-Check" aside={`${pct(an.check.rows[an.check.rows.length - 1].pct)} %`} open={an.check.alarm}>
              {an.check.alarm && (
                <p className="note warn">Zwei Monate in Folge unter 85 % des Solls. Verschmutzung, Defekt oder Verschattung?</p>
              )}
              <ul className="check">
                {an.check.rows.slice(-12).map((r) => (
                  <li key={r.start}>
                    <span>
                      {MONTHS[parts(r.start).m]} {String(parts(r.start).y).slice(2)}
                    </span>
                    <i className="check-bar" aria-hidden>
                      <i className={r.pct < 0.85 ? 'low' : ''} style={{ width: `${Math.min(100, (r.pct / 1.3) * 100)}%` }} />
                      <i className="check-100" />
                    </i>
                    <b className="num">{pct(r.pct)} %</b>
                  </li>
                ))}
              </ul>
              <p className="fineprint">
                Ist-Ertrag gegen Soll aus gemessener Einstrahlung × {num(h.kwp ?? 0, 1)} kWp × Performance Ratio {num(an.check.prRef, 2)}. Strich = 100 %.
              </p>
            </Fold>
          )}

          {an.amort && (
            <Fold title="Amortisation PV + Speicher" aside={`${pct(Math.min(1, an.amort.pct))} %`}>
              <div className="amort">
                <Ring value={Math.min(1, an.amort.pct)} label="amortisiert" color="acc" size={96} />
                <Rows
                  rows={[
                    ['Investition', `${eur(an.amort.invest)} €`],
                    ['Nutzen bisher', `${eur(an.amort.nutzen)} €`],
                    an.amort.geschaetzt > 0 && [
                      'davon vor der ersten Ablesung',
                      <>
                        {eur(an.amort.geschaetzt)} € <Badge kind="geschätzt" />
                      </>,
                    ],
                    ['Nutzen pro Jahr', `${eur(an.amort.proJahr)} €`],
                    an.amort.tag !== undefined && [
                      an.amort.pct >= 1 ? 'Amortisiert' : 'Voraussichtlich amortisiert',
                      an.amort.pct >= 1 ? 'erreicht' : `${MONTHS_LONG[parts(an.amort.tag).m]} ${parts(an.amort.tag).y}`,
                    ],
                  ]}
                />
              </div>
              <p className="fineprint">Nutzen = Ersparnis durch Eigenverbrauch + Einspeisevergütung. Die Zeit vor der ersten Ablesung ist aus dem PV-Gesamtzähler geschätzt.</p>
            </Fold>
          )}
        </div>
      )}
    </section>
  )
}
