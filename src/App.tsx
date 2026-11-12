import { useEffect, useMemo, useState } from 'react'
import { computeDaily } from './calc/engine'
import { applyTheme, exportJson, useModel } from './db'
import { toDay, todayIso } from './lib/dates'
import { Admin } from './screens/Admin'
import { Dashboard } from './screens/Dashboard'
import { Entry } from './screens/Entry'
import { History } from './screens/History'
import { Onboarding } from './screens/Onboarding'
import { Wordmark } from './ui/bits'

type View = 'entry' | 'dash' | 'history' | 'admin'
const NAV: { view: View; label: string }[] = [
  { view: 'entry', label: 'Erfassen' },
  { view: 'dash', label: 'Auswertung' },
  { view: 'history', label: 'Verlauf' },
]

export function App() {
  const model = useModel()
  const [view, setView] = useState<View>()
  const [editId, setEditId] = useState<string>()
  const [hideBackup, setHideBackup] = useState(false)
  const daily = useMemo(() => (model ? computeDaily(model) : undefined), [model])

  const theme = model?.settings.theme
  useEffect(() => {
    if (!theme) return
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: light)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  if (!model || !daily) return <div className="boot" aria-busy="true" />
  if (!model.settings.onboarded) return <Onboarding model={model} series={daily.series} />

  const cur: View = view ?? (model.readings.length >= 2 ? 'dash' : 'entry')
  const go = (v: View) => {
    setEditId(undefined)
    setView(v)
    window.scrollTo({ top: 0 })
  }

  // Dezente Backup-Erinnerung: letztes Backup (oder erste Ablesung) älter als 30 Tage
  const today = toDay(todayIso())
  const since = model.settings.lastBackup
    ? today - toDay(model.settings.lastBackup.slice(0, 10))
    : model.readings.length
      ? today - toDay(model.readings[0].date)
      : 0
  const backupDue = !hideBackup && !model.settings.demo && model.readings.length > 0 && since > 30

  return (
    <div className="app">
      <header className="bar">
        <button type="button" className="brand" onClick={() => go('dash')} aria-label="WATTZEN – zur Auswertung">
          <Wordmark />
        </button>
        <nav className="nav" aria-label="Hauptnavigation">
          {NAV.map((n) => (
            <button key={n.view} type="button" className={cur === n.view ? 'on' : ''} aria-current={cur === n.view ? 'page' : undefined} onClick={() => go(n.view)}>
              {n.label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className={`admin-btn${cur === 'admin' ? ' on' : ''}`}
          onClick={() => go(cur === 'admin' ? 'dash' : 'admin')}
          aria-label="Elektromeisterbereich"
          title="Elektromeisterbereich"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {backupDue && (
        <p className="backup" role="status">
          <span>{model.settings.lastBackup ? `Letztes Backup vor ${since} Tagen.` : 'Noch kein Backup – die Daten liegen nur auf diesem Gerät.'}</span>
          <button type="button" className="link" onClick={() => void exportJson(model)}>
            Jetzt sichern
          </button>
          <button type="button" className="link dim" onClick={() => setHideBackup(true)} aria-label="Hinweis ausblenden">
            Später
          </button>
        </p>
      )}

      <main key={cur}>
        {cur === 'entry' && (
          <Entry model={model} series={daily.series} editId={editId} onDone={() => go('history')} goDash={() => go('dash')} />
        )}
        {cur === 'dash' && <Dashboard model={model} daily={daily} goEntry={() => go('entry')} />}
        {cur === 'history' && (
          <History
            model={model}
            goEntry={() => go('entry')}
            onEdit={(id) => {
              setEditId(id)
              setView('entry')
              window.scrollTo({ top: 0 })
            }}
          />
        )}
        {cur === 'admin' && <Admin model={model} daily={daily} />}
      </main>
    </div>
  )
}
