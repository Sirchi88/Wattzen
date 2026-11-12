export type MeterKey =
  | 'bezug'
  | 'einsp'
  | 'wp'
  | 'pv'
  | 'wrEinsp'
  | 'wrHaus'
  | 'spLaden'
  | 'spEntladen'
  | 'wb'

export const METERS: { key: MeterKey; label: string; source: string; required?: boolean }[] = [
  { key: 'bezug', label: 'Netzbezug', source: 'Hauptzähler', required: true },
  { key: 'einsp', label: 'Einspeisung', source: 'Hauptzähler', required: true },
  { key: 'wp', label: 'Wärmepumpe', source: 'WP-Zähler' },
  { key: 'pv', label: 'PV-Ertrag gesamt', source: 'WR-App' },
  { key: 'wrEinsp', label: 'Einspeisung laut WR', source: 'WR-App' },
  { key: 'wrHaus', label: 'Hausverbrauch laut WR', source: 'WR-App' },
  { key: 'spLaden', label: 'Speicher geladen', source: 'WR-App' },
  { key: 'spEntladen', label: 'Speicher entladen', source: 'WR-App' },
  { key: 'wb', label: 'Wallbox', source: 'Wallbox' },
]

/** ISO-Datum 'YYYY-MM-DD' */
export type IsoDate = string

export interface Reading {
  id: string
  date: IsoDate
  time?: string
  values: Partial<Record<MeterKey, number>>
  km?: number
}

export interface Tariff {
  id: string
  kind: 'haushalt' | 'wp'
  from: IsoDate
  to?: IsoDate
  /** ct/kWh */
  arbeitspreis: number
  /** €/Monat */
  grundgebuehr: number
  anbieter?: string
  notiz?: string
}

export interface FeedIn {
  id: string
  from: IsoDate
  to?: IsoDate
  /** ct/kWh */
  ct: number
}

/** Monatlicher Abschlag: fällig ab `from` jeden Monat am selben Tag, bis `to`. */
export interface Abschlag {
  id: string
  from: IsoDate
  to?: IsoDate
  betrag: number
}

export interface MeterChange {
  id: string
  meter: MeterKey
  date: IsoDate
  endOld: number
  startNew: number
}

export type SplitMethod = 'saison' | 'anteilig' | 'wbZuerst'

export interface Settings {
  onboarded: boolean
  showTime: boolean
  showKm: boolean
  yoy: boolean
  theme: 'dark' | 'light' | 'system'
  splitMethod: SplitMethod
  /** WP-Faktor je Monat, Index 0 = Januar */
  factors: number[]
  /** Eigener WP-Tarif: WP-Zähler ist eigener Netzanschluss, Z_bezug enthält die WP nicht. */
  wpTarifAktiv: boolean
  /** Stichtag, ab dem der WP-Tarif gilt (leer = für alle Daten). */
  wpTarifSeit?: IsoDate
  /** Preise für die Spar-Empfehlungen */
  advice: {
    wpAp?: number
    wpGrund?: number
    zaehlerJahr?: number
    m1Pauschale?: number
    m1Mehrkosten?: number
    m2Reduktion?: number
  }
  lastBackup?: string
  demo?: boolean
}

export const DEFAULT_FACTORS = [0, 0, 0.3, 0.6, 1, 1, 1, 1, 0.6, 0.3, 0, 0]

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  showTime: false,
  showKm: false,
  yoy: true,
  theme: 'dark',
  splitMethod: 'saison',
  factors: DEFAULT_FACTORS,
  wpTarifAktiv: false,
  advice: {},
}

export interface Model {
  readings: Reading[]
  changes: MeterChange[]
  tariffs: Tariff[]
  feedins: FeedIn[]
  abschlaege: Abschlag[]
  settings: Settings
}
