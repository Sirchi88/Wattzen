import {
  ArrowUpFromLine, BatteryMedium, Box, Car, Cpu, Droplet, Flame, Fuel, Gauge, Hash, House, PlugZap, Sprout, Sun,
  Thermometer, Wind, Zap, type LucideIcon,
} from 'lucide-react'
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { num, parseNum, stand } from '../lib/format'
import type { ColorKey, IconKey } from '../types'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

/* ───────────── Haptik ───────────── */

let hapticsOn = true
export const setHaptics = (on: boolean) => {
  hapticsOn = on
}
export const haptic = (ms = 8) => {
  if (hapticsOn) navigator.vibrate?.(ms)
}

/* ───────────── Icons ───────────── */

export const ICONS: Record<IconKey, LucideIcon> = {
  gauge: Gauge, cpu: Cpu, sun: Sun, zap: Zap, export: ArrowUpFromLine, house: House, battery: BatteryMedium,
  thermo: Thermometer, flame: Flame, plug: PlugZap, car: Car, droplet: Droplet, sprout: Sprout, fuel: Fuel,
  wind: Wind, box: Box, hash: Hash,
}

export function Icon({ name, size = 18 }: { name: IconKey; size?: number }) {
  const C = ICONS[name] ?? Hash
  return <C size={size} strokeWidth={1.6} aria-hidden />
}

/** Icon in einem weichen, leicht eingefärbten Kreis. */
export function IconChip({ name, color, size = 34 }: { name: IconKey; color: ColorKey; size?: number }) {
  return (
    <span className={`chip c-${color}`} style={{ width: size, height: size }} aria-hidden>
      <Icon name={name} size={Math.round(size * 0.5)} />
    </span>
  )
}

/* ───────────── Zahlen ───────────── */

/** Zahl, die beim Erscheinen und bei Änderungen kurz hochzählt (280 ms). */
export function Num({ v, digits = 0, sign = false }: { v: number | undefined; digits?: number; sign?: boolean }) {
  const [shown, setShown] = useState(v ?? 0)
  const from = useRef(0)
  useEffect(() => {
    if (v === undefined) return
    if (reduced()) {
      from.current = v
      setShown(v)
      return
    }
    const start = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 280)
      const e = 1 - Math.pow(1 - p, 3)
      const cur = start + (v - start) * e
      from.current = cur
      setShown(cur)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [v])
  if (v === undefined) return <span className="num dim">–</span>
  const s = num(shown, digits)
  return <span className="num">{sign && shown > 0 ? `+${s}` : s}</span>
}

/** Anzahl Tage seit einem Vergleichspunkt – fett und in der Akzentfarbe. */
export function Days({ n, prefix = '', dativ }: { n: number; prefix?: string; dativ?: boolean }) {
  return (
    <b className="days num">
      {prefix}
      {n} {n === 1 ? 'Tag' : dativ ? 'Tagen' : 'Tage'}
    </b>
  )
}

/** Ring-Anzeige 0…1 in der Kategoriefarbe; zeichnet sich beim Laden ein. */
export function Ring({
  value, color = 'acc', size = 76, label, sub, center,
}: {
  value: number | undefined
  color?: ColorKey | 'acc'
  size?: number
  label: string
  sub?: ReactNode
  center?: ReactNode
}) {
  const r = 15.5
  const c = 2 * Math.PI * r
  const v = value === undefined ? 0 : Math.max(0, Math.min(1, value))
  return (
    <figure className={`ring c-${color}`} style={{ width: size }}>
      <div className="ring-box" style={{ width: size, height: size }}>
        <svg viewBox="0 0 36 36" width={size} height={size} role="img" aria-label={`${label}: ${value === undefined ? 'keine Daten' : `${Math.round(v * 100)} %`}`}>
          <circle cx="18" cy="18" r={r} className="ring-bg" />
          {value !== undefined && (
            <circle
              cx="18" cy="18" r={r} className="ring-fg"
              strokeDasharray={`${c * v} ${c}`}
              style={{ ['--c' as string]: `${c}` }}
              transform="rotate(-90 18 18)"
            />
          )}
        </svg>
        <span className="ring-val num">{center ?? (value === undefined ? '–' : `${Math.round(v * 100)}`)}{center === undefined && value !== undefined && <small>%</small>}</span>
      </div>
      <figcaption>
        {label}
        {sub && <small>{sub}</small>}
      </figcaption>
    </figure>
  )
}

/** Markierung, ob ein Wert gemessen oder geschätzt ist. */
export function Badge({ kind }: { kind: 'gemessen' | 'geschätzt' | 'berechnet' | 'Prognose' }) {
  return <span className={`badge b-${kind === 'gemessen' ? 'mess' : 'est'}`}>{kind}</span>
}

/* ───────────── Bedienelemente ───────────── */

export function Seg<T extends string>({
  value, options, onChange, label, small,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  small?: boolean
}) {
  return (
    <div className={`seg${small ? ' seg-s' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          type="button"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Kleiner Info-Knopf, der einen kurzen Erklärtext ein- und ausblendet. */
export function Info({ children, label = 'Erklärung' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <>
      <button type="button" className="info-btn" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen(!open)}>
        i
      </button>
      {open && (
        <p id={id} className="info-text">
          {children}
        </p>
      )}
    </>
  )
}

/** Aufklappbarer Abschnitt in einer Karte. */
export function Fold({ title, aside, children, open: initial = false, icon }: { title: string; aside?: ReactNode; children: ReactNode; open?: boolean; icon?: ReactNode }) {
  const [open, setOpen] = useState(initial)
  const id = useId()
  return (
    <section className={`card fold${open ? ' open' : ''}`}>
      <button type="button" className="fold-head" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
        {icon}
        <span className="fold-title">{title}</span>
        {aside && <span className="fold-aside num">{aside}</span>}
        <i aria-hidden className="fold-chev" />
      </button>
      {open && (
        <div id={id} className="fold-body">
          {children}
        </div>
      )}
    </section>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i aria-hidden />
    </label>
  )
}

/** Zahlenfeld mit deutscher Eingabe. Meldet `undefined` bei leerem oder ungültigem Inhalt. */
export function NumInput({
  value, onChange, placeholder, unit, id, autoFocus, ariaLabel, enterKeyHint = 'next', onEnter, describedBy,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  unit?: string
  id?: string
  autoFocus?: boolean
  ariaLabel?: string
  enterKeyHint?: 'next' | 'done'
  onEnter?: () => void
  describedBy?: string
}) {
  const [text, setText] = useState(value === undefined ? '' : stand(value).replace('−', '-'))
  const last = useRef(value)
  useEffect(() => {
    if (value !== last.current) {
      last.current = value
      setText(value === undefined ? '' : stand(value).replace('−', '-'))
    }
  }, [value])
  return (
    <span className="numinput">
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint={enterKeyHint}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        placeholder={placeholder}
        value={text}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onEnter) {
            e.preventDefault()
            onEnter()
          }
        }}
        onChange={(e) => {
          setText(e.target.value)
          const v = parseNum(e.target.value)
          last.current = v
          onChange(v)
        }}
      />
      {unit && <em>{unit}</em>}
    </span>
  )
}

/** Formularfeld: Label oben, Hilfetext darunter. */
export function Field({ label, help, children, wide }: { label: string; help?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`fld${wide ? ' wide' : ''}`}>
      <span className="fld-label">{label}</span>
      {children}
      {help && <span className="fld-help">{help}</span>}
    </label>
  )
}

export function Dialog({
  title, children, onClose, actions,
}: {
  title: string
  children?: ReactNode
  onClose: () => void
  actions: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (d && !d.open) d.showModal()
  }, [])
  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}>
      <div className="dialog-in">
        <h2>{title}</h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">{actions}</div>
      </div>
    </dialog>
  )
}

/** Bestätigungsdialog. */
export function Confirm({
  title, text, confirm, onConfirm, onClose,
}: {
  title: string
  text: ReactNode
  confirm: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      actions={
        <>
          <button type="button" className="btn ghost" onClick={onClose}>
            Abbrechen
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirm}
          </button>
        </>
      }
    >
      {text}
    </Dialog>
  )
}

/* ───────────── Toast mit Rückgängig ───────────── */

interface ToastMsg {
  id: number
  text: string
  undo?: () => void
}
const ToastCtx = createContext<(text: string, undo?: () => void) => void>(() => undefined)
export const useToast = () => useContext(ToastCtx)

export function ToastHost({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg>()
  const timer = useRef<number>(undefined)
  const show = useCallback((text: string, undo?: () => void) => {
    window.clearTimeout(timer.current)
    const id = Date.now()
    setMsg({ id, text, undo })
    timer.current = window.setTimeout(() => setMsg((m) => (m?.id === id ? undefined : m)), 5000)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toast-zone" aria-live="polite">
        {msg && (
          <div className="toast" key={msg.id}>
            <span>{msg.text}</span>
            {msg.undo && (
              <button
                type="button"
                onClick={() => {
                  msg.undo!()
                  setMsg(undefined)
                }}
              >
                Rückgängig
              </button>
            )}
            <i className="toast-bar" aria-hidden />
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  )
}

/* ───────────── Marke ───────────── */

export function Wordmark({ big }: { big?: boolean }) {
  return (
    <span className={`wordmark${big ? ' big' : ''}`} aria-label="WATTZEN">
      WATTZEN
    </span>
  )
}

/** Blitz, dessen untere Spitze eine Füllerfeder ist: Aufschreiben und Auswerten. */
export function PenBolt({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 220" fill="none" aria-hidden>
      {/* Blitz-Körper */}
      <path
        d="M76 6 L30 112 L58 112 L48 150"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"
      />
      <path
        d="M88 6 L64 86 L94 86 L68 150"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round"
      />
      <path d="M76 6 H88" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Federschulter */}
      <path d="M48 150 C 52 146, 64 146, 68 150" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Feder: läuft zur Spitze zusammen */}
      <path
        d="M48 150 C 46 168, 50 186, 56 212 C 62 186, 70 168, 68 150"
        stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"
      />
      {/* Atemloch und Schlitz */}
      <circle cx="58" cy="170" r="2.6" stroke="currentColor" strokeWidth="1.1" />
      <path d="M58 173 L56.6 210" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  )
}
