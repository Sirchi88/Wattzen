import { useEffect, useState } from 'react'
import { PenBolt, Wordmark } from './bits'

/** Startbildschirm: Logo, Füller-Blitz, Handschrift. Ein Tipp überspringt ihn. */
export function Splash({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [leaving, setLeaving] = useState(false)
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    const total = Math.max(500, seconds * 1000)
    const t1 = window.setTimeout(() => setLeaving(true), Math.max(0, total - (reduced ? 0 : 320)))
    const t2 = window.setTimeout(onDone, total)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [seconds, onDone])
  return (
    <div
      className={`splash${leaving ? ' out' : ''}`}
      role="button"
      tabIndex={0}
      aria-label="Startbildschirm überspringen"
      onClick={onDone}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && onDone()}
    >
      <PenBolt className="splash-bolt" />
      <div className="splash-mark">
        <Wordmark big />
        <span className="splash-by">by Dani S.</span>
      </div>
    </div>
  )
}
