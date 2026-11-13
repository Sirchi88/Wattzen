import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { climateFrom, GERMANY, type Climate, type WxMap } from './calc/smart'
import { db, type WeatherMeta } from './db'
import { fromDay, parts, toDay, todayIso } from './lib/dates'
import type { House } from './types'

/** Open-Meteo: kostenlos, ohne API-Key. */
const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive'
const FORECAST = 'https://api.open-meteo.com/v1/forecast'
const DAILY = 'temperature_2m_mean,shortwave_radiation_sum'

export interface Place {
  name: string
  admin?: string
  plz?: string
  lat: number
  lon: number
}

export async function geocode(q: string): Promise<Place[]> {
  const url = `${GEO}?name=${encodeURIComponent(q.trim())}&count=8&language=de&format=json`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Die Ortssuche ist gerade nicht erreichbar.')
  const j = (await res.json()) as {
    results?: { name: string; admin1?: string; admin3?: string; latitude: number; longitude: number; postcodes?: string[]; country_code?: string }[]
  }
  const digits = /^\d{4,5}$/.test(q.trim()) ? q.trim() : undefined
  return (j.results ?? []).map((r) => ({
    name: r.name,
    admin: [r.admin3, r.admin1].filter(Boolean).join(', ') || undefined,
    plz: digits && r.postcodes?.includes(digits) ? digits : r.postcodes?.[0],
    lat: r.latitude,
    lon: r.longitude,
  }))
}

interface DailyResp {
  daily?: { time: string[]; temperature_2m_mean: (number | null)[]; shortwave_radiation_sum: (number | null)[] }
}

/** Open-Meteo liefert Strahlung in MJ/m²; 1 kWh = 3,6 MJ. */
export function parseDaily(j: DailyResp) {
  const d = j.daily
  if (!d) return []
  const out: { date: string; t: number; rad: number }[] = []
  d.time.forEach((date, i) => {
    const t = d.temperature_2m_mean[i]
    const r = d.shortwave_radiation_sum[i]
    if (t === null || r === null || t === undefined || r === undefined) return
    out.push({ date, t, rad: r / 3.6 })
  })
  return out
}

async function getJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Wetterdienst antwortet mit ${res.status}`)
  return (await res.json()) as DailyResp
}

const locKey = (h: House) => (h.lat !== undefined && h.lon !== undefined ? `${h.lat.toFixed(2)},${h.lon.toFixed(2)}` : '')

let running = false

/**
 * Aktualisiert den Wetter-Cache: Klimamittel der letzten 10 Jahre (einmal pro Ort),
 * gemessene Tageswerte ab der ersten Ablesung und die 16-Tage-Vorhersage (alle 6 Stunden).
 */
export async function refreshWeather(house: House, firstDay?: number): Promise<void> {
  const loc = locKey(house)
  if (!loc || running || (typeof navigator !== 'undefined' && navigator.onLine === false)) return
  running = true
  try {
    const q = `latitude=${house.lat}&longitude=${house.lon}&daily=${DAILY}&timezone=Europe%2FBerlin`
    let meta = await db.meta.get('weather')
    if (!meta || meta.loc !== loc) {
      await db.weather.clear()
      meta = { key: 'weather', loc, label: house.ort || house.plz || 'deinen Standort' }
      await db.meta.put(meta)
    }
    const today = toDay(todayIso())
    const y = parts(today).y
    if (!meta.climate) {
      const rows = parseDaily(await getJson(`${ARCHIVE}?${q}&start_date=${y - 10}-01-01&end_date=${y - 1}-12-31`))
      const clim = climateFrom(rows.map((r) => ({ day: toDay(r.date), t: r.t, rad: r.rad })), meta.label)
      if (clim) meta = { ...meta, climate: { t: clim.t, rad: clim.rad, label: meta.label } }
      // Vergangene Jahre gleich mit in den Cache – sie decken frühe Ablesungen ab
      await db.weather.bulkPut(rows.filter((r) => toDay(r.date) >= (firstDay ?? today) - 400).map((r) => ({ ...r, src: 'archiv' })))
      meta.archiveUntil = `${y - 1}-12-31`
      await db.meta.put(meta)
    }
    // Archiv hinkt einige Tage hinterher
    const until = fromDay(today - 6)
    const startArchive = meta.archiveUntil ? fromDay(toDay(meta.archiveUntil) + 1) : fromDay((firstDay ?? today) - 30)
    if (startArchive <= until) {
      const rows = parseDaily(await getJson(`${ARCHIVE}?${q}&start_date=${startArchive}&end_date=${until}`))
      await db.weather.bulkPut(rows.map((r) => ({ ...r, src: 'archiv' })))
      meta = { ...meta, archiveUntil: until }
      await db.meta.put(meta)
    }
    if (!meta.forecastAt || Date.now() - meta.forecastAt > 6 * 3600e3) {
      const rows = parseDaily(await getJson(`${FORECAST}?${q}&past_days=7&forecast_days=16`))
      const keep = new Set((await db.weather.where('date').anyOf(rows.map((r) => r.date)).toArray()).filter((w) => w.src === 'archiv').map((w) => w.date))
      await db.weather.bulkPut(rows.filter((r) => !keep.has(r.date)).map((r) => ({ ...r, src: 'vorhersage' })))
      await db.meta.put({ ...meta, forecastAt: Date.now() })
    }
  } finally {
    running = false
  }
}

export interface WeatherState {
  wx: WxMap
  clim: Climate
  meta?: WeatherMeta
  /** Tage mit gemessenem Wetter */
  n: number
}

/** Wetter aus dem Cache; stößt bei Bedarf eine Aktualisierung an. */
export function useWeather(house: House | undefined, firstDay: number | undefined): WeatherState | undefined {
  const data = useLiveQuery(async () => {
    const [rows, meta] = await Promise.all([db.weather.toArray(), db.meta.get('weather')])
    return { rows, meta }
  }, [])
  const loc = house ? locKey(house) : ''
  useEffect(() => {
    if (!house || !loc) return
    const run = () => void refreshWeather(house, firstDay).catch(() => undefined)
    run()
    window.addEventListener('online', run)
    return () => window.removeEventListener('online', run)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc, firstDay])
  if (!data) return undefined
  const wx: WxMap = new Map(data.rows.map((r) => [toDay(r.date), { t: r.t, rad: r.rad }]))
  const c = data.meta?.climate
  const clim: Climate = c ? { t: c.t, rad: c.rad, source: 'ort', label: c.label } : GERMANY
  return { wx, clim, meta: data.meta, n: data.rows.length }
}
