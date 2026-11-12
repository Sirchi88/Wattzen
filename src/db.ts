import Dexie, { type Table } from 'dexie'
import { useLiveQuery } from 'dexie-react-hooks'
import { buildDemo } from './calc/demo'
import { todayIso } from './lib/dates'
import { parseNum } from './lib/format'
import {
  DEFAULT_SETTINGS, METERS,
  type Abschlag, type FeedIn, type MeterChange, type Model, type Reading, type Settings, type Tariff,
} from './types'

class WattzenDB extends Dexie {
  readings!: Table<Reading, string>
  tariffs!: Table<Tariff, string>
  feedins!: Table<FeedIn, string>
  abschlaege!: Table<Abschlag, string>
  meterChanges!: Table<MeterChange, string>
  settings!: Table<{ key: string; value: Settings }, string>

  constructor() {
    super('wattzen')
    this.version(1).stores({
      readings: 'id, date',
      tariffs: 'id, from',
      feedins: 'id, from',
      abschlaege: 'id, from',
      meterChanges: 'id, date',
      settings: 'key',
    })
  }
}

export const db = new WattzenDB()

export const uid = () =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

const withDefaults = (s?: Partial<Settings>): Settings => ({
  ...DEFAULT_SETTINGS,
  ...s,
  advice: { ...DEFAULT_SETTINGS.advice, ...s?.advice },
  factors: s?.factors?.length === 12 ? s.factors : DEFAULT_SETTINGS.factors,
})

/** Alle Daten live aus IndexedDB. `undefined`, solange geladen wird. */
export function useModel(): Model | undefined {
  return useLiveQuery(async () => {
    const [readings, tariffs, feedins, abschlaege, changes, s] = await Promise.all([
      db.readings.orderBy('date').toArray(),
      db.tariffs.orderBy('from').toArray(),
      db.feedins.orderBy('from').toArray(),
      db.abschlaege.orderBy('from').toArray(),
      db.meterChanges.orderBy('date').toArray(),
      db.settings.get('main'),
    ])
    return { readings, tariffs, feedins, abschlaege, changes, settings: withDefaults(s?.value) }
  }, [])
}

export async function saveSettings(patch: Partial<Settings>) {
  await db.transaction('rw', db.settings, async () => {
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({ key: 'main', value: { ...cur, ...patch } })
  })
  if (patch.theme) applyTheme(patch.theme)
}

export function applyTheme(theme: Settings['theme']) {
  try {
    localStorage.setItem('wattzen-theme', theme)
  } catch {
    /* privater Modus */
  }
  const t = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme
  document.documentElement.dataset.theme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#FAFAF8' : '#0A0A0B')
}

const DATA_TABLES = () => [db.readings, db.tariffs, db.feedins, db.abschlaege, db.meterChanges]

/* ───────────── Backup ───────────── */

interface BackupFile {
  app: 'wattzen'
  version: 1
  exportedAt: string
  readings: Reading[]
  tariffs: Tariff[]
  feedins: FeedIn[]
  abschlaege: Abschlag[]
  meterChanges: MeterChange[]
  settings: Settings
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportJson(m: Model) {
  const now = new Date().toISOString()
  const file: BackupFile = {
    app: 'wattzen', version: 1, exportedAt: now,
    readings: m.readings, tariffs: m.tariffs, feedins: m.feedins, abschlaege: m.abschlaege,
    meterChanges: m.changes, settings: { ...m.settings, lastBackup: now },
  }
  download(`wattzen-backup-${todayIso()}.json`, JSON.stringify(file, null, 2), 'application/json')
  await saveSettings({ lastBackup: now })
}

const CSV_COLS = ['datum', 'uhrzeit', ...METERS.map((m) => m.key), 'km']

export function exportCsv(m: Model) {
  const de = (v?: number) => (v === undefined ? '' : String(v).replace('.', ','))
  const rows = m.readings.map((r) =>
    [r.date, r.time ?? '', ...METERS.map((x) => de(r.values[x.key])), de(r.km)].join(';'),
  )
  download(`wattzen-ablesungen-${todayIso()}.csv`, '﻿' + [CSV_COLS.join(';'), ...rows].join('\r\n'), 'text/csv')
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** Vollständiges Backup einspielen – ersetzt alle vorhandenen Daten. */
export async function importJson(text: string): Promise<number> {
  let f: BackupFile
  try {
    f = JSON.parse(text)
  } catch {
    throw new Error('Die Datei ist kein gültiges JSON.')
  }
  if (f?.app !== 'wattzen' || !Array.isArray(f.readings)) throw new Error('Das ist kein WATTZEN-Backup.')
  if (!f.readings.every((r) => r && isDate(r.date) && r.values && typeof r.values === 'object'))
    throw new Error('Das Backup enthält ungültige Ablesungen.')
  await db.transaction('rw', [...DATA_TABLES(), db.settings], async () => {
    await Promise.all(DATA_TABLES().map((t) => t.clear()))
    await db.readings.bulkPut(f.readings)
    await db.tariffs.bulkPut(f.tariffs ?? [])
    await db.feedins.bulkPut(f.feedins ?? [])
    await db.abschlaege.bulkPut(f.abschlaege ?? [])
    await db.meterChanges.bulkPut(f.meterChanges ?? [])
    await db.settings.put({ key: 'main', value: { ...withDefaults(f.settings), onboarded: true } })
  })
  applyTheme(withDefaults(f.settings).theme)
  return f.readings.length
}

/** Ablesungen aus CSV einspielen – vorhandene Tage werden überschrieben, der Rest bleibt. */
export async function importCsv(text: string): Promise<number> {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) throw new Error('Die CSV-Datei enthält keine Ablesungen.')
  const sep = lines[0].includes(';') ? ';' : ','
  const head = lines[0].split(sep).map((h) => h.trim().toLowerCase())
  const col = (name: string) => head.indexOf(name.toLowerCase())
  if (col('datum') < 0 || col('bezug') < 0 || col('einsp') < 0)
    throw new Error('Spalten „datum", „bezug" und „einsp" werden benötigt.')
  const parsed: Reading[] = []
  for (const line of lines.slice(1)) {
    const c = line.split(sep)
    let date = c[col('datum')]?.trim()
    const de = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(date ?? '')
    if (de) date = `${de[3]}-${de[2].padStart(2, '0')}-${de[1].padStart(2, '0')}`
    if (!isDate(date)) throw new Error(`Ungültiges Datum: „${c[col('datum')]}"`)
    const values: Reading['values'] = {}
    for (const m of METERS) {
      const v = col(m.key) >= 0 ? parseNum(c[col(m.key)] ?? '') : undefined
      if (v !== undefined) values[m.key] = v
    }
    if (values.bezug === undefined || values.einsp === undefined)
      throw new Error(`Am ${date} fehlen Netzbezug oder Einspeisung.`)
    const time = col('uhrzeit') >= 0 ? c[col('uhrzeit')]?.trim() || undefined : undefined
    const km = col('km') >= 0 ? parseNum(c[col('km')] ?? '') : undefined
    parsed.push({ id: uid(), date, time, values, km })
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
  await db.transaction('rw', [...DATA_TABLES(), db.settings], async () => {
    await Promise.all(DATA_TABLES().map((t) => t.clear()))
    await db.readings.bulkPut(demo.readings)
    await db.tariffs.bulkPut(demo.tariffs)
    await db.feedins.bulkPut(demo.feedins)
    await db.abschlaege.bulkPut(demo.abschlaege)
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({
      key: 'main',
      value: {
        ...cur, onboarded: true, demo: true, showKm: true, lastBackup: undefined,
        advice: { wpAp: 24.9, wpGrund: 6.5, zaehlerJahr: 30, m1Pauschale: 158, m1Mehrkosten: 0, m2Reduktion: 6.2 },
      },
    })
  })
}

/** Löscht alle Daten. Einstellungen zur Darstellung bleiben erhalten. */
export async function clearData(backToOnboarding: boolean) {
  await db.transaction('rw', [...DATA_TABLES(), db.settings], async () => {
    await Promise.all(DATA_TABLES().map((t) => t.clear()))
    const cur = withDefaults((await db.settings.get('main'))?.value)
    await db.settings.put({
      key: 'main',
      value: { ...DEFAULT_SETTINGS, theme: cur.theme, onboarded: !backToOnboarding },
    })
  })
}
