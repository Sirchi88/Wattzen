import { useState, type ReactNode } from 'react'
import { uid } from '../../db'
import { Confirm, Field, NumInput } from '../../ui/bits'

export interface FieldDef {
  key: string
  label: string
  type: 'date' | 'num' | 'text' | 'select'
  unit?: string
  optional?: boolean
  help?: string
  options?: { value: string; label: string }[]
}
type Row = { id: string } & Record<string, unknown>

/**
 * Liste mit Einträgen, die sich anlegen, ändern und löschen lassen.
 * `save` und `remove` schreiben in die Datenbank oder in ein übergeordnetes Objekt.
 */
export function ListEditor<T extends { id: string }>({
  items, fields, summary, addLabel, defaults, empty, save, remove, after,
}: {
  items: T[]
  fields: FieldDef[]
  summary: (item: T) => ReactNode
  addLabel: string
  defaults: () => Partial<T>
  empty: string
  save: (item: T) => void | Promise<unknown>
  remove: (item: T) => void | Promise<unknown>
  after?: (item: T) => ReactNode
}) {
  const [draft, setDraft] = useState<Row>()
  const [isNew, setIsNew] = useState(false)
  const [del, setDel] = useState<T>()
  const [err, setErr] = useState('')
  const set = (k: string, v: unknown) => setDraft((d) => (d ? { ...d, [k]: v } : d))

  async function commit() {
    if (!draft) return
    for (const f of fields) {
      const v = draft[f.key]
      if (!f.optional && (v === undefined || v === '')) return setErr(`„${f.label}" fehlt.`)
    }
    if (draft.from && draft.to && (draft.to as string) < (draft.from as string)) return setErr('„bis" liegt vor „von".')
    const clean: Row = { ...draft }
    for (const f of fields) if (clean[f.key] === '' || clean[f.key] === undefined) delete clean[f.key]
    await save(clean as unknown as T)
    setDraft(undefined)
  }

  const form = draft && (
    <div className="edit">
      <div className="edit-grid">
        {fields.map((f) => (
          <Field key={f.key} label={`${f.label}${f.optional ? ' (optional)' : ''}`} help={f.help} wide={f.type === 'text'}>
            {f.type === 'num' ? (
              <NumInput value={draft[f.key] as number | undefined} onChange={(v) => set(f.key, v)} unit={f.unit} enterKeyHint="done" />
            ) : f.type === 'select' ? (
              <select value={(draft[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value || undefined)}>
                {f.options!.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <input type={f.type} value={(draft[f.key] as string) ?? ''} onChange={(e) => set(f.key, e.target.value)} />
            )}
          </Field>
        ))}
      </div>
      {err && <p className="note warn">{err}</p>}
      <div className="row-actions">
        <button type="button" className="btn primary" onClick={() => void commit()}>
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
              {after?.(it)}
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
          className="btn add"
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
        <Confirm
          title="Eintrag löschen?"
          text="Der Eintrag wird entfernt. Die Auswertung rechnet sofort ohne ihn."
          confirm="Löschen"
          onConfirm={() => void remove(del)}
          onClose={() => setDel(undefined)}
        />
      )}
    </div>
  )
}
