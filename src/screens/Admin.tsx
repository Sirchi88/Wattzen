import { useMemo, useRef, useState, type ReactNode } from 'react'
import { advise } from '../calc/advice'
import type { Daily } from '../calc/engine'
import { clearData, db, exportCsv, exportJson, importCsv, importJson, loadDemo, saveSettings, uid } from '../db'
import { fmtDay, MONTHS, toDay, todayIso } from '../lib/dates'
import { eur, num, stand } from '../lib/format'
import { DEFAULT_FACTORS, METERS, type Model, type Settings, type SplitMethod } from '../types'
import { Confirm, NumInput, Seg, Toggle } from '../ui/bits'
import type { Table } from 'dexie'

/* ───────────── Generischer Listen-Editor ───────────── */

interface FieldDef {
  key: string
  label: string
  type: 'date' | 'num' | 'text' | 'select'
  unit?: string
  optional?: boolean
  options?: { value: string; label: string }[]
}
type Row = { id: string } & Record<string, unknown>

function ListEditor<T extends { id: string }>({
  items, table, fields, summary, addLabel, defaults, extra, empty,
}: {
  items: T[]
  table: Table<T, string>
  fields: FieldDef[]
  summary: (item: T) => ReactNode
  addLabel: string
  defaults: () => Partial<T>
  extra?: Partial<T>
  empty: string
}) {
  const [draft, setDraft] = useState<Row>()
  const [isNew, setIsNew] = useState(false)
  const [del, setDel] = useState<T>()
  const [err, setErr] = useState('')
  const set = (k: string, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  async function save() {
    if (!draft) return
    for (const f of fields) {
      const v = draft[f.key]
      if (!f.optional && (v === undefined || v === '')) return setErr(`„${f.label}" fehlt.`)
    }
    if (draft.from && draft.to && (draft.to as string) < (draft.from as string)) return setErr('„bis" liegt vor „von".')
    const clean: Row = { ...draft }
    for (const f of fields) if (clean[f.key] === '') delete clean[f.key]
    await table.put({ ...(clean as unknown as T), ...extra })
    setDraft(undefined)
  }

  const form = draft && (
    <div className="edit">
      <div className="edit-grid">
        {fields.map((f) => (
          <label key={f.key} className={f.type === 'text' ? 'wide' : ''}>
            <span>
              {f.label}
              {f.optional && <small> optional</small>}
            </span>
            {f.type === 'num' ? (
              <NumInput value={draft[f.key] as number | undefined} onChange={(v) => set(f.key, v)} unit={f.unit} />
            ) : f.type === 'select' ? (
              <select value={(draft[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)}>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input type={f.type} value={(draft[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      {err && <p className="note warn">{err}</p>}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={() => void save()}>
          Speichern
        </button>
        <button type="button" className="btn ghost" onClick={() => setDraft(undefined)}>
          Abbrechen
        </button>
      </div>
    </div>
  )

  return (
    <div className="list">
      {!items.length && !draft && <p className="muted">{empty}</p>}
      {items.map((it) =>
        draft && !isNew && draft.id === it.id ? (
          <div key={it.id}>{form}</div>
        ) : (
          <div className="list-row" key={it.id}>
            <div className="list-sum">{summary(it)}</div>
            <div className="list-act">
              <button
                type="button"
                className="link"
                onClick={() => {
                  setErr('')
                  setIsNew(false)
                  setDraft({ ...(it as unknown as Row) })
                }}
              >
                Ändern
              </button>
              <button type="button" className="link" onClick={() => setDel(it)}>
                Löschen
              </button>
            </div>
          </div>
        ),
      )}
      {draft && isNew ? (
        form
      ) : (
        <button
          type="button"
          className="btn ghost add"
          onClick={() => {
            setErr('')
            setIsNew(true)
            setDraft({ id: uid(), ...(defaults() as Record<string, unknown>) })
          }}
        >
          + {addLabel}
        </button>
      )}
      {del && (
        <Confirm title="Eintrag löschen?" text="Der Eintrag wird entfernt. Die Auswertung rechnet sofort ohne ihn." confirm="Löschen" onConfirm={() => void table.delete(del.id)} onClose={() => setDel(undefined)} />
      )}
    </div>
  )
}

const span = (from: string, to?: string) => `${fmtDay(toDay(from))} – ${to ? fmtDay(toDay(to)) : 'offen'}`

const TARIFF_FIELDS: FieldDef[] = [
  { key: 'from', label: 'Gültig von', type: 'date' },
  { key: 'to', label: 'Gültig bis', type: 'date', optional: true },
  { key: 'arbeitspreis', label: 'Arbeitspreis', type: 'num', unit: 'ct/kWh' },
  { key: 'grundgebuehr', label: 'Grundgebühr', type: 'num', unit: '€/Monat' },
  { key: 'anbieter', label: 'Anbieter', type: 'text', optional: true },
  { key: 'notiz', label: 'Notiz', type: 'text', optional: true },
]

/* ───────────── Bereich ───────────── */

function Section({ id, title, hint, open, onToggle, children }: { id: string; title: string; hint?: string; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <div className={`sec${open ? ' open' : ''}`}>
      <button type="button" className="sec-head" aria-expanded={open} onClick={() => onToggle(id)}>
        <span>{title}</span>
        <small>{hint}</small>
        <i aria-hidden>{open ? '−' : '+'}</i>
      </button>
      {open && <div className="sec-body">{children}</div>}
    </div>
  )
}

export function Admin({ model, daily }: { model: Model; daily: Daily }) {
  const s = model.settings
  const [open, setOpen] = useState<string>('tarife')
  const [confirm, setConfirm] = useState<'reset' | 'demo' | 'demoDel' | 'import'>()
  const [msg, setMsg] = useState('')
  const pending = useRef<{ name: string; text: string }>(undefined)
  const fileRef = useRef<HTMLInputElement>(null)
  const toggle = (id: string) => setOpen((o) => (o === id ? '' : id))
  const set = (p: Partial<Settings>) => void saveSettings(p)
  const adv = useMemo(() => advise(daily, model), [daily, model])
  const haushalt = model.tariffs.filter((t) => t.kind === 'haushalt')
  const wpTarife = model.tariffs.filter((t) => t.kind === 'wp')
  const hasData = model.readings.length > 0

  async function runImport(name: string, text: string) {
    try {
      const n = name.toLowerCase().endsWith('.csv') ? await importCsv(text) : await importJson(text)
      setMsg(`${n} Ablesungen importiert.`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Import fehlgeschlagen.')
    }
  }

  const advInput = (key: keyof Settings['advice'], label: string, unit: string) => (
    <label>
      <span>{label}</span>
      <NumInput value={s.advice[key]} onChange={(v) => set({ advice: { ...s.advice, [key]: v } })} unit={unit} />
    </label>
  )

  return (
    <section className="screen narrow admin">
      <div className="screen-head">
        <h1>Elektromeisterbereich</h1>
      </div>

      <Section id="tarife" title="Stromtarife" hint={`${haushalt.length}`} open={open === 'tarife'} onToggle={toggle}>
        <ListEditor
          items={haushalt}
          table={db.tariffs}
          fields={TARIFF_FIELDS}
          extra={{ kind: 'haushalt' }}
          addLabel="Tarif"
          empty="Noch kein Tarif. Ohne Tarif sind alle Kosten 0."
          defaults={() => ({ from: todayIso() })}
          summary={(t) => (
            <>
              <b className="num">
                {num(t.arbeitspreis, 2)} ct/kWh · {num(t.grundgebuehr, 2)} €/Monat
              </b>
              <small className="num">
                {span(t.from, t.to)}
                {t.anbieter ? ` · ${t.anbieter}` : ''}
                {t.notiz ? ` · ${t.notiz}` : ''}
              </small>
            </>
          )}
        />
        <p className="fineprint">Tarifwechsel innerhalb eines Zeitraums werden tagesgenau anteilig gerechnet.</p>
      </Section>

      <Section id="verg" title="Einspeisevergütung" hint={`${model.feedins.length}`} open={open === 'verg'} onToggle={toggle}>
        <ListEditor
          items={model.feedins}
          table={db.feedins}
          fields={[
            { key: 'from', label: 'Gültig von', type: 'date' },
            { key: 'to', label: 'Gültig bis', type: 'date', optional: true },
            { key: 'ct', label: 'Vergütung', type: 'num', unit: 'ct/kWh' },
          ]}
          addLabel="Vergütungssatz"
          empty="Noch keine Vergütung hinterlegt."
          defaults={() => ({ from: todayIso() })}
          summary={(f) => (
            <>
              <b className="num">{num(f.ct, 2)} ct/kWh</b>
              <small className="num">{span(f.from, f.to)}</small>
            </>
          )}
        />
      </Section>

      <Section id="abschlag" title="Abschläge" hint={`${model.abschlaege.length}`} open={open === 'abschlag'} onToggle={toggle}>
        <ListEditor
          items={model.abschlaege}
          table={db.abschlaege}
          fields={[
            { key: 'from', label: 'Erste Zahlung am', type: 'date' },
            { key: 'to', label: 'Letzte Zahlung bis', type: 'date', optional: true },
            { key: 'betrag', label: 'Betrag', type: 'num', unit: '€/Monat' },
          ]}
          addLabel="Abschlag"
          empty="Noch kein Abschlag. Für die Prognose von Nachzahlung oder Gutschrift nötig."
          defaults={() => ({ from: todayIso() })}
          summary={(a) => (
            <>
              <b className="num">{num(a.betrag, 2)} € monatlich</b>
              <small className="num">
                am {toDay(a.from) ? Number(a.from.slice(8)) : ''}. · {span(a.from, a.to)}
              </small>
            </>
          )}
        />
        <p className="fineprint">Ein Abschlag wiederholt sich monatlich am Tag der ersten Zahlung. Ändert sich der Betrag, den alten beenden und einen neuen anlegen.</p>
      </Section>

      <Section id="split" title="PV-Aufteilung auf WP und Wallbox" open={open === 'split'} onToggle={toggle}>
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
        <p className="muted">
          {s.splitMethod === 'saison'
            ? 'Der PV-Strom hinter dem Wechselrichter wird nach Verbrauch verteilt; die Wärmepumpe zählt je Monat mit ihrem Faktor. 0 ist keine Sperre: Was die Wallbox nicht aufnimmt, geht an die Wärmepumpe.'
            : s.splitMethod === 'anteilig'
              ? 'Der PV-Strom wird rein nach Verbrauch auf Wärmepumpe und Wallbox verteilt (alle Faktoren = 1).'
              : 'Die Wallbox bekommt den PV-Strom zuerst, der Rest geht an die Wärmepumpe.'}
        </p>
        {s.splitMethod === 'saison' && (
          <>
            <div className="factors">
              {MONTHS.map((m, i) => (
                <label key={m}>
                  <span>{m}</span>
                  <NumInput
                    ariaLabel={`WP-Faktor ${m}`}
                    value={s.factors[i]}
                    onChange={(v) => {
                      if (v === undefined) return
                      const f = [...s.factors]
                      f[i] = Math.min(1, Math.max(0, v))
                      set({ factors: f })
                    }}
                  />
                </label>
              ))}
            </div>
            <button type="button" className="link" onClick={() => set({ factors: DEFAULT_FACTORS })}>
              Standardwerte wiederherstellen
            </button>
          </>
        )}
      </Section>

      <Section id="wp" title="Eigener WP-Tarif" hint={s.wpTarifAktiv ? 'an' : 'aus'} open={open === 'wp'} onToggle={toggle}>
        <Toggle
          label="WP läuft über eigenen Tarif und Zähler"
          hint="Der WP-Zähler zählt dann als eigener Netzanschluss. Der Netzbezug am Hauptzähler enthält die WP nicht mehr, und die WP bekommt rechnerisch keinen PV-Strom."
          checked={s.wpTarifAktiv}
          onChange={(v) => set({ wpTarifAktiv: v })}
        />
        {s.wpTarifAktiv && (
          <>
            <label className="inline">
              <span>
                Gilt seit <small>leer = für alle Daten</small>
              </span>
              <input type="date" value={s.wpTarifSeit ?? ''} onChange={(e) => set({ wpTarifSeit: e.target.value || undefined })} />
            </label>
            <ListEditor
              items={wpTarife}
              table={db.tariffs}
              fields={TARIFF_FIELDS}
              extra={{ kind: 'wp' }}
              addLabel="WP-Tarif"
              empty="Noch kein WP-Tarif – der WP-Strom kostet rechnerisch 0."
              defaults={() => ({ from: s.wpTarifSeit ?? todayIso() })}
              summary={(t) => (
                <>
                  <b className="num">
                    {num(t.arbeitspreis, 2)} ct/kWh · {num(t.grundgebuehr, 2)} €/Monat
                  </b>
                  <small className="num">
                    {span(t.from, t.to)}
                    {t.anbieter ? ` · ${t.anbieter}` : ''}
                  </small>
                </>
              )}
            />
          </>
        )}
      </Section>

      <Section id="spar" title="Spar-Empfehlungen" open={open === 'spar'} onToggle={toggle}>
        <p className="muted">Preise eintragen – gerechnet wird mit deinen echten Verbräuchen der letzten 12 Monate.</p>
        <div className="edit-grid">
          {advInput('wpAp', 'WP-Tarif Arbeitspreis', 'ct/kWh')}
          {advInput('wpGrund', 'WP-Tarif Grundgebühr', '€/Monat')}
          {advInput('zaehlerJahr', 'Zusätzlicher Zähler', '€/Jahr')}
          {advInput('m1Pauschale', '§14a Modul 1 Pauschale', '€/Jahr')}
          {advInput('m1Mehrkosten', '§14a Modul 1 Mehrkosten', '€/Jahr')}
          {advInput('m2Reduktion', '§14a Modul 2 Reduzierung', 'ct/kWh')}
        </div>
        {!adv ? (
          <p className="muted">Für Empfehlungen braucht es mindestens 90 Tage Daten.</p>
        ) : (
          <>
            {adv.hochgerechnet && <p className="fineprint">Hochgerechnet aus {adv.basisTage} Tagen – mit einem vollen Jahr wird es genauer.</p>}
            {!adv.rechnungen.length && !adv.hinweise.length && (
              <p className="muted">Keine Auffälligkeiten in deinen Daten. Mit eingetragenen Preisen erscheinen hier die Vergleichsrechnungen.</p>
            )}
            {[...adv.rechnungen, ...adv.hinweise].map((a) => (
              <div className="advice" key={a.id}>
                <div className="advice-head">
                  <h3>{a.titel}</h3>
                  {a.ersparnis !== undefined && (
                    <b className={`num${a.ersparnis > 0 ? ' acc' : ''}`}>
                      {a.ersparnis >= 0 ? '+' : '−'}
                      {eur(Math.abs(a.ersparnis))} €/Jahr
                    </b>
                  )}
                </div>
                <dl className="hero-rows num">
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
                <p className="muted">{a.text}</p>
              </div>
            ))}
          </>
        )}
      </Section>

      <Section id="wechsel" title="Zählerwechsel" hint={`${model.changes.length}`} open={open === 'wechsel'} onToggle={toggle}>
        <ListEditor
          items={model.changes}
          table={db.meterChanges}
          fields={[
            { key: 'meter', label: 'Zähler', type: 'select', options: METERS.map((m) => ({ value: m.key, label: m.label })) },
            { key: 'date', label: 'Datum des Wechsels', type: 'date' },
            { key: 'endOld', label: 'Endstand alt', type: 'num', unit: 'kWh' },
            { key: 'startNew', label: 'Startstand neu', type: 'num', unit: 'kWh' },
          ]}
          addLabel="Zählerwechsel"
          empty="Kein Zählerwechsel erfasst."
          defaults={() => ({ meter: 'bezug', date: todayIso(), startNew: 0 }) as never}
          summary={(c) => (
            <>
              <b>{METERS.find((m) => m.key === c.meter)?.label}</b>
              <small className="num">
                {fmtDay(toDay(c.date))} · alt {stand(c.endOld)} → neu {stand(c.startNew)} kWh
              </small>
            </>
          )}
        />
        <p className="fineprint">Ablesungen ab dem Wechseldatum gelten als Stände des neuen Zählers. Die Rechnung läuft nahtlos weiter.</p>
      </Section>

      <Section id="opt" title="Optionen" open={open === 'opt'} onToggle={toggle}>
        <Toggle label="Uhrzeit erfassen" checked={s.showTime} onChange={(v) => set({ showTime: v })} />
        <Toggle label="Kilometerstand Auto" hint="Zusätzliches Feld bei der Ablesung; ergibt kWh pro 100 km." checked={s.showKm} onChange={(v) => set({ showKm: v })} />
        <Toggle label="Vorjahresvergleich" checked={s.yoy} onChange={(v) => set({ yoy: v })} />
        <div className="inline">
          <span>Darstellung</span>
          <Seg
            small
            label="Darstellung"
            value={s.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: 'dark', label: 'Dunkel' },
              { value: 'light', label: 'Hell' },
              { value: 'system', label: 'System' },
            ]}
          />
        </div>
      </Section>

      <Section id="backup" title="Backup und Daten" hint={s.lastBackup ? `zuletzt ${fmtDay(toDay(s.lastBackup.slice(0, 10)))}` : 'noch nie'} open={open === 'backup'} onToggle={toggle}>
        <p className="muted">Deine Daten liegen nur in diesem Browser. Ein JSON-Backup enthält alles; CSV enthält die Ablesungen.</p>
        <div className="btn-row">
          <button type="button" className="btn" disabled={!hasData} onClick={() => void exportJson(model)}>
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
              else {
                pending.current = { name: f.name, text }
                setConfirm('import')
              }
            }}
          />
        </div>
        {msg && (
          <p className="note" role="status">
            {msg}
          </p>
        )}
        <p className="fineprint">JSON-Import ersetzt alle Daten. CSV-Import ergänzt Ablesungen und überschreibt gleiche Tage.</p>

        <h3 className="sub">Demo-Daten</h3>
        <p className="muted">Rund zwei Jahre realistische Beispielwerte zum Ausprobieren.</p>
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => (hasData && !s.demo ? setConfirm('demo') : void loadDemo())}>
            Demo-Daten laden
          </button>
          {s.demo && (
            <button type="button" className="btn" onClick={() => setConfirm('demoDel')}>
              Demo-Daten löschen
            </button>
          )}
        </div>

        <h3 className="sub">Zurücksetzen</h3>
        <button type="button" className="btn danger-text" onClick={() => setConfirm('reset')}>
          Alle Daten löschen
        </button>
      </Section>

      <p className="fineprint center">WATTZEN · alle Daten bleiben auf diesem Gerät</p>

      {confirm === 'reset' && (
        <Confirm
          title="Alle Daten löschen?"
          text="Ablesungen, Tarife, Abschläge und Zählerwechsel werden gelöscht. Vorher am besten ein Backup exportieren."
          doppelt="Das lässt sich nicht rückgängig machen. Ohne Backup sind die Daten weg."
          confirm="Löschen"
          onConfirm={() => void clearData(true)}
          onClose={() => setConfirm(undefined)}
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
          title="Demo-Daten löschen?"
          text="Alle Demo-Werte werden entfernt. Danach kannst du mit deinen eigenen Zählerständen starten."
          confirm="Löschen"
          onConfirm={() => void clearData(false)}
          onClose={() => setConfirm(undefined)}
        />
      )}
      {confirm === 'import' && (
        <Confirm
          title="Backup einspielen?"
          text="Das JSON-Backup ersetzt alle vorhandenen Daten in dieser App."
          confirm="Ersetzen"
          onConfirm={() => pending.current && void runImport(pending.current.name, pending.current.text)}
          onClose={() => setConfirm(undefined)}
        />
      )}
    </section>
  )
}
