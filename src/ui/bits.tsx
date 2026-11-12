import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { num, parseNum, stand } from '../lib/format'

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

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
    <div className={`seg${small ? ' seg-s' : ''}`} role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
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
  value, onChange, placeholder, unit, id, autoFocus, ariaLabel,
}: {
  value: number | undefined
  onChange: (v: number | undefined) => void
  placeholder?: string
  unit?: string
  id?: string
  autoFocus?: boolean
  ariaLabel?: string
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
        enterKeyHint="next"
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={text}
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

/** Bestätigungsdialog; mit `doppelt` muss ein zweites Mal bestätigt werden. */
export function Confirm({
  title, text, confirm, onConfirm, onClose, doppelt,
}: {
  title: string
  text: ReactNode
  confirm: string
  onConfirm: () => void
  onClose: () => void
  doppelt?: string
}) {
  const [step, setStep] = useState(0)
  const second = doppelt && step === 1
  return (
    <Dialog
      title={second ? 'Wirklich sicher?' : title}
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
              if (doppelt && step === 0) setStep(1)
              else {
                onConfirm()
                onClose()
              }
            }}
          >
            {second ? 'Ja, endgültig' : confirm}
          </button>
        </>
      }
    >
      {second ? doppelt : text}
    </Dialog>
  )
}

export function Wordmark({ big }: { big?: boolean }) {
  return (
    <span className={`wordmark${big ? ' big' : ''}`} aria-label="WATTZEN">
      WATTZEN
    </span>
  )
}
