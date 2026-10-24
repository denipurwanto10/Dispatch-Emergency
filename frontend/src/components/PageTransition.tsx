import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLocation, type Location } from 'react-router-dom'

const EXIT_MS = 220

interface PageTransitionProps {
  /** Render rute untuk lokasi tertentu. */
  render: (location: Location) => ReactNode
}

/**
 * Transisi antar halaman: halaman lama memudar keluar, halaman baru
 * masuk dengan fade + slide + sedikit scale. Tanpa dependensi tambahan.
 */
export function PageTransition({ render }: PageTransitionProps) {
  const location = useLocation()
  const [shown, setShown] = useState<Location>(location)
  const [phase, setPhase] = useState<'enter' | 'exit'>('enter')
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (location.pathname === shown.pathname) {
      setShown(location)
      return
    }
    setPhase('exit')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setShown(location)
      setPhase('enter')
    }, EXIT_MS)
    return () => window.clearTimeout(timer.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location])

  return (
    <>
      <div className={`route-bar ${phase === 'exit' ? 'is-active' : ''}`} aria-hidden="true" />
      <div key={shown.pathname} className={`page-stage page-${phase}`}>
        {render(shown)}
      </div>
    </>
  )
}
