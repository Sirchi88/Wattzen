import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'

registerSW({ immediate: true })

// Bittet den Browser, die lokalen Daten nicht bei Speicherknappheit zu verwerfen.
void navigator.storage?.persist?.()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
