import { useMemo, useState } from 'react'
import { checkField } from '../calc/advice'
import type { Series, SeriesKey } from '../calc/engine'
import { db, uid } from '../db'
import { fmtDay, fmtDayLong, fmtDayShort, toDay, todayIso, weekday } from '../lib/dates'
import { num, signed, stand } from '../lib/format'
import { METERS, type Model, type Reading } from '../types'
import { NumInput } from '../ui/bits'

type Vals = Partial<Record<SeriesKey, number | undefined>>

export function EntryForm({
  model, series, editId, onSaved, onCancel, saveLabel = 'Ablesung speichern',
}: {
  model: Model
  series: Series
  editId?: string
  onSaved: (r: Reading) => void
  onCancel?: () => void
  saveLabel?: string
}) {
  const editing = editId ? model.readings.find((r) => r.id === editId) : undefined
  const [date, setDate] = useState(editing?.date ?? todayIso())
  const [time, setTime] = useState(editing?.time ?? new Date().toTimeString().slice(0, 5))
  const [vals, setVals] = useState<Vals>(() => (editing ? { ...editing.values, km: editing.km } : {}))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)

  const sameDay = model.readings.find((r) => r.date === date && r.id !== editId)
  const ignoreId = editId ?? sameDay?.id
  const fields = useMemo(
    () => [
      ...METERS.map((m) => ({ ...m, unit: 'kWh' })),
      ...(model.settings.showKm
        ? [{ key: 'km' as SeriesKey, label: 'Kilometerstand', source: 'Auto', unit: 'km', required: false }]
        : []),
    ],
    [model.settings.showKm],
  )
  const day = toDay(date)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(day)
  const missing = vals.bezug === undefined || vals.einsp === undefined

  async function save() {
    setTried(true)
    if (missing || !valid || busy) return
    setBusy(true)
    const values: Reading['values'] = {}
    for (const m of METERS) {
      const v = vals[m.key]
      if (v !== undefined) values[m.key] = v
    }
    const r: Reading = {
      id: ignoreId ?? uid(),
      date,
      time: model.settings.showTime ? time : editing?.time,
      values,
      km: model.settings.showKm ? vals.km : editing?.km,
    }
    await db.readings.put(r)
    setBusy(false)
    onSaved(r)
  }

  return (
    <form
      className="entry"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label className="date-hero">
        <span className="eyebrow">{valid ? weekday(day) : 'Datum'}</span>
        <span className="date-big num">{valid ? fmtDayLong(day) : '–'}</span>
        <span className="date-hint">{date === todayIso() ? 'heute · tippen zum Ändern' : 'tippen zum Ändern'}</span>
        <input
          type="date"
          value={date}
          max="2100-12-31"
          aria-label="Datum der Ablesung"
          onChange={(e) => e.target.value && setDate(e.target.value)}
          onClick={(e) => {
            try {
              e.currentTarget.showPicker?.()
            } catch {
              /* nicht unterstützt */
            }
          }}
        />
      </label>

      {model.settings.showTime && (
        <label className="time-row">
          <span>Uhrzeit</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}

      {sameDay && (
        <p className="note">Für den {fmtDay(day)} gibt es schon eine Ablesung. Speichern überschreibt sie.</p>
      )}

      <div className="fields">
        {fields.map((f) => {
          const c = valid ? checkField(series[f.key], model.readings, model, f.key, date, vals[f.key], ignoreId) : {}
          const d = f.key === 'km' ? 0 : 1
          const err = tried && f.required && vals[f.key] === undefined
          return (
            <div className={`field${c.warn ? ' warn' : ''}${err ? ' err' : ''}`} key={f.key}>
              <label htmlFor={`f-${f.key}`}>
                <span>
                  {f.label}
                  {f.required && <b aria-label="Pflichtfeld"> *</b>}
                </span>
                <small>{f.source}</small>
              </label>
              <NumInput
                id={`f-${f.key}`}
                value={vals[f.key]}
                onChange={(v) => setVals((old) => ({ ...old, [f.key]: v }))}
                placeholder={c.prevRaw !== undefined ? stand(c.prevRaw) : '0'}
                unit={f.unit}
              />
              <p className="field-sub num" aria-live="polite">
                {err
                  ? 'Pflichtfeld'
                  : c.warn
                    ? `${c.delta !== undefined ? `${signed(num(c.delta, d))} ${f.unit} · ` : ''}${c.warn}`
                    : c.delta !== undefined && c.prevDay !== undefined
                      ? `${signed(num(c.delta, d))} ${f.unit} seit ${fmtDayShort(c.prevDay)}`
                      : c.prevDay !== undefined
                        ? `zuletzt am ${fmtDayShort(c.prevDay)}`
                        : ' '}
              </p>
            </div>
          )
        })}
      </div>

      <div className="entry-actions">
        <button type="submit" className="btn primary big" disabled={busy}>
          {editing ? 'Änderung speichern' : saveLabel}
        </button>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
      <p className="fineprint">* Pflichtfelder. Alles andere ist optional – die Auswertung rechnet mit dem, was da ist.</p>
    </form>
  )
}

export function Entry({
  model, series, editId, onDone, goDash,
}: {
  model: Model
  series: Series
  editId?: string
  onDone: () => void
  goDash: () => void
}) {
  const [saved, setSaved] = useState<Reading>()
  const [n, setN] = useState(0)
  return (
    <section className="screen narrow">
      {editId && <p className="eyebrow acc">Ablesung bearbeiten</p>}
      {saved && !editId && (
        <p className="saved" role="status">
          <span>Gespeichert · {fmtDay(toDay(saved.date))}</span>
          <button type="button" className="link" onClick={goDash}>
            Auswertung ansehen
          </button>
        </p>
      )}
      <EntryForm
        key={`${editId ?? 'new'}-${n}`}
        model={model}
        series={series}
        editId={editId}
        onCancel={editId ? onDone : undefined}
        onSaved={(r) => {
          if (editId) onDone()
          else {
            setSaved(r)
            setN((x) => x + 1)
            window.scrollTo({ top: 0 })
          }
        }}
      />
    </section>
  )
}
