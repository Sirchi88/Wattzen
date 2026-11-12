import { useMemo, useState } from 'react'
import { aggregate, kpis, plausibilitaet, type Daily, type Totals } from '../calc/engine'
import { forecast } from '../calc/forecast'
import { addMonths, dayOf, daysInMonth, fmtDay, MONTHS_LONG, parts, toDay, todayIso } from '../lib/dates'
import { eur, eurDigits, kwh, kwhDigits, num, pct } from '../lib/format'
import type { Model } from '../types'
import { Info, Num } from '../ui/bits'
import { Flow, Trend } from './charts'

type Tab = 'last' | 'monat' | 'halb' | 'jahr' | 'zwei' | 'custom'
const TABS: { value: Tab; label: string }[] = [
  { value: 'last', label: 'Seit letzter Ablesung' },
  { value: 'monat', label: 'Monat' },
  { value: 'halb', label: 'Halbjahr' },
  { value: 'jahr', label: 'Jahr' },
  { value: 'zwei', label: '2 Jahre' },
  { value: 'custom', label: 'Benutzerdefiniert' },
]

function Calendar({
  daily, from, to, onPick,
}: {
  daily: Daily
  from?: number
  to?: number
  onPick: (day: number) => void
}) {
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
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="link" disabled={ym <= minYm} onClick={() => setYm(ym - 1)} aria-label="Vorheriger Monat">
          ←
        </button>
        <span>
          {MONTHS_LONG[m]} <span className="num">{y}</span>
        </span>
        <button type="button" className="link" disabled={ym >= maxYm} onClick={() => setYm(ym + 1)} aria-label="Nächster Monat">
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

function Tile({
  label, value, digits, unit, sub, delta,
}: {
  label: string
  value?: number
  digits: number
  unit: string
  sub?: string
  delta?: React.ReactNode
}) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">
        <Num v={value} digits={digits} />
        {value !== undefined && <em>{unit}</em>}
      </span>
      <span className="tile-sub num">{sub ?? ' '}</span>
      {delta}
    </div>
  )
}

export function Dashboard({ model, daily, goEntry }: { model: Model; daily: Daily; goEntry: () => void }) {
  const [tab, setTab] = useState<Tab>('jahr')
  const [custom, setCustom] = useState<{ from?: number; to?: number }>({})

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
    if (!model.settings.yoy || tab === 'zwei') return undefined
    const pf = addMonths(range.from, -12)
    if (pf < daily.start || t.days < 1) return undefined
    return aggregate(daily, pf, addMonths(range.to, -12))
  }, [model.settings.yoy, tab, range, daily, t.days])
  const pk = prev ? kpis(prev) : undefined
  const fc = useMemo(
    () => (tab === 'jahr' ? forecast(daily, model, toDay(todayIso())) : undefined),
    [tab, daily, model],
  )
  const warnings = useMemo(() => plausibilitaet(t), [t])

  if (!daily.days.length) {
    return (
      <section className="screen narrow empty">
        <div className="empty-mark" aria-hidden />
        <h1>{model.readings.length ? 'Noch eine Ablesung, dann gibt’s die erste Auswertung.' : 'Noch keine Ablesung.'}</h1>
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

  const perDay = (v: number) => (t.days ? `${num(v / t.days, 1)} kWh/Tag` : undefined)
  const startCalc = !daily.readingDays.has(range.from)
  const endCalc = !daily.readingDays.has(range.to)
  const ap = t.nPv && k.ev ? t.ersparnis / k.ev : undefined
  const waiting = tab === 'custom' && custom.from !== undefined && custom.to === undefined

  const cards = [
    { name: 'Haus', kwh: t.haus, share: k.pvAnteilHaus, cost: t.kHaus, show: true, extra: undefined as string | undefined },
    { name: 'Wärmepumpe', kwh: t.wp, share: k.pvAnteilWP, cost: t.kWP + t.kWPGrund, show: t.nWp > 0, extra: t.nSep > 0 ? 'eigener WP-Tarif' : undefined },
    {
      name: 'Wallbox', kwh: t.wb, share: k.pvAnteilWB, cost: t.kWB, show: t.nWb > 0,
      extra: k.kwh100km !== undefined ? `${num(k.kwh100km, 1)} kWh/100 km` : undefined,
    },
  ].filter((c) => c.show)

  return (
    <section className="screen dash">
      <nav className="tabs" aria-label="Zeitraum">
        {TABS.map((x) => (
          <button key={x.value} type="button" className={x.value === tab ? 'on' : ''} aria-current={x.value === tab}
            onClick={(e) => {
              setTab(x.value)
              e.currentTarget.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' })
            }}
          >
            {x.label}
          </button>
        ))}
      </nav>

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
            {endCalc && <span className="calc">berechnet</span>} · {t.days} {t.days === 1 ? 'Tag' : 'Tage'}
            {range.clipped && tab !== 'custom' && <span className="dim"> · Daten ab {fmtDay(daily.start)}</span>}
          </>
        )}
      </p>

      {t.days > 0 && !waiting && (
        <div className="dash-body" key={`${tab}-${range.from}-${range.to}`}>
          <div className="top">
            <div className="hero">
              <span className="eyebrow">Netto-Bilanz</span>
              <span className="hero-num">
                <Num v={k.bilanz} digits={eurDigits(k.bilanz)} />
                <em>€</em>
              </span>
              <dl className="hero-rows num">
                <div>
                  <dt>Bezugskosten</dt>
                  <dd>{eur(k.kosten)} €</dd>
                </div>
                <div>
                  <dt>Einspeisevergütung</dt>
                  <dd>−{eur(t.verg)} €</dd>
                </div>
                {t.nPv > 0 && (
                  <div className="sep">
                    <dt>Ersparnis durch Eigenverbrauch</dt>
                    <dd>{eur(t.ersparnis)} €</dd>
                  </div>
                )}
              </dl>
              <Delta cur={k.bilanz} prev={pk?.bilanz} />
            </div>

            <div className="pvhome">
              <span className="eyebrow acc">PV ins Haus statt ins Netz</span>
              {k.ev !== undefined ? (
                <>
                  <span className="pv-num">
                    <Num v={k.ev} digits={kwhDigits(k.ev)} />
                    <em>kWh</em>
                  </span>
                  <div className="quota" role="img" aria-label={`Eigenverbrauchsquote ${pct(k.evQuote ?? 0)} Prozent`}>
                    <i style={{ width: `${Math.min(100, Math.max(0, (k.evQuote ?? 0) * 100))}%` }} />
                  </div>
                  <dl className="hero-rows num">
                    <div>
                      <dt>Eigenverbrauchsquote</dt>
                      <dd>{k.evQuote !== undefined ? `${pct(k.evQuote)} %` : '–'}</dd>
                    </div>
                    <div>
                      <dt>Gegenwert{ap ? ` bei ${num(ap * 100, 1)} ct/kWh` : ''}</dt>
                      <dd>{eur(t.ersparnis)} €</dd>
                    </div>
                  </dl>
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

          <div className="tiles">
            <Tile label="Bezug" value={t.bezug} digits={kwhDigits(t.bezug)} unit="kWh" sub={perDay(t.bezug)} delta={<Delta cur={t.bezug} prev={prev?.bezug} />} />
            <Tile label="Einspeisung" value={t.ze} digits={kwhDigits(t.ze)} unit="kWh" sub={perDay(t.ze)} delta={<Delta cur={t.ze} prev={prev?.ze} invert />} />
            <Tile
              label="PV-Ertrag"
              value={t.nPv ? t.pv : undefined}
              digits={kwhDigits(t.pv)}
              unit="kWh"
              sub={t.nPv ? `${num(t.pv / t.nPv, 1)} kWh/Tag` : undefined}
              delta={t.nPv ? <Delta cur={t.pv} prev={prev?.nPv ? prev.pv : undefined} invert /> : null}
            />
            <Tile
              label="Autarkie"
              value={k.autarkie !== undefined ? k.autarkie * 100 : undefined}
              digits={0}
              unit="%"
              sub={k.gesamt !== undefined && t.nPv ? `${num(k.gesamt / t.nPv, 1)} kWh/Tag Verbrauch` : undefined}
            />
            <Tile
              label="Eigenverbrauch"
              value={k.evQuote !== undefined ? k.evQuote * 100 : undefined}
              digits={0}
              unit="%"
              sub={k.ev !== undefined && t.nPv ? `${num(k.ev / t.nPv, 1)} kWh/Tag` : undefined}
            />
          </div>

          {fc && (
            <div className="card forecast">
              <div className="card-head">
                <h2>Prognose bis 31.12.{fc.year}</h2>
                <Info label="So wird hochgerechnet">
                  {fc.method === 'saisonal'
                    ? 'Der Rest des Jahres folgt dem Tagesprofil des Vorjahres, skaliert mit dem Verhältnis dieses Jahres zum gleichen Vorjahreszeitraum.'
                    : 'Noch kein vollständiges Vorjahr vorhanden: Der bisherige Tagesschnitt wird linear bis Jahresende fortgeschrieben.'}{' '}
                  Verglichen werden die Bezugskosten mit gezahlten und noch kommenden Abschlägen.
                </Info>
              </div>
              {model.abschlaege.length ? (
                <p className="forecast-main">
                  voraussichtlich{' '}
                  <b>
                    <span className="num">
                      {fc.differenz >= 0 ? '+' : '−'}
                      {num(Math.abs(fc.differenz), 0)}
                    </span>{' '}
                    €
                  </b>{' '}
                  {fc.differenz >= 0 ? 'Nachzahlung' : 'Gutschrift'}
                </p>
              ) : (
                <p className="muted">Trag im Elektromeisterbereich deine Abschläge ein, dann steht hier Nachzahlung oder Gutschrift.</p>
              )}
              <dl className="hero-rows num cols">
                <div>
                  <dt>Jahreskosten</dt>
                  <dd>{eur(fc.kosten)} €</dd>
                </div>
                <div>
                  <dt>Abschläge gezahlt</dt>
                  <dd>{eur(fc.abschlaegeGezahlt)} €</dd>
                </div>
                <div>
                  <dt>Abschläge noch offen</dt>
                  <dd>{eur(fc.abschlaegeKommend)} €</dd>
                </div>
                <div>
                  <dt>Bezug im Jahr</dt>
                  <dd>{kwh(fc.bezug)} kWh</dd>
                </div>
                <div>
                  <dt>Einspeisung im Jahr</dt>
                  <dd>{kwh(fc.einsp)} kWh</dd>
                </div>
                <div>
                  <dt>Vergütung im Jahr</dt>
                  <dd>{eur(fc.verg)} €</dd>
                </div>
              </dl>
              <p className="fineprint">
                {fc.method === 'saisonal' ? 'Saisonal gewichtet nach Vorjahresprofil' : 'Linear hochgerechnet'}
                {fc.teiljahr ? ` · Daten erst ab ${fmtDay(fc.from)}` : ''}
              </p>
            </div>
          )}

          <div className="card">
            <div className="card-head">
              <h2>Energiefluss</h2>
              <Info label="So wird der PV-Anteil geschätzt">
                Rechnerische Schätzung: PV-Strom für Wärmepumpe und Wallbox ist die Differenz zwischen der Einspeisung laut
                Wechselrichter und der Einspeisung am Zähler. Aufgeteilt wird er
                {model.settings.splitMethod === 'saison'
                  ? ' nach Verbrauch, die Wärmepumpe gewichtet mit einem Saisonfaktor je Monat'
                  : model.settings.splitMethod === 'anteilig'
                    ? ' anteilig nach Verbrauch'
                    : ' zuerst an die Wallbox, der Rest an die Wärmepumpe'}
                ; was ein Verbraucher nicht aufnehmen kann, geht an den anderen.
              </Info>
            </div>
            <Flow t={t} k={k} />
            <p className="fineprint">Aufteilung auf Wärmepumpe und Wallbox ist eine rechnerische Schätzung.</p>
          </div>

          <div className="consumers">
            {cards.map((c) => (
              <div className="card consumer" key={c.name}>
                <h2>{c.name}</h2>
                <span className="consumer-num">
                  <Num v={c.kwh} digits={kwhDigits(c.kwh)} />
                  <em>kWh</em>
                </span>
                <dl className="hero-rows num">
                  <div>
                    <dt>PV-Anteil</dt>
                    <dd>{c.share !== undefined ? `${pct(c.share)} %` : '–'}</dd>
                  </div>
                  <div>
                    <dt>Kosten</dt>
                    <dd>{eur(c.cost)} €</dd>
                  </div>
                  <div>
                    <dt>pro Tag</dt>
                    <dd>{num(c.kwh / t.days, 1)} kWh</dd>
                  </div>
                </dl>
                {c.extra && <p className="fineprint">{c.extra}</p>}
              </div>
            ))}
          </div>

          <div className="card">
            <div className="card-head">
              <h2>Verlauf</h2>
            </div>
            <Trend daily={daily} from={range.from} to={range.to} yoy={model.settings.yoy} />
          </div>

          {k.spEff !== undefined && (
            <p className="footline num">
              Speicher-Wirkungsgrad {pct(k.spEff)} % · geladen {kwh(t.spL)} kWh · entladen {kwh(t.spE)} kWh
            </p>
          )}
        </div>
      )}
    </section>
  )
}
