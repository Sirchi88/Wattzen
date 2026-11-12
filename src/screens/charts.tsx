import { useEffect, useMemo, useRef, useState } from 'react'
import { aggregate, type Daily, type Kpis, type Totals } from '../calc/engine'
import { addMonths, fmtDay, monthStart, MONTHS, parts } from '../lib/dates'
import { kwh, num, pct } from '../lib/format'
import { Seg } from '../ui/bits'

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/* ───────────── Energiefluss: gestapelte Balken ───────────── */

interface Part {
  label: string
  v: number
  cls: string
}

function Stack({ parts: ps, total, scale = 1 }: { parts: Part[]; total: number; scale?: number }) {
  const vis = ps.filter((p) => p.v > total * 0.002)
  return (
    <div className="stack" style={{ width: `${Math.max(2, scale * 100)}%` }}>
      {vis.map((p) => (
        <i
          key={p.label}
          className={p.cls}
          style={{ flexGrow: p.v }}
          title={`${p.label}: ${kwh(p.v)} kWh · ${pct(p.v / total)} %`}
        />
      ))}
    </div>
  )
}

export function Flow({ t, k }: { t: Totals; k: Kpis }) {
  const hasPv = t.nPv > 0 && t.pv > 0.5
  const pvParts: Part[] = [
    { label: 'Haus', v: t.pvHaus, cls: 'a1' },
    { label: 'Speicher', v: t.spL, cls: 'a2' },
    { label: 'Wärmepumpe', v: t.pvWP, cls: 'a3' },
    { label: 'Wallbox', v: t.pvWB, cls: 'a4' },
    { label: 'Netz', v: t.zeP, cls: 'n' },
  ]
  const pvTotal = pvParts.reduce((s, p) => s + p.v, 0)
  const users = [
    {
      name: 'Haus',
      total: Math.max(0, t.haus),
      share: k.pvAnteilHaus,
      parts: [
        { label: 'PV direkt', v: t.pvHaus, cls: 'a1' },
        { label: 'Speicher', v: t.spE, cls: 'a2' },
        { label: 'Netz', v: Math.max(0, t.netzHaus), cls: 'n' },
      ],
    },
    {
      name: 'Wärmepumpe',
      total: t.wp,
      share: k.pvAnteilWP,
      parts: [
        { label: 'PV', v: t.pvWP, cls: 'a1' },
        { label: 'Netz', v: t.netzWP, cls: 'n' },
      ],
    },
    {
      name: 'Wallbox',
      total: t.wb,
      share: k.pvAnteilWB,
      parts: [
        { label: 'PV', v: t.pvWB, cls: 'a1' },
        { label: 'Netz', v: t.netzWB, cls: 'n' },
      ],
    },
  ].filter((u) => u.total > 0.05)
  const max = Math.max(1e-9, ...users.map((u) => u.total))

  return (
    <div className="flow">
      {hasPv && (
        <div className="flow-block">
          <div className="flow-head">
            <span>Wohin der PV-Strom ging</span>
            <span className="num">{kwh(t.pv)} kWh</span>
          </div>
          <Stack parts={pvParts} total={pvTotal} />
          <ul className="legend">
            {pvParts
              .filter((p) => p.v > pvTotal * 0.002)
              .map((p) => (
                <li key={p.label}>
                  <i className={p.cls} />
                  <span>{p.label}</span>
                  <b className="num">{pct(p.v / pvTotal)} %</b>
                  <small className="num">{kwh(p.v)} kWh</small>
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
              <i className="a1" /> PV <i className="a2" /> Speicher <i className="n" /> Netz
            </span>
          </div>
          {users.map((u) => (
            <div className="flow-row" key={u.name}>
              <div className="flow-row-head">
                <span>{u.name}</span>
                <span className="num">
                  {u.share !== undefined && <b>{pct(u.share)} % PV</b>} {kwh(u.total)} kWh
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

/* ───────────── Verlauf: kWh/Tag je Intervall oder Monat ───────────── */

interface Bucket {
  from: number
  to: number
  label: string
  bar: number
  wp?: number
  prev?: number
}

const niceMax = (v: number) => {
  if (v <= 0) return 1
  const p = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / p
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p
}

export function Trend({ daily, from, to, yoy }: { daily: Daily; from: number; to: number; yoy: boolean }) {
  const [serie, setSerie] = useState<'zb' | 'ze'>('zb')
  const [mode, setMode] = useState<'monat' | 'intervall'>('monat')
  const [hover, setHover] = useState<number>()
  const [ref, width] = useWidth<HTMLDivElement>()

  // Kurze Zeiträume sagen wenig aus – dann die letzten 12 Monate zeigen.
  const short = to - from < 85
  const a = short ? Math.max(daily.start, addMonths(to, -12)) : from
  const b = to

  const buckets = useMemo(() => {
    const edges: number[] = [a]
    if (mode === 'monat') {
      let d = addMonths(monthStart(a), 1)
      while (d < b) {
        edges.push(d)
        d = addMonths(d, 1)
      }
    } else {
      for (const p of daily.series.bezug) if (p.day > a && p.day < b) edges.push(p.day)
    }
    edges.push(b)
    const out: Bucket[] = []
    for (let i = 1; i < edges.length; i++) {
      const f = edges[i - 1]
      const t = edges[i]
      if (t <= f) continue
      const s = aggregate(daily, f, t)
      if (!s.days) continue
      const pf = addMonths(f, -12)
      const prev = yoy && mode === 'monat' && pf >= daily.start ? aggregate(daily, pf, addMonths(t, -12)) : undefined
      const p = parts(f)
      out.push({
        from: f,
        to: t,
        label: MONTHS[p.m],
        bar: s[serie] / s.days,
        wp: s.nWp === s.days ? s.wp / s.days : undefined,
        prev: prev && prev.days ? prev[serie] / prev.days : undefined,
      })
    }
    return out
  }, [daily, a, b, mode, serie, yoy])

  const hasWp = buckets.some((x) => x.wp !== undefined)
  const hasPrev = buckets.some((x) => x.prev !== undefined)
  const H = 220
  const padL = 34
  const padR = 8
  const padT = 12
  const padB = 22
  const W = Math.max(280, width)
  const iw = W - padL - padR
  const ih = H - padT - padB
  const max = niceMax(Math.max(1, ...buckets.map((x) => Math.max(x.bar, x.wp ?? 0, x.prev ?? 0))))
  const y = (v: number) => padT + ih - (Math.max(0, v) / max) * ih
  const span = Math.max(1, b - a)
  const pos = (i: number) => {
    const bk = buckets[i]
    if (mode === 'monat') {
      const w = iw / buckets.length
      return { x: padL + i * w, w }
    }
    return { x: padL + ((bk.from - a) / span) * iw, w: ((bk.to - bk.from) / span) * iw }
  }
  const ticks = [0, 0.5, 1].map((f) => f * max)
  const wpPath = buckets
    .map((bk, i) => {
      if (bk.wp === undefined) return ''
      const { x, w } = pos(i)
      const started = i > 0 && buckets[i - 1].wp !== undefined
      return `${started ? 'L' : 'M'}${x.toFixed(1)},${y(bk.wp).toFixed(1)} L${(x + w).toFixed(1)},${y(bk.wp).toFixed(1)}`
    })
    .join(' ')
  const labelEvery = Math.max(1, Math.ceil(buckets.length / Math.max(1, Math.floor(iw / 38))))
  const h = hover !== undefined ? buckets[hover] : undefined
  const name = serie === 'zb' ? 'Bezug' : 'Einspeisung'

  return (
    <div className="trend">
      <div className="trend-ctl">
        <Seg small label="Reihe" value={serie} onChange={setSerie} options={[{ value: 'zb', label: 'Bezug' }, { value: 'ze', label: 'Einspeisung' }]} />
        <Seg small label="Auflösung" value={mode} onChange={setMode} options={[{ value: 'monat', label: 'Monat' }, { value: 'intervall', label: 'Intervall' }]} />
      </div>
      <div className="trend-legend">
        <span>
          <i className={serie === 'zb' ? 'n' : 'a1'} /> {name}
        </span>
        {hasWp && (
          <span>
            <i className="ln" /> Wärmepumpe
          </span>
        )}
        {hasPrev && (
          <span>
            <i className="pv" /> Vorjahr
          </span>
        )}
        <span className="unit">kWh pro Tag</span>
      </div>
      <div className="trend-plot" ref={ref}>
        {width > 0 && (
          <svg
            key={`${serie}-${mode}-${a}-${b}`}
            width={W}
            height={H}
            role="img"
            aria-label={`${name} und Wärmepumpe in kWh pro Tag`}
            onMouseLeave={() => setHover(undefined)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} className="grid" />
                <text x={padL - 8} y={y(t) + 3.5} textAnchor="end" className="tick">
                  {num(t, max < 5 ? 1 : 0)}
                </text>
              </g>
            ))}
            {buckets.map((bk, i) => {
              const { x, w } = pos(i)
              const gap = w > 6 ? 2 : 0.5
              const bw = Math.max(0.5, w - gap)
              const top = y(bk.bar)
              const bh = padT + ih - top
              const r = Math.min(3, bw / 2, bh)
              return (
                <g key={bk.from}>
                  <path
                    className={`bar ${serie === 'zb' ? 'n' : 'a1'}${hover === i ? ' hot' : ''}`}
                    style={{ animationDelay: `${Math.min(i * 8, 120)}ms` }}
                    d={`M${x + gap / 2},${top + bh} v${-(bh - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${bh - r} z`}
                  />
                  {bk.prev !== undefined && (
                    <line className="prev" x1={x + gap / 2 + 1} x2={x + gap / 2 + bw - 1} y1={y(bk.prev)} y2={y(bk.prev)} />
                  )}
                  {mode === 'monat' && i % labelEvery === 0 && (
                    <text x={x + w / 2} y={H - 6} textAnchor="middle" className="tick">
                      {bk.label}
                    </text>
                  )}
                </g>
              )
            })}
            {mode === 'intervall' &&
              buckets
                .filter((bk, i) => i === 0 || parts(bk.from).m !== parts(buckets[i - 1].from).m)
                .filter((_, i, arr) => i % Math.max(1, Math.ceil(arr.length / Math.max(1, Math.floor(iw / 44)))) === 0)
                .map((bk) => (
                  <text key={bk.from} x={padL + ((bk.from - a) / span) * iw} y={H - 6} className="tick">
                    {bk.label}
                  </text>
                ))}
            {hasWp && <path d={wpPath} className="wp-line" pathLength={1} />}
            {buckets.map((bk, i) => {
              const { x, w } = pos(i)
              return (
                <rect
                  key={bk.from}
                  x={x}
                  y={padT}
                  width={Math.max(1, w)}
                  height={ih}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                />
              )
            })}
          </svg>
        )}
      </div>
      <p className="trend-tip num" aria-live="polite">
        {h ? (
          <>
            <span>
              {fmtDay(h.from)} – {fmtDay(h.to)}
            </span>
            <span>
              {name} <b>{num(h.bar, 1)}</b>
            </span>
            {h.wp !== undefined && (
              <span>
                WP <b>{num(h.wp, 1)}</b>
              </span>
            )}
            {h.prev !== undefined && (
              <span>
                Vorjahr <b>{num(h.prev, 1)}</b>
              </span>
            )}
          </>
        ) : (
          <span className="dim">
            {short ? 'Letzte 12 Monate · ' : ''}Balken antippen für Werte
          </span>
        )}
      </p>
    </div>
  )
}
