import { addMonths, dayOf, parts, toDay } from '../lib/dates'
import type { Abschlag, Model } from '../types'
import { aggregate, feedInAt, grundProTag, kpis, tariffAt, wpSeparatAm, type Daily } from './engine'

/** Fälligkeitstage eines monatlichen Abschlags im Bereich [from, to). */
export function abschlagTermine(a: Abschlag, from: number, to: number): number[] {
  const first = toDay(a.from)
  const last = a.to ? toDay(a.to) : Infinity
  const out: number[] = []
  for (let k = 0; k < 1200; k++) {
    const day = addMonths(first, k)
    if (day >= to || day > last) break
    if (day >= from) out.push(day)
  }
  return out
}

export function abschlagSumme(abschlaege: Abschlag[], from: number, to: number) {
  let s = 0
  for (const a of abschlaege) s += abschlagTermine(a, from, to).length * a.betrag
  return s
}

export interface Forecast {
  year: number
  method: 'saisonal' | 'linear'
  /** Daten beginnen erst nach dem 1.1. – Prognose gilt ab `from` */
  from: number
  teiljahr: boolean
  bezug: number
  einsp: number
  kosten: number
  verg: number
  /** bisher im Jahr */
  kostenBisher: number
  abschlaegeGezahlt: number
  abschlaegeKommend: number
  /** > 0 Nachzahlung, < 0 Gutschrift */
  differenz: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Hochrechnung bis 31.12. des Jahres der letzten Ablesung.
 * Mit vollständigem Vorjahr: Vorjahres-Tagesprofil, skaliert mit dem Verhältnis
 * „dieses Jahr bisher / Vorjahr im selben Zeitraum". Sonst linear.
 */
export function forecast(daily: Daily, m: Model, today: number): Forecast | undefined {
  if (!daily.days.length) return undefined
  const year = parts(daily.end - 1).y
  const y0 = dayOf(year, 0, 1)
  const y1 = dayOf(year + 1, 0, 1)
  const from = Math.max(y0, daily.start)
  const elapsed = daily.end - from
  if (elapsed < 7) return undefined

  const ytd = aggregate(daily, from, daily.end)
  const shift = y0 - dayOf(year - 1, 0, 1)
  const prevOk = daily.start <= from - shift
  const prev = prevOk ? aggregate(daily, from - shift, daily.end - shift) : undefined

  type Q = 'zb' | 'ze' | 'wp'
  const scale = (q: Q) => (prev && prev[q] > 1 ? clamp(ytd[q] / prev[q], 0.2, 5) : undefined)
  const sc = { zb: scale('zb'), ze: scale('ze'), wp: scale('wp') }
  const future = (q: Q, day: number) => {
    const s = sc[q]
    if (s !== undefined) return daily.days[day - shift - daily.start][q] * s
    return ytd[q] / elapsed
  }

  let bezug = ytd.bezug
  let einsp = ytd.ze
  let kosten = kpis(ytd).kosten
  let verg = ytd.verg
  for (let day = daily.end; day < y1; day++) {
    const zb = future('zb', day)
    const ze = future('ze', day)
    const t = tariffAt(m.tariffs, day)
    kosten += (zb * (t?.arbeitspreis ?? 0)) / 100 + grundProTag(t, day)
    bezug += zb
    if (wpSeparatAm(m, day)) {
      const wp = future('wp', day)
      const tw = tariffAt(m.tariffs, day, 'wp')
      kosten += (wp * (tw?.arbeitspreis ?? 0)) / 100 + grundProTag(tw, day)
      bezug += wp
    }
    einsp += ze
    verg += (ze * (feedInAt(m.feedins, day)?.ct ?? 0)) / 100
  }

  const cut = Math.min(Math.max(today + 1, from), y1)
  const abschlaegeGezahlt = abschlagSumme(m.abschlaege, from, cut)
  const abschlaegeKommend = abschlagSumme(m.abschlaege, cut, y1)
  return {
    year,
    method: sc.zb !== undefined ? 'saisonal' : 'linear',
    from,
    teiljahr: from > y0,
    bezug,
    einsp,
    kosten,
    verg,
    kostenBisher: kpis(ytd).kosten,
    abschlaegeGezahlt,
    abschlaegeKommend,
    differenz: kosten - abschlaegeGezahlt - abschlaegeKommend,
  }
}
