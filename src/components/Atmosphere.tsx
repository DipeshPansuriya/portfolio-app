import { useEffect, useRef } from 'react'
import { useIsTouch, usePrefersReducedMotion } from '../hooks/useMediaQuery'

/**
 * A soft accent spotlight that trails the pointer. Rendered on a canvas-free
 * div with a transform write per frame — cheaper than a React state update.
 */
export function CursorGlow() {
  const ref = useRef<HTMLDivElement>(null)
  const isTouch = useIsTouch()
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    if (isTouch || reduced) return
    const el = ref.current
    if (!el) return

    let raf = 0
    const target = { x: window.innerWidth / 2, y: window.innerHeight / 3 }
    const pos = { ...target }

    const onMove = (e: PointerEvent) => {
      target.x = e.clientX
      target.y = e.clientY
    }

    const tick = () => {
      pos.x += (target.x - pos.x) * 0.12
      pos.y += (target.y - pos.y) * 0.12
      el.style.transform = `translate3d(${pos.x - 240}px, ${pos.y - 240}px, 0)`
      raf = requestAnimationFrame(tick)
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    raf = requestAnimationFrame(tick)

    return () => {
      window.removeEventListener('pointermove', onMove)
      cancelAnimationFrame(raf)
    }
  }, [isTouch, reduced])

  if (isTouch || reduced) return null

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-0 size-[480px] rounded-full opacity-60 mix-blend-screen will-change-transform"
      style={{
        background:
          'radial-gradient(circle, color-mix(in oklab, var(--accent) 9%, transparent), transparent 62%)',
      }}
    />
  )
}

/** Static film grain, kept subtle so text stays crisp. */
export function GrainOverlay() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-40 opacity-[0.035] mix-blend-overlay"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E\")",
      }}
    />
  )
}
