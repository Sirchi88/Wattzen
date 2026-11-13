import { useMemo, useState } from 'react'
import { aggregate, aggregateCustom, type Daily, type Kpis, type Totals } from '../calc/engine'
import { meterName } from '../calc/meters'
import type { MonthForecast } from '../calc/smart'
import { addMonths, fmtDay, monthStart, MONTHS, parts } from '../lib/dates'
import { kwhU, num, pct } from '../lib/format'
import type { ColorKey, Model } from '../types'
import { Seg } from '../ui/bits'
import { useWidth } from '../ui/hooks'

/* ───────────── Energiefluss: gestapelte Balken ───────────── */

interface Part {
  label: string
  v: number
  c: ColorKey | 'acc'
}

function Stack({ parts: ps, total, scale = 1 }: { parts: Part[]; total: number; scale?: number }) {
  const vis = ps.filter((p) => p.v > total * 0.002)
  return (
    <div className="stack" style={{ width: `${Math.max(2, scale * 100)}%` }}>
      {vis.map((p) => (
        <i key={p.label} className={`f-${p.c}`} style={{ flexGrow: p.v }} title={`${p.label}: ${kwhU(p.v)} · ${pct(p.v / total)} %`} />
      ))}
    </div>
  )
}

export function Flow({ t, k }: { t: Totals; k: Kpis }) {
  const hasPv = t.nPv > 0 && t.pv > 0.5
  const pvParts: Part[] = [
    { label: 'Haus', v: t.pvHaus, c: 'haus' },
    { label: 'Speicher', v: t.spL, c: 'speicher' },
    { label: 'Wärmepumpe', v: t.pvWP, c: 'wp' },
    { label: 'Wallbox', v: t.pvWB, c: 'wb' },
    { label: 'Netz', v: t.zeP, c: 'einsp' },
  ]
  const pvTotal = pvParts.reduce((s, p) => s + p.v, 0)
  const users = [
    {
      name: 'Haus', total: Math.max(0, t.haus), share: k.pvAnteilHaus,
      parts: [
        { label: 'PV direkt', v: t.pvHaus, c: 'pv' },
        { label: 'Speicher', v: t.spE, c: 'speicher' },
        { label: 'Netz', v: Math.max(0, t.netzHaus), c: 'netz' },
      ] as Part[],
    },
    {
      name: 'Wärmepumpe', total: t.wp, share: k.pvAnteilWP,
      parts: [
        { label: 'PV', v: t.pvWP, c: 'pv' },
        { label: 'Netz', v: t.netzWP, c: 'netz' },
      ] as Part[],
    },
    {
      name: 'Wallbox', total: t.wb, share: k.pvAnteilWB,
      parts: [
        { label: 'PV', v: t.pvWB, c: 'pv' },
        { label: 'Netz', v: t.netzWB, c: 'netz' },
      ] as Part[],
    },
  ].filter((u) => u.total > 0.05)
  const max = Math.max(1e-9, ...users.map((u) => u.total))

  return (
    <div className="flow">
      {hasPv && (
        <div className="flow-block">
          <div className="flow-head">
            <span>Wohin der PV-Strom ging</span>
            <span className="num">{kwhU(t.pv)}</span>
          </div>
          <Stack parts={pvParts} total={pvTotal} />
          <ul className="legend">
            {pvParts
              .filter((p) => p.v > pvTotal * 0.002)
              .map((p) => (
                <li key={p.label}>
                  <i className={`f-${p.c}`} />
                  <span>{p.label}</span>
                  <b className="num">{pct(p.v / pvTotal)} %</b>
                  <small className="num">{kwhU(p.v)}</small>
                </li>
              ))}
          </ul>
        </div>
      )}
      {users.length > 0 && (
        <div className="flow-block">
          <div className="flow-head">
            <span>Woher der Strom kam</span>
            <span className="keys">
              <i className="f-pv" /> PV <i className="f-speicher" /> Speicher <i className="f-netz" /> Netz
            </span>
          </div>
          {users.map((u) => (
            <div className="flow-row" key={u.name}>
              <div className="flow-row-head">
                <span>{u.name}</span>
                <span className="num">
                  {u.share !== undefined && <b>{pct(u.share)} % PV</b>} {kwhU(u.total)}
                </span>
              </div>
              <Stack parts={u.parts} total={u.parts.reduce((s, p) => s + p.v, 0) || 1} scale={u.total / max} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/* ───────────── Gemeinsames Balken-/Linien-Diagramm ───────────── */

const niceMax = (v: number) => {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

interface Col {
  key: number
  label: string
  /** Balkenhöhe */
  bar?: number
  /** Teil des Balkens, der Prognose ist (0…1) */
  fc?: number
  lines: (number | undefined)[]
  tip: React.ReactNode
}

function Plot({
  cols, barColor, lineColors, lineDash, unit, aria,
}: {
  cols: Col[]
  barColor?: ColorKey
  lineColors: (ColorKey | 'fg')[]
  lineDash?: boolean[]
  unit: string
  aria: string
}) {
  const [hover, setHover] = useState<number>()
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 200
  const padL = 34
  const padR = 6
  const padT = 10
  const padB = 22
  const W = Math.max(200, width)
  const iw = W - padL - padR
  const ih = H - padT - padB
  const max = niceMax(Math.max(1e-6, ...cols.flatMap((c) => [c.bar ?? 0, ...c.lines.map((l) => l ?? 0)])))
  const y = (v: number) => padT + ih - (Math.max(0, v) / max) * ih
  const w = iw / Math.max(1, cols.length)
  const every = Math.max(1, Math.ceil(cols.length / Math.max(1, Math.floor(iw / 34))))
  const h = hover !== undefined ? cols[hover] : undefined
  const line = (li: number) =>
    cols
      .map((c, i) => {
        const v = c.lines[li]
        if (v === undefined) return ''
        const started = i > 0 && cols[i - 1].lines[li] !== undefined
        return `${started ? 'L' : 'M'}${(padL + i * w + w / 2).toFixed(1)},${y(v).toFixed(1)}`
      })
      .join(' ')
  return (
    <div className="plot">
      <div className="plot-area" ref={ref}>
        {width > 0 && (
          <svg width={W} height={H} role="img" aria-label={aria} onMouseLeave={() => setHover(undefined)}>
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={padL} x2={W - padR} y1={y(f * max)} y2={y(f * max)} className="grid" />
                <text x={padL - 7} y={y(f * max) + 3.5} textAnchor="end" className="tick">
                  {num(f * max, max < 5 ? 1 : 0)}
                </text>
              </g>
            ))}
            {cols.map((c, i) => {
              const x = padL + i * w
              const gap = w > 8 ? 2 : 0.5
              const bw = Math.max(1, w - gap * 2)
              return (
                <g key={c.key}>
                  {c.bar !== undefined && c.bar > 0 && (() => {
                    const top = y(c.bar)
                    const bh = padT + ih - top
                    const r = Math.min(3, bw / 2, bh)
                    const d = `M${x + gap},${top + bh} v${-(bh - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${bh - r} z`
                    return (
                      <path
                        className={`bar f-${barColor}${c.fc && c.fc > 0.5 ? ' fc' : ''}${hover === i ? ' hot' : ''}`}
                        style={{ animationDelay: `${Math.min(i * 10, 140)}ms` }}
                        d={d}
                      />
                    )
                  })()}
                  {i % every === 0 && (
                    <text x={x + w / 2} y={H - 6} textAnchor="middle" className="tick">
                      {c.label}
                    </text>
                  )}
                </g>
              )
            })}
            {lineColors.map((lc, li) => (
              <path key={li} d={line(li)} className={`pline s-${lc}${lineDash?.[li] ? ' dash' : ''}`} pathLength={1} />
            ))}
            {h &&
              lineColors.map((lc, li) =>
                h.lines[li] !== undefined ? (
                  <circle key={li} cx={padL + hover! * w + w / 2} cy={y(h.lines[li]!)} r={4} className={`pdot s-${lc}`} />
                ) : null,
              )}
            {cols.map((c, i) => (
              <rect
                key={c.key}
                x={padL + i * w}
                y={padT}
                width={Math.max(1, w)}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onPointerDown={() => setHover(i)}
              />
            ))}
          </svg>
        )}
      </div>
      <p className="plot-tip num" aria-live="polite">
        {h ? h.tip : <span className="dim">Antippen für Werte · {unit}</span>}
      </p>
    </div>
  )
}

/* ───────────── Verlauf: kWh/Tag je Monat oder Intervall ───────────── */

export function Trend({ daily, from, to, yoy }: { daily: Daily; from: number; to: number; yoy: boolean }) {
  const [serie, setSerie] = useState<'zb' | 'ze'>('zb')
  const [mode, setMode] = useState<'monat' | 'intervall'>('monat')
  const short = to - from < 85
  const a = short ? Math.max(daily.start, addMonths(to, -12)) : from
  const b = to

  const cols = useMemo(() => {
    const edges: number[] = [a]
    if (mode === 'monat') {
      for (let d = addMonths(monthStart(a), 1); d < b; d = addMonths(d, 1)) edges.push(d)
    } else {
      for (const p of daily.series.bezug) if (p.day > a && p.day < b) edges.push(p.day)
    }
    edges.push(b)
    const out: Col[] = []
    for (let i = 1; i < edges.length; i++) {
      const f = edges[i - 1]
      const t = edges[i]
      if (t <= f) continue
      const s = aggregate(daily, f, t)
      if (!s.days) continue
      const pf = addMonths(f, -12)
      const prev = yoy && pf >= daily.start ? aggregate(daily, pf, addMonths(t, -12)) : undefined
      const bar = s[serie] / s.days
      const wp = s.nWp === s.days ? s.wp / s.days : undefined
      const pv = prev && prev.days ? prev[serie] / prev.days : undefined
      out.push({
        key: f,
        label: MONTHS[parts(f).m],
        bar,
        lines: [wp, pv],
        tip: (
          <>
            <span>
              {fmtDay(f)} – {fmtDay(t)}
            </span>
            <span>
              {serie === 'zb' ? 'Bezug' : 'Einspeisung'} <b>{num(bar, 1)}</b>
            </span>
            {wp !== undefined && (
              <span>
                WP <b>{num(wp, 1)}</b>
              </span>
            )}
            {pv !== undefined && (
              <span>
                Vorjahr <b>{num(pv, 1)}</b>
              </span>
            )}
          </>
        ),
      })
    }
    return out
  }, [daily, a, b, mode, serie, yoy])

  const hasWp = cols.some((c) => c.lines[0] !== undefined)
  const hasPrev = cols.some((c) => c.lines[1] !== undefined)
  const color: ColorKey = serie === 'zb' ? 'netz' : 'einsp'
  return (
    <div className="trend">
      <div className="trend-ctl">
        <Seg small label="Reihe" value={serie} onChange={setSerie} options={[{ value: 'zb', label: 'Bezug' }, { value: 'ze', label: 'Einspeisung' }]} />
        <Seg small label="Auflösung" value={mode} onChange={setMode} options={[{ value: 'monat', label: 'Monat' }, { value: 'intervall', label: 'Intervall' }]} />
      </div>
      <div className="trend-legend">
        <span>
          <i className={`f-${color}`} /> {serie === 'zb' ? 'Bezug' : 'Einspeisung'}
        </span>
        {hasWp && (
          <span>
            <i className="ln s-wp" /> Wärmepumpe
          </span>
        )}
        {hasPrev && (
          <span>
            <i className="ln dash s-fg" /> Vorjahr
          </span>
        )}
        <span className="unit">kWh pro Tag{short ? ' · letzte 12 Monate' : ''}</span>
      </div>
      <Plot key={`${serie}-${mode}-${a}`} cols={cols} barColor={color} lineColors={['wp', 'fg']} lineDash={[false, true]} unit="kWh pro Tag" aria="Verbrauch pro Tag im Verlauf" />
    </div>
  )
}

/* ───────────── Prognose je Monat ───────────── */

export function ForecastBars({ months }: { months: MonthForecast[] }) {
  const cols: Col[] = months.map((m) => {
    const n = (addMonths(m.start, 1) - m.start)
    const bez = m.bezug / n
    return {
      key: m.start,
      label: MONTHS[parts(m.start).m],
      bar: bez,
      fc: m.fc,
      lines: [m.pv / n],
      tip: (
        <>
          <span>
            {MONTHS[parts(m.start).m]} {parts(m.start).y}
            {m.fc > 0 ? (m.fc >= 1 ? ' · Prognose' : ' · teils Prognose') : ''}
          </span>
          <span>
            Netzbezug <b>{num(bez, 1)}</b>
          </span>
          <span>
            PV <b>{num(m.pv / n, 1)}</b>
          </span>
          <span>
            Kosten <b>{num(m.kosten, 0)} €</b>
          </span>
        </>
      ),
    }
  })
  return (
    <div className="trend">
      <div className="trend-legend">
        <span>
          <i className="f-netz" /> Netzbezug
        </span>
        <span>
          <i className="f-netz fc" /> Prognose
        </span>
        <span>
          <i className="ln s-pv" /> PV-Ertrag
        </span>
        <span className="unit">kWh pro Tag</span>
      </div>
      <Plot cols={cols} barColor="netz" lineColors={['pv']} unit="kWh pro Tag" aria="Netzbezug und PV-Ertrag je Monat mit Prognose" />
    </div>
  )
}

/* ───────────── Vergleich zweier Zähler ───────────── */

export interface Comparable {
  id: string
  name: string
  unit: string
  color: ColorKey
  get: (a: number, b: number) => { v: number; n: number }
}

export function comparables(model: Model, daily: Daily): Comparable[] {
  const e = (id: string, name: string, color: ColorKey, key: 'zb' | 'ze' | 'pv' | 'wp' | 'wb' | 'haus' | 'spL' | 'km' | 'wpW', nKey?: 'nPv' | 'nWp' | 'nWb' | 'nKm' | 'nSp' | 'nWpW'): Comparable => ({
    id, name, color, unit: key === 'km' ? 'km' : 'kWh',
    get: (a, b) => {
      const t = aggregate(daily, a, b)
      return { v: t[key], n: nKey ? t[nKey] : t.days }
    },
  })
  const has = (k: 'nPv' | 'nWp' | 'nWb' | 'nKm' | 'nSp' | 'nWpW') => daily.days.some((d) => d[k])
  const out: Comparable[] = [e('zb', 'Netzbezug', 'netz', 'zb'), e('ze', 'Einspeisung', 'einsp', 'ze')]
  if (has('nPv')) out.push(e('pv', 'PV-Ertrag', 'pv', 'pv', 'nPv'), e('haus', 'Hausverbrauch', 'haus', 'haus', 'nPv'))
  if (has('nWp')) out.push(e('wp', 'Wärmepumpe', 'wp', 'wp', 'nWp'))
  if (has('nWpW')) out.push(e('wpW', 'WP-Wärmemenge', 'wp', 'wpW', 'nWpW'))
  if (has('nWb')) out.push(e('wb', 'Wallbox', 'wb', 'wb', 'nWb'))
  if (has('nSp')) out.push(e('spL', 'Speicher geladen', 'speicher', 'spL', 'nSp'))
  if (has('nKm')) out.push(e('km', 'Kilometerstand', 'wb', 'km', 'nKm'))
  for (const c of model.meters.filter((x) => !x.builtin)) {
    out.push({
      id: c.id, name: meterName(c), unit: c.unit, color: c.color,
      get: (a, b) => {
        const t = aggregateCustom(daily, c.id, a, b)
        return { v: t.qty, n: t.n }
      },
    })
  }
  return out
}

export function Compare({ model, daily, from, to }: { model: Model; daily: Daily; from: number; to: number }) {
  const list = useMemo(() => comparables(model, daily), [model, daily])
  const [a, setA] = useState(list[0]?.id)
  const [b, setB] = useState((list.find((x) => x.id === 'wp') ?? list[1])?.id)
  const A = list.find((x) => x.id === a) ?? list[0]
  const B = list.find((x) => x.id === b) ?? list[1]
  const short = to - from < 85
  const s = short ? Math.max(daily.start, addMonths(to, -12)) : from
  const cols = useMemo(() => {
    if (!A || !B) return []
    const raw: { key: number; va?: number; vb?: number }[] = []
    for (let m = monthStart(s); m < to; m = addMonths(m, 1)) {
      const f = Math.max(m, s)
      const t = Math.min(addMonths(m, 1), to)
      const x = A.get(f, t)
      const y = B.get(f, t)
      raw.push({ key: m, va: x.n ? x.v / x.n : undefined, vb: y.n ? y.v / y.n : undefined })
    }
    const same = A.unit === B.unit
    const mean = (k: 'va' | 'vb') => {
      const v = raw.map((r) => r[k]).filter((x): x is number => x !== undefined)
      return v.length ? v.reduce((p, c) => p + c, 0) / v.length : 1
    }
    const ma = same ? 1 : mean('va') / 100
    const mb = same ? 1 : mean('vb') / 100
    return raw.map<Col>((r) => ({
      key: r.key,
      label: MONTHS[parts(r.key).m],
      lines: [r.va !== undefined ? r.va / (ma || 1) : undefined, r.vb !== undefined ? r.vb / (mb || 1) : undefined],
      tip: (
        <>
          <span>
            {MONTHS[parts(r.key).m]} {parts(r.key).y}
          </span>
          <span>
            {A.name} <b>{r.va !== undefined ? num(r.va, 2) : '–'}</b> {A.unit}/Tag
          </span>
          <span>
            {B.name} <b>{r.vb !== undefined ? num(r.vb, 2) : '–'}</b> {B.unit}/Tag
          </span>
        </>
      ),
    }))
  }, [A, B, s, to])
  if (list.length < 2 || !A || !B) return <p className="muted">Für einen Vergleich braucht es mindestens zwei Zähler mit Daten.</p>
  const same = A.unit === B.unit
  const colorB: ColorKey = B.color === A.color ? (A.color === 'netz' ? 'pv' : 'netz') : B.color
  return (
    <div className="trend">
      <div className="compare-ctl">
        <label>
          <span className="sr">Erster Zähler</span>
          <select value={A.id} onChange={(e) => setA(e.target.value)}>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <span className="dim">gegen</span>
        <label>
          <span className="sr">Zweiter Zähler</span>
          <select value={B.id} onChange={(e) => setB(e.target.value)}>
            {list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="trend-legend">
        <span>
          <i className={`ln s-${A.color}`} /> {A.name}
        </span>
        <span>
          <i className={`ln dash s-${colorB}`} /> {B.name}
        </span>
        <span className="unit">{same ? `${A.unit} pro Tag` : 'Index, Ø = 100'}</span>
      </div>
      <Plot key={`${A.id}-${B.id}`} cols={cols} lineColors={[A.color, colorB]} lineDash={[false, true]} unit={same ? `${A.unit} pro Tag` : 'Index'} aria={`${A.name} gegen ${B.name} pro Tag`} />
      {!same && (
        <p className="fineprint">
          Unterschiedliche Einheiten ({A.unit} und {B.unit}): Beide Reihen sind auf ihren Durchschnitt normiert, damit der Verlauf vergleichbar ist.
        </p>
      )}
    </div>
  )
}

