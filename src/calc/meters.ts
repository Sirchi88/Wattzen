import type { ColorKey, GroupKey, IconKey, MeterConf, MeterKey, Model } from '../types'
import { DEFAULT_GROUP_ORDER } from '../types'

export const GROUPS: Record<GroupKey, { name: string; icon: IconKey; color: ColorKey }> = {
  haupt: { name: 'Hauptzähler', icon: 'gauge', color: 'netz' },
  wr: { name: 'WechselRichter', icon: 'sun', color: 'pv' },
  wp: { name: 'Wärmepumpe', icon: 'thermo', color: 'wp' },
  wb: { name: 'Wallbox', icon: 'plug', color: 'wb' },
  auto: { name: 'Auto', icon: 'car', color: 'wb' },
  eigene: { name: 'Eigene Zähler', icon: 'droplet', color: 'wasser' },
}

type B = Omit<MeterConf, 'order' | 'builtin' | 'decimals' | 'unit'> & { id: MeterKey; unit?: string }
const B: B[] = [
  { id: 'bezug', group: 'haupt', name: 'Netzbezug', hint: 'Hauptzähler', icon: 'zap', color: 'netz', active: true, required: true },
  { id: 'einsp', group: 'haupt', name: 'Einspeisung', hint: 'Hauptzähler', icon: 'export', color: 'einsp', active: true, required: true },
  { id: 'pv', group: 'wr', name: 'PV-Ertrag gesamt', hint: 'WechselRichter', icon: 'sun', color: 'pv', active: true },
  { id: 'wrImport', group: 'wr', name: 'Import', hint: 'Netzbezug laut WechselRichter', icon: 'zap', color: 'netz', active: true },
  { id: 'wrEinsp', group: 'wr', name: 'Export', hint: 'Einspeisung laut WechselRichter', icon: 'export', color: 'einsp', active: true },
  { id: 'wrHaus', group: 'wr', name: 'Hausverbrauch', hint: 'laut WechselRichter', icon: 'house', color: 'haus', active: true },
  { id: 'spLaden', group: 'wr', name: 'Speicher geladen', hint: 'laut WechselRichter', icon: 'battery', color: 'speicher', active: true },
  { id: 'spEntladen', group: 'wr', name: 'Speicher entladen', hint: 'laut WechselRichter', icon: 'battery', color: 'speicher', active: true },
  { id: 'wp', group: 'wp', name: 'Stromzähler', hint: 'WP-Zähler', icon: 'thermo', color: 'wp', active: true },
  { id: 'wpWaerme', group: 'wp', name: 'Wärmemenge', hint: 'kWh thermisch', icon: 'flame', color: 'wp', active: false },
  { id: 'wb', group: 'wb', name: 'Zählerstand', hint: 'Wallbox', icon: 'plug', color: 'wb', active: true },
  { id: 'km', group: 'auto', name: 'Kilometerstand', hint: 'Auto', icon: 'car', color: 'wb', active: false, unit: 'km' },
]

/** Lange Namen für Auswertung und Verlauf (z. B. „Wärmepumpe“ statt „Stromzähler“). */
export const LONG_NAME: Partial<Record<MeterKey, string>> = {
  wp: 'Wärmepumpe',
  wb: 'Wallbox',
  wrImport: 'Import (WechselRichter)',
  wrEinsp: 'Export (WechselRichter)',
  wrHaus: 'Hausverbrauch (WechselRichter)',
  wpWaerme: 'WP-Wärmemenge',
}

export const BUILTIN_IDS = B.map((b) => b.id)

export const builtinDefaults = (): MeterConf[] =>
  B.map((b, i) => ({ ...b, builtin: true, unit: b.unit ?? 'kWh', decimals: b.unit === 'km' ? 0 : 1, order: i }))

/**
 * Führt gespeicherte Zähler-Einstellungen mit den eingebauten Standards zusammen.
 * Eingebaute Zähler lassen sich ausblenden, aber nicht löschen; Pflichtzähler bleiben aktiv.
 */
export function mergeMeters(stored: MeterConf[]): MeterConf[] {
  const byId = new Map(stored.map((m) => [m.id, m]))
  const out: MeterConf[] = builtinDefaults().map((d) => {
    const s = byId.get(d.id)
    if (!s) return d
    return { ...d, active: d.required ? true : s.active, order: s.order ?? d.order }
  })
  for (const s of stored) if (!s.builtin) out.push(s)
  return out
}

export const meterName = (m: Pick<MeterConf, 'id' | 'name' | 'builtin'>) =>
  (m.builtin && LONG_NAME[m.id as MeterKey]) || m.name

/** Aktive Zähler in Erfassungsreihenfolge, nach Gruppen. */
export function orderedGroups(meters: MeterConf[], groupOrder: GroupKey[] = DEFAULT_GROUP_ORDER, includeInactive = false) {
  const order = [...groupOrder, ...DEFAULT_GROUP_ORDER.filter((g) => !groupOrder.includes(g))]
  return order
    .map((g) => ({
      key: g,
      ...GROUPS[g],
      meters: meters.filter((m) => m.group === g && (includeInactive || m.active)).sort((a, b) => a.order - b.order),
    }))
    .filter((g) => g.meters.length > 0)
}

export const isActive = (m: Model, id: string) => m.meters.find((x) => x.id === id)?.active ?? false
export const customMeters = (m: Pick<Model, 'meters'>) => m.meters.filter((x) => !x.builtin)
