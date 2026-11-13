import { useMemo } from 'react'
import type { Daily } from '../calc/engine'
import { amortisation } from '../calc/finance'
import { fitPr, GERMANY, pvCheck, smartForecast } from '../calc/smart'
import { toDay, todayIso } from '../lib/dates'
import type { Model } from '../types'
import type { WeatherState } from '../weather'

/** Prognose, PV-Check und Amortisation – einmal berechnet, von Übersicht und Auswertung genutzt. */
export function useAnalysis(model: Model, daily: Daily, weather: WeatherState | undefined) {
  const wx = weather?.wx
  const clim = weather?.clim ?? GERMANY
  return useMemo(() => {
    const w = wx ?? new Map()
    const today = toDay(todayIso())
    const fc = daily.days.length ? smartForecast(daily, model, { wx: w, clim, today }) : undefined
    const pr = fitPr(daily, w, clim, model.settings.house.kwp)
    const check = daily.days.length ? pvCheck(daily, w, model.settings.house.kwp, pr) : undefined
    const amort = amortisation(daily, model)
    return { fc, check, amort, wx: w, clim, today }
  }, [daily, model, wx, clim])
}
