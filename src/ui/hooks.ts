import { useEffect, useRef, useState } from 'react'

/**
 * Hält die Speichern-Leiste über der Bildschirmtastatur: setzt `--kb` (Höhe der Tastatur)
 * und die Klasse `kb` auf <html>, solange die Tastatur offen ist.
 */
export function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      root.style.setProperty('--kb', `${Math.round(kb)}px`)
      root.classList.toggle('kb', kb > 80)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.classList.remove('kb')
    }
  }, [])
}

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    setW(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/**
 * Wischgeste nach links auf einer Zeile. Gibt den Versatz und Handler zurück;
 * über `threshold` hinaus bleibt die Zeile offen und zeigt die Aktion.
 */
export function useSwipe(open: boolean, setOpen: (v: boolean) => void, width = 96) {
  const start = useRef<{ x: number; y: number; base: number; locked?: 'x' | 'y' }>(undefined)
  const [dx, setDx] = useState(0)
  const [drag, setDrag] = useState(false)
  useEffect(() => setDx(open ? -width : 0), [open, width])
  return {
    dx,
    drag,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === 'mouse') return
        start.current = { x: e.clientX, y: e.clientY, base: open ? -width : 0 }
      },
      onPointerMove: (e: React.PointerEvent) => {
        const s = start.current
        if (!s) return
        const mx = e.clientX - s.x
        const my = e.clientY - s.y
        if (!s.locked) {
          if (Math.abs(mx) < 8 && Math.abs(my) < 8) return
          s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y'
        }
        if (s.locked !== 'x') return
        setDrag(true)
        setDx(Math.max(-width * 1.4, Math.min(0, s.base + mx)))
      },
      onPointerUp: () => {
        const s = start.current
        start.current = undefined
        if (!s || s.locked !== 'x') return
        setDrag(false)
        const next = dx < -width / 2
        setOpen(next)
        setDx(next ? -width : 0)
      },
      onPointerCancel: () => {
        start.current = undefined
        setDrag(false)
        setDx(open ? -width : 0)
      },
    },
  }
}
