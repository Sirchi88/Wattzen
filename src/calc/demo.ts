import { dayOf, fromDay, parts, toDay } from '../lib/dates'
import type { Abschlag, FeedIn, House, MeterConf, Reading, Tariff } from '../types'
import { builtinDefaults } from './meters'
import { doy, GERMANY } from './smart'

/** Deterministischer Zufall (mulberry32), damit die Demo immer gleich aussieht. */
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DemoData {
  readings: Reading[]
  tariffs: Tariff[]
  feedins: FeedIn[]
  abschlaege: Abschlag[]
  feedinAbschlaege: Abschlag[]
  meters: MeterConf[]
  house: House
  /** simuliertes Wetter passend zu den Werten */
  weather: { date: string; t: number; rad: number }[]
  climate: { t: number[]; rad: number[]; label: string }
}

export const DEMO_WASSER = 'c_demo_wasser'
export const DEMO_GARTEN = 'c_demo_garten'

/**
 * Rund zwei Jahre simulierter Betrieb: 9,8 kWp PV, 10 kWh Speicher,
 * Wärmepumpe und Wallbox hinter dem WechselRichter-Messpunkt, dazu Wasser und Gartenwasser.
 * Ablesungen in unregelmäßigen Abständen, Werte aus simuliertem Wetter.
 */
export function buildDemo(todayIso: string): DemoData {
  const rand = rng(20241)
  const end = toDay(todayIso)
  const start = end - 742
  const r1 = (v: number) => Math.round(v * 10) / 10
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  const kwp = 9.8

  const cum = {
    bezug: 18432.6, einsp: 21077.3, wp: 9120.4, wpWaerme: 31480.2, pv: 31250.8, wrImport: 9310.7, wrEinsp: 24310.2,
    wrHaus: 11840.5, spLaden: 5210.7, spEntladen: 4655.1, wb: 3480.9,
  }
  let wasser = 812.4
  let garten = 64.2
  let km = 41250
  let tDev = 0
  let cloud = 1
  let next = start
  const readings: Reading[] = []
  const weather: DemoData['weather'] = []
  let n = 0

  for (let day = start; day <= end; day++) {
    if (day === next || day === end) {
      const values: Reading['values'] = {}
      for (const k of Object.keys(cum) as (keyof typeof cum)[]) values[k] = r1(cum[k])
      values[DEMO_WASSER] = r3(wasser)
      values[DEMO_GARTEN] = r3(garten)
      values.km = Math.round(km)
      // Manchmal fehlen optionale Werte – wie im echten Leben
      n++
      if (n % 9 === 4) {
        delete values.spLaden
        delete values.spEntladen
      }
      if (n % 13 === 7) delete values.wb
      if (n % 11 === 5) delete values[DEMO_GARTEN]
      readings.push({ id: `demo-${day}`, date: fromDay(day), values })
      next = day + 5 + Math.floor(rand() * 17)
      if (end - next < 4) next = end
    }
    if (day === end) break

    // Wetter: Klimamittel plus träge Abweichungen
    const i = Math.min(365, doy(day))
    tDev = tDev * 0.82 + (rand() - 0.5) * 3.2
    cloud = Math.min(1.45, Math.max(0.22, cloud * 0.5 + (0.3 + rand() * 1.1) * 0.5))
    const t = GERMANY.t[i] + tDev
    const rad = Math.max(0.15, GERMANY.rad[i] * cloud)
    weather.push({ date: fromDay(day), t: Math.round(t * 10) / 10, rad: Math.round(rad * 100) / 100 })

    const p = parts(day)
    const winter = Math.max(0, Math.cos((2 * Math.PI * (i + 10)) / 365))
    const pv = kwp * rad * 0.84 * (0.97 + rand() * 0.06)
    const haus = 8.3 + 1.3 * winter + (rand() - 0.5) * 2.2
    const hg = Math.max(0, 15 - t)
    const wp = 2.4 + 1.52 * hg * (0.92 + rand() * 0.16) + rand() * 0.4
    const cop = Math.min(4.6, Math.max(2.2, 2.45 + 0.075 * t))
    const wb = rand() < 0.3 ? 12 + rand() * 26 : 0
    km += wb > 0 ? (wb / 17.5) * 100 : 0

    // Haus hinter dem WechselRichter: direkt, dann Speicher, dann Netz
    const direkt = Math.min(pv * 0.9, haus * 0.48)
    const ueber = pv - direkt
    const eff = 0.87 + rand() * 0.04
    const laden = Math.min(ueber, 9.5, ((haus - direkt) * (0.8 + rand() * 0.18)) / eff)
    const entladen = laden * eff
    const wrEinsp = ueber - laden
    const hausNetz = haus - direkt - entladen

    // WP und Wallbox sitzen zwischen WechselRichter-Messpunkt und Hauptzähler
    const summer = p.m >= 4 && p.m <= 8
    const wpPV = Math.min(wp * (summer ? 0.5 : 0.12), wrEinsp * 0.6)
    const wbPV = Math.min(wb * (0.45 + rand() * 0.3), wrEinsp - wpPV)

    cum.pv += pv
    cum.wrHaus += haus
    cum.spLaden += laden
    cum.spEntladen += entladen
    cum.wrEinsp += wrEinsp
    cum.wrImport += hausNetz
    cum.einsp += wrEinsp - wpPV - wbPV
    // Der WP-Zähler zählt gut 1 % mehr – sichtbar in der Plausibilitätsprüfung
    cum.wp += wp * 1.012
    cum.wpWaerme += wp * cop
    cum.wb += wb
    cum.bezug += hausNetz + (wp - wpPV) + (wb - wbPV)

    const g = summer ? Math.max(0, (t - 12) * 0.035 * (0.5 + rand())) * (rad > 3 ? 1.4 : 0.6) : 0
    garten += g
    wasser += 0.31 + (rand() - 0.5) * 0.12 + g
  }

  const y = parts(end).y
  const iso = (yy: number, m: number, d: number) => fromDay(dayOf(yy, m, d))
  const defaults = builtinDefaults()
  const on = (id: string): MeterConf => ({ ...defaults.find((d) => d.id === id)!, active: true })
  const meters: MeterConf[] = [
    on('wpWaerme'),
    on('km'),
    {
      id: DEMO_WASSER, builtin: false, group: 'eigene', name: 'Wasser', hint: 'Hauswasserzähler', icon: 'droplet',
      color: 'wasser', unit: 'm³', decimals: 3, active: true, order: 0,
      costs: {
        anbieter: 'Stadtwerke',
        grund: [{ id: 'dg1', from: iso(y - 3, 0, 1), eurMonat: 4.6 }],
        parts: [
          { id: 'dp1', from: iso(y - 3, 0, 1), name: 'Frischwasser', preis: 2.1 },
          { id: 'dp2', from: iso(y - 3, 0, 1), name: 'Abwasser', preis: 2.85, minus: DEMO_GARTEN },
        ],
        abschlaege: [
          { id: 'da1', from: iso(y - 2, 0, 15), to: iso(y - 1, 11, 31), betrag: 44 },
          { id: 'da2', from: iso(y, 0, 15), betrag: 56 },
        ],
      },
    },
    {
      id: DEMO_GARTEN, builtin: false, group: 'eigene', name: 'Gartenwasser', hint: 'Zwischenzähler Garten',
      icon: 'sprout', color: 'einsp', unit: 'm³', decimals: 3, active: true, order: 1,
      costs: { grund: [], parts: [], abschlaege: [] },
    },
  ]

  return {
    readings,
    tariffs: [
      {
        id: 'demo-t1', kind: 'haushalt', from: iso(y - 3, 0, 1), to: iso(y - 1, 11, 31),
        arbeitspreis: 34.9, grundgebuehr: 12.9, anbieter: 'Stadtwerke', notiz: 'Grundversorgung',
      },
      {
        id: 'demo-t2', kind: 'haushalt', from: iso(y, 0, 1), to: iso(y, 11, 31), fristWochen: 6,
        arbeitspreis: 31.4, grundgebuehr: 14.5, anbieter: 'Naturstrom Süd', notiz: 'Laufzeit 12 Monate',
      },
    ],
    feedins: [{ id: 'demo-f1', from: iso(y - 3, 0, 1), ct: 8.11 }],
    abschlaege: [
      { id: 'demo-a1', from: iso(y - 2, 0, 15), to: iso(y - 1, 11, 31), betrag: 165 },
      { id: 'demo-a2', from: iso(y, 0, 15), betrag: 182 },
    ],
    feedinAbschlaege: [{ id: 'demo-fa1', from: iso(y, 0, 28), betrag: 22 }],
    meters,
    house: {
      plz: '', ort: 'Demo-Ort', kwp, azimut: 0, neigung: 30, inbetrieb: fromDay(start - 1190), speicherKwh: 10,
      investPv: 15800, investSpeicher: 7200, wpModell: 'Luft-Wasser-Wärmepumpe 7 kW', flaeche: 145, personen: 3,
      autoModell: 'Kompaktwagen elektrisch', autoAkku: 58,
    },
    weather,
    climate: { t: GERMANY.t, rad: GERMANY.rad, label: 'Demo-Ort' },
  }
}
