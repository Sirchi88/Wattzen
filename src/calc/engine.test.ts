import { describe, expect, it } from 'vitest'
import { dayOf, toDay } from '../lib/dates'
import { parseNum } from '../lib/format'
import { DEFAULT_SETTINGS, type Model, type Reading, type Settings, type Tariff } from '../types'
import { advise, checkField } from './advice'
import { buildDemo } from './demo'
import { aggregate, buildSeries, computeDaily, kpis, plausibilitaet, splitX, valueAt } from './engine'
import { abschlagSumme, forecast } from './forecast'

let id = 0
const rd = (date: string, values: Reading['values'], km?: number): Reading => ({ id: `r${id++}`, date, values, km })
const tarif = (from: string, ap: number, grund = 0, extra: Partial<Tariff> = {}): Tariff => ({
  id: `t${id++}`, kind: 'haushalt', from, arbeitspreis: ap, grundgebuehr: grund, ...extra,
})
const model = (p: Partial<Model> & { s?: Partial<Settings> }): Model => ({
  readings: [], changes: [], tariffs: [], feedins: [], abschlaege: [],
  ...p,
  settings: { ...DEFAULT_SETTINGS, ...p.s },
})
const agg = (m: Model, from: string, to: string) => aggregate(computeDaily(m), toDay(from), toDay(to))

describe('Interpolation', () => {
  const m = model({
    readings: [
      rd('2024-12-22', { bezug: 1000, einsp: 500 }),
      rd('2025-01-11', { bezug: 1200, einsp: 520 }),
    ],
  })

  it('interpoliert den Stand am 1.1. linear nach Tagen', () => {
    const s = buildSeries(m.readings, m.changes)
    // 10 von 20 Tagen → halber Weg
    expect(valueAt(s.bezug, toDay('2025-01-01'))).toBeCloseTo(1100, 9)
    expect(valueAt(s.einsp, toDay('2025-01-01'))).toBeCloseTo(510, 9)
  })

  it('liefert außerhalb des Datenbereichs nichts', () => {
    const s = buildSeries(m.readings, m.changes)
    expect(valueAt(s.bezug, toDay('2024-12-21'))).toBeUndefined()
    expect(valueAt(s.bezug, toDay('2025-01-12'))).toBeUndefined()
  })

  it('summiert Teilzeiträume tagesgenau', () => {
    const t = agg(m, '2025-01-01', '2025-01-11')
    expect(t.days).toBe(10)
    expect(t.zb).toBeCloseTo(100, 9)
    expect(t.ze).toBeCloseTo(10, 9)
  })

  it('begrenzt Zeiträume auf den Datenbereich', () => {
    const t = agg(m, '2024-01-01', '2026-01-01')
    expect(t.days).toBe(20)
    expect(t.zb).toBeCloseTo(200, 9)
  })
})

describe('Aufteilung X auf WP und Wallbox', () => {
  it('teilt nach Gewicht WP·f und WB', () => {
    const s = splitX(30, 100, 50, 0.5, 'saison')
    expect(s.pvWP).toBeCloseTo(15)
    expect(s.pvWB).toBeCloseTo(15)
    expect(s.rest).toBe(0)
  })

  it('f = 0 ist keine Sperre: Überlauf der Wallbox geht an die WP', () => {
    const s = splitX(30, 100, 10, 0, 'saison')
    expect(s.pvWB).toBeCloseTo(10)
    expect(s.pvWP).toBeCloseTo(20)
    expect(s.rest).toBe(0)
  })

  it('f = 0 ohne Wallbox: alles an die WP', () => {
    const s = splitX(12, 100, 0, 0, 'saison')
    expect(s.pvWP).toBeCloseTo(12)
    expect(s.rest).toBe(0)
  })

  it('Überlauf der WP geht an die Wallbox', () => {
    const s = splitX(40, 10, 100, 1, 'wbZuerst')
    expect(s.pvWB).toBeCloseTo(40)
    const s2 = splitX(60, 20, 50, 1, 'anteilig')
    expect(s2.pvWP + s2.pvWB).toBeCloseTo(60)
    expect(s2.pvWP).toBeLessThanOrEqual(20)
    expect(s2.pvWB).toBeLessThanOrEqual(50)
  })

  it('meldet Rest, wenn X größer als beide Verbraucher zusammen ist', () => {
    const s = splitX(100, 30, 20, 1, 'saison')
    expect(s.pvWP).toBe(30)
    expect(s.pvWB).toBe(20)
    expect(s.rest).toBeCloseTo(50)
  })

  it('anteilig ignoriert den Saisonfaktor, Wallbox zuerst füllt die Wallbox', () => {
    expect(splitX(30, 100, 50, 0, 'anteilig').pvWP).toBeCloseTo(20)
    const w = splitX(30, 100, 20, 1, 'wbZuerst')
    expect(w.pvWB).toBe(20)
    expect(w.pvWP).toBe(10)
  })
})

describe('Saisonaufteilung über Monatsgrenzen', () => {
  // 20.2. → 10.3.2025: 9 Tage Februar (f = 0), 9 Tage März (f = 0,3)
  const m = model({
    readings: [
      rd('2025-02-20', { bezug: 0, einsp: 0, wrEinsp: 0, wp: 0, wb: 0, pv: 0 }),
      rd('2025-03-10', { bezug: 360, einsp: 180, wrEinsp: 216, wp: 180, wb: 90, pv: 400 }),
    ],
  })

  it('rechnet jeden Monat mit seinem Faktor', () => {
    const t = agg(m, '2025-02-20', '2025-03-10')
    expect(t.x).toBeCloseTo(36)
    // Februar: X 18, f = 0 → alles Wallbox (45 kWh Verbrauch).
    // März: X 18, Gewicht WP 90·0,3 = 27, WB 45 → WP 6,75, WB 11,25
    expect(t.pvWP).toBeCloseTo(6.75)
    expect(t.pvWB).toBeCloseTo(29.25)
    expect(t.netzWP).toBeCloseTo(180 - 6.75)
    expect(t.netzWB).toBeCloseTo(90 - 29.25)
    expect(t.netzHaus).toBeCloseTo(360 - (180 - 6.75) - (90 - 29.25))
  })

  it('Tagesrechnung entspricht der Rechnung pro Monatsstück', () => {
    const feb = agg(m, '2025-02-20', '2025-03-01')
    const mar = agg(m, '2025-03-01', '2025-03-10')
    expect(feb.pvWP).toBeCloseTo(0)
    expect(feb.pvWB).toBeCloseTo(18)
    const ref = splitX(18, 90, 45, 0.3, 'saison')
    expect(mar.pvWP).toBeCloseTo(ref.pvWP)
    expect(mar.pvWB).toBeCloseTo(ref.pvWB)
  })

  it('Kennzahlen', () => {
    const t = agg(m, '2025-02-20', '2025-03-10')
    const k = kpis(t)
    expect(k.ev).toBeCloseTo(220)
    expect(k.evQuote).toBeCloseTo(0.55)
    expect(k.gesamt).toBeCloseTo(580)
    expect(k.autarkie).toBeCloseTo(1 - 360 / 580)
    expect(k.pvAnteilWB).toBeCloseTo(29.25 / 90)
  })
})

describe('Tarife und Kosten', () => {
  const readings = [rd('2025-01-01', { bezug: 0, einsp: 0 }), rd('2025-03-02', { bezug: 600, einsp: 120 })]

  it('rechnet einen Tarifwechsel mitten im Zeitraum tagesgenau', () => {
    const m = model({
      readings,
      tariffs: [tarif('2024-01-01', 30, 10, { to: '2025-01-31' }), tarif('2025-02-01', 40, 15.5)],
      feedins: [
        { id: 'f1', from: '2020-01-01', to: '2025-01-31', ct: 8 },
        { id: 'f2', from: '2025-02-01', ct: 6 },
      ],
    })
    const t = agg(m, '2025-01-01', '2025-03-02')
    // 60 Tage, 10 kWh/Tag: 31 Tage à 30 ct, 29 Tage à 40 ct
    expect(t.kHaus).toBeCloseTo(310 * 0.3 + 290 * 0.4)
    // Grundgebühr: Januar voll, Februar voll, 1 Tag März
    expect(t.kGrund).toBeCloseTo(10 + 15.5 + 15.5 / 31)
    expect(t.verg).toBeCloseTo(62 * 0.08 + 58 * 0.06)
    const k = kpis(t)
    expect(k.bilanz).toBeCloseTo(k.kosten - t.verg)
    expect(t.nNoTariff).toBe(0)
  })

  it('meldet Tage ohne Tarif', () => {
    const m = model({ readings, tariffs: [tarif('2025-02-01', 40)] })
    const t = agg(m, '2025-01-01', '2025-03-02')
    expect(t.nNoTariff).toBe(31)
    expect(plausibilitaet(t).length).toBe(1)
  })

  it('Ersparnis = Eigenverbrauch × Arbeitspreis', () => {
    const m = model({
      readings: [rd('2025-06-01', { bezug: 0, einsp: 0, pv: 0 }), rd('2025-06-11', { bezug: 50, einsp: 200, pv: 300 })],
      tariffs: [tarif('2025-01-01', 32)],
    })
    const t = agg(m, '2025-06-01', '2025-06-11')
    expect(t.ersparnis).toBeCloseTo(100 * 0.32)
  })
})

describe('Zählerwechsel', () => {
  it('rechnet nahtlos über den Wechsel hinweg', () => {
    const m = model({
      readings: [
        rd('2025-01-01', { bezug: 9000, einsp: 100 }),
        rd('2025-01-21', { bezug: 60, einsp: 120 }),
      ],
      changes: [{ id: 'c1', meter: 'bezug', date: '2025-01-11', endOld: 9100, startNew: 0 }],
    })
    const t = agg(m, '2025-01-01', '2025-01-21')
    expect(t.zb).toBeCloseTo(160)
    // vor dem Wechsel 10 kWh/Tag, danach 6 kWh/Tag
    expect(agg(m, '2025-01-01', '2025-01-11').zb).toBeCloseTo(100)
    expect(agg(m, '2025-01-11', '2025-01-21').zb).toBeCloseTo(60)
    expect(t.ze).toBeCloseTo(20)
  })

  it('verkraftet mehrere Wechsel und einen Startstand ungleich null', () => {
    const m = model({
      readings: [
        rd('2025-01-01', { bezug: 500, einsp: 0 }),
        rd('2025-02-01', { bezug: 150, einsp: 10 }),
        rd('2025-03-01', { bezug: 30, einsp: 20 }),
      ],
      changes: [
        { id: 'c1', meter: 'bezug', date: '2025-01-15', endOld: 560, startNew: 100 },
        { id: 'c2', meter: 'bezug', date: '2025-02-10', endOld: 170, startNew: 5 },
      ],
    })
    // 60 + 50 + 20 + 25
    expect(agg(m, '2025-01-01', '2025-03-01').zb).toBeCloseTo(155)
  })

  it('Plausibilitätscheck kennt den Wechsel', () => {
    const readings = [rd('2025-01-01', { bezug: 9000, einsp: 0 })]
    const changes = [{ id: 'c1', meter: 'bezug' as const, date: '2025-01-11', endOld: 9100, startNew: 0 }]
    const s = buildSeries(readings, changes)
    const c = checkField(s.bezug, readings, { changes }, 'bezug', '2025-01-21', 60)
    expect(c.warn).toBeUndefined()
    // Delta gegenüber der letzten Ablesung, über den Wechsel hinweg: 100 + 60
    expect(c.delta).toBeCloseTo(160)
  })
})

describe('Fehlende optionale Felder', () => {
  it('kommt nur mit Bezug und Einspeisung aus', () => {
    const m = model({
      readings: [rd('2025-01-01', { bezug: 0, einsp: 0 }), rd('2025-01-11', { bezug: 100, einsp: 5 })],
      tariffs: [tarif('2025-01-01', 30)],
    })
    const t = agg(m, '2025-01-01', '2025-01-11')
    const k = kpis(t)
    expect(t.netzHaus).toBeCloseTo(100)
    expect(k.ev).toBeUndefined()
    expect(k.autarkie).toBeUndefined()
    expect(k.pvAnteilWP).toBeUndefined()
    expect(k.spEff).toBeUndefined()
    expect(k.kosten).toBeCloseTo(30)
    expect(plausibilitaet(t)).toEqual([])
  })

  it('überbrückt Ablesungen, bei denen ein optionaler Wert fehlt', () => {
    const m = model({
      readings: [
        rd('2025-07-01', { bezug: 0, einsp: 0, wp: 0, wrEinsp: 0 }),
        rd('2025-07-11', { bezug: 50, einsp: 100 }),
        rd('2025-07-21', { bezug: 100, einsp: 200, wp: 60, wrEinsp: 240 }),
      ],
    })
    const t = agg(m, '2025-07-01', '2025-07-21')
    expect(t.wp).toBeCloseTo(60)
    expect(t.x).toBeCloseTo(40)
    expect(t.pvWP).toBeCloseTo(40)
    expect(agg(m, '2025-07-01', '2025-07-11').wp).toBeCloseTo(30)
  })

  it('ohne Einspeisung laut WR gibt es keinen PV-Anteil für WP und Wallbox', () => {
    const m = model({
      readings: [rd('2025-07-01', { bezug: 0, einsp: 0, wp: 0, wb: 0 }), rd('2025-07-11', { bezug: 80, einsp: 10, wp: 30, wb: 20 })],
    })
    const t = agg(m, '2025-07-01', '2025-07-11')
    expect(t.x).toBe(0)
    expect(t.netzWP).toBeCloseTo(30)
    expect(t.netzHaus).toBeCloseTo(30)
  })

  it('Speicher-Wirkungsgrad und Energiefluss gehen auf', () => {
    const m = model({
      readings: [
        rd('2025-07-01', { bezug: 0, einsp: 0, pv: 0, wrEinsp: 0, wp: 0, wb: 0, spLaden: 0, spEntladen: 0 }),
        rd('2025-07-11', { bezug: 40, einsp: 150, pv: 400, wrEinsp: 200, wp: 40, wb: 30, spLaden: 80, spEntladen: 72 }),
      ],
    })
    const t = agg(m, '2025-07-01', '2025-07-11')
    expect(kpis(t).spEff).toBeCloseTo(0.9)
    // PV 400 = Haus direkt + Speicher 80 + WP/WB 50 + Netz 150
    expect(t.pvHaus).toBeCloseTo(120)
    expect(t.pvHaus + t.spL + t.pvWP + t.pvWB + t.ze).toBeCloseTo(t.pv)
    expect(t.haus).toBeCloseTo(t.netzHaus + 120 + 72)
  })
})

describe('Eigener WP-Tarif', () => {
  const readings = [
    rd('2025-05-01', { bezug: 0, einsp: 0, wp: 0, wb: 0, wrEinsp: 0, pv: 0 }),
    rd('2025-05-11', { bezug: 100, einsp: 60, wp: 50, wb: 20, wrEinsp: 90, pv: 200 }),
  ]
  const tariffs = [tarif('2025-01-01', 30, 12), tarif('2025-01-01', 22, 6.2, { kind: 'wp' })]

  it('aus: WP läuft über den Hauptzähler und bekommt PV-Strom', () => {
    const t = agg(model({ readings, tariffs }), '2025-05-01', '2025-05-11')
    expect(t.x).toBeCloseTo(30)
    expect(t.pvWP + t.pvWB).toBeCloseTo(30)
    expect(t.pvWP).toBeGreaterThan(0)
    expect(t.netzHaus).toBeCloseTo(100 - t.netzWP - t.netzWB)
    expect(t.kHaus + t.kWP + t.kWB).toBeCloseTo(100 * 0.3)
    expect(t.kWPGrund).toBe(0)
    expect(t.bezug).toBeCloseTo(100)
  })

  it('an: WP ist eigener Netzanschluss, Z_bezug enthält sie nicht', () => {
    const t = agg(model({ readings, tariffs, s: { wpTarifAktiv: true } }), '2025-05-01', '2025-05-11')
    expect(t.pvWP).toBe(0)
    expect(t.netzWP).toBeCloseTo(50)
    expect(t.pvWB).toBeCloseTo(20)
    expect(t.rest).toBeCloseTo(10)
    expect(t.netzHaus).toBeCloseTo(100)
    expect(t.kWP).toBeCloseTo(50 * 0.22)
    expect(t.kWPGrund).toBeCloseTo((6.2 * 10) / 31)
    expect(t.bezug).toBeCloseTo(150)
    const k = kpis(t)
    expect(k.gesamt).toBeCloseTo(150 + 200 - 60)
    expect(k.kosten).toBeCloseTo(100 * 0.3 + 50 * 0.22 + (12 * 10) / 31 + (6.2 * 10) / 31)
  })

  it('gilt erst ab dem Stichtag', () => {
    const m = model({ readings, tariffs, s: { wpTarifAktiv: true, wpTarifSeit: '2025-05-06' } })
    expect(agg(m, '2025-05-01', '2025-05-06').nSep).toBe(0)
    const t = agg(m, '2025-05-06', '2025-05-11')
    expect(t.nSep).toBe(5)
    expect(t.kWP).toBeCloseTo(25 * 0.22)
  })
})

describe('Prognose und Abschläge', () => {
  it('zählt monatliche Abschläge im Zeitraum', () => {
    const a = [{ id: 'a', from: '2025-01-15', betrag: 100 }]
    expect(abschlagSumme(a, toDay('2025-01-01'), toDay('2026-01-01'))).toBe(1200)
    expect(abschlagSumme(a, toDay('2025-01-01'), toDay('2025-07-15'))).toBe(600)
    expect(abschlagSumme([{ ...a[0], to: '2025-03-31' }], toDay('2025-01-01'), toDay('2026-01-01'))).toBe(300)
  })

  it('rechnet ohne Vorjahr linear hoch', () => {
    const m = model({
      readings: [rd('2025-01-01', { bezug: 0, einsp: 0 }), rd('2025-07-02', { bezug: 1820, einsp: 364 })],
      tariffs: [tarif('2025-01-01', 30, 10)],
      feedins: [{ id: 'f', from: '2025-01-01', ct: 8 }],
      abschlaege: [{ id: 'a', from: '2025-01-10', betrag: 100 }],
    })
    const f = forecast(computeDaily(m), m, toDay('2025-07-02'))!
    expect(f.method).toBe('linear')
    expect(f.bezug).toBeCloseTo(3650)
    expect(f.kosten).toBeCloseTo(3650 * 0.3 + 120)
    expect(f.verg).toBeCloseTo(730 * 0.08)
    expect(f.abschlaegeGezahlt).toBe(600)
    expect(f.abschlaegeKommend).toBe(600)
    expect(f.differenz).toBeCloseTo(3650 * 0.3 + 120 - 1200)
  })

  it('gewichtet mit Vorjahresdaten saisonal', () => {
    // Vorjahr: 1. Halbjahr 10 kWh/Tag, 2. Halbjahr 30 kWh/Tag. Dieses Jahr bisher 20 % mehr.
    const h1 = toDay('2024-07-01') - toDay('2024-01-01')
    const h2 = toDay('2025-01-01') - toDay('2024-07-01')
    const d25 = toDay('2025-07-01') - toDay('2025-01-01')
    const m = model({
      readings: [
        rd('2024-01-01', { bezug: 0, einsp: 0 }),
        rd('2024-07-01', { bezug: h1 * 10, einsp: 0 }),
        rd('2025-01-01', { bezug: h1 * 10 + h2 * 30, einsp: 0 }),
        rd('2025-07-01', { bezug: h1 * 10 + h2 * 30 + d25 * 12, einsp: 0 }),
      ],
      tariffs: [tarif('2024-01-01', 30)],
    })
    const f = forecast(computeDaily(m), m, toDay('2025-07-01'))!
    expect(f.method).toBe('saisonal')
    const rest = dayOf(2026, 0, 1) - toDay('2025-07-01')
    // Vergleichszeitraum liegt komplett im 1. Halbjahr 2024 → Skalierung 1,2.
    // 2024 ist ein Schaltjahr: der erste Prognosetag fällt auf den 30.6.2024 (10 kWh).
    const scale = 1.2
    expect(f.bezug).toBeCloseTo(d25 * 12 + ((rest - 1) * 30 + 10) * scale, 3)
    // linear wären es nur 12 kWh/Tag
    expect(f.bezug).toBeGreaterThan(365 * 12 * 1.5)
  })
})

describe('Plausibilitätscheck', () => {
  const readings = [
    rd('2025-01-01', { bezug: 0, einsp: 0 }),
    rd('2025-01-11', { bezug: 100, einsp: 0 }),
    rd('2025-01-21', { bezug: 200, einsp: 0 }),
  ]
  const s = buildSeries(readings, [])
  const chk = (v: number) => checkField(s.bezug, readings, { changes: [] }, 'bezug', '2025-01-31', v)

  it('warnt bei kleinerem Stand', () => expect(chk(150).warn).toMatch(/Kleiner/))
  it('warnt beim Dreifachen des Schnitts', () => expect(chk(520).warn).toMatch(/dreimal/))
  it('bleibt bei normalen Werten still', () => {
    const c = chk(310)
    expect(c.warn).toBeUndefined()
    expect(c.delta).toBeCloseTo(110)
    expect(c.prevRaw).toBe(200)
  })
})

describe('Demo-Datensatz', () => {
  const demo = buildDemo('2026-11-12')
  const m = model({ ...demo })
  const daily = computeDaily(m)

  it('umfasst rund zwei Jahre mit plausiblen Werten', () => {
    expect(demo.readings.length).toBeGreaterThan(40)
    expect(daily.end - daily.start).toBeGreaterThan(700)
    const t = aggregate(daily, toDay('2026-01-01'), daily.end)
    const k = kpis(t)
    expect(plausibilitaet(t)).toEqual([])
    expect(k.autarkie!).toBeGreaterThan(0.3)
    expect(k.autarkie!).toBeLessThan(0.9)
    expect(k.evQuote!).toBeGreaterThan(0.2)
    expect(k.evQuote!).toBeLessThan(0.8)
    expect(k.spEff!).toBeGreaterThan(0.8)
    expect(t.netzHaus).toBeGreaterThan(0)
    expect(t.rest).toBeLessThan(0.5)
  })

  it('liefert Prognose und Empfehlungen', () => {
    const f = forecast(daily, m, toDay('2026-11-12'))!
    expect(f.method).toBe('saisonal')
    expect(f.kosten).toBeGreaterThan(f.kostenBisher)
    const a = advise(daily, model({ ...demo, s: { advice: { wpAp: 24, wpGrund: 6, zaehlerJahr: 30, m1Pauschale: 150 } } }))!
    expect(a.rechnungen.map((r) => r.id)).toEqual(['wp-tarif', '14a-m1'])
  })
})

describe('Zahleneingabe', () => {
  it('versteht deutsche Schreibweisen', () => {
    expect(parseNum('1.234,5')).toBe(1234.5)
    expect(parseNum('1234,5')).toBe(1234.5)
    expect(parseNum('1234.5')).toBe(1234.5)
    expect(parseNum('12.345')).toBe(12345)
    expect(parseNum(' 42 ')).toBe(42)
    expect(parseNum('')).toBeUndefined()
    expect(parseNum('abc')).toBeUndefined()
  })
})
