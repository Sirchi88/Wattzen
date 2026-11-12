import { dayOf, fromDay, parts, toDay } from '../lib/dates'
import type { Abschlag, FeedIn, Reading, Tariff } from '../types'

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
}

/**
 * Rund zwei Jahre simulierter Betrieb: 9,8 kWp PV, 10 kWh Speicher,
 * Wärmepumpe und Wallbox hinter dem WR-Messpunkt. Ablesungen in unregelmäßigen Abständen.
 */
export function buildDemo(todayIso: string): DemoData {
  const rand = rng(20241)
  const end = toDay(todayIso)
  const start = end - 742
  const r1 = (v: number) => Math.round(v * 10) / 10

  const cum = {
    bezug: 18432.6, einsp: 21077.3, wp: 9120.4, pv: 31250.8, wrEinsp: 24310.2,
    wrHaus: 11840.5, spLaden: 5210.7, spEntladen: 4655.1, wb: 3480.9,
  }
  let km = 41250
  let wetter = 0.8
  let next = start
  const readings: Reading[] = []
  let n = 0

  for (let day = start; day <= end; day++) {
    if (day === next || day === end) {
      const values: Reading['values'] = {}
      for (const k of Object.keys(cum) as (keyof typeof cum)[]) values[k] = r1(cum[k])
      // Manchmal fehlen optionale Werte – wie im echten Leben
      n++
      if (n % 9 === 4) {
        delete values.spLaden
        delete values.spEntladen
      }
      if (n % 13 === 7) delete values.wb
      readings.push({ id: `demo-${day}`, date: fromDay(day), values, km: Math.round(km) })
      next = day + 5 + Math.floor(rand() * 17)
      if (end - next < 4) next = end
    }
    if (day === end) break

    const p = parts(day)
    const doy = day - dayOf(p.y, 0, 1)
    const saison = Math.cos((2 * Math.PI * (doy + 10)) / 365) // +1 Winter, −1 Sommer
    wetter = Math.min(1.25, Math.max(0.2, wetter * 0.55 + (0.35 + rand() * 0.95) * 0.45))

    const pv = 9.8 * (2.85 - 2.3 * saison) * wetter
    const haus = 8.6 + 1.1 * saison + (rand() - 0.5) * 2.4
    const kalt = Math.max(0, saison + 0.25) / 1.25
    const wp = 2.4 + 21 * Math.pow(kalt, 1.35) * (0.8 + rand() * 0.4) + rand() * 0.6
    const wb = rand() < 0.3 ? 12 + rand() * 26 : 0
    km += wb > 0 ? (wb / 17.5) * 100 : 0

    // Haus hinter dem WR: direkt, dann Speicher, dann Netz
    const direkt = Math.min(pv * 0.9, haus * 0.48)
    const ueber = pv - direkt
    const eff = 0.87 + rand() * 0.04
    const laden = Math.min(ueber, 9.5, ((haus - direkt) * (0.8 + rand() * 0.18)) / eff)
    const entladen = laden * eff
    const wrEinsp = ueber - laden
    const hausNetz = haus - direkt - entladen

    // WP und Wallbox sitzen zwischen WR-Messpunkt und Hauptzähler
    const wpPV = Math.min(wp * (0.25 + 0.3 * Math.max(0, -saison)), wrEinsp * 0.6)
    const wbPV = Math.min(wb * (0.45 + rand() * 0.3), wrEinsp - wpPV)
    const x = wpPV + wbPV

    cum.pv += pv
    cum.wrHaus += haus
    cum.spLaden += laden
    cum.spEntladen += entladen
    cum.wrEinsp += wrEinsp
    cum.einsp += wrEinsp - x
    cum.wp += wp
    cum.wb += wb
    cum.bezug += hausNetz + (wp - wpPV) + (wb - wbPV)
  }

  const y = parts(end).y
  const iso = (yy: number, m: number, d: number) => fromDay(dayOf(yy, m, d))
  return {
    readings,
    tariffs: [
      {
        id: 'demo-t1', kind: 'haushalt', from: iso(y - 3, 0, 1), to: iso(y - 1, 11, 31),
        arbeitspreis: 34.9, grundgebuehr: 12.9, anbieter: 'Stadtwerke', notiz: 'Grundversorgung',
      },
      {
        id: 'demo-t2', kind: 'haushalt', from: iso(y, 0, 1),
        arbeitspreis: 31.4, grundgebuehr: 14.5, anbieter: 'Naturstrom Süd', notiz: 'Wechsel zum Jahresanfang',
      },
    ],
    feedins: [{ id: 'demo-f1', from: iso(y - 3, 0, 1), ct: 8.11 }],
    abschlaege: [
      { id: 'demo-a1', from: iso(y - 2, 0, 15), to: iso(y - 1, 11, 31), betrag: 165 },
      { id: 'demo-a2', from: iso(y, 0, 15), betrag: 150 },
    ],
  }
}
