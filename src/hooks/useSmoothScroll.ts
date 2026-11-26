import { useEffect, useState } from 'react'
import Lenis from 'lenis'
import { currentSection } from './activeSection'

let instance: Lenis | null = null

/** Module-level accessor so any component can drive smooth scrolling. */
export function getLenis() {
  return instance
}

export function scrollToSection(id: string, offset = -8) {
  const el = document.getElementById(id)
  if (!el) return
  if (instance) {
    instance.scrollTo(el, { offset, duration: 1.15 })
    return
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/**
 * Boots Lenis once for the whole page. `anchors` lets plain `#hash` links
 * animate without extra wiring; reduced-motion users get instant scrolling.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const lenis = new Lenis({
      autoRaf: true,
      anchors: { offset: -8, duration: 1.15 },
      lerp: 0.09,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
      smoothWheel: true,
    })
    instance = lenis

    return () => {
      lenis.destroy()
      instance = null
    }
  }, [])
}

/** Reports which of the section ids the reader is in. */
export function useActiveSection(ids: readonly string[]) {
  const [active, setActive] = useState(ids[0] ?? '')
  // Look the elements up again when chapters are added, removed or renamed.
  const key = ids.join('|')

  useEffect(() => {
    const elements = key
      .split('|')
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el))
    if (!elements.length) return

    let frame = 0
    const update = () => {
      frame = 0
      const sections = elements.map((el) => ({ id: el.id, top: el.getBoundingClientRect().top }))
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      setActive(currentSection(sections, window.innerHeight, atBottom))
    }
    const schedule = () => {
      frame ||= requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [key])

  return active
}
