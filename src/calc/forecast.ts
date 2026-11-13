import { addMonths, toDay } from '../lib/dates'
import type { Abschlag } from '../types'

/** Fälligkeitstage eines monatlichen Abschlags im Bereich [from, to). */
export function abschlagTermine(a: Abschlag, from: number, to: number): number[] {
  const first = toDay(a.from)
  const last = a.to ? toDay(a.to) : Infinity
  const out: number[] = []
  for (let k = 0; k < 1200; k++) {
    const day = addMonths(first, k)
    if (day >= to || day > last) break
    if (day >= from) out.push(day)
  }
  return out
}

export function abschlagSumme(abschlaege: Abschlag[], from: number, to: number) {
  let s = 0
  for (const a of abschlaege) s += abschlagTermine(a, from, to).length * a.betrag
  return s
}
