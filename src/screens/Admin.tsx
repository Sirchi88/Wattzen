import {
  Bell, Calculator, ChevronLeft, ChevronRight, Database, Gauge, House, Info as InfoIcon, MapPin, Palette, Receipt,
  type LucideIcon,
} from 'lucide-react'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { advise } from '../calc/advice'
import type { Daily } from '../calc/engine'
import { contractHints } from '../calc/finance'
import { readingReminder } from '../calc/ics'
import { GROUPS, meterName, orderedGroups } from '../calc/meters'
import {
  clearData, db, exportCsv, exportJson, importCsv, importJson, loadDemo, saveFile, saveHouse, saveMeter, saveSettings, uid,
} from '../db'
import { fmtDay, MONTHS, toDay, todayIso } from '../lib/dates'
import { eur, num, stand } from '../lib/format'
import { DEFAULT_FACTORS, type GroupKey, type House as HouseT, type MeterConf, type Model, type RangeTab, type Settings, type SplitMethod, type Tariff } from '../types'
import { Confirm, Field, IconChip, NumInput, Seg, Toggle, useToast } from '../ui/bits'
import { geocode, type Place, type WeatherState } from '../weather'
import { contractIcs } from './cards'
import { ListEditor, type FieldDef } from './admin/ListEditor'
import { emptyCosts, MeterEditor } from './admin/MeterEditor'
import { Sortable } from './admin/Sortable'

type Page = 'home' | 'haus' | 'zaehler' | 'tarife' | 'berechnung' | 'erinnerungen' | 'darstellung' | 'daten' | 'ueber'

const PAGES: { id: Exclude<Page, 'home'>; title: string; desc: string; Icon: LucideIcon; color: string }[] = [
  { id: 'haus', title: 'Haus und Anlage', desc: 'Standort, PV, Speicher, Wärmepumpe, Haushalt', Icon: House, color: 'haus' },
  { id: 'zaehler', title: 'Zähler', desc: 'Erfassung, eigene Zähler, Reihenfolge, Zählerwechsel', Icon: Gauge, color: 'netz' },
  { id: 'tarife', title: 'Tarife und Abschläge', desc: 'Strom, Einspeisung, eigene Zähler, Vertragsende', Icon: Receipt, color: 'einsp' },
  { id: 'berechnung', title: 'Berechnung', desc: 'Aufteilung, Monatsfaktoren, Heizgrenze, Spar-Empfehlungen', Icon: Calculator, color: 'wp' },
  { id: 'erinnerungen', title: 'Erinnerungen', desc: 'Ablesen am 1., Kalender, Fällig-Punkt', Icon: Bell, color: 'pv' },
  { id: 'darstellung', title: 'Darstellung', desc: 'Hell/Dunkel, Startbildschirm, Zahlen, Startseite', Icon: Palette, color: 'wb' },
  { id: 'daten', title: 'Daten', desc: 'Export, Import, Demo-Daten, Zurücksetzen', Icon: Database, color: 'speicher' },
  { id: 'ueber', title: 'Über WATTZEN', desc: 'Version und Herkunft', Icon: InfoIcon, color: 'haus' },
]

const span = (from: string, to?: string) => `${fmtDay(toDay(from))} – ${to ? fmtDay(toDay(to)) : 'offen'}`
const set = (p: Partial<Settings>) => void saveSettings(p)

function Group({ title, children, help }: { title: string; children: ReactNode; help?: ReactNode }) {
  return (
    <section className="set-group">
      <h3 className="sec-title">{title}</h3>
      <div className="card form-card">
        {help && <p className="help">{help}</p>}
        {children}
      </div>
    </section>
  )
}

const TARIFF_FIELDS: FieldDef[] = [
  { key: 'from', label: 'Gültig von', type: 'date' },
  { key: 'to', label: 'Vertragsende', type: 'date', optional: true, help: 'Leer = unbefristet' },
  { key: 'arbeitspreis', label: 'Arbeitspreis', type: 'num', unit: 'ct/kWh' },
  { key: 'grundgebuehr', label: 'Grundgebühr', type: 'num', unit: '€/Monat' },
  { key: 'fristWochen', label: 'Kündigungsfrist', type: 'num', unit: 'Wochen', optional: true },
  { key: 'anbieter', label: 'Anbieter', type: 'text', optional: true },
  { key: 'notiz', label: 'Notiz', type: 'text', optional: true },
]

/* ───────────── Haus und Anlage ───────────── */

function HouseNum({ k, label, unit, help, h }: { k: keyof HouseT; label: string; unit: string; help?: string; h: HouseT }) {
  return (
    <Field label={label} help={help}>
      <NumInput value={h[k] as number | undefined} onChange={(v) => void saveHouse({ [k]: v })} unit={unit} enterKeyHint="done" />
    </Field>
  )
}

function HousePage({ model, weather }: { model: Model; weather?: WeatherState }) {
  const h = model.settings.house
  const [q, setQ] = useState(h.plz || h.ort || '')
  const [res, setRes] = useState<Place[]>()
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  async function search() {
    setErr('')
    setBusy(true)
    try {
      const r = await geocode(q)
      setRes(r)
      if (!r.length) setErr('Kein Ort gefunden. Versuch es mit dem Ortsnamen.')
    } catch {
      setErr('Die Ortssuche braucht eine Internetverbindung.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="sub">
      <Group title="Standort" help="Für das Wetter: Heizgradtage, Einstrahlung und die Prognose. Wetterdaten kommen von Open-Meteo und werden auf dem Gerät gespeichert.">
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault()
            void search()
          }}
        >
          <Field label="PLZ oder Ort">
            <input type="text" inputMode="search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search" />
          </Field>
          <button type="submit" className="btn" disabled={busy || q.trim().length < 2}>
            {busy ? 'Suche …' : 'Suchen'}
          </button>
        </form>
        {err && <p className="note warn">{err}</p>}
        {res && res.length > 0 && (
          <ul className="choices">
            {res.map((p) => (
              <li key={`${p.lat},${p.lon}`}>
                <button
                  type="button"
                  onClick={() => {
                    void saveHouse({ ort: p.name, plz: p.plz, lat: p.lat, lon: p.lon })
                    setRes(undefined)
                  }}
                >
                  <MapPin size={16} aria-hidden />
                  <span>
                    {p.plz ? `${p.plz} ` : ''}
                    {p.name}
                    {p.admin && <small>{p.admin}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="status-line">
          {h.lat !== undefined ? (
            <>
              <b>
                {h.plz ? `${h.plz} ` : ''}
                {h.ort}
              </b>{' '}
              · {weather?.n ? `${weather.n} Tage Wetter gespeichert` : 'Wetter wird geladen, sobald eine Verbindung besteht'}
              {weather?.meta?.climate ? ' · Klimamittel vorhanden' : ''}
            </>
          ) : h.ort ? (
            <>
              <b>{h.ort}</b> · ohne Koordinaten – die Prognose nutzt das typische Klima in Deutschland
            </>
          ) : (
            'Noch kein Standort – die Prognose nutzt bis dahin das typische Klima in Deutschland.'
          )}
        </p>
      </Group>

      <Group title="PV-Anlage">
        <div className="edit-grid">
          <HouseNum h={h} k="kwp" label="Leistung" unit="kWp" help="Für spezifischen Ertrag und PV-Prognose." />
          <HouseNum h={h} k="azimut" label="Ausrichtung (optional)" unit="°" help="0 = Süd, −90 = Ost, 90 = West" />
          <HouseNum h={h} k="neigung" label="Neigung (optional)" unit="°" />
          <Field label="Inbetriebnahme" help="Für die Amortisation vor der ersten Ablesung.">
            <input type="date" value={h.inbetrieb ?? ''} onChange={(e) => void saveHouse({ inbetrieb: e.target.value || undefined })} />
          </Field>
          <HouseNum h={h} k="investPv" label="Investition PV" unit="€" />
        </div>
      </Group>

      <Group title="Speicher">
        <div className="edit-grid">
          <HouseNum h={h} k="speicherKwh" label="Nutzbare Kapazität" unit="kWh" help="Für die Vollzyklen." />
          <HouseNum h={h} k="investSpeicher" label="Investition Speicher" unit="€" />
        </div>
      </Group>

      <Group title="Wärmepumpe">
        <div className="edit-grid">
          <Field label="Modell (optional)">
            <input type="text" value={h.wpModell ?? ''} onChange={(e) => void saveHouse({ wpModell: e.target.value || undefined })} />
          </Field>
          <HouseNum h={h} k="flaeche" label="Beheizte Fläche" unit="m²" help="Für kWh/m² und den Startwert der WP-Prognose." />
        </div>
      </Group>

      <Group title="Haushalt und Auto">
        <div className="edit-grid">
          <HouseNum h={h} k="personen" label="Personen im Haushalt" unit="Pers." />
          <Field label="E-Auto Modell (optional)">
            <input type="text" value={h.autoModell ?? ''} onChange={(e) => void saveHouse({ autoModell: e.target.value || undefined })} />
          </Field>
          <HouseNum h={h} k="autoAkku" label="Akku (optional)" unit="kWh" />
        </div>
      </Group>
    </div>
  )
}

/* ───────────── Zähler ───────────── */

function MetersPage({ model, openMeter }: { model: Model; openMeter: (id: string) => void }) {
  const s = model.settings
  const groups = orderedGroups(model.meters, s.groupOrder, true)
  const saveOrder = (list: MeterConf[]) => list.forEach((m, i) => void saveMeter({ ...m, order: i }))
  async function addCustom() {
    const id = `c_${uid().slice(0, 8)}`
    const order = model.meters.filter((m) => m.group === 'eigene').length
    await saveMeter({
      id, builtin: false, group: 'eigene', name: 'Wasser', icon: 'droplet', color: 'wasser', unit: 'm³', decimals: 3,
      active: true, order, costs: emptyCosts(),
    })
    openMeter(id)
  }
  const keys = groups.map((g) => g.key)
  return (
    <div className="sub">
      <Group title="Reihenfolge der Gruppen" help="Ziehen am Griff ändert die Reihenfolge beim Erfassen.">
        <Sortable<GroupKey>
          items={keys}
          getKey={(g) => g}
          label={(g) => GROUPS[g].name}
          onChange={(next) => set({ groupOrder: next })}
          render={(g) => (
            <span className="sort-line">
              <IconChip name={GROUPS[g].icon} color={GROUPS[g].color} size={28} />
              {GROUPS[g].name}
            </span>
          )}
        />
      </Group>

      {groups.map((g) => (
        <Group key={g.key} title={g.name}>
          <Sortable<MeterConf>
            items={g.meters}
            getKey={(m) => m.id}
            label={(m) => meterName(m)}
            onChange={saveOrder}
            render={(m) => (
              <div className="meter-line">
                <IconChip name={m.icon} color={m.color} size={28} />
                <span className="meter-name">
                  {m.name}
                  <small>
                    {m.hint ?? m.unit}
                    {m.required ? ' · Pflicht' : ''}
                  </small>
                </span>
                {m.builtin ? (
                  <label className="mini-toggle">
                    <span className="sr">{meterName(m)} erfassen</span>
                    <input
                      type="checkbox"
                      role="switch"
                      disabled={m.required}
                      checked={m.active}
                      onChange={(e) => void saveMeter({ ...m, active: e.target.checked })}
                    />
                    <i aria-hidden />
                  </label>
                ) : (
                  <button type="button" className="icon-btn" aria-label={`${m.name} bearbeiten`} onClick={() => openMeter(m.id)}>
                    <ChevronRight size={18} aria-hidden />
                  </button>
                )}
              </div>
            )}
          />
          {g.key === 'wp' && <p className="help">Die Wärmemenge (kWh thermisch) ergibt die Jahresarbeitszahl.</p>}
        </Group>
      ))}

      <button type="button" className="btn primary wide" onClick={() => void addCustom()}>
        + Eigenen Zähler anlegen
      </button>
      <p className="help">Zum Beispiel Wasser, Gartenwasser, Gas oder Kilometerstand – mit eigener Einheit, Preisen und Abschlägen.</p>

      <Group title="Zählerwechsel" help="Ablesungen ab dem Wechseldatum gelten als Stände des neuen Zählers. Die Rechnung läuft nahtlos weiter.">
        <ListEditor
          items={model.changes}
          fields={[
            { key: 'meter', label: 'Zähler', type: 'select', options: model.meters.map((m) => ({ value: m.id, label: meterName(m) })) },
            { key: 'date', label: 'Datum des Wechsels', type: 'date' },
            { key: 'endOld', label: 'Endstand alt', type: 'num' },
            { key: 'startNew', label: 'Startstand neu', type: 'num' },
          ]}
          addLabel="Zählerwechsel"
          empty="Kein Zählerwechsel erfasst."
          defaults={() => ({ meter: 'bezug', date: todayIso(), startNew: 0 })}
          save={(c) => db.meterChanges.put(c)}
          remove={(c) => db.meterChanges.delete(c.id)}
          summary={(c) => (
            <>
              <b>{meterName(model.meters.find((m) => m.id === c.meter) ?? { id: c.meter, name: c.meter, builtin: true })}</b>
              <small className="num">
                {fmtDay(toDay(c.date))} · alt {stand(c.endOld)} → neu {stand(c.startNew)}
              </small>
            </>
          )}
        />
      </Group>
    </div>
  )
}

/* ───────────── Tarife und Abschläge ───────────── */

function TariffList({ model, kind }: { model: Model; kind: Tariff['kind'] }) {
  const items = model.tariffs.filter((t) => t.kind === kind)
  return (
    <ListEditor<Tariff>
      items={items}
      fields={TARIFF_FIELDS}
      addLabel={kind === 'wp' ? 'WP-Tarif' : 'Tarif'}
      empty={kind === 'wp' ? 'Noch kein WP-Tarif – der WP-Strom kostet rechnerisch 0.' : 'Noch kein Tarif. Ohne Tarif sind alle Kosten 0.'}
      defaults={() => ({ from: kind === 'wp' ? model.settings.wpTarifSeit ?? todayIso() : todayIso(), kind })}
      save={(t) => db.tariffs.put({ ...t, kind })}
      remove={(t) => db.tariffs.delete(t.id)}
      summary={(t) => (
        <>
          <b className="num">
            {num(t.arbeitspreis, 2)} ct/kWh · {num(t.grundgebuehr, 2)} €/Monat
          </b>
          <small className="num">
            {span(t.from, t.to)}
            {t.fristWochen ? ` · Kündigung ${t.fristWochen} Wochen vorher` : ''}
            {t.anbieter ? ` · ${t.anbieter}` : ''}
          </small>
        </>
      )}
    />
  )
}

function TariffsPage({ model, openMeter }: { model: Model; openMeter: (id: string) => void }) {
  const s = model.settings
  const hints = contractHints(model, toDay(todayIso()), true)
  const customs = model.meters.filter((m) => !m.builtin)
  return (
    <div className="sub">
      <Group title="Stromtarif" help="Tarifwechsel innerhalb eines Zeitraums werden tagesgenau anteilig gerechnet.">
        <TariffList model={model} kind="haushalt" />
      </Group>

      <Group title="Abschläge Strom" help="Wiederholt sich monatlich am Tag der ersten Zahlung. Ändert sich der Betrag: alten beenden, neuen anlegen.">
        <ListEditor
          items={model.abschlaege}
          fields={[
            { key: 'from', label: 'Erste Zahlung am', type: 'date' },
            { key: 'to', label: 'Letzte Zahlung bis', type: 'date', optional: true },
            { key: 'betrag', label: 'Betrag', type: 'num', unit: '€/Monat' },
          ]}
          addLabel="Abschlag"
          empty="Noch kein Abschlag. Für die Prognose von Nachzahlung oder Gutschrift nötig."
          defaults={() => ({ from: todayIso() })}
          save={(a) => db.abschlaege.put(a)}
          remove={(a) => db.abschlaege.delete(a.id)}
          summary={(a) => (
            <>
              <b className="num">{num(a.betrag, 2)} € monatlich</b>
              <small className="num">{span(a.from, a.to)}</small>
            </>
          )}
        />
      </Group>

      <Group title="Einspeisevergütung">
        <ListEditor
          items={model.feedins}
          fields={[
            { key: 'from', label: 'Gültig von', type: 'date' },
            { key: 'to', label: 'Gültig bis', type: 'date', optional: true },
            { key: 'ct', label: 'Vergütung', type: 'num', unit: 'ct/kWh' },
          ]}
          addLabel="Vergütungssatz"
          empty="Noch keine Vergütung hinterlegt."
          defaults={() => ({ from: todayIso() })}
          save={(f) => db.feedins.put(f)}
          remove={(f) => db.feedins.delete(f.id)}
          summary={(f) => (
            <>
              <b className="num">{num(f.ct, 2)} ct/kWh</b>
              <small className="num">{span(f.from, f.to)}</small>
            </>
          )}
        />
      </Group>

      <Group title="Abschläge Einspeisung" help="Monatlicher fester Betrag, den du für die Einspeisung bekommst. WATTZEN rechnet ihn gegen die tatsächliche Vergütung und zeigt Nachzahlung oder Rückforderung.">
        <ListEditor
          items={model.feedinAbschlaege}
          fields={[
            { key: 'from', label: 'Erste Zahlung am', type: 'date' },
            { key: 'to', label: 'Letzte Zahlung bis', type: 'date', optional: true },
            { key: 'betrag', label: 'Betrag', type: 'num', unit: '€/Monat' },
          ]}
          addLabel="Einspeise-Abschlag"
          empty="Kein Einspeise-Abschlag."
          defaults={() => ({ from: todayIso() })}
          save={(a) => db.feedinAbschlaege.put(a)}
          remove={(a) => db.feedinAbschlaege.delete(a.id)}
          summary={(a) => (
            <>
              <b className="num">{num(a.betrag, 2)} € monatlich</b>
              <small className="num">{span(a.from, a.to)}</small>
            </>
          )}
        />
      </Group>

      <Group title="Eigener WP-Tarif">
        <Toggle
          label="WP läuft über eigenen Tarif und Zähler"
          hint="Der WP-Zähler zählt dann als eigener Netzanschluss. Der Netzbezug am Hauptzähler enthält die WP nicht mehr, und die WP bekommt rechnerisch keinen PV-Strom."
          checked={s.wpTarifAktiv}
          onChange={(v) => set({ wpTarifAktiv: v })}
        />
        {s.wpTarifAktiv && (
          <>
            <Field label="Gilt seit" help="Leer = für alle Daten.">
              <input type="date" value={s.wpTarifSeit ?? ''} onChange={(e) => set({ wpTarifSeit: e.target.value || undefined })} />
            </Field>
            <TariffList model={model} kind="wp" />
          </>
        )}
      </Group>

      {customs.length > 0 && (
        <Group title="Eigene Zähler" help="Preise, Grundgebühren und Abschläge der eigenen Zähler.">
          <ul className="nav-list">
            {customs.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => openMeter(c.id)}>
                  <IconChip name={c.icon} color={c.color} size={30} />
                  <span>
                    {meterName(c)}
                    <small>
                      {c.costs?.parts.length ?? 0} Preise · {c.costs?.abschlaege.length ?? 0} Abschläge
                      {c.costs?.vertragEnde ? ` · Vertrag bis ${fmtDay(toDay(c.costs.vertragEnde))}` : ''}
                    </small>
                  </span>
                  <ChevronRight size={18} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </Group>
      )}

      <Group title="Vertragsende-Hinweis" help="Ein Hinweis erscheint vor Ablauf bzw. vor der Kündigungsfrist, bis ein neuer Tarif hinterlegt ist. Weggewischt kommt er nach 7 Tagen wieder.">
        <Field label="Vorlauf">
          <NumInput value={s.contractLead} onChange={(v) => v !== undefined && set({ contractLead: Math.max(1, Math.round(v)) })} unit="Wochen" enterKeyHint="done" />
        </Field>
        {hints.length > 0 && (
          <ul className="nav-list">
            {hints.map((h) => (
              <li key={h.key}>
                <button type="button" onClick={() => saveFile(`wattzen-vertrag-${todayIso()}.ics`, contractIcs(h), 'text/calendar')}>
                  <span>
                    {h.text}
                    <small>{h.sub}</small>
                  </span>
                  <span className="link">In den Kalender</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </div>
  )
}

/* ───────────── Berechnung ───────────── */

function CalcPage({ model, daily }: { model: Model; daily: Daily }) {
  const s = model.settings
  const adv = useMemo(() => advise(daily, model), [daily, model])
  const advInput = (key: keyof Settings['advice'], label: string, unit: string) => (
    <Field label={label}>
      <NumInput value={s.advice[key]} onChange={(v) => set({ advice: { ...s.advice, [key]: v } })} unit={unit} enterKeyHint="done" />
    </Field>
  )
  return (
    <div className="sub">
      <Group
        title="PV-Aufteilung auf WP und Wallbox"
        help="Wie viel PV-Strom an Wärmepumpe und Wallbox ging, ist gemessen (Export laut WechselRichter minus Einspeisung am Zähler). Geschätzt ist nur die Aufteilung zwischen beiden."
      >
        <Seg<SplitMethod>
          label="Aufteilungsmethode"
          value={s.splitMethod}
          onChange={(v) => set({ splitMethod: v })}
          options={[
            { value: 'saison', label: 'Saisonfaktoren' },
            { value: 'anteilig', label: 'Anteilig' },
            { value: 'wbZuerst', label: 'Wallbox zuerst' },
          ]}
        />
        <p className="help">
          {s.splitMethod === 'saison'
            ? 'Nach Verbrauch verteilt, die Wärmepumpe zählt je Monat mit ihrem Faktor. 0 ist keine Sperre: Was die Wallbox nicht aufnimmt, geht an die Wärmepumpe.'
            : s.splitMethod === 'anteilig'
              ? 'Rein nach Verbrauch verteilt (alle Faktoren = 1).'
              : 'Die Wallbox bekommt den PV-Strom zuerst, der Rest geht an die Wärmepumpe.'}
        </p>
        {s.splitMethod === 'saison' && (
          <>
            <div className="factors">
              {MONTHS.map((m, i) => (
                <Field key={m} label={m}>
                  <NumInput
                    ariaLabel={`WP-Faktor ${m}`}
                    value={s.factors[i]}
                    enterKeyHint="done"
                    onChange={(v) => {
                      if (v === undefined) return
                      const f = [...s.factors]
                      f[i] = Math.min(1, Math.max(0, v))
                      set({ factors: f })
                    }}
                  />
                </Field>
              ))}
            </div>
            <button type="button" className="link" onClick={() => set({ factors: DEFAULT_FACTORS })}>
              Standardwerte wiederherstellen
            </button>
          </>
        )}
      </Group>

      <Group title="Wetter und Plausibilität">
        <div className="edit-grid">
          <Field label="Heizgrenze" help="Unter dieser Tagesmitteltemperatur zählen Heizgradtage. Üblich: 15 °C.">
            <NumInput value={s.heizgrenze} onChange={(v) => v !== undefined && set({ heizgrenze: v })} unit="°C" enterKeyHint="done" />
          </Field>
          <Field label="Plausibilitäts-Toleranz" help="Erlaubte Abweichung zwischen WechselRichter und Zählern.">
            <NumInput value={Math.round(s.toleranz * 1000) / 10} onChange={(v) => v !== undefined && set({ toleranz: Math.max(0, v) / 100 })} unit="%" enterKeyHint="done" />
          </Field>
        </div>
      </Group>

      <Group title="Interpolation" help="Zwischen zwei Ablesungen wird linear nach Tagen interpoliert. Liegen Monats- oder Jahresgrenzen dazwischen, entstehen berechnete Stände.">
        <Toggle label="Berechnete Werte markieren" hint="Zeigt an Zeitraumgrenzen ohne Ablesung die Marke „berechnet“." checked={s.markCalc} onChange={(v) => set({ markCalc: v })} />
      </Group>

      <Group title="Spar-Empfehlungen" help="Preise eintragen – gerechnet wird mit deinen echten Verbräuchen der letzten 12 Monate.">
        <div className="edit-grid">
          {advInput('wpAp', 'WP-Tarif Arbeitspreis', 'ct/kWh')}
          {advInput('wpGrund', 'WP-Tarif Grundgebühr', '€/Monat')}
          {advInput('zaehlerJahr', 'Zusätzlicher Zähler', '€/Jahr')}
          {advInput('m1Pauschale', '§14a Modul 1 Pauschale', '€/Jahr')}
          {advInput('m1Mehrkosten', '§14a Modul 1 Mehrkosten', '€/Jahr')}
          {advInput('m2Reduktion', '§14a Modul 2 Reduzierung', 'ct/kWh')}
        </div>
        {!adv ? (
          <p className="help">Für Empfehlungen braucht es mindestens 90 Tage Daten.</p>
        ) : (
          <>
            {adv.hochgerechnet && <p className="help">Hochgerechnet aus {adv.basisTage} Tagen.</p>}
            {!adv.rechnungen.length && !adv.hinweise.length && <p className="help">Keine Auffälligkeiten in deinen Daten.</p>}
            {[...adv.rechnungen, ...adv.hinweise].map((a) => (
              <div className="advice" key={a.id}>
                <div className="advice-head">
                  <h4>{a.titel}</h4>
                  {a.ersparnis !== undefined && (
                    <b className={`num${a.ersparnis > 0 ? ' acc' : ''}`}>
                      {a.ersparnis >= 0 ? '+' : '−'}
                      {eur(Math.abs(a.ersparnis))} €/Jahr
                    </b>
                  )}
                </div>
                <dl className="rows num">
                  {a.zeilen.map((z) => (
                    <div key={z.label}>
                      <dt>{z.label}</dt>
                      <dd>
                        {z.eur < 0 ? '−' : ''}
                        {eur(Math.abs(z.eur))} €
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="help">{a.text}</p>
              </div>
            ))}
          </>
        )}
      </Group>
    </div>
  )
}

/* ───────────── Erinnerungen ───────────── */

function RemindPage({ model }: { model: Model }) {
  const s = model.settings
  const toast = useToast()
  const hints = contractHints(model, toDay(todayIso()), true)
  return (
    <div className="sub">
      <Group title="Werte ablesen am 1." help="WATTZEN erzeugt einen Kalendertermin, der sich jeden Monatsersten wiederholt – mit Erinnerung. Funktioniert ohne Server auf iPhone und Android.">
        <Toggle label="Erinnerung am 1. jedes Monats" checked={s.reminder} onChange={(v) => set({ reminder: v })} />
        {s.reminder && (
          <>
            <Field label="Uhrzeit">
              <input type="time" value={s.reminderTime} onChange={(e) => e.target.value && set({ reminderTime: e.target.value })} />
            </Field>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                saveFile('wattzen-ablesen.ics', readingReminder(toDay(todayIso()), s.reminderTime), 'text/calendar')
                toast('Kalenderdatei erstellt – öffnen und „Hinzufügen“ tippen')
              }}
            >
              Zum Kalender hinzufügen
            </button>
            <p className="help">Auf dem iPhone die geladene Datei öffnen und „Alle hinzufügen“ tippen; unter Android öffnet sie der Kalender.</p>
          </>
        )}
      </Group>
      <Group title="Fällig-Punkt">
        <Toggle label="Punkt am Erfassen-Knopf" hint="Erscheint, solange seit dem 1. des Monats noch nicht abgelesen wurde." checked={s.dueDot} onChange={(v) => set({ dueDot: v })} />
      </Group>
      <Group title="Vertragsende" help="Termine für Vertragsende oder Kündigungsfrist, mit Erinnerung eine Woche vorher.">
        {hints.length ? (
          <ul className="nav-list">
            {hints.map((h) => (
              <li key={h.key}>
                <button type="button" onClick={() => saveFile(`wattzen-vertrag-${todayIso()}.ics`, contractIcs(h), 'text/calendar')}>
                  <span>
                    {h.text}
                    <small>{h.sub}</small>
                  </span>
                  <span className="link">In den Kalender</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="nav-list">
            {model.tariffs
              .filter((t) => t.to)
              .map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() =>
                      saveFile(
                        `wattzen-vertrag-${t.to}.ics`,
                        contractIcs({ key: t.id, title: t.kind === 'wp' ? 'WP-Tarif' : 'Stromvertrag', text: `Vertrag läuft am ${fmtDay(toDay(t.to!))} aus`, ende: toDay(t.to!), frist: t.fristWochen ? toDay(t.to!) - t.fristWochen * 7 : undefined }),
                        'text/calendar',
                      )
                    }
                  >
                    <span>
                      {t.anbieter ?? (t.kind === 'wp' ? 'WP-Tarif' : 'Stromtarif')}
                      <small>bis {fmtDay(toDay(t.to!))}</small>
                    </span>
                    <span className="link">In den Kalender</span>
                  </button>
                </li>
              ))}
            {!model.tariffs.some((t) => t.to) && <li className="help">Kein Tarif mit Vertragsende hinterlegt.</li>}
          </ul>
        )}
      </Group>
    </div>
  )
}

/* ───────────── Darstellung ───────────── */

function LookPage({ model }: { model: Model }) {
  const s = model.settings
  return (
    <div className="sub">
      <Group title="Farbschema">
        <Seg
          label="Farbschema"
          value={s.theme}
          onChange={(v) => set({ theme: v })}
          options={[
            { value: 'dark', label: 'Dunkel' },
            { value: 'light', label: 'Hell' },
            { value: 'system', label: 'System' },
          ]}
        />
      </Group>
      <Group title="Startbildschirm">
        <Toggle label="Startbildschirm zeigen" hint="Logo mit „by Dani S.“ beim Öffnen. Ein Tipp überspringt ihn." checked={s.splash} onChange={(v) => set({ splash: v })} />
        {s.splash && (
          <Field label={`Dauer: ${num(s.splashDauer, 1)} s`}>
            <input type="range" min={0.5} max={3} step={0.5} value={s.splashDauer} onChange={(e) => set({ splashDauer: Number(e.target.value) })} />
          </Field>
        )}
      </Group>
      <Group title="Navigation">
        <div className="edit-grid">
          <Field label="Startseite der App">
            <select value={s.startView} onChange={(e) => set({ startView: e.target.value as Settings['startView'] })}>
              <option value="overview">Übersicht</option>
              <option value="dash">Auswertung</option>
              <option value="entry">Erfassen</option>
            </select>
          </Field>
          <Field label="Standard-Zeitraum der Auswertung">
            <select value={s.defaultRange} onChange={(e) => set({ defaultRange: e.target.value as RangeTab })}>
              <option value="last">Seit letzter Ablesung</option>
              <option value="monat">Monat</option>
              <option value="halb">Halbjahr</option>
              <option value="jahr">Jahr (seit 1.1.)</option>
              <option value="zwei">2 Jahre</option>
            </select>
          </Field>
        </div>
      </Group>
      <Group title="Zahlen">
        <div className="edit-grid">
          <Field label="Nachkommastellen bei kWh">
            <select value={s.kwhDecimals} onChange={(e) => set({ kwhDecimals: Number(e.target.value) })}>
              <option value={-1}>Automatisch</option>
              <option value={0}>0</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
            </select>
          </Field>
        </div>
        <Toggle label="MWh ab 1.000 kWh" checked={s.mwh} onChange={(v) => set({ mwh: v })} />
        <Toggle label="Vorjahresvergleich" hint="Dezentes „−12 % ggü. Vorjahr“ und eine blasse Linie im Diagramm." checked={s.yoy} onChange={(v) => set({ yoy: v })} />
        <Toggle label="Uhrzeit bei der Ablesung" checked={s.showTime} onChange={(v) => set({ showTime: v })} />
        <Toggle label="Haptik-Feedback" hint="Kurze Vibration beim Speichern und Navigieren (wo das Gerät es unterstützt)." checked={s.haptics} onChange={(v) => set({ haptics: v })} />
      </Group>
    </div>
  )
}

/* ───────────── Daten ───────────── */

function DataPage({ model }: { model: Model }) {
  const s = model.settings
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [pending, setPending] = useState<{ name: string; text: string }>()
  const [confirm, setConfirm] = useState<'demo' | 'demoDel'>()
  const [word, setWord] = useState('')
  const [nurAbl, setNurAbl] = useState(false)
  const hasData = model.readings.length > 0

  async function runImport(name: string, text: string) {
    try {
      const n = name.toLowerCase().endsWith('.csv') ? await importCsv(text, model) : await importJson(text)
      setMsg(`${n} Ablesungen importiert.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Import fehlgeschlagen.')
    }
  }

  return (
    <div className="sub">
      <Group title="Export und Import" help="Deine Daten liegen nur auf diesem Gerät. JSON enthält alles, CSV die Ablesungen.">
        <div className="btn-row">
          <button type="button" className="btn" disabled={!hasData} onClick={() => exportJson(model)}>
            Export JSON
          </button>
          <button type="button" className="btn" disabled={!hasData} onClick={() => exportCsv(model)}>
            Export CSV
          </button>
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            Import …
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,application/json,text/csv"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              const text = await f.text()
              if (f.name.toLowerCase().endsWith('.csv') || !hasData) void runImport(f.name, text)
              else setPending({ name: f.name, text })
            }}
          />
        </div>
        {msg && (
          <p className="note" role="status">
            {msg}
          </p>
        )}
        <p className="help">JSON-Import ersetzt alle Daten. CSV-Import ergänzt Ablesungen und überschreibt gleiche Tage.</p>
      </Group>

      <Group title="Demo-Daten" help="Rund zwei Jahre realistische Beispielwerte mit simuliertem Wetter, Wasserzählern und Tarifen.">
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => (hasData && !s.demo ? setConfirm('demo') : void loadDemo().then(() => toast('Demo-Daten geladen')))}>
            Demo-Daten laden
          </button>
          {s.demo && (
            <button type="button" className="btn" onClick={() => setConfirm('demoDel')}>
              Demo-Daten entfernen
            </button>
          )}
        </div>
      </Group>

      <Group title="Zurücksetzen">
        <Toggle label="Nur Ablesungen löschen" hint="Tarife, Zähler und Einstellungen bleiben erhalten." checked={nurAbl} onChange={setNurAbl} />
        <Field label="Zum Bestätigen ZURÜCKSETZEN eintippen" help={nurAbl ? 'Alle Ablesungen und Zählerwechsel werden gelöscht.' : 'Alle Daten werden gelöscht. Das lässt sich nicht rückgängig machen.'}>
          <input type="text" autoCapitalize="characters" autoComplete="off" value={word} onChange={(e) => setWord(e.target.value)} />
        </Field>
        <button
          type="button"
          className="btn danger"
          disabled={word !== 'ZURÜCKSETZEN'}
          onClick={() => {
            void clearData({ nurAblesungen: nurAbl, backToOnboarding: !nurAbl })
            setWord('')
            toast(nurAbl ? 'Ablesungen gelöscht' : 'Alle Daten gelöscht')
          }}
        >
          {nurAbl ? 'Ablesungen löschen' : 'Alles zurücksetzen'}
        </button>
      </Group>

      {pending && (
        <Confirm
          title="Backup einspielen?"
          text="Das JSON-Backup ersetzt alle vorhandenen Daten in dieser App."
          confirm="Ersetzen"
          onConfirm={() => void runImport(pending.name, pending.text)}
          onClose={() => setPending(undefined)}
        />
      )}
      {confirm === 'demo' && (
        <Confirm
          title="Demo-Daten laden?"
          text="Die Demo ersetzt deine vorhandenen Daten. Exportiere vorher ein Backup, wenn du sie behalten willst."
          confirm="Ersetzen"
          onConfirm={() => void loadDemo()}
          onClose={() => setConfirm(undefined)}
        />
      )}
      {confirm === 'demoDel' && (
        <Confirm
          title="Demo-Daten entfernen?"
          text="Alle Demo-Werte werden gelöscht. Danach kannst du mit deinen eigenen Zählerständen starten."
          confirm="Entfernen"
          onConfirm={() => void clearData({ backToOnboarding: true })}
          onClose={() => setConfirm(undefined)}
        />
      )}
    </div>
  )
}

/* ───────────── Über ───────────── */

function AboutPage({ model }: { model: Model }) {
  return (
    <div className="sub about">
      <div className="card about-card">
        <span className="wordmark big">WATTZEN</span>
        <span className="hand">by Dani S.</span>
        <dl className="rows num">
          <div>
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div>
            <dt>Ablesungen</dt>
            <dd>{model.readings.length}</dd>
          </div>
          <div>
            <dt>Zähler aktiv</dt>
            <dd>{model.meters.filter((m) => m.active).length}</dd>
          </div>
        </dl>
        <p className="help">
          Energie-Tracker für Haus, PV, Speicher, Wärmepumpe und Wallbox. Alle Daten bleiben auf diesem Gerät. Wetterdaten: Open-Meteo.com (CC BY 4.0).
        </p>
      </div>
    </div>
  )
}

/* ───────────── Rahmen ───────────── */

export function Admin({ model, daily, weather }: { model: Model; daily: Daily; weather?: WeatherState }) {
  const [page, setPage] = useState<Page>('home')
  const [meterId, setMeterId] = useState<string>()
  const go = (p: Page) => {
    setPage(p)
    setMeterId(undefined)
    window.scrollTo({ top: 0 })
  }
  const openMeter = (id: string) => {
    setMeterId(id)
    window.scrollTo({ top: 0 })
  }
  const meter = meterId ? model.meters.find((m) => m.id === meterId) : undefined
  const info = PAGES.find((p) => p.id === page)

  if (page === 'home') {
    const groups: Exclude<Page, 'home'>[][] = [
      ['haus', 'zaehler', 'tarife'],
      ['berechnung', 'erinnerungen', 'darstellung'],
      ['daten', 'ueber'],
    ]
    return (
      <section className="screen narrow admin">
        {groups.map((g, i) => (
          <ul className="card settings-list" key={i}>
            {g.map((id) => {
              const p = PAGES.find((x) => x.id === id)!
              return (
                <li key={id}>
                  <button type="button" onClick={() => go(id)}>
                    <span className={`chip c-${p.color}`} style={{ width: 36, height: 36 }} aria-hidden>
                      <p.Icon size={18} strokeWidth={1.6} />
                    </span>
                    <span className="set-text">
                      <b>{p.title}</b>
                      <small>{p.desc}</small>
                    </span>
                    <ChevronRight size={18} aria-hidden className="chev" />
                  </button>
                </li>
              )
            })}
          </ul>
        ))}
        <p className="fineprint center">WATTZEN {__APP_VERSION__} · alle Daten bleiben auf diesem Gerät</p>
      </section>
    )
  }

  return (
    <section className="screen narrow admin">
      <div className="sub-head">
        <button type="button" className="back" onClick={() => (meter ? setMeterId(undefined) : go('home'))}>
          <ChevronLeft size={20} aria-hidden />
          {meter ? (page === 'tarife' ? 'Tarife' : 'Zähler') : 'Meister'}
        </button>
        <h2>{meter ? meter.name || 'Eigener Zähler' : info?.title}</h2>
      </div>
      {meter ? (
        <MeterEditor key={meter.id} model={model} meter={meter} onBack={() => setMeterId(undefined)} />
      ) : (
        <>
          {page === 'haus' && <HousePage model={model} weather={weather} />}
          {page === 'zaehler' && <MetersPage model={model} openMeter={openMeter} />}
          {page === 'tarife' && <TariffsPage model={model} openMeter={openMeter} />}
          {page === 'berechnung' && <CalcPage model={model} daily={daily} />}
          {page === 'erinnerungen' && <RemindPage model={model} />}
          {page === 'darstellung' && <LookPage model={model} />}
          {page === 'daten' && <DataPage model={model} />}
          {page === 'ueber' && <AboutPage model={model} />}
        </>
      )}
    </section>
  )
}
