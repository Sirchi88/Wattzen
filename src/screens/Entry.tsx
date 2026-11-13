import { useMemo, useRef, useState } from 'react'
import { checkField } from '../calc/advice'
import type { Series } from '../calc/engine'
import { orderedGroups } from '../calc/meters'
import { db, uid } from '../db'
import { fmtDay, fmtDayLong, fmtDayShort, toDay, todayIso, weekday } from '../lib/dates'
import { num, signed, stand } from '../lib/format'
import type { Model, Reading } from '../types'
import { Days, haptic, IconChip, NumInput, useToast } from '../ui/bits'
import { useKeyboardInset } from '../ui/hooks'

type Vals = Record<string, number | undefined>

export function EntryForm({
  model, series, editId, onSaved, onCancel, saveLabel = 'Speichern', inline,
}: {
  model: Model
  series: Series
  editId?: string
  onSaved: (r: Reading) => void
  onCancel?: () => void
  saveLabel?: string
  /** im Onboarding: Speichern-Knopf im Fluss statt als feste Leiste */
  inline?: boolean
}) {
  useKeyboardInset()
  const editing = editId ? model.readings.find((r) => r.id === editId) : undefined
  const [date, setDate] = useState(editing?.date ?? todayIso())
  const [time, setTime] = useState(editing?.time ?? new Date().toTimeString().slice(0, 5))
  const [vals, setVals] = useState<Vals>(() => (editing ? { ...editing.values } : {}))
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  const sameDay = model.readings.find((r) => r.date === date && r.id !== editId)
  const ignoreId = editId ?? sameDay?.id
  const groups = useMemo(() => orderedGroups(model.meters, model.settings.groupOrder), [model.meters, model.settings.groupOrder])
  const fields = groups.flatMap((g) => g.meters)
  const filled = fields.filter((f) => vals[f.id] !== undefined).length
  const day = toDay(date)
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(day)
  const missing = vals.bezug === undefined || vals.einsp === undefined

  async function save() {
    setTried(true)
    if (missing || !valid || busy) {
      const first = formRef.current?.querySelector<HTMLInputElement>(vals.bezug === undefined ? '#f-bezug' : '#f-einsp')
      first?.focus()
      return
    }
    setBusy(true)
    const values: Reading['values'] = {}
    // Werte inaktiver Zähler beim Bearbeiten erhalten
    if (editing) for (const [k, v] of Object.entries(editing.values)) if (!fields.some((f) => f.id === k)) values[k] = v
    for (const f of fields) {
      const v = vals[f.id]
      if (v !== undefined) values[f.id] = v
    }
    const r: Reading = { id: ignoreId ?? uid(), date, time: model.settings.showTime ? time : editing?.time, values }
    await db.readings.put(r)
    haptic(14)
    setBusy(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
    onSaved(r)
  }

  const focusNext = (i: number) => {
    const next = fields[i + 1]
    if (next) document.getElementById(`f-${next.id}`)?.focus()
    else void save()
  }

  return (
    <form
      ref={formRef}
      className="entry"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <div className="entry-top">
        <label className="date-hero">
          <span className="eyebrow">{valid ? weekday(day) : 'Datum'}</span>
          <span className="date-big num">{valid ? fmtDayLong(day) : '–'}</span>
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
          <span className="date-hint">{date === todayIso() ? 'heute · antippen zum Ändern' : 'antippen zum Ändern'}</span>
        </label>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={fields.length} aria-valuenow={filled} aria-label="Erfasste Werte">
          <i style={{ width: `${(filled / Math.max(1, fields.length)) * 100}%` }} />
        </div>
        <p className="progress-label num">
          {filled} / {fields.length} erfasst
        </p>
      </div>

      {model.settings.showTime && (
        <label className="card time-row">
          <span>Uhrzeit</span>
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}

      {sameDay && <p className="note">Für den {fmtDay(day)} gibt es schon eine Ablesung. Speichern überschreibt sie.</p>}

      {groups.map((g) => (
        <section className="card group" key={g.key} aria-labelledby={`g-${g.key}`}>
          <h2 className="group-head" id={`g-${g.key}`}>
            <IconChip name={g.icon} color={g.color} size={30} />
            <span>{g.name}</span>
          </h2>
          {g.meters.map((f) => {
            const i = fields.indexOf(f)
            const c = valid ? checkField(series[f.id] ?? [], model.readings, model, f.id, date, vals[f.id], ignoreId) : {}
            const d = f.unit === 'kWh' ? 1 : f.decimals
            const err = tried && f.required && vals[f.id] === undefined
            const subId = `s-${f.id}`
            return (
              <div className={`row${c.warn ? ' warn' : ''}${err ? ' err' : ''}`} key={f.id}>
                <label className="row-label" htmlFor={`f-${f.id}`}>
                  {g.key === 'eigene' && <IconChip name={f.icon} color={f.color} size={24} />}
                  <span>
                    <span>
                      {f.name}
                      {f.required && <b aria-label="Pflichtfeld"> *</b>}
                    </span>
                    {f.hint && <small>{f.hint}</small>}
                  </span>
                </label>
                <NumInput
                  id={`f-${f.id}`}
                  value={vals[f.id]}
                  onChange={(v) => setVals((old) => ({ ...old, [f.id]: v }))}
                  placeholder={c.prevRaw !== undefined ? stand(c.prevRaw) : '0'}
                  unit={f.unit}
                  enterKeyHint={i === fields.length - 1 ? 'done' : 'next'}
                  onEnter={() => focusNext(i)}
                  describedBy={subId}
                />
                <p className="row-sub" id={subId} aria-live="polite">
                  {err ? (
                    'Pflichtfeld – bitte eintragen'
                  ) : c.delta !== undefined && c.prevDay !== undefined ? (
                    <>
                      <span className="num">
                        {signed(num(c.delta, d))} {f.unit}
                      </span>{' '}
                      seit {fmtDayShort(c.prevDay)} · <Days n={day - c.prevDay} />
                      {c.warn && <span className="row-warn">{c.warn}</span>}
                    </>
                  ) : c.prevDay !== undefined ? (
                    <>
                      zuletzt <span className="num">{stand(c.prevRaw!)}</span> am {fmtDayShort(c.prevDay)} · <Days n={day - c.prevDay} />
                    </>
                  ) : (
                    ' '
                  )}
                </p>
              </div>
            )
          })}
        </section>
      ))}

      <p className="fineprint">* Pflichtfelder. Leere Felder sind in Ordnung – die Auswertung rechnet mit dem, was da ist.</p>

      <div className={inline ? 'entry-actions' : 'savebar'}>
        {onCancel && (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        <button type="submit" className="btn primary big" disabled={busy}>
          {editing ? 'Änderung speichern' : saveLabel}
          <span className="num savebar-count">
            {filled}/{fields.length}
          </span>
        </button>
      </div>
    </form>
  )
}

export function Entry({
  model, series, editId, onDone,
}: {
  model: Model
  series: Series
  editId?: string
  onDone: () => void
}) {
  const [n, setN] = useState(0)
  const toast = useToast()
  return (
    <section className="screen narrow has-savebar">
      <EntryForm
        key={`${editId ?? 'new'}-${n}`}
        model={model}
        series={series}
        editId={editId}
        onCancel={editId ? onDone : undefined}
        onSaved={(r) => {
          if (editId) {
            toast('Änderung gespeichert')
            onDone()
          } else {
            toast(`Gespeichert · ${fmtDay(toDay(r.date))}`)
            setN((x) => x + 1)
            window.scrollTo({ top: 0 })
          }
        }}
      />
    </section>
  )
}
