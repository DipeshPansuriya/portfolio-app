import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useScroll, useSpring } from 'framer-motion'
import type { Chapter, Profile } from '../content/types'
import { scrollToSection, useActiveSection } from '../hooks/useSmoothScroll'
import { CloseIcon, MenuIcon, MoonIcon, SunIcon } from './Icons'
import type { Theme } from '../hooks/useTheme'

type Props = {
  theme: Theme
  onToggleTheme: () => void
  chapters: Chapter[]
  profile: Profile
  onDrive: () => void
}

export function Nav({ theme, onToggleTheme, chapters, profile, onDrive }: Props) {
  const active = useActiveSection(chapters.map((c) => c.id))
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  // Chapter links sit in the bar from 1024 px, seven or eight from 1280 px, more never. Else the menu.
  const fit = chapters.length > 8 ? 'menu' : chapters.length > 6 ? 'many' : 'few'
  const links = useRef<HTMLDivElement>(null)
  // The count says when the links may sit in the bar; their width says whether they do.
  const [crowded, setCrowded] = useState(false)
  const menuFit = crowded ? 'menu' : fit

  useEffect(() => {
    const bar = links.current
    if (!bar) return
    const observer = new ResizeObserver(() => {
      // Measured as if the menu button were away, as it is whenever the links are in the bar.
      const button = menuButton.current
      const spare = button?.offsetWidth ? button.offsetWidth + parseFloat(getComputedStyle(button.parentElement!).columnGap) : 0
      setCrowded(bar.scrollWidth > bar.clientWidth + spare + 1)
    })
    // The links too: a late web font changes their width without resizing the bar.
    for (const element of [bar, ...bar.children]) observer.observe(element)
    return () => observer.disconnect()
  }, [chapters])

  const { scrollYProgress } = useScroll()
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 })

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      menuButton.current?.focus()
    }
    // Past the breakpoint the menu and its button are hidden: it must not keep holding the scroll.
    const onResize = () => {
      if (!menuButton.current?.getClientRects().length) setOpen(false)
    }
    // Also when the links start to fit again, which can follow the resize event.
    onResize()
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onResize)
    }
  }, [open, crowded])

  function go(id: string) {
    setOpen(false)
    window.setTimeout(() => scrollToSection(id), 60)
  }

  return (
    <>
      <motion.div
        className="fixed inset-x-0 top-0 z-60 h-px origin-left bg-gradient-to-r from-accent via-accent-2 to-accent-3"
        style={{ scaleX: progress }}
        aria-hidden="true"
      />

      <header className="fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-4 sm:px-6 sm:pt-5">
        <nav
          className={`flex w-full max-w-6xl items-center gap-2 rounded-2xl px-3 py-2.5 transition-all duration-500 sm:px-4 ${
            scrolled ? 'glass shadow-[0_20px_60px_-30px_rgba(0,0,0,0.85)]' : 'border border-transparent'
          }`}
          aria-label="Primary"
        >
          <button
            type="button"
            onClick={() => go('hero')}
            className="group flex shrink-0 items-center gap-2.5 rounded-xl px-1.5 py-1 text-left"
          >
            <span className="relative grid size-8 place-items-center rounded-lg border border-line-strong bg-surface-2 font-mono text-[11px] font-medium tracking-tight text-ink">
              {profile.initials}
              <span className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-accent animate-pulse-dot" />
            </span>
            <span className="hidden flex-col leading-none sm:flex">
              <span className="max-w-52 truncate font-display text-[13px] font-semibold tracking-tight">
                {profile.name}
              </span>
              <span className="mt-1 max-w-52 truncate font-mono text-[9px] uppercase tracking-[0.16em] text-faint">
                {profile.role}
              </span>
            </span>
          </button>

          {/* Links too long for the bar stay laid out, so they can be measured, but unseen: the menu takes over. */}
          <div
            ref={links}
            data-fit={fit}
            className={`mx-auto hidden min-w-0 items-center gap-0.5 overflow-x-auto p-1 [scrollbar-width:none] lg:data-[fit=few]:flex xl:data-[fit=many]:flex ${crowded ? 'invisible' : ''}`}
          >
            {chapters.map((item) => {
              const isActive = active === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(item.id)}
                  aria-current={isActive ? 'location' : undefined}
                  className={`relative shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] transition-colors duration-200 ${
                    isActive ? 'text-ink' : 'text-muted hover:text-ink'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="absolute inset-0 rounded-lg border border-line bg-surface-2"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                    />
                  )}
                  <span className="relative">{item.label}</span>
                </button>
              )
            })}
          </div>

          <div
            data-fit={fit}
            className="ml-auto flex shrink-0 items-center gap-1.5 lg:data-[fit=few]:ml-0 xl:data-[fit=many]:ml-0"
          >
            <button
              type="button"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={theme}
                  initial={{ opacity: 0, rotate: -35, scale: 0.7 }}
                  animate={{ opacity: 1, rotate: 0, scale: 1 }}
                  exit={{ opacity: 0, rotate: 35, scale: 0.7 }}
                  transition={{ duration: 0.22 }}
                  className="grid place-items-center"
                >
                  {theme === 'dark' ? <SunIcon className="size-4" /> : <MoonIcon className="size-4" />}
                </motion.span>
              </AnimatePresence>
            </button>

            <button
              type="button"
              onClick={onDrive}
              className="hidden items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink sm:flex"
            >
              <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
              Play
            </button>

            <button
              type="button"
              onClick={() => go('contact-card')}
              className="hidden items-center gap-2 whitespace-nowrap rounded-lg bg-ink px-3.5 py-2 text-[13px] font-medium text-bg transition-transform duration-200 hover:-translate-y-px sm:flex"
            >
              Let’s talk
            </button>

            <button
              ref={menuButton}
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Close menu' : 'Open menu'}
              data-fit={menuFit}
              className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-ink lg:data-[fit=few]:hidden xl:data-[fit=many]:hidden"
            >
              {open ? <CloseIcon className="size-4" /> : <MenuIcon className="size-4" />}
            </button>
          </div>
        </nav>
      </header>

      <AnimatePresence>
        {open && (
          <motion.div
            data-fit={menuFit}
            className="fixed inset-0 z-40 bg-bg/95 pt-24 backdrop-blur-xl lg:data-[fit=few]:hidden xl:data-[fit=many]:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {/* Scrolls on short screens, below the header (`pt-24` above); Lenis must not take the wheel. */}
            <div
              data-lenis-prevent
              className="flex h-full flex-col overflow-y-auto overscroll-contain px-8 pb-8"
            >
              <div className="my-auto flex shrink-0 flex-col">
                {chapters.map((item, i) => (
                  <motion.button
                    key={item.id}
                    type="button"
                    onClick={() => go(item.id)}
                    initial={{ opacity: 0, y: 22 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.06 + i * 0.05, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="flex items-baseline justify-between gap-3 border-b border-line py-5 text-left"
                  >
                    <span className="min-w-0 font-display text-3xl font-medium tracking-tight">{item.label}</span>
                    <span className="shrink-0 font-mono text-[10px] text-faint">{String(i + 1).padStart(2, '0')}</span>
                  </motion.button>
                ))}
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.4 }}
                  className="mt-10 font-mono text-[11px] uppercase tracking-[0.18em] text-faint"
                >
                  {profile.location} · {profile.availability}
                </motion.p>

                <motion.button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    window.setTimeout(onDrive, 120)
                  }}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.46, duration: 0.5 }}
                  className="mt-6 inline-flex w-fit items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-[13px] text-ink"
                >
                  <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
                  Explore the island
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
