// Tage werden als ganze Zahl (Tage seit 1970-01-01, UTC) gerechnet.
// Eine Ablesung am Tag D beschreibt den Zählerstand zu Beginn von D;
// ein Zeitraum [a, b) umfasst die Tage a … b−1.

const MS = 864e5

export const dayOf = (y: number, m: number, d: number) => Math.round(Date.UTC(y, m, d) / MS)

export const toDay = (iso: string) => dayOf(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))

export const fromDay = (day: number) => new Date(day * MS).toISOString().slice(0, 10)

export const parts = (day: number) => {
  const x = new Date(day * MS)
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate() }
}

export const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()

export const addMonths = (day: number, n: number) => {
  const p = parts(day)
  const total = p.y * 12 + p.m + n
  const y = Math.floor(total / 12)
  const m = total - y * 12
  return dayOf(y, m, Math.min(p.d, daysInMonth(y, m)))
}

export const monthStart = (day: number) => {
  const p = parts(day)
  return dayOf(p.y, p.m, 1)
}

export const todayIso = () => {
  const n = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`
}

export const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez']
export const MONTHS_LONG = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

/** 30.10. */
export const fmtDayShort = (day: number) => {
  const p = parts(day)
  return `${p.d}.${p.m + 1}.`
}
/** 30.10.2025 */
export const fmtDay = (day: number) => {
  const p = parts(day)
  return `${String(p.d).padStart(2, '0')}.${String(p.m + 1).padStart(2, '0')}.${p.y}`
}
/** 30. Oktober 2025 */
export const fmtDayLong = (day: number) => {
  const p = parts(day)
  return `${p.d}. ${MONTHS_LONG[p.m]} ${p.y}`
}
export const weekday = (day: number) => WEEKDAYS[new Date(day * MS).getUTCDay()]
