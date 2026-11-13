import { DEFAULT_SETTINGS, type Model, type Reading, type Settings, type Tariff } from '../types'
import { mergeMeters } from './meters'

let id = 0
export const rd = (date: string, values: Reading['values']): Reading => ({ id: `r${id++}`, date, values })
export const tarif = (from: string, ap: number, grund = 0, extra: Partial<Tariff> = {}): Tariff => ({
  id: `t${id++}`, kind: 'haushalt', from, arbeitspreis: ap, grundgebuehr: grund, ...extra,
})
export const model = (p: Partial<Model> & { s?: Partial<Settings> }): Model => ({
  readings: [], changes: [], tariffs: [], feedins: [], abschlaege: [], feedinAbschlaege: [],
  ...p,
  meters: mergeMeters(p.meters ?? []),
  settings: { ...DEFAULT_SETTINGS, ...p.s },
})
