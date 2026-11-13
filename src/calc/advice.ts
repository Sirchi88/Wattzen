import { toDay } from '../lib/dates'
import type { Model, Reading } from '../types'
import { aggregate, feedInAt, kpis, offsetAt, tariffAt, type Daily, type Point } from './engine'

export interface Advice {
  id: string
  titel: string
  /** €/Jahr, positiv = lohnt sich */
  ersparnis?: number
  zeilen: { label: string; eur: number }[]
  text: string
}

export interface AdviceResult {
  /** Tage der Datenbasis; unter 365 wird aufs Jahr hochgerechnet */
  basisTage: number
  hochgerechnet: boolean
  rechnungen: Advice[]
  hinweise: Advice[]
}

/**
 * Spar-Empfehlungen aus den echten Daten der letzten 12 Monate.
 * Rechnungen erscheinen nur, wenn die nötigen Preise eingegeben sind;
 * Hinweise nur, wenn die Daten sie stützen.
 */
export function advise(daily: Daily, m: Model): AdviceResult | undefined {
  const span = daily.end - daily.start
  if (span < 90) return undefined
  const basisTage = Math.min(365, span)
  const t = aggregate(daily, daily.end - basisTage, daily.end)
  const k = kpis(t)
  const j = 365 / basisTage
  const ap = (tariffAt(m.tariffs, daily.end - 1)?.arbeitspreis ?? 0) / 100
  const verg = (feedInAt(m.feedins, daily.end - 1)?.ct ?? 0) / 100
  const a = m.settings.advice
  const rechnungen: Advice[] = []
  const hinweise: Advice[] = []
  const hatWP = t.nWp > 0 && t.wp > 1
  const schonSeparat = t.nSep > 0

  if (hatWP && !schonSeparat && ap > 0 && a.wpAp !== undefined) {
    const heute = t.netzWP * j * ap
    const arbeit = (t.wp * j * a.wpAp) / 100
    const fix = (a.wpGrund ?? 0) * 12 + (a.zaehlerJahr ?? 0)
    const mehrEinsp = t.pvWP * j * verg
    const ersparnis = heute - arbeit - fix + mehrEinsp
    rechnungen.push({
      id: 'wp-tarif',
      titel: 'Separater WP-Tarif',
      ersparnis,
      zeilen: [
        { label: 'WP-Netzstrom heute (Haushaltstarif)', eur: heute },
        { label: 'WP komplett zum WP-Tarif', eur: -arbeit },
        { label: 'Grundgebühr und Zähler', eur: -fix },
        { label: 'Mehr Einspeisung (PV fließt nicht mehr in die WP)', eur: mehrEinsp },
      ],
      text:
        ersparnis > 0
          ? 'Lohnt sich nach deinen Daten. Annahme: Die WP hängt dann als eigener Netzanschluss ohne PV-Anteil am WP-Zähler.'
          : 'Lohnt sich nach deinen Daten nicht: Fixkosten und der entfallende PV-Anteil fressen den Preisvorteil auf.',
    })
  }

  if (hatWP && a.m1Pauschale !== undefined) {
    const ersparnis = a.m1Pauschale - (a.m1Mehrkosten ?? 0)
    rechnungen.push({
      id: '14a-m1',
      titel: '§14a EnWG · Modul 1 (Pauschale)',
      ersparnis,
      zeilen: [
        { label: 'Pauschale Netzentgelt-Reduzierung', eur: a.m1Pauschale },
        { label: 'Mehrkosten pro Jahr', eur: -(a.m1Mehrkosten ?? 0) },
      ],
      text: 'Unabhängig vom Verbrauch. Kein zusätzlicher Zähler nötig, der PV-Anteil bleibt erhalten.',
    })
  }

  if (hatWP && a.m2Reduktion !== undefined) {
    const netz = (schonSeparat ? t.wp : t.netzWP) * j
    const red = (netz * a.m2Reduktion) / 100
    const fix = a.zaehlerJahr ?? 0
    const ersparnis = red - fix
    rechnungen.push({
      id: '14a-m2',
      titel: '§14a EnWG · Modul 2 (reduziertes Netzentgelt)',
      ersparnis,
      zeilen: [
        { label: `Reduzierung auf ${Math.round(netz).toLocaleString('de-DE')} kWh WP-Netzstrom`, eur: red },
        { label: 'Zusätzlicher Zähler', eur: -fix },
      ],
      text: 'Annahme: Kaskadenmessung – der PV-Anteil der WP bleibt erhalten, reduziert wird nur ihr Netzstrom.',
    })
  }

  const m1 = rechnungen.find((r) => r.id === '14a-m1')
  const m2 = rechnungen.find((r) => r.id === '14a-m2')
  if (m1 && m2 && m1.ersparnis !== undefined && m2.ersparnis !== undefined) {
    const besser = m1.ersparnis >= m2.ersparnis ? m1 : m2
    besser.text += ' Bei deinem Verbrauch das bessere der beiden Module.'
  }

  if (t.nWb > 0 && t.wb * j > 150 && k.pvAnteilWB !== undefined && t.nWrE > t.days * 0.8) {
    const netzAnteil = 1 - k.pvAnteilWB
    if (netzAnteil > 0.5) {
      const eur = t.netzWB * j * ap
      hinweise.push({
        id: 'wb-netz',
        titel: `Wallbox lädt zu ${Math.round(netzAnteil * 100)} % aus dem Netz`,
        zeilen: [{ label: 'Netzstrom Wallbox pro Jahr', eur: -eur }],
        text: 'Eco-Mindestleistung prüfen oder Ladungen stärker in die Mittagsstunden legen.',
      })
    }
  }

  if (t.nSp > t.days * 0.5 && t.spL * j > 200 && k.spEff !== undefined && k.spEff < 0.8) {
    const verlust = (t.spL - t.spE) * j
    hinweise.push({
      id: 'speicher',
      titel: `Speicher-Wirkungsgrad auffällig niedrig (${Math.round(k.spEff * 100)} %)`,
      zeilen: [{ label: `Verlust ${Math.round(verlust)} kWh pro Jahr`, eur: -verlust * ap }],
      text: 'Üblich sind 85–95 %. Standby-Verbrauch, Ladegrenzen und Firmware des Speichers prüfen.',
    })
  }

  return { basisTage, hochgerechnet: basisTage < 365, rechnungen, hinweise }
}

/* ───────────── Plausibilitätscheck bei der Eingabe ───────────── */

export interface FieldCheck {
  /** Delta zum letzten Stand vor diesem Tag */
  delta?: number
  prevDay?: number
  prevRaw?: number
  warn?: string
}

/**
 * Prüft einen neuen Zählerstand gegen die bisherige Reihe:
 * kleiner als der vorherige Stand, oder Tagesmittel über dem Dreifachen des bisherigen Schnitts.
 */
export function checkField(
  points: Point[],
  readings: Reading[],
  model: Pick<Model, 'changes'>,
  key: string,
  date: string,
  raw: number | undefined,
  ignoreId?: string,
): FieldCheck {
  const day = toDay(date)
  const own = ignoreId ? readings.find((r) => r.id === ignoreId) : undefined
  const ownDay = own ? toDay(own.date) : undefined
  const before = points.filter((p) => p.day < day && p.day !== ownDay)
  const last = before[before.length - 1]
  if (!last) return {}
  // Platzhalter: letzter bekannter Stand (nach einem Zählerwechsel der Startstand des neuen Zählers).
  // Delta: gegenüber der letzten echten Ablesung, auch über einen Zählerwechsel hinweg.
  const readingDays = new Set(
    readings
      .filter((r) => r.id !== ignoreId && r.values[key] !== undefined)
      .map((r) => toDay(r.date)),
  )
  const prev = [...before].reverse().find((p) => readingDays.has(p.day)) ?? last
  const prevRaw = last.v - offsetAt(model.changes, key, last.day)
  if (raw === undefined) return { prevDay: prev.day, prevRaw }
  const v = raw + offsetAt(model.changes, key, day)
  const delta = v - prev.v
  const res: FieldCheck = { delta, prevDay: prev.day, prevRaw }
  if (v - last.v < -1e-9) {
    res.warn = 'Kleiner als der letzte Stand. Tippfehler oder Zählerwechsel?'
    return res
  }
  const first = before[0]
  if (before.length >= 3 && prev.day > first.day) {
    const avg = (prev.v - first.v) / (prev.day - first.day)
    const rate = delta / (day - prev.day)
    if (avg > 0 && delta > 5 && rate > 3 * avg) res.warn = 'Tagesmittel mehr als dreimal so hoch wie bisher.'
  }
  return res
}
