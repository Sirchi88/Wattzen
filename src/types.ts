/** Eingebaute Zähler, mit denen die Energie-Rechnung arbeitet. */
export type MeterKey =
  | 'bezug'
  | 'einsp'
  | 'pv'
  | 'wrImport'
  | 'wrEinsp'
  | 'wrHaus'
  | 'spLaden'
  | 'spEntladen'
  | 'wp'
  | 'wpWaerme'
  | 'wb'
  | 'km'

export type GroupKey = 'haupt' | 'wr' | 'wp' | 'wb' | 'auto' | 'eigene'

export type IconKey =
  | 'gauge' | 'cpu' | 'sun' | 'zap' | 'export' | 'house' | 'battery' | 'thermo' | 'flame'
  | 'plug' | 'car' | 'droplet' | 'sprout' | 'fuel' | 'wind' | 'box' | 'hash'

/** Kategorie-Farben; dieselbe Farbe in Zahlen, Ringen und Diagrammen. */
export type ColorKey = 'pv' | 'netz' | 'einsp' | 'speicher' | 'wp' | 'wb' | 'haus' | 'wasser'

/** ISO-Datum 'YYYY-MM-DD' */
export type IsoDate = string

export interface Reading {
  id: string
  date: IsoDate
  time?: string
  /** Zählerstände: eingebaute Zähler unter ihrem Schlüssel, eigene Zähler unter ihrer ID. */
  values: Record<string, number | undefined>
}

export interface Period {
  id: string
  from: IsoDate
  to?: IsoDate
}

export interface Tariff extends Period {
  kind: 'haushalt' | 'wp'
  /** ct/kWh */
  arbeitspreis: number
  /** €/Monat */
  grundgebuehr: number
  anbieter?: string
  notiz?: string
  /** Kündigungsfrist in Wochen vor Vertragsende (`to`). */
  fristWochen?: number
}

export interface FeedIn extends Period {
  /** ct/kWh */
  ct: number
}

/** Monatlicher Abschlag: fällig ab `from` jeden Monat am selben Tag, bis `to`. */
export interface Abschlag extends Period {
  betrag: number
}

export interface MeterChange {
  id: string
  meter: string
  date: IsoDate
  endOld: number
  startNew: number
}

/** Preisbestandteil eines eigenen Zählers, z. B. „Abwasser 2,85 €/m³“. */
export interface PricePart extends Period {
  name: string
  /** € pro Einheit */
  preis: number
  /** Mengenbasis: diese Menge minus die Menge eines anderen Zählers (z. B. Gartenwasser). */
  minus?: string
}

export interface CustomCosts {
  grund: (Period & { eurMonat: number })[]
  parts: PricePart[]
  abschlaege: Abschlag[]
  anbieter?: string
  vertragEnde?: IsoDate
  fristWochen?: number
}

export interface MeterConf {
  /** Schlüssel des eingebauten Zählers oder ID des eigenen Zählers */
  id: string
  builtin: boolean
  group: GroupKey
  name: string
  /** Woher der Wert kommt, z. B. „Hauptzähler“ */
  hint?: string
  icon: IconKey
  color: ColorKey
  unit: string
  decimals: number
  active: boolean
  order: number
  required?: boolean
  costs?: CustomCosts
}

export type SplitMethod = 'saison' | 'anteilig' | 'wbZuerst'
export type RangeTab = 'last' | 'monat' | 'halb' | 'jahr' | 'zwei' | 'custom'
export type View = 'overview' | 'dash' | 'entry' | 'history' | 'admin'

export interface House {
  plz?: string
  ort?: string
  lat?: number
  lon?: number
  kwp?: number
  /** Grad, 0 = Süd */
  azimut?: number
  neigung?: number
  inbetrieb?: IsoDate
  speicherKwh?: number
  investPv?: number
  investSpeicher?: number
  wpModell?: string
  flaeche?: number
  personen?: number
  autoModell?: string
  autoAkku?: number
}

export interface Settings {
  onboarded: boolean
  showTime: boolean
  yoy: boolean
  theme: 'dark' | 'light' | 'system'
  splitMethod: SplitMethod
  /** WP-Faktor je Monat, Index 0 = Januar */
  factors: number[]
  /** Eigener WP-Tarif: WP-Zähler ist eigener Netzanschluss, Z_bezug enthält die WP nicht. */
  wpTarifAktiv: boolean
  wpTarifSeit?: IsoDate
  advice: {
    wpAp?: number
    wpGrund?: number
    zaehlerJahr?: number
    m1Pauschale?: number
    m1Mehrkosten?: number
    m2Reduktion?: number
  }
  demo?: boolean
  house: House
  groupOrder: GroupKey[]
  splash: boolean
  /** Sekunden */
  splashDauer: number
  startView: 'overview' | 'dash' | 'entry'
  defaultRange: RangeTab
  /** -1 = automatisch */
  kwhDecimals: number
  mwh: boolean
  haptics: boolean
  /** °C */
  heizgrenze: number
  /** Toleranz der Plausibilität WechselRichter vs. Zähler, z. B. 0,03 */
  toleranz: number
  markCalc: boolean
  reminder: boolean
  reminderTime: string
  dueDot: boolean
  /** Vorlauf des Vertragsende-Hinweises in Wochen */
  contractLead: number
  /** Weggewischte Hinweise: Schlüssel → Datum */
  dismissed: Record<string, IsoDate>
}

export const DEFAULT_FACTORS = [0, 0, 0.3, 0.6, 1, 1, 1, 1, 0.6, 0.3, 0, 0]
export const DEFAULT_GROUP_ORDER: GroupKey[] = ['haupt', 'wr', 'wp', 'wb', 'eigene', 'auto']

export const DEFAULT_SETTINGS: Settings = {
  onboarded: false,
  showTime: false,
  yoy: true,
  theme: 'dark',
  splitMethod: 'saison',
  factors: DEFAULT_FACTORS,
  wpTarifAktiv: false,
  advice: {},
  house: {},
  groupOrder: DEFAULT_GROUP_ORDER,
  splash: true,
  splashDauer: 1,
  startView: 'overview',
  defaultRange: 'jahr',
  kwhDecimals: -1,
  mwh: false,
  haptics: true,
  heizgrenze: 15,
  toleranz: 0.03,
  markCalc: true,
  reminder: false,
  reminderTime: '18:00',
  dueDot: true,
  contractLead: 8,
  dismissed: {},
}

export interface Model {
  readings: Reading[]
  changes: MeterChange[]
  tariffs: Tariff[]
  feedins: FeedIn[]
  abschlaege: Abschlag[]
  feedinAbschlaege: Abschlag[]
  meters: MeterConf[]
  settings: Settings
}
