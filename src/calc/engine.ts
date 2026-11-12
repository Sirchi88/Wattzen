import { daysInMonth, parts, toDay } from '../lib/dates'
import type { FeedIn, MeterChange, MeterKey, Model, Reading, SplitMethod, Tariff } from '../types'
import { METERS } from '../types'

export type SeriesKey = MeterKey | 'km'
export interface Point {
  day: number
  v: number
}
export type Series = Record<SeriesKey, Point[]>

const KEYS: SeriesKey[] = [...METERS.map((m) => m.key), 'km']

/* ───────────── 1. Durchgehende Zählerreihen (Zählerwechsel) ───────────── */

/** Summe der Sprünge aller Wechsel eines Zählers bis einschließlich `day`. */
export function offsetAt(changes: MeterChange[], meter: SeriesKey, day: number, inclusive = true) {
  let off = 0
  for (const c of changes) {
    if (c.meter !== meter) continue
    const cd = toDay(c.date)
    if (cd < day || (inclusive && cd === day)) off += c.endOld - c.startNew
  }
  return off
}

/**
 * Baut je Zähler eine durchgehende, nach Tagen sortierte Reihe.
 * Ablesungen ab dem Wechseldatum gelten als Stände des neuen Zählers;
 * der Wechsel selbst liefert einen Stützpunkt (Endstand alt).
 */
export function buildSeries(readings: Reading[], changes: MeterChange[]): Series {
  const out = {} as Series
  for (const key of KEYS) {
    const byDay = new Map<number, number>()
    const put = (day: number, v: number) => {
      const old = byDay.get(day)
      byDay.set(day, old === undefined ? v : Math.max(old, v))
    }
    for (const r of readings) {
      const raw = key === 'km' ? r.km : r.values[key]
      if (raw === undefined || raw === null || Number.isNaN(raw)) continue
      const day = toDay(r.date)
      put(day, raw + offsetAt(changes, key, day))
    }
    for (const c of changes) {
      if (c.meter !== key) continue
      const day = toDay(c.date)
      put(day, c.endOld + offsetAt(changes, key, day, false))
    }
    out[key] = [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([day, v]) => ({ day, v }))
  }
  return out
}

/* ───────────── 2. Lineare Interpolation ───────────── */

/** Zählerstand am Tag `day`, linear zwischen den Nachbar-Ablesungen. Außerhalb: undefined. */
export function valueAt(points: Point[], day: number): number | undefined {
  const n = points.length
  if (!n || day < points[0].day || day > points[n - 1].day) return undefined
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].day <= day) lo = mid
    else hi = mid
  }
  const a = points[lo]
  const b = points[hi]
  if (day === a.day) return a.v
  if (day === b.day) return b.v
  return a.v + ((b.v - a.v) * (day - a.day)) / (b.day - a.day)
}

/* ───────────── 3. Aufteilung des PV-Stroms X auf WP und Wallbox ───────────── */

export interface Split {
  pvWP: number
  pvWB: number
  /** PV-Strom, der bei keinem Verbraucher unterkommt → Plausibilitätswarnung */
  rest: number
}

export function splitX(x: number, wp: number, wb: number, f: number, method: SplitMethod): Split {
  x = Math.max(0, x)
  wp = Math.max(0, wp)
  wb = Math.max(0, wb)
  let pvWP: number
  let pvWB: number
  if (method === 'wbZuerst') {
    pvWB = Math.min(x, wb)
    pvWP = Math.min(x - pvWB, wp)
  } else {
    const gWP = wp * (method === 'anteilig' ? 1 : f)
    const g = gWP + wb
    pvWP = g > 0 ? (x * gWP) / g : 0
    pvWB = x - pvWP
    // Überlauf eines Verbrauchers dem anderen zuschlagen (bis zu dessen Verbrauch)
    if (pvWP > wp) {
      pvWB += pvWP - wp
      pvWP = wp
    }
    if (pvWB > wb) {
      pvWP = Math.min(wp, pvWP + (pvWB - wb))
      pvWB = wb
    }
  }
  return { pvWP, pvWB, rest: Math.max(0, x - pvWP - pvWB) }
}

/* ───────────── 4. Tarife ───────────── */

function validAt<T extends { from: string; to?: string }>(items: T[], day: number): T | undefined {
  let best: T | undefined
  let bestFrom = -Infinity
  for (const t of items) {
    const from = toDay(t.from)
    if (from > day) continue
    if (t.to && toDay(t.to) < day) continue
    if (from >= bestFrom) {
      best = t
      bestFrom = from
    }
  }
  return best
}

export const tariffAt = (tariffs: Tariff[], day: number, kind: Tariff['kind'] = 'haushalt') =>
  validAt(tariffs.filter((t) => t.kind === kind), day)

export const feedInAt = (feedins: FeedIn[], day: number) => validAt(feedins, day)

/** Grundgebühr eines Tages: Monatsbetrag / Tage des Monats (ein voller Monat ergibt exakt den Betrag). */
export const grundProTag = (t: Tariff | undefined, day: number) => {
  if (!t) return 0
  const p = parts(day)
  return t.grundgebuehr / daysInMonth(p.y, p.m)
}

export const wpSeparatAm = (m: Pick<Model, 'settings'>, day: number) =>
  m.settings.wpTarifAktiv && (!m.settings.wpTarifSeit || day >= toDay(m.settings.wpTarifSeit))

/* ───────────── 5. Tageswerte ───────────── */

const ZERO = {
  /** Hauptzähler */
  zb: 0, ze: 0,
  /** Netzbezug gesamt (inkl. WP, wenn sie ein eigener Netzanschluss ist) */
  bezug: 0,
  pv: 0, wrE: 0, wrH: 0, spL: 0, spE: 0, wp: 0, wb: 0, km: 0,
  /** Anzahl Tage, an denen der jeweilige Wert vorliegt */
  nPv: 0, nSp: 0, nWp: 0, nWb: 0, nWrE: 0, nKm: 0, nNoTariff: 0, nSep: 0,
  /** Bezug / Einspeisung / Wallbox nur an Tagen mit PV- bzw. km-Daten (für Quoten) */
  bezugP: 0, zeP: 0, wbKm: 0,
  x: 0, pvWP: 0, pvWB: 0, rest: 0,
  netzWP: 0, netzWB: 0, netzHaus: 0,
  /** PV direkt ins Haus (ohne Umweg Speicher) und Hausverbrauch gesamt */
  pvHaus: 0, haus: 0,
  kHaus: 0, kWP: 0, kWB: 0, kGrund: 0, kWPGrund: 0,
  verg: 0, ersparnis: 0,
}
export type Sums = typeof ZERO
const SUM_KEYS = Object.keys(ZERO) as (keyof Sums)[]

export interface Daily {
  /** erster Tag mit Daten */
  start: number
  /** Tag der letzten Ablesung (exklusiv) */
  end: number
  days: Sums[]
  series: Series
  readingDays: Set<number>
}

function rates(points: Point[], start: number, end: number): Float64Array {
  const r = new Float64Array(Math.max(0, end - start)).fill(NaN)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const rate = (b.v - a.v) / (b.day - a.day)
    for (let d = Math.max(a.day, start); d < Math.min(b.day, end); d++) r[d - start] = rate
  }
  return r
}

export function computeDaily(m: Model): Daily {
  const series = buildSeries(m.readings, m.changes)
  const readingDays = new Set(m.readings.map((r) => toDay(r.date)))
  const zb = series.bezug
  const ze = series.einsp
  if (zb.length < 2 || ze.length < 2) return { start: 0, end: 0, days: [], series, readingDays }
  const start = Math.max(zb[0].day, ze[0].day)
  const end = Math.min(zb[zb.length - 1].day, ze[ze.length - 1].day)
  if (end <= start) return { start: 0, end: 0, days: [], series, readingDays }

  const R = {} as Record<SeriesKey, Float64Array>
  for (const k of KEYS) R[k] = rates(series[k], start, end)
  const haushalt = m.tariffs.filter((t) => t.kind === 'haushalt')
  const wpTarife = m.tariffs.filter((t) => t.kind === 'wp')

  const days: Sums[] = []
  for (let day = start; day < end; day++) {
    const i = day - start
    const has = (k: SeriesKey) => !Number.isNaN(R[k][i])
    const val = (k: SeriesKey) => (has(k) ? R[k][i] : 0)
    const d: Sums = { ...ZERO }
    d.zb = val('bezug')
    d.ze = val('einsp')
    d.pv = val('pv')
    d.wrE = val('wrEinsp')
    d.wrH = val('wrHaus')
    d.wp = val('wp')
    d.wb = val('wb')
    d.km = val('km')
    d.nPv = +has('pv')
    d.nWp = +has('wp')
    d.nWb = +has('wb')
    d.nWrE = +has('wrEinsp')
    d.nKm = +has('km')
    const sp = has('spLaden') && has('spEntladen')
    d.nSp = +sp
    if (sp) {
      d.spL = val('spLaden')
      d.spE = val('spEntladen')
    }

    const sep = wpSeparatAm(m, day)
    d.nSep = +sep
    d.bezug = d.zb + (sep ? d.wp : 0)

    // PV-Strom hinter dem WR-Messpunkt, der nicht am Hauptzähler ankam
    d.x = d.nWrE ? Math.max(0, d.wrE - d.ze) : 0
    const f = m.settings.factors[parts(day).m] ?? 0
    // Eigener WP-Netzanschluss: die WP bekommt keinen PV-Strom, alles geht an die Wallbox.
    const s = sep
      ? splitX(d.x, 0, d.wb, 0, 'wbZuerst')
      : splitX(d.x, d.wp, d.wb, f, m.settings.splitMethod)
    d.pvWP = s.pvWP
    d.pvWB = s.pvWB
    d.rest = s.rest
    d.netzWP = d.wp - d.pvWP
    d.netzWB = d.wb - d.pvWB
    d.netzHaus = d.zb - d.netzWB - (sep ? 0 : d.netzWP)

    if (d.nPv) {
      d.bezugP = d.bezug
      d.zeP = d.ze
      d.pvHaus = Math.max(0, d.pv - d.ze - d.pvWP - d.pvWB - d.spL)
    }
    if (d.nKm) d.wbKm = d.wb
    d.haus = d.netzHaus + d.pvHaus + d.spE

    const t = validAt(haushalt, day)
    if (!t) d.nNoTariff = 1
    const ap = (t?.arbeitspreis ?? 0) / 100
    d.kHaus = d.netzHaus * ap
    d.kWB = d.netzWB * ap
    d.kGrund = grundProTag(t, day)
    if (sep) {
      const tw = validAt(wpTarife, day)
      d.kWP = (d.wp * (tw?.arbeitspreis ?? 0)) / 100
      d.kWPGrund = grundProTag(tw, day)
    } else {
      d.kWP = d.netzWP * ap
    }
    d.verg = (d.ze * (feedInAt(m.feedins, day)?.ct ?? 0)) / 100
    if (d.nPv) d.ersparnis = (d.pv - d.ze) * ap
    days.push(d)
  }
  return { start, end, days, series, readingDays }
}

/* ───────────── 6. Zeitraum-Summen und Kennzahlen ───────────── */

export interface Totals extends Sums {
  from: number
  to: number
  days: number
}

/** Summiert die Tage [from, to). Der Zeitraum wird auf den Datenbereich begrenzt. */
export function aggregate(daily: Daily, from: number, to: number): Totals {
  const a = Math.max(from, daily.start)
  const b = Math.min(to, daily.end)
  const t = { ...ZERO, from: a, to: Math.max(a, b), days: Math.max(0, b - a) } as Totals
  for (let day = a; day < b; day++) {
    const d = daily.days[day - daily.start]
    for (const k of SUM_KEYS) t[k] += d[k]
  }
  return t
}

const ratio = (a: number, b: number) => (b > 1e-9 ? a / b : undefined)

export interface Kpis {
  kosten: number
  bilanz: number
  /** Eigenverbrauch PV = PV − Einspeisung (Zähler) */
  ev?: number
  evQuote?: number
  gesamt?: number
  autarkie?: number
  pvAnteilWP?: number
  pvAnteilWB?: number
  pvAnteilHaus?: number
  spEff?: number
  kwh100km?: number
  /** PV-Daten decken nur einen Teil des Zeitraums ab */
  pvTeilweise: boolean
}

export function kpis(t: Totals): Kpis {
  const kosten = t.kHaus + t.kWP + t.kWB + t.kGrund + t.kWPGrund
  const hasPv = t.nPv > 0
  const ev = hasPv ? t.pv - t.zeP : undefined
  const gesamt = hasPv ? t.bezugP + t.pv - t.zeP : undefined
  return {
    kosten,
    bilanz: kosten - t.verg,
    ev,
    evQuote: ev === undefined ? undefined : ratio(ev, t.pv),
    gesamt,
    autarkie: gesamt === undefined || gesamt <= 1e-9 ? undefined : 1 - t.bezugP / gesamt,
    pvAnteilWP: t.nWp ? ratio(t.pvWP, t.wp) : undefined,
    pvAnteilWB: t.nWb ? ratio(t.pvWB, t.wb) : undefined,
    pvAnteilHaus: hasPv && t.haus > 1e-9 ? 1 - Math.max(0, t.netzHaus) / t.haus : undefined,
    spEff: t.nSp ? ratio(t.spE, t.spL) : undefined,
    kwh100km: t.nKm && t.km > 1 ? (t.wbKm / t.km) * 100 : undefined,
    pvTeilweise: hasPv && t.nPv < t.days,
  }
}

/** Hinweise, wenn die Daten rechnerisch nicht zusammenpassen. */
export function plausibilitaet(t: Totals): string[] {
  const w: string[] = []
  if (t.rest > 0.5)
    w.push(
      'Laut Wechselrichter wurde mehr eingespeist, als am Zähler ankam und Wärmepumpe plus Wallbox verbraucht haben. Bitte die Stände prüfen.',
    )
  if (t.netzHaus < -0.5)
    w.push('Der Netzbezug ist kleiner als der Netzanteil von Wärmepumpe und Wallbox. Bitte die Stände prüfen.')
  if (t.nNoTariff > 0) w.push(`Für ${t.nNoTariff} Tage ist kein Tarif hinterlegt – die Kosten sind dort 0.`)
  return w
}
