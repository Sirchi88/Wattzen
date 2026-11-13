import { GripVertical } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

/**
 * Senkrechte Liste mit Drag & Drop über einen Griff.
 * Tastatur: Griff fokussieren, Pfeil hoch/runter verschiebt.
 */
export function Sortable<T>({
  items, getKey, render, onChange, label,
}: {
  items: T[]
  getKey: (t: T) => string
  render: (t: T) => ReactNode
  onChange: (next: T[]) => void
  label: (t: T) => string
}) {
  const [order, setOrder] = useState<T[]>()
  const [dragKey, setDragKey] = useState<string>()
  const [offset, setOffset] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const st = useRef<{ y: number; key: string; start: number }>(undefined)
  const shown = order ?? items

  const move = (from: number, to: number, list = shown) => {
    const next = [...list]
    const [x] = next.splice(from, 1)
    next.splice(to, 0, x)
    return next
  }

  return (
    <ul className="sortable" ref={listRef}>
      {shown.map((it, i) => {
        const key = getKey(it)
        const dragging = key === dragKey
        return (
          <li key={key} className={`sort-item${dragging ? ' dragging' : ''}`} style={dragging ? { transform: `translateY(${offset}px)` } : undefined}>
            <button
              type="button"
              className="grip"
              aria-label={`${label(it)} verschieben`}
              onPointerDown={(e) => {
                e.preventDefault()
                ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                st.current = { y: e.clientY, key, start: i }
                setOrder(shown)
                setDragKey(key)
                setOffset(0)
              }}
              onPointerMove={(e) => {
                const s = st.current
                if (!s || !listRef.current) return
                const cur = order ?? shown
                const idx = cur.findIndex((x) => getKey(x) === s.key)
                const els = [...listRef.current.children] as HTMLElement[]
                const dy = e.clientY - s.y
                setOffset(dy)
                const me = els[idx]
                if (!me) return
                const r = me.getBoundingClientRect()
                const mid = r.top + r.height / 2 - offset + dy
                const prev = els[idx - 1]?.getBoundingClientRect()
                const next = els[idx + 1]?.getBoundingClientRect()
                if (prev && mid < prev.top + prev.height / 2) {
                  setOrder(move(idx, idx - 1, cur))
                  s.y -= prev.height + 0
                  setOffset(e.clientY - s.y)
                } else if (next && mid > next.top + next.height / 2) {
                  setOrder(move(idx, idx + 1, cur))
                  s.y += next.height + 0
                  setOffset(e.clientY - s.y)
                }
              }}
              onPointerUp={() => {
                if (order) onChange(order)
                st.current = undefined
                setDragKey(undefined)
                setOrder(undefined)
                setOffset(0)
              }}
              onPointerCancel={() => {
                st.current = undefined
                setDragKey(undefined)
                setOrder(undefined)
                setOffset(0)
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowUp' && i > 0) {
                  e.preventDefault()
                  onChange(move(i, i - 1))
                }
                if (e.key === 'ArrowDown' && i < shown.length - 1) {
                  e.preventDefault()
                  onChange(move(i, i + 1))
                }
              }}
            >
              <GripVertical size={18} aria-hidden />
            </button>
            <div className="sort-body">{render(it)}</div>
          </li>
        )
      })}
    </ul>
  )
}
