import { addMonths, fmtDayShort, monthStart, toDay } from '../lib/dates'
import type { Model, Tariff } from '../types'
import { aggregate, type Daily } from './engine'
import { customMeters, meterName } from './meters'

/* ───────────── Kostenaufstellung pro Monat ───────────── */

export interface CostRow {
  start: number
  from: number
  to: number
  /** alle Grundgebühren (Strom, WP-Tarif, eigene Zähler) */
  fix: number
  /** Arbeitskosten Strom */
  arbeit: number
  /** davon Wärmepumpe und Wallbox */
  wp: number
  wb: number
  verg: number
  /** mengenabhängige Kosten der eigenen Zähler */
  eigene: number
  /** fix + arbeit + eigene − verg */
  saldo: number
}

export function costTable(daily: Daily, from: number, to: number) {
  const rows: CostRow[] = []
  for (let a = monthStart(from); a < to; a = addMonths(a, 1)) {
    const f = Math.max(a, from)
    const b = Math.min(addMonths(a, 1), to)
    const t = aggregate(daily, f, b)
    if (!t.days) continue
    const fix = t.kGrund + t.kWPGrund + t.kCustGrund
    const arbeit = t.kHaus + t.kWP + t.kWB
    rows.push({
      start: a, from: t.from, to: t.to, fix, arbeit, wp: t.kWP, wb: t.kWB, verg: t.verg, eigene: t.kCustVar,
      saldo: fix + arbeit + t.kCustVar - t.verg,
    })
  }
  const sum = rows.reduce(
    (s, r) => ({
      ...s, fix: s.fix + r.fix, arbeit: s.arbeit + r.arbeit, wp: s.wp + r.wp, wb: s.wb + r.wb,
      verg: s.verg + r.verg, eigene: s.eigene + r.eigene, saldo: s.saldo + r.saldo,
    }),
    { start: from, from, to, fix: 0, arbeit: 0, wp: 0, wb: 0, verg: 0, eigene: 0, saldo: 0 } as CostRow,
  )
  return { rows, sum }
}

/* ───────────── Amortisation PV + Speicher ───────────── */

export interface Amortisation {
  invest: number
  /** Nutzen bis zur letzten Ablesung (gemessen + geschätzt) */
  nutzen: number
  gemessen: number
  /** Schätzung für die Zeit zwischen Inbetriebnahme und erster Ablesung */
  geschaetzt: number
  pct: number
  /** Nutzen pro Jahr (letzte 12 Monate oder hochgerechnet) */
  proJahr: number
  /** voraussichtlicher Tag der Amortisation */
  tag?: number
}

/**
 * Nutzen = Ersparnis durch Eigenverbrauch + Einspeisevergütung.
 * Vor der ersten Ablesung wird anhand des PV-Gesamtzählers geschätzt
 * (mit Eigenverbrauchsquote und Preisen der gemessenen Zeit).
 */
export function amortisation(daily: Daily, m: Model): Amortisation | undefined {
  const h = m.settings.house
  const invest = (h.investPv ?? 0) + (h.investSpeicher ?? 0)
  if (invest <= 0 || !daily.days.length) return undefined
  const all = aggregate(daily, daily.start, daily.end)
  if (!all.nPv) return undefined
  const gemessen = all.ersparnis + all.verg
  let geschaetzt = 0
  const firstPv = daily.series.pv[0]
  if (h.inbetrieb && firstPv && toDay(h.inbetrieb) < firstPv.day) {
    // Zählerstand des PV-Ertrags bei der ersten Ablesung = Ertrag seit Inbetriebnahme
    const raw = m.readings.filter((r) => r.values.pv !== undefined).sort((a, b) => (a.date < b.date ? -1 : 1))[0]?.values.pv ?? 0
    const proKwhPv = all.pv > 0 ? gemessen / all.pv : 0
    geschaetzt = Math.max(0, raw) * proKwhPv
  }
  const nutzen = gemessen + geschaetzt
  const len = Math.min(365, daily.end - daily.start)
  const last = aggregate(daily, daily.end - len, daily.end)
  const proJahr = len > 0 ? ((last.ersparnis + last.verg) / len) * 365 : 0
  const rest = invest - nutzen
  const tag = rest <= 0 ? daily.end : proJahr > 0 ? Math.round(daily.end + (rest / proJahr) * 365) : undefined
  return { invest, nutzen, gemessen, geschaetzt, pct: nutzen / invest, proJahr, tag }
}

/* ───────────── Vertragsende-Hinweise ───────────── */

export interface ContractHint {
  key: string
  text: string
  sub?: string
  /** Vertragsende */
  ende: number
  /** Kündigungsfrist bis */
  frist?: number
  title: string
}

const lastOf = (tariffs: Tariff[]) =>
  [...tariffs].sort((a, b) => (a.from < b.from ? 1 : -1))[0]

/**
 * Hinweis ab `contractLead` Wochen vor Ablauf bzw. vor der Kündigungsfrist,
 * bis ein neuer Tarif hinterlegt ist. Weggewischt: 7 Tage Ruhe.
 */
export function contractHints(m: Model, today: number, includeDismissed = false): ContractHint[] {
  const lead = (m.settings.contractLead ?? 8) * 7
  const out: ContractHint[] = []
  const check = (key: string, title: string, label: string, ende?: string, fristWochen?: number) => {
    if (!ende) return
    const e = toDay(ende)
    const frist = fristWochen ? e - fristWochen * 7 : undefined
    const stichtag = frist ?? e
    if (today < stichtag - lead) return
    const dismissed = m.settings.dismissed?.[key]
    if (!includeDismissed && dismissed && today < toDay(dismissed) + 7) return
    const vorbei = today > e
    out.push({
      key, title, ende: e, frist,
      text: vorbei ? `Dein ${label} ist am ${fmtDayShort(e)} ausgelaufen` : `Dein ${label} läuft am ${fmtDayShort(e)} aus`,
      sub:
        frist !== undefined && !vorbei
          ? today <= frist
            ? `Kündigen bis ${fmtDayShort(frist)} · noch ${frist - today} Tage`
            : `Kündigungsfrist ist am ${fmtDayShort(frist)} abgelaufen`
          : 'Neuen Tarif im Meisterbereich hinterlegen, dann verschwindet der Hinweis.',
    })
  }
  const hh = lastOf(m.tariffs.filter((t) => t.kind === 'haushalt'))
  if (hh) check(`tarif-${hh.id}-${hh.to}`, 'Stromvertrag', 'Stromvertrag', hh.to, hh.fristWochen)
  if (m.settings.wpTarifAktiv) {
    const wp = lastOf(m.tariffs.filter((t) => t.kind === 'wp'))
    if (wp) check(`tarif-${wp.id}-${wp.to}`, 'WP-Tarif', 'WP-Tarif', wp.to, wp.fristWochen)
  }
  for (const c of customMeters(m)) {
    if (!c.active || !c.costs?.vertragEnde) continue
    check(`zaehler-${c.id}-${c.costs.vertragEnde}`, meterName(c), `Vertrag für ${meterName(c)}`, c.costs.vertragEnde, c.costs.fristWochen)
  }
  return out.sort((a, b) => (a.frist ?? a.ende) - (b.frist ?? b.ende))
}

/** Ablesung fällig: seit dem 1. des Monats wurde noch nicht abgelesen. */
export function ablesungFaellig(m: Model, today: number) {
  if (!m.readings.length) return false
  const first = monthStart(today)
  return !m.readings.some((r) => toDay(r.date) >= first)
}
