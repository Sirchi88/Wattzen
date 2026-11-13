import { ChartColumn, History as HistoryIcon, LayoutGrid, PenLine, Wrench } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { computeDaily } from './calc/engine'
import { ablesungFaellig } from './calc/finance'
import { applyTheme, useModel } from './db'
import { toDay, todayIso } from './lib/dates'
import { setDisplay } from './lib/format'
import { Admin } from './screens/Admin'
import { Dashboard } from './screens/Dashboard'
import { Entry } from './screens/Entry'
import { History } from './screens/History'
import { Onboarding } from './screens/Onboarding'
import { Overview } from './screens/Overview'
import type { View } from './types'
import { haptic, setHaptics, ToastHost, Wordmark } from './ui/bits'
import { Splash } from './ui/Splash'
import { useWeather } from './weather'

const NAV: { view: View; label: string; title: string; Icon: typeof LayoutGrid }[] = [
  { view: 'overview', label: 'Übersicht', title: 'Übersicht', Icon: LayoutGrid },
  { view: 'dash', label: 'Auswertung', title: 'Auswertung', Icon: ChartColumn },
  { view: 'entry', label: 'Erfassen', title: 'Erfassen', Icon: PenLine },
  { view: 'history', label: 'Verlauf', title: 'Verlauf', Icon: HistoryIcon },
  { view: 'admin', label: 'Meister', title: 'Elektromeister', Icon: Wrench },
]

let splashShown = false

export function App() {
  const model = useModel()
  const [view, setView] = useState<View>()
  const [editId, setEditId] = useState<string>()
  const [splash, setSplash] = useState(!splashShown)
  const daily = useMemo(() => (model ? computeDaily(model) : undefined), [model])
  const weather = useWeather(model?.settings.house, daily && daily.days.length ? daily.start : undefined)

  const s = model?.settings
  useEffect(() => {
    if (!s) return
    setDisplay({ kwhDecimals: s.kwhDecimals, mwh: s.mwh })
    setHaptics(s.haptics)
  }, [s])

  const theme = s?.theme
  useEffect(() => {
    if (!theme) return
    applyTheme(theme)
    if (theme !== 'system') return
    const mq = matchMedia('(prefers-color-scheme: light)')
    const on = () => applyTheme('system')
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [theme])

  const endSplash = useCallback(() => {
    splashShown = true
    setSplash(false)
  }, [])

  if (!model || !daily || !s) return <div className="boot" aria-busy="true" />
  if (splash && s.splash) return <Splash seconds={s.splashDauer} onDone={endSplash} />
  if (!model.settings.onboarded) return <Onboarding model={model} series={daily.series} />

  const start: View = model.readings.length >= 2 ? s.startView : 'entry'
  const cur: View = view ?? start
  const go = (v: View) => {
    haptic()
    setEditId(undefined)
    setView(v)
    window.scrollTo({ top: 0 })
  }
  const today = toDay(todayIso())
  const due = s.dueDot && ablesungFaellig(model, today)
  const title = editId ? 'Ablesung bearbeiten' : NAV.find((n) => n.view === cur)!.title

  return (
    <ToastHost>
      <div className="app">
        <header className="bar">
          <h1 className="bar-title">{title}</h1>
          <button type="button" className="brand" onClick={() => go('overview')} aria-label="WATTZEN – zur Übersicht">
            <Wordmark />
          </button>
        </header>

        <main key={cur + (editId ?? '')} className="main">
          {cur === 'overview' && <Overview model={model} daily={daily} weather={weather} go={go} />}
          {cur === 'dash' && <Dashboard model={model} daily={daily} weather={weather} goEntry={() => go('entry')} />}
          {cur === 'entry' && (
            <Entry model={model} series={daily.series} editId={editId} onDone={() => go('history')} />
          )}
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
          {cur === 'admin' && <Admin model={model} daily={daily} weather={weather} />}
        </main>

        <nav className="tabbar" aria-label="Hauptnavigation">
          {NAV.map(({ view: v, label, Icon }) => (
            <button
              key={v}
              type="button"
              className={`tab${cur === v ? ' on' : ''}${v === 'entry' ? ' tab-main' : ''}`}
              aria-current={cur === v ? 'page' : undefined}
              onClick={() => go(v)}
            >
              <span className="tab-ic">
                <Icon size={v === 'entry' ? 24 : 21} strokeWidth={v === 'entry' ? 2 : 1.6} aria-hidden />
                {v === 'entry' && due && <i className="due" aria-label="Ablesung fällig" />}
              </span>
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </ToastHost>
  )
}
