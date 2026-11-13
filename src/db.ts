import Dexie, { type Table } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildDemo } from './calc/demo'
import { builtinDefaults, customMeters, mergeMeters } from './calc/meters'
import { todayIso } from './lib/dates'
import { parseNum } from './lib/format'
import {
  DEFAULT_SETTINGS,
  type Abschlag, type FeedIn, type House, type MeterChange, type MeterConf, type Model, type Reading, type Settings, type Tariff,
} from './types'

export interface WeatherRow {
  date: string
  t: number
  rad: number
  /** 'archiv' | 'vorhersage' | 'demo' */
  src: string
}
export interface WeatherMeta {
  key: 'weather'
  loc: string
  label: string
  archiveUntil?: string
  forecastAt?: number
  climate?: { t: number[]; rad: number[]; label: string }
}

export class WattzenDB extends Dexie {
  readings!: Table<Reading, string>
  tariffs!: Table<Tariff, string>
  feedins!: Table<FeedIn, string>
  abschlaege!: Table<Abschlag, string>
  feedinAbschlaege!: Table<Abschlag, string>
  meterChanges!: Table<MeterChange, string>
  meters!: Table<MeterConf, string>
  settings!: Table<{ key: string; value: Settings }, string>
  weather!: Table<WeatherRow, string>
  meta!: Table<WeatherMeta, string>

  constructor(name = 'wattzen') {
    super(name)
    this.version(1).stores({
      readings: 'id, date',
      tariffs: 'id, from',
      feedins: 'id, from',
      abschlaege: 'id, from',
      meterChanges: 'id, date',
      settings: 'key',
    })
    // Version 2: Zählerverwaltung, Einspeise-Abschläge, Wetter-Cache.
    // Der Kilometerstand wandert aus `km` in `values.km`; alte Ablesungen bleiben vollständig erhalten.
    this.version(2)
      .stores({
        readings: 'id, date',
        tariffs: 'id, from',
        feedins: 'id, from',
        abschlaege: 'id, from',
        meterChanges: 'id, date',
        settings: 'key',
        meters: 'id',
        feedinAbschlaege: 'id, from',
        weather: 'date',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const s = (await tx.table('settings').get('main')) as { key: string; value: Record<string, unknown> } | undefined
        let anyKm = false
        await tx
          .table('readings')
          .toCollection()
          .modify((r: Reading & { km?: number }) => {
            if (typeof r.km === 'number') {
              r.values = { ...r.values, km: r.km }
              anyKm = true
            }
            delete r.km
          })
        if (s?.value?.showKm || anyKm) {
          const km = builtinDefaults().find((d) => d.id === 'km')!
          await tx.table('meters').put({ ...km, active: true })
        }
        if (s?.value) {
          const v = { ...s.value }
          delete v.showKm
          delete v.lastBackup
          await tx.table('settings').put({ key: 'main', value: v })
        }
      })
  }
}

export const db = new WattzenDB()

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const withDefaults = (s?: Partial<Settings>): Settings => ({
  ...DEFAULT_SETTINGS,
  ...s,
  advice: { ...DEFAULT_SETTINGS.advice, ...s?.advice },
  house: { ...DEFAULT_SETTINGS.house, ...s?.house },
  dismissed: { ...s?.dismissed },
  factors: s?.factors?.length === 12 ? s.factors : DEFAULT_SETTINGS.factors,
  groupOrder: s?.groupOrder?.length ? s.groupOrder : DEFAULT_SETTINGS.groupOrder,
})

/** Alle Daten live aus IndexedDB. `undefined`, solange geladen wird. */
export function useModel(): Model | undefined {
  return useLiveQuery(async () => {
    const [readings, tariffs, feedins, abschlaege, feedinAbschlaege, changes, meters, s] = await Promise.all([
      db.readings.orderBy('date').toArray(),
      db.tariffs.orderBy('from').toArray(),
      db.feedins.orderBy('from').toArray(),
      db.abschlaege.orderBy('from').toArray(),
      db.feedinAbschlaege.orderBy('from').toArray(),
      db.meterChanges.orderBy('date').toArray(),
      db.meters.toArray(),
      db.settings.get('main'),
    ])
    return {
      readings, tariffs, feedins, abschlaege, feedinAbschlaege, changes,
      meters: mergeMeters(meters),
      settings: withDefaults(s?.value),
    }
  }, [])
}

export async function saveSettings(patch: Partial<Settings>) {
  await db.transaction('rw', db.settings, async () => {
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({ key: 'main', value: { ...cur, ...patch } })
  })
  if (patch.theme) applyTheme(patch.theme)
}

export async function saveHouse(patch: Partial<House>) {
  await db.transaction('rw', db.settings, async () => {
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({ key: 'main', value: { ...cur, house: { ...cur.house, ...patch } } })
  })
}

export async function saveMeter(m: MeterConf) {
  await db.meters.put(m)
}

export function applyTheme(theme: Settings['theme']) {
  try {
    localStorage.setItem('wattzen-theme', theme)
  } catch {
    /* privater Modus */
  }
  const t = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F4F4F1' : '#0A0A0B')
}

const DATA_TABLES = () => [db.readings, db.tariffs, db.feedins, db.abschlaege, db.feedinAbschlaege, db.meterChanges, db.meters]

/* ───────────── Datei-Ausgabe ───────────── */

export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* ───────────── Backup ───────────── */

interface BackupFile {
  app: 'wattzen'
  version: 2
  exportedAt: string
  readings: Reading[]
  tariffs: Tariff[]
  feedins: FeedIn[]
  abschlaege: Abschlag[]
  feedinAbschlaege: Abschlag[]
  meterChanges: MeterChange[]
  meters: MeterConf[]
  settings: Settings
}

export function exportJson(m: Model) {
  const file: BackupFile = {
    app: 'wattzen', version: 2, exportedAt: new Date().toISOString(),
    readings: m.readings, tariffs: m.tariffs, feedins: m.feedins, abschlaege: m.abschlaege,
    feedinAbschlaege: m.feedinAbschlaege, meterChanges: m.changes, meters: m.meters, settings: m.settings,
  }
  saveFile(`wattzen-backup-${todayIso()}.json`, JSON.stringify(file, null, 2), 'application/json')
}

const csvCols = (m: Pick<Model, 'meters'>) => m.meters.map((x) => ({ id: x.id, head: x.builtin ? x.id : x.name }))

export function exportCsv(m: Model) {
  const cols = csvCols(m)
  const de = (v?: number) => (v === undefined ? '' : String(v).replace('.', ','))
  const rows = m.readings.map((r) => [r.date, r.time ?? '', ...cols.map((c) => de(r.values[c.id]))].join(';'))
  const head = ['datum', 'uhrzeit', ...cols.map((c) => c.head.replace(/;/g, ','))].join(';')
  saveFile(`wattzen-ablesungen-${todayIso()}.csv`, '﻿' + [head, ...rows].join('\r\n'), 'text/csv')
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Vollständiges Backup einspielen – ersetzt alle vorhandenen Daten. Liest auch Backups der Version 1. */
export async function importJson(text: string): Promise<number> {
  let f: Omit<Partial<BackupFile>, 'readings'> & { readings?: (Reading & { km?: number })[] }
  try {
    f = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  if (f?.app !== 'wattzen' || !Array.isArray(f.readings)) throw new Error('Das ist kein WATTZEN-Backup.')
  if (!f.readings.every((r) => r && isDate(r.date) && r.values && typeof r.values === 'object'))
    throw new Error('Das Backup enthält ungültige Ablesungen.')
  const readings = f.readings.map(({ km, ...r }) => (typeof km === 'number' ? { ...r, values: { ...r.values, km } } : r))
  const old = f.settings as (Settings & { showKm?: boolean }) | undefined
  const meters = [...(f.meters ?? [])]
  if (old?.showKm && !meters.some((x) => x.id === 'km')) meters.push({ ...builtinDefaults().find((d) => d.id === 'km')!, active: true })
  await db.transaction('rw', [...DATA_TABLES(), db.settings], async () => {
    await Promise.all(DATA_TABLES().map((t) => t.clear()))
    await db.readings.bulkPut(readings)
    await db.tariffs.bulkPut(f.tariffs ?? [])
    await db.feedins.bulkPut(f.feedins ?? [])
    await db.abschlaege.bulkPut(f.abschlaege ?? [])
    await db.feedinAbschlaege.bulkPut(f.feedinAbschlaege ?? [])
    await db.meterChanges.bulkPut(f.meterChanges ?? [])
    await db.meters.bulkPut(meters)
    await db.settings.put({ key: 'main', value: { ...withDefaults(f.settings), onboarded: true } })
  })
  applyTheme(withDefaults(f.settings).theme)
  return readings.length
}

/** Ablesungen aus CSV einspielen – vorhandene Tage werden überschrieben, der Rest bleibt. */
export async function importCsv(text: string, m: Pick<Model, 'meters'>): Promise<number> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('Die CSV-Datei enthält keine Ablesungen.')
  const sep = lines[0].includes(';') ? ';' : ','
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name.toLowerCase())
  if (col('datum') < 0 || col('bezug') < 0 || col('einsp') < 0)
    throw new Error('Spalten „datum", „bezug" und „einsp" werden benötigt.')
  const cols = [...csvCols(m), { id: 'km', head: 'km' }]
  const parsed: Reading[] = []
  for (const line of lines.slice(1)) {
    const c = line.split(sep)
    let date = c[col('datum')]?.trim()
    const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(date ?? '')
    if (de) date = `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
    if (!isDate(date)) throw new Error(`Ungültiges Datum: „${c[col('datum')]}"`)
    const values: Reading['values'] = {}
    for (const m of cols) {
      const i = col(m.head)
      const v = i >= 0 ? parseNum(c[i] ?? '') : undefined
      if (v !== undefined) values[m.id] = v
    }
    if (values.bezug === undefined || values.einsp === undefined)
      throw new Error(`Am ${date} fehlen Netzbezug oder Einspeisung.`)
    const time = col('uhrzeit') >= 0 ? c[col('uhrzeit')]?.trim() || undefined : undefined
    parsed.push({ id: uid(), date, time, values })
  }
  await db.transaction('rw', db.readings, async () => {
    for (const r of parsed) {
      const old = await db.readings.where('date').equals(r.date).first()
      await db.readings.put(old ? { ...r, id: old.id } : r)
    }
  })
  return parsed.length
}

/* ───────────── Demo und Zurücksetzen ───────────── */

export async function loadDemo() {
  const demo = buildDemo(todayIso())
  await db.transaction('rw', [...DATA_TABLES(), db.settings, db.weather, db.meta], async () => {
    await Promise.all([...DATA_TABLES(), db.weather, db.meta].map((t) => t.clear()))
    await db.readings.bulkPut(demo.readings)
    await db.tariffs.bulkPut(demo.tariffs)
    await db.feedins.bulkPut(demo.feedins)
    await db.abschlaege.bulkPut(demo.abschlaege)
    await db.feedinAbschlaege.bulkPut(demo.feedinAbschlaege)
    await db.meters.bulkPut(demo.meters)
    await db.weather.bulkPut(demo.weather.map((w) => ({ ...w, src: 'demo' })))
    await db.meta.put({ key: 'weather', loc: 'demo', label: 'Demo-Ort', climate: demo.climate })
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({
      key: 'main',
      value: {
        ...cur, onboarded: true, demo: true, house: demo.house, dismissed: {},
        advice: { wpAp: 24.9, wpGrund: 6.5, zaehlerJahr: 30, m1Pauschale: 158, m1Mehrkosten: 0, m2Reduktion: 6.2 },
      },
    })
  })
}

/**
 * Löscht Daten. `nurAblesungen`: nur Ablesungen und Zählerwechsel, Tarife und Einstellungen bleiben.
 * Sonst alles; Darstellung (Theme, Splash) bleibt erhalten.
 */
export async function clearData(opts: { nurAblesungen?: boolean; backToOnboarding?: boolean } = {}) {
  if (opts.nurAblesungen) {
    await db.transaction('rw', db.readings, db.meterChanges, async () => {
      await db.readings.clear()
      await db.meterChanges.clear()
    })
    return
  }
  await db.transaction('rw', [...DATA_TABLES(), db.settings, db.weather, db.meta], async () => {
    await Promise.all([...DATA_TABLES(), db.weather, db.meta].map((t) => t.clear()))
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({
      key: 'main',
      value: {
        ...DEFAULT_SETTINGS, theme: cur.theme, splash: cur.splash, splashDauer: cur.splashDauer,
        onboarded: !opts.backToOnboarding,
      },
    })
  })
}

export const hasCustom = (m: Model) => customMeters(m).length > 0
