import { useState } from 'react'
import { db } from '../db'
import { fmtDay, toDay, weekday } from '../lib/dates'
import { stand } from '../lib/format'
import { METERS, type Model, type Reading } from '../types'
import { Confirm } from '../ui/bits'

export function History({ model, onEdit, goEntry }: { model: Model; onEdit: (id: string) => void; goEntry: () => void }) {
  const [del, setDel] = useState<Reading>()
  const [open, setOpen] = useState<string>()
  const list = [...model.readings].sort((a, b) => (a.date < b.date ? 1 : -1))

  if (!list.length) {
    return (
      <section className="screen narrow empty">
        <div className="empty-mark" aria-hidden />
        <h1>Hier sammeln sich deine Ablesungen.</h1>
        <p>Jede Zeile lässt sich später bearbeiten oder löschen.</p>
        <button type="button" className="btn primary" onClick={goEntry}>
          Ablesung erfassen
        </button>
      </section>
    )
  }

  return (
    <section className="screen narrow">
      <div className="screen-head">
        <h1>Ablesungen</h1>
        <span className="num dim">{list.length}</span>
      </div>
      <ul className="hist">
        {list.map((r, i) => {
          const day = toDay(r.date)
          const next = list[i + 1]
          const isOpen = open === r.id
          return (
            <li key={r.id} className={isOpen ? 'open' : ''}>
              <button type="button" className="hist-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? undefined : r.id)}>
                <span className="hist-date">
                  <b className="num">{fmtDay(day)}</b>
                  <small>
                    {weekday(day).slice(0, 2)}
                    {r.time && model.settings.showTime ? ` · ${r.time}` : ''}
                    {next ? ` · nach ${day - toDay(next.date)} Tagen` : ' · erste Ablesung'}
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
              {isOpen && (
                <div className="hist-detail">
                  <dl className="hero-rows num cols">
                    {METERS.map((m) => (
                      <div key={m.key}>
                        <dt>{m.label}</dt>
                        <dd>{r.values[m.key] !== undefined ? `${stand(r.values[m.key]!)} kWh` : '–'}</dd>
                      </div>
                    ))}
                    {r.km !== undefined && (
                      <div>
                        <dt>Kilometerstand</dt>
                        <dd>{stand(r.km)} km</dd>
                      </div>
                    )}
                  </dl>
                  <div className="row-actions">
                    <button type="button" className="btn ghost" onClick={() => onEdit(r.id)}>
                      Bearbeiten
                    </button>
                    <button type="button" className="btn ghost danger-text" onClick={() => setDel(r)}>
                      Löschen
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {del && (
        <Confirm
          title="Ablesung löschen?"
          text={`Die Ablesung vom ${fmtDay(toDay(del.date))} wird entfernt. Die Auswertung überbrückt die Lücke dann mit den Nachbar-Ablesungen.`}
          confirm="Löschen"
          onConfirm={() => void db.readings.delete(del.id)}
          onClose={() => setDel(undefined)}
        />
      )}
    </section>
  )
}
