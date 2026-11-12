const nf = (min: number, max: number) =>
  new Intl.NumberFormat('de-DE', { minimumFractionDigits: min, maximumFractionDigits: max })

const cache = new Map<string, Intl.NumberFormat>()
const get = (min: number, max: number) => {
  const k = `${min}:${max}`
  let f = cache.get(k)
  if (!f) cache.set(k, (f = nf(min, max)))
  return f
}

const clean = (s: string) => s.replace('-', '−')

/** Deutsche Zahl mit fester Nachkommastellenzahl. */
export const num = (v: number, digits = 1) => clean(get(digits, digits).format(v))

/** kWh: unter 100 eine Nachkommastelle, darüber ganzzahlig. */
export const kwhDigits = (v: number) => (Math.abs(v) < 100 ? 1 : 0)
export const kwh = (v: number) => num(v, kwhDigits(v))

/** Euro: unter 100 mit Cent, darüber ganzzahlig. */
export const eurDigits = (v: number) => (Math.abs(v) < 100 ? 2 : 0)
export const eur = (v: number) => num(v, eurDigits(v))

export const pct = (v: number) => num(v * 100, 0)

export const signed = (s: string) => (s.startsWith('−') ? s : `+${s}`)

/** Zählerstand, wie eingegeben (bis 3 Nachkommastellen). */
export const stand = (v: number) => clean(get(0, 3).format(v))

/**
 * Deutsche Eingabe parsen: "1.234,5" → 1234.5, "1234,5" → 1234.5, "1234.5" → 1234.5.
 * Ohne Komma gilt ein Punkt nur dann als Tausendertrenner, wenn das Muster eindeutig ist ("12.345").
 */
export function parseNum(raw: string): number | undefined {
  let s = raw.trim().replace(/\s/g, '')
  if (!s) return undefined
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  if (!/^-?\d*\.?\d+$/.test(s) && !/^-?\d+\.$/.test(s)) return undefined
  const v = Number(s)
  return Number.isFinite(v) ? v : undefined
}
