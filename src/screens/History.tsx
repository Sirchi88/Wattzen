import { Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { meterName } from '../calc/meters'
import { db } from '../db'
import { fmtDay, toDay, weekday } from '../lib/dates'
import { stand } from '../lib/format'
import type { Model, Reading } from '../types'
import { Days, haptic, useToast } from '../ui/bits'
import { useSwipe } from '../ui/hooks'

function Row({
  r, prev, model, open, setOpen, swiped, setSwiped, onEdit,
}: {
  r: Reading
  prev?: Reading
  model: Model
  open: boolean
  setOpen: (v: boolean) => void
  swiped: boolean
  setSwiped: (v: boolean) => void
  onEdit: () => void
}) {
  const toast = useToast()
  const [ask, setAsk] = useState<string>()
  const { dx, drag, handlers } = useSwipe(swiped, setSwiped)
  const day = toDay(r.date)
  const metersById = new Map(model.meters.map((m) => [m.id, m]))
  const entries = Object.entries(r.values).filter(([, v]) => v !== undefined) as [string, number][]
  const order = (id: string) => model.meters.findIndex((m) => m.id === id)
  entries.sort((a, b) => order(a[0]) - order(b[0]))

  async function deleteAll() {
    await db.readings.delete(r.id)
    haptic(14)
    toast(`Ablesung vom ${fmtDay(day)} gelöscht`, () => void db.readings.put(r))
  }
  async function deleteValue(id: string) {
    const values = { ...r.values }
    delete values[id]
    if (id === 'bezug' || id === 'einsp') return
    await db.readings.put({ ...r, values })
    setAsk(undefined)
    haptic()
    toast(`${meterName(metersById.get(id) ?? { id, name: id, builtin: true })} gelöscht`, () => void db.readings.put(r))
  }

  return (
    <li className={`hist-item${open ? ' open' : ''}`}>
      <div className="swipe">
        <button type="button" className="swipe-action" tabIndex={swiped ? 0 : -1} aria-hidden={!swiped} onClick={() => setAsk('*')}>
          <Trash2 size={18} aria-hidden />
          <span>Löschen</span>
        </button>
        <div
          className={`swipe-front${drag ? ' drag' : ''}`}
          style={{ transform: `translateX(${dx}px)` }}
          {...handlers}
        >
          <button
            type="button"
            className="hist-row"
            aria-expanded={open}
            onClick={() => (swiped ? setSwiped(false) : setOpen(!open))}
          >
            <span className="hist-date">
              <b className="num">{fmtDay(day)}</b>
              <small>
                {weekday(day).slice(0, 2)}
                {r.time && model.settings.showTime ? ` · ${r.time}` : ''}
                {prev ? (
                  <>
                    {' · nach '}
                    <Days n={day - toDay(prev.date)} dativ />
                  </>
                ) : (
                  ' · erste Ablesung'
                )}
              </small>
            </span>
            <span className="hist-vals num">
              <span>
                <small>Bezug</small>
                {r.values.bezug !== undefined ? stand(r.values.bezug) : '–'}
              </span>
              <span>
                <small>Einspeisung</small>
                {r.values.einsp !== undefined ? stand(r.values.einsp) : '–'}
              </span>
            </span>
          </button>
        </div>
      </div>

      {ask === '*' && (
        <div className="inline-confirm" role="alertdialog" aria-label="Ablesung löschen">
          <span>Ganze Ablesung vom {fmtDay(day)} löschen?</span>
          <button type="button" className="btn ghost" onClick={() => (setAsk(undefined), setSwiped(false))}>
            Nein
          </button>
          <button type="button" className="btn danger" onClick={() => void deleteAll()}>
            Löschen
          </button>
        </div>
      )}

      {open && (
        <div className="hist-detail">
          <ul className="vals">
            {entries.map(([id, v]) => {
              const m = metersById.get(id)
              const req = id === 'bezug' || id === 'einsp'
              return (
                <li key={id}>
                  <span className="vals-name">{m ? meterName(m) : id}</span>
                  <span className="num">
                    {stand(v)} {m?.unit ?? ''}
                  </span>
                  {ask === id ? (
                    <span className="vals-ask">
                      <button type="button" className="link" onClick={() => setAsk(undefined)}>
                        Nein
                      </button>
                      <button type="button" className="link strong" onClick={() => void deleteValue(id)}>
                        Löschen
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="icon-btn"
                      disabled={req}
                      title={req ? 'Pflichtwert – nur mit der ganzen Ablesung löschbar' : 'Wert löschen'}
                      aria-label={`${m ? meterName(m) : id} löschen`}
                      onClick={() => setAsk(id)}
                    >
                      <X size={16} aria-hidden />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="row-actions">
            <button type="button" className="btn" onClick={onEdit}>
              Bearbeiten
            </button>
            <button type="button" className="btn ghost danger-text" onClick={() => setAsk('*')}>
              Ganze Ablesung löschen
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

export function History({ model, onEdit, goEntry }: { model: Model; onEdit: (id: string) => void; goEntry: () => void }) {
  const [open, setOpen] = useState<string>()
  const [swiped, setSwiped] = useState<string>()
  const list = [...model.readings].sort((a, b) => (a.date < b.date ? 1 : -1))

  if (!list.length) {
    return (
      <section className="screen narrow empty">
        <div className="empty-mark" aria-hidden />
        <h2>Hier sammeln sich deine Ablesungen.</h2>
        <p>Jede Zeile lässt sich später bearbeiten oder löschen.</p>
        <button type="button" className="btn primary" onClick={goEntry}>
          Ablesung erfassen
        </button>
      </section>
    )
  }

  return (
    <section className="screen narrow">
      <p className="lead">
        <span className="num">{list.length}</span> Ablesungen · nach links wischen zum Löschen, antippen für Details
      </p>
      <ul className="card hist">
        {list.map((r, i) => (
          <Row
            key={r.id}
            r={r}
            prev={list[i + 1]}
            model={model}
            open={open === r.id}
            setOpen={(v) => setOpen(v ? r.id : undefined)}
            swiped={swiped === r.id}
            setSwiped={(v) => setSwiped(v ? r.id : undefined)}
            onEdit={() => onEdit(r.id)}
          />
        ))}
      </ul>
    </section>
  )
}
