import { useState } from 'react'
import { meterName } from '../../calc/meters'
import { db, saveMeter } from '../../db'
import { fmtDay, toDay, todayIso } from '../../lib/dates'
import { num } from '../../lib/format'
import type { ColorKey, CustomCosts, IconKey, MeterConf, Model, PricePart } from '../../types'
import { Confirm, Field, IconChip, NumInput, Toggle } from '../../ui/bits'
import { ListEditor } from './ListEditor'

const ICON_CHOICES: IconKey[] = ['droplet', 'sprout', 'flame', 'fuel', 'car', 'zap', 'sun', 'thermo', 'wind', 'house', 'box', 'hash']
const COLOR_CHOICES: { key: ColorKey; name: string }[] = [
  { key: 'wasser', name: 'Blau' },
  { key: 'einsp', name: 'Grün' },
  { key: 'speicher', name: 'Türkis' },
  { key: 'pv', name: 'Gelb' },
  { key: 'wp', name: 'Orange' },
  { key: 'wb', name: 'Violett' },
  { key: 'netz', name: 'Graublau' },
  { key: 'haus', name: 'Grau' },
]
const UNITS = ['kWh', 'm³', 'l', 'km', 'h', 'Stk']

const span = (from: string, to?: string) => `${fmtDay(toDay(from))} – ${to ? fmtDay(toDay(to)) : 'offen'}`

export const emptyCosts = (): CustomCosts => ({ grund: [], parts: [], abschlaege: [] })

/** Eigenen Zähler bearbeiten: Darstellung und Kostenmodell. */
export function MeterEditor({ model, meter, onBack }: { model: Model; meter: MeterConf; onBack: () => void }) {
  const [m, setM] = useState<MeterConf>({ ...meter, costs: meter.costs ?? emptyCosts() })
  const [del, setDel] = useState(false)
  const costs = m.costs!
  const update = (patch: Partial<MeterConf>) => {
    const next = { ...m, ...patch }
    setM(next)
    void saveMeter(next)
  }
  const updCosts = (patch: Partial<CustomCosts>) => update({ costs: { ...costs, ...patch } })
  const others = model.meters.filter((x) => x.id !== m.id && x.unit === m.unit)
  const upsert = <T extends { id: string }>(list: T[], item: T) =>
    list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [...list, item]

  return (
    <div className="sub">
      <div className="card form-card">
        <div className="meter-preview">
          <IconChip name={m.icon} color={m.color} size={44} />
          <div>
            <b>{m.name || 'Neuer Zähler'}</b>
            <small>{m.unit}</small>
          </div>
        </div>
        <Field label="Name" help="So erscheint der Zähler beim Erfassen und in der Auswertung.">
          <input type="text" value={m.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
        <Field label="Hinweis (optional)" help="Kleine Zeile unter dem Namen, z. B. „Keller, links“.">
          <input type="text" value={m.hint ?? ''} onChange={(e) => update({ hint: e.target.value || undefined })} />
        </Field>
        <div className="field-label">Icon</div>
        <div className="pick" role="radiogroup" aria-label="Icon">
          {ICON_CHOICES.map((ic) => (
            <button key={ic} type="button" role="radio" aria-checked={m.icon === ic} aria-label={ic} className={m.icon === ic ? 'on' : ''} onClick={() => update({ icon: ic })}>
              <IconChip name={ic} color={m.color} size={36} />
            </button>
          ))}
        </div>
        <div className="field-label">Farbe</div>
        <div className="pick" role="radiogroup" aria-label="Farbe">
          {COLOR_CHOICES.map((c) => (
            <button key={c.key} type="button" role="radio" aria-checked={m.color === c.key} aria-label={c.name} className={`swatch-btn${m.color === c.key ? ' on' : ''}`} onClick={() => update({ color: c.key })}>
              <i className={`swatch f-${c.key}`} />
            </button>
          ))}
        </div>
        <div className="edit-grid">
          <Field label="Einheit" help="Frei wählbar, z. B. m³, l, km.">
            <input type="text" list="unit-list" value={m.unit} onChange={(e) => update({ unit: e.target.value })} />
            <datalist id="unit-list">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
          <Field label="Nachkommastellen" help="Für den Zählerstand.">
            <select value={m.decimals} onChange={(e) => update({ decimals: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Toggle label="Aktiv" hint="Inaktive Zähler erscheinen nicht beim Erfassen." checked={m.active} onChange={(v) => update({ active: v })} />
      </div>

      <h3 className="sec-title">Grundgebühr</h3>
      <div className="card form-card">
        <ListEditor
          items={costs.grund}
          fields={[
            { key: 'from', label: 'Gültig von', type: 'date' },
            { key: 'to', label: 'Gültig bis', type: 'date', optional: true },
            { key: 'eurMonat', label: 'Grundgebühr', type: 'num', unit: '€/Monat' },
          ]}
          addLabel="Grundgebühr"
          empty="Keine Grundgebühr."
          defaults={() => ({ from: `${todayIso().slice(0, 4)}-01-01` })}
          save={(g) => updCosts({ grund: upsert(costs.grund, g) })}
          remove={(g) => updCosts({ grund: costs.grund.filter((x) => x.id !== g.id) })}
          summary={(g) => (
            <>
              <b className="num">{num(g.eurMonat, 2)} €/Monat</b>
              <small className="num">{span(g.from, g.to)}</small>
            </>
          )}
        />
      </div>

      <h3 className="sec-title">Preisbestandteile</h3>
      <div className="card form-card">
        <p className="help">
          Beliebig viele Preise pro {m.unit || 'Einheit'}, z. B. „Frischwasser“ und „Abwasser“. Mit „abzüglich“ zählt nur die Menge dieses Zählers minus die eines anderen – etwa Abwasser ohne Gartenwasser.
        </p>
        <ListEditor<PricePart>
          items={costs.parts}
          fields={[
            { key: 'name', label: 'Name', type: 'text' },
            { key: 'preis', label: 'Preis', type: 'num', unit: `€/${m.unit || 'Einheit'}` },
            { key: 'from', label: 'Gültig von', type: 'date' },
            { key: 'to', label: 'Gültig bis', type: 'date', optional: true },
            {
              key: 'minus', label: 'Mengenbasis', type: 'select', optional: true,
              options: [{ value: '', label: 'Menge dieses Zählers' }, ...others.map((o) => ({ value: o.id, label: `abzüglich ${meterName(o)}` }))],
            },
          ]}
          addLabel="Preisbestandteil"
          empty="Noch keine Preise – dann rechnet WATTZEN nur Mengen."
          defaults={() => ({ from: `${todayIso().slice(0, 4)}-01-01` })}
          save={(p) => updCosts({ parts: upsert(costs.parts, p) })}
          remove={(p) => updCosts({ parts: costs.parts.filter((x) => x.id !== p.id) })}
          summary={(p) => (
            <>
              <b className="num">
                {p.name} · {num(p.preis, 2)} €/{m.unit}
              </b>
              <small className="num">
                {span(p.from, p.to)}
                {p.minus ? ` · abzüglich ${meterName(model.meters.find((x) => x.id === p.minus) ?? { id: p.minus, name: '?', builtin: false })}` : ''}
              </small>
            </>
          )}
        />
      </div>

      <h3 className="sec-title">Abschläge und Vertrag</h3>
      <div className="card form-card">
        <ListEditor
          items={costs.abschlaege}
          fields={[
            { key: 'from', label: 'Erste Zahlung am', type: 'date' },
            { key: 'to', label: 'Letzte Zahlung bis', type: 'date', optional: true },
            { key: 'betrag', label: 'Betrag', type: 'num', unit: '€/Monat' },
          ]}
          addLabel="Abschlag"
          empty="Kein Abschlag – mit Abschlag zeigt die Prognose Nachzahlung oder Gutschrift."
          defaults={() => ({ from: todayIso() })}
          save={(a) => updCosts({ abschlaege: upsert(costs.abschlaege, a) })}
          remove={(a) => updCosts({ abschlaege: costs.abschlaege.filter((x) => x.id !== a.id) })}
          summary={(a) => (
            <>
              <b className="num">{num(a.betrag, 2)} € monatlich</b>
              <small className="num">{span(a.from, a.to)}</small>
            </>
          )}
        />
        <div className="edit-grid">
          <Field label="Anbieter (optional)">
            <input type="text" value={costs.anbieter ?? ''} onChange={(e) => updCosts({ anbieter: e.target.value || undefined })} />
          </Field>
          <Field label="Vertragsende (optional)" help="Ab dem eingestellten Vorlauf erscheint ein Hinweis.">
            <input type="date" value={costs.vertragEnde ?? ''} onChange={(e) => updCosts({ vertragEnde: e.target.value || undefined })} />
          </Field>
          <Field label="Kündigungsfrist (optional)">
            <NumInput value={costs.fristWochen} onChange={(v) => updCosts({ fristWochen: v })} unit="Wochen" enterKeyHint="done" />
          </Field>
        </div>
      </div>

      <button type="button" className="btn ghost danger-text" onClick={() => setDel(true)}>
        Zähler löschen
      </button>
      {del && (
        <Confirm
          title={`${m.name} löschen?`}
          text="Die Einstellungen des Zählers werden gelöscht. Seine Stände bleiben in den Ablesungen gespeichert, werden aber nicht mehr ausgewertet."
          confirm="Löschen"
          onConfirm={() => {
            void db.meters.delete(m.id)
            onBack()
          }}
          onClose={() => setDel(false)}
        />
      )}
    </div>
  )
}
