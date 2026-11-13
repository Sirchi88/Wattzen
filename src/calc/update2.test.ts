import { describe, expect, it } from 'vitest'
import { addMonths, dayOf, fromDay, toDay } from '../lib/dates'
import type { MeterConf } from '../types'
import { buildDemo } from './demo'
import { aggregate, aggregateCustom, computeDaily, kpis, plausibilitaet } from './engine'
import { ablesungFaellig, amortisation, contractHints, costTable } from './finance'
import { makeIcs, readingReminder } from './ics'
import { mergeMeters, orderedGroups } from './meters'
import { climateFrom, fitPr, fitWp, GERMANY, hgt, pvCheck, smartForecast, type WxMap } from './smart'
import { model, rd, tarif } from './testutil'

const agg = (m: ReturnType<typeof model>, from: string, to: string) => aggregate(computeDaily(m), toDay(from), toDay(to))

describe('WechselRichter-Import: gemessener Netzanteil', () => {
  // 10 Tage: Hauptzähler 100 kWh Bezug, 60 Einspeisung; WechselRichter: Import 40, Export 90; WP 50, Wallbox 20
  const base = { bezug: 0, einsp: 0, wp: 0, wb: 0, wrEinsp: 0, pv: 0, wrImport: 0 }
  const readings = [
    rd('2025-05-01', base),
    rd('2025-05-11', { bezug: 100, einsp: 60, wp: 50, wb: 20, wrEinsp: 90, pv: 200, wrImport: 40 }),
  ]
  const tariffs = [tarif('2025-01-01', 30)]

  it('misst Netz für Haus und für WP + Wallbox', () => {
    const t = agg(model({ readings, tariffs }), '2025-05-01', '2025-05-11')
    expect(t.nImp).toBe(10)
    expect(t.netzHaus).toBeCloseTo(40)
    expect(t.mNetz).toBeCloseTo(60)
    expect(t.x).toBeCloseTo(30)
    // Nur die Aufteilung zwischen WP und Wallbox ist geschätzt
    expect(t.pvWP + t.pvWB).toBeCloseTo(30)
    expect(t.netzWP).toBeCloseTo(50 - t.pvWP)
    expect(t.netzWB).toBeCloseTo(20 - t.pvWB)
    expect(kpis(t).gemessen).toBe(1)
  })

  it('Plausibilität: Netz + PV für WP/WB gegen Zählersumme', () => {
    const t = agg(model({ readings, tariffs }), '2025-05-01', '2025-05-11')
    const k = kpis(t)
    // 60 + 30 = 90 gegen 50 + 20 = 70 → +20 kWh, +28,6 %
    expect(k.plausDiff).toBeCloseTo(20)
    expect(k.plausPct).toBeCloseTo(20 / 70)
    expect(plausibilitaet(t, 0.03)[0]).toMatch(/\+20,0 kWh/)
    expect(plausibilitaet(t, 0.5)).toEqual([])
  })

  it('passt bei stimmigen Zählern ohne Warnung', () => {
    const ok = [rd('2025-05-01', base), rd('2025-05-11', { bezug: 100, einsp: 60, wp: 65, wb: 25, wrEinsp: 90, pv: 200, wrImport: 40 })]
    const t = agg(model({ readings: ok, tariffs }), '2025-05-01', '2025-05-11')
    expect(kpis(t).plausPct).toBeCloseTo(0)
    expect(plausibilitaet(t)).toEqual([])
  })

  it('fällt ohne Import auf die alte Rechnung zurück', () => {
    const r = [
      rd('2025-05-01', base),
      rd('2025-05-11', { bezug: 100, einsp: 60, wp: 50, wb: 20, wrEinsp: 90, pv: 200, wrImport: 40 }),
      rd('2025-05-21', { bezug: 200, einsp: 120, wp: 100, wb: 40, wrEinsp: 180, pv: 400 }),
    ]
    const t = agg(model({ readings: r, tariffs }), '2025-05-11', '2025-05-21')
    expect(t.nImp).toBe(0)
    expect(t.netzHaus).toBeCloseTo(100 - t.netzWP - t.netzWB)
  })
})

describe('Eigene Zähler mit Kostenmodell', () => {
  const wasser: MeterConf = {
    id: 'c_w', builtin: false, group: 'eigene', name: 'Wasser', icon: 'droplet', color: 'wasser', unit: 'm³',
    decimals: 3, active: true, order: 0,
    costs: {
      grund: [{ id: 'g', from: '2025-01-01', eurMonat: 3.1 }],
      parts: [
        { id: 'p1', from: '2025-01-01', name: 'Frischwasser', preis: 2.1 },
        { id: 'p2', from: '2025-01-01', name: 'Abwasser', preis: 2.85, minus: 'c_g' },
        { id: 'p3', from: '2025-03-01', name: 'Neuer Preis', preis: 1 },
      ],
      abschlaege: [{ id: 'a', from: '2025-01-15', betrag: 30 }],
    },
  }
  const garten: MeterConf = { ...wasser, id: 'c_g', name: 'Garten', costs: { grund: [], parts: [], abschlaege: [] } }
  const m = model({
    meters: [wasser, garten],
    readings: [
      rd('2025-02-01', { bezug: 0, einsp: 0, c_w: 100, c_g: 10 }),
      rd('2025-03-01', { bezug: 280, einsp: 0, c_w: 114, c_g: 12.8 }),
    ],
  })
  const daily = computeDaily(m)

  it('rechnet Grundgebühr und Preisbestandteile mit Abzugszähler', () => {
    const c = aggregateCustom(daily, 'c_w', toDay('2025-02-01'), toDay('2025-03-01'))
    expect(c.qty).toBeCloseTo(14)
    expect(c.grund).toBeCloseTo(3.1)
    // Frischwasser auf 14 m³, Abwasser auf 14 − 2,8 m³; „Neuer Preis“ gilt erst ab März
    expect(c.variabel).toBeCloseTo(14 * 2.1 + 11.2 * 2.85)
    const t = aggregate(daily, toDay('2025-02-01'), toDay('2025-03-01'))
    expect(t.kCustGrund + t.kCustVar).toBeCloseTo(c.kosten)
  })

  it('erscheint in der Kostentabelle', () => {
    const { rows, sum } = costTable(daily, toDay('2025-02-01'), toDay('2025-03-01'))
    expect(rows).toHaveLength(1)
    expect(sum.fix).toBeCloseTo(3.1)
    expect(sum.eigene).toBeCloseTo(14 * 2.1 + 11.2 * 2.85)
  })
})

describe('Zählerverwaltung', () => {
  it('eingebaute Zähler lassen sich ausblenden, aber Pflichtzähler nicht', () => {
    const meters = mergeMeters([
      { ...mergeMeters([]).find((x) => x.id === 'bezug')!, active: false },
      { ...mergeMeters([]).find((x) => x.id === 'wb')!, active: false },
    ])
    expect(meters.find((x) => x.id === 'bezug')!.active).toBe(true)
    expect(meters.find((x) => x.id === 'wb')!.active).toBe(false)
    const groups = orderedGroups(meters)
    expect(groups.map((g) => g.key)).not.toContain('wb')
    expect(groups[0].meters.map((x) => x.id)).toEqual(['bezug', 'einsp'])
  })

  it('folgt der eingestellten Reihenfolge', () => {
    const meters = mergeMeters([{ ...mergeMeters([]).find((x) => x.id === 'einsp')!, order: -1 }])
    const g = orderedGroups(meters, ['wp', 'haupt'])
    expect(g[0].key).toBe('wp')
    expect(g[1].meters.map((x) => x.id)).toEqual(['einsp', 'bezug'])
  })
})

/* ───────────── Wetter und Prognose ───────────── */

/** Synthetisches Wetter: Klimamittel ohne Rauschen. */
function synthWx(from: number, to: number): WxMap {
  const wx: WxMap = new Map()
  for (let d = from; d < to; d++) {
    const i = d - dayOf(new Date(d * 864e5).getUTCFullYear(), 0, 1)
    wx.set(d, { t: GERMANY.t[Math.min(365, i)], rad: GERMANY.rad[Math.min(365, i)] })
  }
  return wx
}

/** Ablesungen alle 10 Tage aus einem Tagesmodell erzeugen. */
function simulate(from: string, days: number, perDay: (day: number) => Record<string, number>, step = 10) {
  const a = toDay(from)
  const cum: Record<string, number> = { bezug: 0, einsp: 0 }
  const readings = []
  for (let d = a; d <= a + days; d++) {
    if ((d - a) % step === 0) readings.push(rd(fromDay(d), { ...cum }))
    const v = perDay(d)
    for (const k of Object.keys(v)) cum[k] = (cum[k] ?? 0) + v[k]
  }
  return readings
}

describe('Wetterbasierte Modelle', () => {
  const from = '2025-01-01'
  const wx = synthWx(toDay(from) - 5, toDay(from) + 800)

  it('Heizgradtage mit Heizgrenze', () => {
    expect(hgt(5, 15)).toBe(10)
    expect(hgt(18, 15)).toBe(0)
  })

  it('lernt die WP-Kennlinie per Regression', () => {
    const readings = simulate(from, 400, (d) => ({ bezug: 10, einsp: 0, wp: 2 + 1.4 * hgt(wx.get(d)!.t, 15) }))
    const fit = fitWp(computeDaily(model({ readings })), wx, GERMANY, 15)
    expect(fit.fitted).toBe(true)
    expect(fit.a).toBeCloseTo(2, 0)
    expect(fit.b).toBeCloseTo(1.4, 1)
  })

  it('nimmt ohne Daten Startwerte aus der Fläche', () => {
    const readings = simulate(from, 20, () => ({ bezug: 10, einsp: 0 }))
    const fit = fitWp(computeDaily(model({ readings })), wx, GERMANY, 15, 200)
    expect(fit.fitted).toBe(false)
    expect(fit.b).toBeCloseTo(2.2)
  })

  it('lernt die Performance Ratio, Startwert 0,8', () => {
    const readings = simulate(from, 120, (d) => ({ bezug: 5, einsp: 10, pv: 8 * wx.get(d)!.rad * 0.9 }))
    const daily = computeDaily(model({ readings }))
    expect(fitPr(daily, wx, GERMANY, 8).pr).toBeCloseTo(0.9, 2)
    expect(fitPr(daily, new Map(), GERMANY, 8)).toEqual({ pr: 0.8, fitted: false })
  })

  it('rechnet Klimamittel aus Tageswerten', () => {
    const rows = [...synthWx(toDay('2015-01-01'), toDay('2025-01-01')).entries()].map(([day, w]) => ({ day, ...w }))
    const c = climateFrom(rows, 'Testort')!
    expect(c.source).toBe('ort')
    expect(c.t[15]).toBeLessThan(3)
    expect(c.t[200]).toBeGreaterThan(16)
  })
})

describe('Prognose ist saisonal, nicht linear', () => {
  // Sommerhalbjahr Mai–Oktober: wenig Netzbezug. Die Prognose für Nov–Feb muss deutlich steigen.
  const from = '2025-05-01'
  const wx = synthWx(toDay(from) - 5, toDay(from) + 600)
  const readings = simulate(from, 183, (d) => {
    const w = wx.get(d)!
    const wp = 2 + 1.5 * hgt(w.t, 15)
    const pv = 9 * w.rad * 0.85
    const haus = 8
    const v = haus + wp
    const ev = 0.7 * Math.min(pv, v)
    return { bezug: v - ev, einsp: pv - ev, pv, wp, wrEinsp: pv - ev }
  })
  const m = model({
    readings,
    tariffs: [tarif('2025-01-01', 30, 12)],
    feedins: [{ id: 'f', from: '2025-01-01', ct: 8 }],
    abschlaege: [{ id: 'a', from: '2025-01-15', betrag: 100 }],
    feedinAbschlaege: [{ id: 'fa', from: '2025-01-15', betrag: 20 }],
    s: { house: { kwp: 9, flaeche: 140 } },
  })
  const daily = computeDaily(m)
  const today = daily.end
  const f = smartForecast(daily, m, { wx, clim: GERMANY, today })!

  it('zeigt den Winteranstieg beim Netzbezug', () => {
    const sommer = aggregate(daily, toDay('2025-06-01'), toDay('2025-09-01'))
    const proTagSommer = sommer.bezug / sommer.days
    const jan = f.months.find((x) => x.start === dayOf(2026, 0, 1))!
    expect(jan.bezug / 31).toBeGreaterThan(proTagSommer * 2.5)
  })

  it('liefert Jahres- und 12-Monats-Werte mit Spanne und Begründung', () => {
    expect(f.year).toBe(2025)
    expect(f.next12End - f.from).toBe(365)
    expect(f.strom.lo).toBeLessThan(f.strom.differenz)
    expect(f.strom.hi).toBeGreaterThan(f.strom.differenz)
    expect(f.basis).toMatch(/Wärmepumpe/)
    expect(f.einsp).toBeDefined()
    expect(f.gesamt.differenz).toBeCloseTo(f.strom.differenz - f.einsp!.saldo)
  })

  it('rechnet nach Vertragsende mit dem letzten Tarif weiter', () => {
    const m2 = model({ ...m, tariffs: [tarif('2025-01-01', 30, 12, { to: '2025-12-31' })], s: m.settings })
    const f2 = smartForecast(computeDaily(m2), m2, { wx, clim: GERMANY, today })!
    expect(f2.next12.kosten).toBeCloseTo(f.next12.kosten, 6)
    expect(f2.next12.kosten).toBeGreaterThan(f2.next12.bezug * 0.3)
  })

  it('rechnet Abschläge gegen die Kosten (ab Datenbeginn im Mai)', () => {
    expect(f.teiljahr).toBe(true)
    expect(f.strom.gezahlt + f.strom.kommend).toBe(800)
    expect(f.einsp!.erhalten + f.einsp!.kommend).toBe(160)
  })
})

describe('PV-Anlagen-Check', () => {
  const from = '2025-03-01'
  const wx = synthWx(toDay(from) - 5, toDay(from) + 400)
  it('meldet zwei Monate in Folge unter 85 %', () => {
    const readings = simulate(from, 245, (d) => {
      const drop = d >= toDay('2025-09-01') ? 0.7 : 1
      return { bezug: 5, einsp: 10, pv: 8 * wx.get(d)!.rad * 0.85 * drop }
    }, 5)
    const daily = computeDaily(model({ readings }))
    const c = pvCheck(daily, wx, 8, { pr: 0.85, fitted: true })!
    expect(c.rows.find((r) => r.start === toDay('2025-05-01'))!.pct).toBeCloseTo(1, 2)
    expect(c.rows.find((r) => r.start === toDay('2025-09-01'))!.pct).toBeCloseTo(0.7, 1)
    expect(c.alarm).toBe(true)
  })
})

describe('Vertragsende-Hinweis', () => {
  const t = tarif('2025-01-01', 30, 10, { to: '2025-12-31', fristWochen: 4 })
  const m = model({ tariffs: [t], s: { contractLead: 8 } })
  // Frist endet am 3.12.; Hinweis ab 8 Wochen vorher = 8.10.
  it('erscheint ab dem Vorlauf vor der Kündigungsfrist', () => {
    expect(contractHints(m, toDay('2025-10-07'))).toHaveLength(0)
    const h = contractHints(m, toDay('2025-10-08'))
    expect(h).toHaveLength(1)
    expect(h[0].text).toBe('Dein Stromvertrag läuft am 31.12. aus')
    expect(h[0].sub).toMatch(/Kündigen bis 3\.12\./)
  })

  it('kommt 7 Tage nach dem Wegwischen wieder', () => {
    const key = contractHints(m, toDay('2025-10-10'))[0].key
    const m2 = model({ tariffs: [t], s: { dismissed: { [key]: '2025-10-10' } } })
    expect(contractHints(m2, toDay('2025-10-16'))).toHaveLength(0)
    expect(contractHints(m2, toDay('2025-10-17'))).toHaveLength(1)
  })

  it('verschwindet mit neuem Tarif', () => {
    const m3 = model({ tariffs: [t, tarif('2026-01-01', 28)] })
    expect(contractHints(m3, toDay('2025-12-01'))).toHaveLength(0)
  })
})

describe('Kalender und Fälligkeit', () => {
  it('erzeugt einen monatlichen Termin am 1. mit Alarm', () => {
    const ics = readingReminder(toDay('2025-11-12'), '18:00')
    expect(ics).toMatch(/DTSTART:20251201T180000/)
    expect(ics).toMatch(/RRULE:FREQ=MONTHLY;BYMONTHDAY=1/)
    expect(ics).toMatch(/BEGIN:VALARM/)
    expect(ics.split('\r\n').every((l) => l.length <= 75)).toBe(true)
  })

  it('maskiert Sonderzeichen', () => {
    expect(makeIcs([{ uid: 'x', title: 'A, B; C', day: 0, time: '09:00' }])).toMatch(/SUMMARY:A\\, B\\; C/)
  })

  it('Fällig-Punkt, solange seit dem 1. nicht abgelesen wurde', () => {
    const m = model({ readings: [rd('2025-10-20', { bezug: 0, einsp: 0 })] })
    expect(ablesungFaellig(m, toDay('2025-11-05'))).toBe(true)
    expect(ablesungFaellig(m, toDay('2025-10-25'))).toBe(false)
  })
})

describe('Demo mit Update 2', () => {
  const demo = buildDemo('2026-11-12')
  const m = model({ ...demo, s: { house: demo.house } })
  const daily = computeDaily(m)
  const wx: WxMap = new Map(demo.weather.map((w) => [toDay(w.date), { t: w.t, rad: w.rad }]))

  it('Import misst, Plausibilität innerhalb der Toleranz', () => {
    const t = aggregate(daily, toDay('2026-01-01'), daily.end)
    const k = kpis(t)
    expect(k.gemessen).toBe(1)
    expect(Math.abs(k.plausPct!)).toBeLessThan(0.03)
    expect(k.jaz!).toBeGreaterThan(2.5)
    expect(k.jaz!).toBeLessThan(4.5)
  })

  it('lernt WP und PR aus dem simulierten Wetter', () => {
    const w = fitWp(daily, wx, GERMANY, 15, 145)
    expect(w.fitted).toBe(true)
    expect(w.b).toBeGreaterThan(1.2)
    expect(w.b).toBeLessThan(1.9)
    const pr = fitPr(daily, wx, GERMANY, 9.8)
    expect(pr.pr).toBeGreaterThan(0.75)
    expect(pr.pr).toBeLessThan(0.95)
  })

  it('Amortisation und Wasser-Kosten', () => {
    const a = amortisation(daily, m)!
    expect(a.geschaetzt).toBeGreaterThan(0)
    expect(a.pct).toBeGreaterThan(0.2)
    expect(a.tag).toBeGreaterThan(daily.end)
    const w = aggregateCustom(daily, 'c_demo_wasser', addMonths(daily.end, -12), daily.end)
    expect(w.qty / w.n).toBeGreaterThan(0.25)
    expect(w.kosten).toBeGreaterThan(400)
  })

  it('zeigt den Vertragsende-Hinweis', () => {
    expect(contractHints(m, toDay('2026-11-12'))[0].text).toMatch(/31\.12\./)
  })
})
