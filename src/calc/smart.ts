import { addMonths, dayOf, daysInMonth, monthStart, parts } from '../lib/dates'
import type { Model } from '../types'
import { aggregate, aggregateCustom, customCostDay, feedInAt, grundProTag, kpis, tariffAt, wpSeparatAm, type Daily } from './engine'
import { abschlagSumme } from './forecast'
import { customMeters, meterName } from './meters'

/* ───────────── Wetter ───────────── */

/** Tageswetter: Mitteltemperatur °C und Globalstrahlung kWh/m² */
export interface Wx {
  t: number
  rad: number
}
export type WxMap = Map<number, Wx>

/** Klimamittel je Tag des Jahres (Index 0 … 365). */
export interface Climate {
  t: number[]
  rad: number[]
  /** 'ort' = Klimamittel des Standorts, 'de' = typisches Klima in Deutschland */
  source: 'ort' | 'de'
  label: string
}

export const doy = (day: number) => day - dayOf(parts(day).y, 0, 1)

/** Eingebautes Klimamittel für Deutschland – Rückfall ohne Standort oder Netz. */
export const GERMANY: Climate = (() => {
  const t: number[] = []
  const rad: number[] = []
  for (let i = 0; i < 366; i++) {
    t.push(9.6 + 9.4 * Math.sin((2 * Math.PI * (i - 110)) / 365))
    rad.push(2.9 + 2.35 * Math.cos((2 * Math.PI * (i - 172)) / 365))
  }
  return { t, rad, source: 'de', label: 'typischem Klima in Deutschland' }
})()

/** Klimamittel aus Tageswerten mehrerer Jahre, mit ±7 Tagen geglättet. */
export function climateFrom(rows: { day: number; t: number; rad: number }[], label: string): Climate | undefined {
  if (rows.length < 365) return undefined
  const sumT = new Array(366).fill(0)
  const sumR = new Array(366).fill(0)
  const n = new Array(366).fill(0)
  for (const r of rows) {
    const i = Math.min(365, doy(r.day))
    sumT[i] += r.t
    sumR[i] += r.rad
    n[i]++
  }
  const raw = (arr: number[]) => arr.map((s, i) => (n[i] ? s / n[i] : NaN))
  const smooth = (arr: number[]) =>
    arr.map((_, i) => {
      let s = 0
      let c = 0
      for (let k = -7; k <= 7; k++) {
        const v = arr[(i + k + 366) % 366]
        if (!Number.isNaN(v)) {
          s += v
          c++
        }
      }
      return c ? s / c : 0
    })
  return { t: smooth(raw(sumT)), rad: smooth(raw(sumR)), source: 'ort', label }
}

export function wxAt(day: number, wx: WxMap, clim: Climate): Wx & { gemessen: boolean } {
  const w = wx.get(day)
  if (w) return { ...w, gemessen: true }
  const i = Math.min(365, doy(day))
  return { t: clim.t[i], rad: clim.rad[i], gemessen: false }
}

export const hgt = (t: number, grenze: number) => Math.max(0, grenze - t)

/** Heizgradtage im Zeitraum [from, to). */
export function hgtSum(from: number, to: number, wx: WxMap, clim: Climate, grenze: number) {
  let s = 0
  for (let d = from; d < to; d++) s += hgt(wxAt(d, wx, clim).t, grenze)
  return s
}

/* ───────────── Modelle, aus den eigenen Daten gelernt ───────────── */

export interface WpModel {
  /** Grundlast kWh/Tag (Warmwasser, Standby) */
  a: number
  /** kWh je Heizgradtag */
  b: number
  n: number
  fitted: boolean
}

/**
 * Wärmepumpe: kWh/Tag = a + b · Heizgradtage.
 * Gewichtete Regression über die Ableseintervalle (Gewicht = Tage).
 * Zu wenig Daten → Startwerte aus der beheizten Fläche.
 */
export function fitWp(daily: Daily, wx: WxMap, clim: Climate, grenze: number, flaeche?: number): WpModel {
  const a0 = 2.5
  const b0 = Math.max(0.5, (flaeche || 140) * 0.011)
  const pts = daily.series.wp.filter((p) => p.day >= daily.start && p.day <= daily.end)
  const xs: { x: number; y: number; w: number }[] = []
  for (let i = 1; i < pts.length; i++) {
    const n = pts[i].day - pts[i - 1].day
    if (n < 1) continue
    xs.push({ x: hgtSum(pts[i - 1].day, pts[i].day, wx, clim, grenze) / n, y: (pts[i].v - pts[i - 1].v) / n, w: n })
  }
  if (!xs.length) return { a: a0, b: b0, n: 0, fitted: false }
  const W = xs.reduce((s, p) => s + p.w, 0)
  const mx = xs.reduce((s, p) => s + p.w * p.x, 0) / W
  const my = xs.reduce((s, p) => s + p.w * p.y, 0) / W
  const sxx = xs.reduce((s, p) => s + p.w * (p.x - mx) ** 2, 0)
  const sxy = xs.reduce((s, p) => s + p.w * (p.x - mx) * (p.y - my), 0)
  const spread = Math.max(...xs.map((p) => p.x)) - Math.min(...xs.map((p) => p.x))
  if (xs.length >= 4 && spread >= 3 && sxx > 0) {
    const b = sxy / sxx
    const a = my - b * mx
    if (b > 0) {
      if (a >= 0) return { a, b, n: xs.length, fitted: true }
      // Grundlast kann nicht negativ sein: Gerade durch den Ursprung
      const b2 = xs.reduce((s, p) => s + p.w * p.x * p.y, 0) / xs.reduce((s, p) => s + p.w * p.x * p.x, 0)
      return { a: 0, b: b2, n: xs.length, fitted: true }
    }
  }
  // Zu wenig Streuung: Startwert für a behalten, b an den bisherigen Verbrauch anpassen
  const b = mx > 0.5 ? Math.max(0.2, (my - a0) / mx) : b0
  return { a: mx > 0.5 ? a0 : my, b, n: xs.length, fitted: false }
}

export interface PrModel {
  pr: number
  fitted: boolean
}

/** PV: kWh = kWp × Einstrahlung × Performance Ratio. PR aus den eigenen Daten, Startwert 0,8. */
export function fitPr(daily: Daily, wx: WxMap, clim: Climate, kwp?: number): PrModel {
  if (!kwp) return { pr: 0.8, fitted: false }
  let pv = 0
  let soll = 0
  let n = 0
  let nKlima = 0
  for (let d = daily.start; d < daily.end; d++) {
    const s = daily.days[d - daily.start]
    if (!s.nPv) continue
    const w = wxAt(d, wx, clim)
    pv += s.pv
    soll += kwp * w.rad
    n++
    if (!w.gemessen) nKlima++
  }
  // Mit Klimamitteln nur, wenn ein ganzes Jahr die Wetterschwankungen ausgleicht
  const ok = soll > 0 && (n - nKlima >= 30 || n >= 330)
  if (!ok) return { pr: 0.8, fitted: false }
  return { pr: Math.min(1.5, Math.max(0.3, pv / soll)), fitted: true }
}

export interface EvModel {
  c: number
  fitted: boolean
}

/**
 * PV-Eigenverbrauch pro Monat: EV = c · min(PV, Verbrauch).
 * c bildet Speicher und Tag/Nacht-Versatz ab und wird aus vollen Monaten gelernt.
 */
export function fitEv(daily: Daily): EvModel {
  let ev = 0
  let cap = 0
  let n = 0
  for (let a = monthStart(daily.start); a < daily.end; a = addMonths(a, 1)) {
    const b = addMonths(a, 1)
    if (a < daily.start || b > daily.end) continue
    const t = aggregate(daily, a, b)
    if (t.nPv < t.days) continue
    const v = t.bezugP + t.pv - t.zeP - (t.nSep ? t.wp : 0)
    ev += t.pv - t.zeP
    cap += Math.min(t.pv, v)
    n++
  }
  if (n < 2 || cap <= 0) return { c: 0.85, fitted: false }
  return { c: Math.min(1, Math.max(0.3, ev / cap)), fitted: true }
}

/**
 * Tagesrate einer Größe mit Vorjahresprofil: Mittel der letzten bis zu 365 Tage,
 * bei einem vollen Jahr gewichtet mit dem Monatsprofil.
 */
export function profile(daily: Daily, get: (i: number) => number): (day: number) => number {
  const len = Math.min(365, daily.end - daily.start)
  const from = daily.end - len
  let sum = 0
  let n = 0
  const mSum = new Array(12).fill(0)
  const mN = new Array(12).fill(0)
  for (let d = from; d < daily.end; d++) {
    const v = get(d - daily.start)
    if (Number.isNaN(v)) continue
    sum += v
    n++
    const m = parts(d).m
    mSum[m] += v
    mN[m]++
  }
  if (!n) return () => 0
  const base = sum / n
  if (len < 330 || base <= 0) return () => base
  const f = mSum.map((s, m) => (mN[m] >= 10 ? s / mN[m] / base : 1))
  return (day) => base * f[parts(day).m]
}

/* ───────────── Prognose ───────────── */

export interface Saldo {
  kosten: number
  gezahlt: number
  kommend: number
  /** > 0 Nachzahlung, < 0 Gutschrift */
  differenz: number
  lo: number
  hi: number
}

export interface MonthForecast {
  start: number
  /** Anteil prognostizierter Tage */
  fc: number
  pv: number
  wp: number
  haus: number
  wb: number
  bezug: number
  einsp: number
  kosten: number
  verg: number
}

export interface SmartForecast {
  year: number
  /** erster Prognosetag */
  from: number
  yearEnd: number
  next12End: number
  months: MonthForecast[]
  jahr: { bezug: number; einsp: number; pv: number; wp: number; kosten: number; verg: number; eigene: number }
  next12: { bezug: number; einsp: number; pv: number; kosten: number; verg: number; eigene: number; abschlaege: number; einspAbschlaege: number }
  strom: Saldo
  /** Einspeisung: > 0 Nachzahlung an dich, < 0 Rückforderung */
  einsp: { verg: number; erhalten: number; kommend: number; saldo: number; lo: number; hi: number } | undefined
  eigene: (Saldo & { id: string; name: string })[]
  /** Gesamtsaldo: > 0 du zahlst nach, < 0 du bekommst Geld */
  gesamt: { differenz: number; lo: number; hi: number }
  spanne: number
  basis: string
  wp: WpModel
  pr: PrModel
  ev: EvModel
  teiljahr: boolean
}

interface Ctx {
  wx: WxMap
  clim: Climate
  today: number
}

const fmt1 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const fmt2 = (v: number) => v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * Prognose bis 31.12. und für die nächsten 12 Monate.
 * WP über Heizgradtage, PV über Einstrahlung, Haus und Wallbox über das Vorjahresprofil;
 * Netzbezug = Verbrauch − erwarteter Eigenverbrauch pro Monat. Nie naiv linear.
 */
export function smartForecast(daily: Daily, m: Model, ctx: Ctx): SmartForecast | undefined {
  if (daily.end - daily.start < 7) return undefined
  const { wx, clim, today } = ctx
  const s = m.settings
  const house = s.house
  const end = daily.end
  const year = parts(end - 1).y
  const y0 = dayOf(year, 0, 1)
  const yearEnd = dayOf(year + 1, 0, 1)
  const next12End = end + 365
  const horizon = Math.max(yearEnd, next12End)

  // Über das Vertragsende hinaus rechnet die Prognose mit dem zuletzt gültigen Tarif weiter.
  const latest = <T extends { from: string }>(xs: T[]) => [...xs].sort((a, b) => (a.from < b.from ? 1 : -1))[0]
  const tarif = (d: number, kind: 'haushalt' | 'wp' = 'haushalt') =>
    tariffAt(m.tariffs, d, kind) ?? latest(m.tariffs.filter((t) => t.kind === kind))
  const verguetung = (d: number) => feedInAt(m.feedins, d) ?? latest(m.feedins)
  const hasWp = daily.days.some((d) => d.nWp)
  const hasPv = daily.days.some((d) => d.nPv)
  const wpM = fitWp(daily, wx, clim, s.heizgrenze, house.flaeche)
  const prM = fitPr(daily, wx, clim, house.kwp)
  const evM = fitEv(daily)
  const at = (k: 'haus' | 'wb' | 'pv' | 'wp', need: 'nPv' | 'nWb' | 'nWp' | null) => (i: number) => {
    const d = daily.days[i]
    return need && !d[need] ? NaN : d[k]
  }
  const hausP = profile(daily, at('haus', null))
  const wbP = profile(daily, at('wb', 'nWb'))
  const pvP = profile(daily, at('pv', 'nPv'))
  const customs = customMeters(m)
  const custP = Object.fromEntries(
    customs.map((c) => [c.id, profile(daily, (i) => daily.custom[c.id]?.qty[i] ?? NaN)]),
  )
  const custHas = Object.fromEntries(customs.map((c) => [c.id, aggregateCustom(daily, c.id, daily.start, end).n > 0]))

  // Prognose je Tag, zu Kalendermonaten gebündelt
  type Day = { day: number; pv: number; wp: number; haus: number; wb: number; v: number; sep: boolean }
  const byMonth = new Map<number, Day[]>()
  for (let d = end; d < horizon; d++) {
    const w = wxAt(d, wx, clim)
    const pv = house.kwp && (prM.fitted || !hasPv) ? house.kwp * w.rad * prM.pr : hasPv ? pvP(d) : 0
    const wp = hasWp ? wpM.a + wpM.b * hgt(w.t, s.heizgrenze) : 0
    const haus = hausP(d)
    const wb = wbP(d)
    const sep = wpSeparatAm(m, d)
    const row = { day: d, pv, wp, haus, wb, v: haus + wb + (sep ? 0 : wp), sep }
    const ms = monthStart(d)
    if (!byMonth.has(ms)) byMonth.set(ms, [])
    byMonth.get(ms)!.push(row)
  }

  // Tageswerte für Netzbezug, Einspeisung, Kosten
  const fut = new Map<number, { bezug: number; einsp: number; kosten: number; verg: number; pv: number; wp: number; haus: number; wb: number; eigene: number }>()
  for (const days of byMonth.values()) {
    const PV = days.reduce((a, d) => a + d.pv, 0)
    const V = days.reduce((a, d) => a + d.v, 0)
    const EV = Math.min(PV, V, evM.c * Math.min(PV, V))
    const bezugM = V - EV
    const einspM = PV - EV
    for (const d of days) {
      const bez = V > 0 ? (bezugM * d.v) / V : 0
      const ein = PV > 0 ? (einspM * d.pv) / PV : 0
      const t = tarif(d.day)
      let kosten = (bez * (t?.arbeitspreis ?? 0)) / 100 + grundProTag(t, d.day)
      let bezug = bez
      if (d.sep) {
        const tw = tarif(d.day, 'wp')
        kosten += (d.wp * (tw?.arbeitspreis ?? 0)) / 100 + grundProTag(tw, d.day)
        bezug += d.wp
      }
      let eigene = 0
      for (const c of customs) {
        if (!custHas[c.id]) continue
        const k = customCostDay(c.costs, d.day, custP[c.id](d.day), (id) => (custP[id] ? custP[id](d.day) : 0))
        eigene += k.grund + k.variabel
      }
      fut.set(d.day, {
        bezug, einsp: ein, kosten, eigene, pv: d.pv, wp: d.wp, haus: d.haus, wb: d.wb,
        verg: (ein * (verguetung(d.day)?.ct ?? 0)) / 100,
      })
    }
  }
  const sumFut = (a: number, b: number) => {
    const o = { bezug: 0, einsp: 0, kosten: 0, verg: 0, pv: 0, wp: 0, eigene: 0 }
    for (let d = Math.max(a, end); d < b; d++) {
      const f = fut.get(d)
      if (!f) continue
      o.bezug += f.bezug
      o.einsp += f.einsp
      o.kosten += f.kosten
      o.verg += f.verg
      o.pv += f.pv
      o.wp += f.wp
      o.eigene += f.eigene
    }
    return o
  }

  // Ist-Werte im laufenden Jahr
  const from = Math.max(y0, daily.start)
  const ist = aggregate(daily, from, end)
  const istK = kpis(ist)
  const istEigene = customs.map((c) => ({ c, t: aggregateCustom(daily, c.id, from, end) }))
  const fy = sumFut(end, yearEnd)
  const f12 = sumFut(end, next12End)

  // Unsicherheit der Prognose (gilt für den prognostizierten Teil)
  const span = daily.end - daily.start
  const spanne =
    0.06 +
    (hasWp && !wpM.fitted ? 0.08 : 0) +
    (house.kwp && !prM.fitted ? 0.05 : 0) +
    (span < 330 ? 0.05 : 0) +
    (clim.source === 'de' ? 0.03 : 0)

  const cut = Math.min(Math.max(today + 1, from), yearEnd)
  const gezahlt = abschlagSumme(m.abschlaege, from, cut)
  const kommend = abschlagSumme(m.abschlaege, cut, yearEnd)
  const kostenJahr = istK.kosten + fy.kosten
  const strom: Saldo = {
    kosten: kostenJahr, gezahlt, kommend,
    differenz: kostenJahr - gezahlt - kommend,
    lo: kostenJahr - fy.kosten * spanne - gezahlt - kommend,
    hi: kostenJahr + fy.kosten * spanne - gezahlt - kommend,
  }

  const vergJahr = ist.verg + fy.verg
  const einsp = m.feedinAbschlaege.length
    ? (() => {
        const erhalten = abschlagSumme(m.feedinAbschlaege, from, cut)
        const komm = abschlagSumme(m.feedinAbschlaege, cut, yearEnd)
        const saldo = vergJahr - erhalten - komm
        return { verg: vergJahr, erhalten, kommend: komm, saldo, lo: saldo - fy.verg * spanne, hi: saldo + fy.verg * spanne }
      })()
    : undefined

  const eigene = istEigene
    .filter(({ c }) => c.costs && (c.costs.abschlaege.length || c.costs.parts.length || c.costs.grund.length))
    .map(({ c, t }) => {
      let futK = 0
      for (let d = end; d < yearEnd; d++) {
        if (!custHas[c.id]) break
        const k = customCostDay(c.costs, d, custP[c.id](d), (id) => (custP[id] ? custP[id](d) : 0))
        futK += k.grund + k.variabel
      }
      const kosten = t.kosten + futK
      const gz = abschlagSumme(c.costs!.abschlaege, from, cut)
      const km = abschlagSumme(c.costs!.abschlaege, cut, yearEnd)
      return {
        id: c.id, name: meterName(c), kosten, gezahlt: gz, kommend: km,
        differenz: kosten - gz - km, lo: kosten - futK * spanne - gz - km, hi: kosten + futK * spanne - gz - km,
      }
    })

  const gesamtD =
    (m.abschlaege.length ? strom.differenz : 0) - (einsp?.saldo ?? 0) + eigene.reduce((a, e) => a + (e.gezahlt + e.kommend > 0 ? e.differenz : 0), 0)
  const spread =
    (m.abschlaege.length ? strom.hi - strom.differenz : 0) +
    (einsp ? einsp.hi - einsp.saldo : 0) +
    eigene.reduce((a, e) => a + (e.hi - e.differenz), 0)

  // Monatsübersicht: Januar des Jahres bis Ende der 12-Monats-Prognose
  const months: MonthForecast[] = []
  for (let a = Math.max(y0, monthStart(daily.start)); a < next12End; a = addMonths(a, 1)) {
    const b = addMonths(a, 1)
    const t = aggregate(daily, a, Math.min(b, end))
    const f = sumFut(a, b)
    const fd = Math.max(0, Math.min(b, next12End) - Math.max(a, end))
    const tot = b - a
    months.push({
      start: a,
      fc: fd / tot,
      pv: (t.nPv ? t.pv : 0) + f.pv,
      wp: t.wp + f.wp,
      haus: t.haus + sumKey(fut, 'haus', Math.max(a, end), b),
      wb: t.wb + sumKey(fut, 'wb', Math.max(a, end), b),
      bezug: t.bezug + f.bezug,
      einsp: t.ze + f.einsp,
      kosten: kpis(t).kosten + f.kosten,
      verg: t.verg + f.verg,
    })
  }

  const climText = clim.source === 'ort' ? `Klimamittel der letzten 10 Jahre für ${clim.label}` : clim.label
  const wxDays = [...wx.keys()].filter((d) => d >= end).length
  const parts_: string[] = []
  parts_.push(`${span} Tagen eigener Messdaten`)
  parts_.push(wxDays ? `der Wettervorhersage für ${wxDays} Tage und danach dem ${climText}` : `dem ${climText}`)
  const modelText: string[] = []
  if (hasWp)
    modelText.push(
      wpM.fitted
        ? `Wärmepumpe aus ${wpM.n} Intervallen gelernt (${fmt1(wpM.a)} kWh Grundlast + ${fmt2(wpM.b)} kWh je Heizgradtag)`
        : `Wärmepumpe mit Startwerten (${fmt2(wpM.b)} kWh je Heizgradtag)`,
    )
  if (house.kwp) modelText.push(`PV mit Performance Ratio ${fmt2(prM.pr)}${prM.fitted ? '' : ' (Startwert)'}`)
  else if (hasPv) modelText.push('PV nach Vorjahresprofil – mit kWp unter „Haus und Anlage“ wird es wetterbasiert')
  const basis = `Beruht auf ${parts_.join(', ')}. ${modelText.length ? modelText.join('; ') + '.' : ''}`.trim()

  return {
    year, from: end, yearEnd, next12End, months,
    jahr: {
      bezug: ist.bezug + fy.bezug, einsp: ist.ze + fy.einsp, pv: (ist.nPv ? ist.pv : 0) + fy.pv, wp: ist.wp + fy.wp,
      kosten: kostenJahr, verg: vergJahr, eigene: istEigene.reduce((a, e) => a + e.t.kosten, 0) + fy.eigene,
    },
    next12: {
      bezug: f12.bezug, einsp: f12.einsp, pv: f12.pv, kosten: f12.kosten, verg: f12.verg, eigene: f12.eigene,
      abschlaege: abschlagSumme(m.abschlaege, end, next12End),
      einspAbschlaege: abschlagSumme(m.feedinAbschlaege, end, next12End),
    },
    strom, einsp, eigene,
    gesamt: { differenz: gesamtD, lo: gesamtD - spread, hi: gesamtD + spread },
    spanne, basis, wp: wpM, pr: prM, ev: evM,
    teiljahr: from > y0,
  }
}

function sumKey(fut: Map<number, Record<string, number>>, k: string, a: number, b: number) {
  let s = 0
  for (let d = a; d < b; d++) s += fut.get(d)?.[k] ?? 0
  return s
}

/* ───────────── PV-Anlagen-Check und WP-Effizienz ───────────── */

export interface PvCheckRow {
  start: number
  days: number
  ist: number
  soll: number
  pct: number
}

/** Ist-Ertrag gegen wetterbasiertes Soll je Monat (nur mit gemessenem Wetter). */
export function pvCheck(daily: Daily, wx: WxMap, kwp: number | undefined, pr: PrModel) {
  if (!kwp) return undefined
  const prRef = pr.fitted ? pr.pr : 0.8
  const rows: PvCheckRow[] = []
  for (let a = monthStart(daily.start); a < daily.end; a = addMonths(a, 1)) {
    const b = Math.min(addMonths(a, 1), daily.end)
    const a2 = Math.max(a, daily.start)
    let ist = 0
    let rad = 0
    let n = 0
    let ok = true
    for (let d = a2; d < b; d++) {
      const s = daily.days[d - daily.start]
      const w = wx.get(d)
      if (!s.nPv || !w) {
        ok = false
        break
      }
      ist += s.pv
      rad += w.rad
      n++
    }
    const full = parts(a).y === parts(b - 1).y && n >= Math.min(10, daysInMonth(parts(a).y, parts(a).m))
    if (!ok || !full || rad <= 0) continue
    const soll = kwp * rad * prRef
    rows.push({ start: a, days: n, ist, soll, pct: ist / soll })
  }
  if (!rows.length) return undefined
  let alarm = false
  for (let i = 1; i < rows.length; i++) {
    const consecutive = addMonths(rows[i - 1].start, 1) === rows[i].start
    if (consecutive && rows[i].pct < 0.85 && rows[i - 1].pct < 0.85 && i >= rows.length - 2) alarm = true
  }
  return { rows, alarm, prRef }
}

export function wpEffizienz(daily: Daily, from: number, to: number, wx: WxMap, clim: Climate, grenze: number) {
  const t = aggregate(daily, from, to)
  if (!t.nWp || t.wp < 1) return undefined
  let hg = 0
  for (let d = t.from; d < t.to; d++) if (daily.days[d - daily.start].nWp) hg += hgt(wxAt(d, wx, clim).t, grenze)
  return {
    hgt: hg,
    kwhProHgt: hg > 5 ? t.wp / hg : undefined,
    jaz: kpis(t).jaz,
  }
}
