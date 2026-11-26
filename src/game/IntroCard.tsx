import { motion } from 'framer-motion'
import type { Chapter } from '../content/types'
import { PlayIcon, CloseIcon } from '../components/Icons'
import { formatMs } from './store'
import { useIsTouch } from '../hooks/useMediaQuery'

type Props = {
  chapters: Chapter[]
  bestMs: number | null
  onStart: () => void
  onExit: () => void
}

export function IntroCard({ chapters, bestMs, onStart, onExit }: Props) {
  const touch = useIsTouch()
  const hints = touch
    ? ['Hold ▲ to drive', '◀ ▶ steer', 'Drag look', '⤒ brake', '⚡ boost']
    : ['W A S D drive', 'Drag look', 'Space brake', 'Shift boost', 'E chapter']

  return (
    <motion.div
      className="absolute inset-0 z-40 flex justify-center bg-bg/70 px-4 py-4 backdrop-blur-[3px]"
      data-lenis-prevent
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -18, scale: 0.99 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        // Never taller than the screen: Leave and Start stay put and only the text between them scrolls.
        className="relative my-auto flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-bg/92"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              'radial-gradient(80% 120% at 12% 0%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 62%), radial-gradient(70% 110% at 92% 20%, color-mix(in oklab, var(--accent-2) 20%, transparent), transparent 64%)',
          }}
        />

        <div className="relative flex shrink-0 items-start justify-between px-6 pt-6 sm:px-8 sm:pt-8 [@media(max-height:480px)]:pt-4">
          <div className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="mono-label">The island</span>
          </div>
          <button
            type="button"
            onClick={onExit}
            aria-label="Leave the island"
            className="grid size-8 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>

        <div className="relative min-h-0 overflow-y-auto overscroll-contain px-6 pt-4 sm:px-8">
          <h2 className="font-display text-[clamp(1.6rem,3.4vw,2.1rem)] font-semibold leading-tight tracking-[-0.035em]">
            Drive the circuit. Pass all {chapters.length} chapter gates.
          </h2>
          <p className="mt-3 text-[13px] leading-relaxed text-muted">
            Each arch is a chapter of this portfolio. Drive through all of them to finish the lap —
            the clock stops when the last gate lights up.
          </p>

          <ul className="mt-5 grid gap-2 sm:grid-cols-2">
            {chapters.map((c, i) => (
              <li
                key={c.id}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-2"
              >
                <span className="size-1.5 rounded-full" style={{ background: c.accent }} />
                <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                  {String(i + 1).padStart(2, '0')} {c.label}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            {hints.map((hint) => (
              <span key={hint}>{hint}</span>
            ))}
          </div>
        </div>

        <div className="relative shrink-0 px-6 pb-6 pt-4 sm:px-8 sm:pb-8 [@media(max-height:480px)]:pb-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              autoFocus
              onClick={onStart}
              className="group inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5"
            >
              <PlayIcon className="size-3.5" />
              Start the lap
            </button>
            {bestMs !== null && (
              <div className="rounded-xl border border-line px-3 py-2 text-center">
                <span className="block font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
                  Best
                </span>
                <span className="font-display text-sm font-semibold tabular-nums">
                  {formatMs(bestMs)}
                </span>
              </div>
            )}
          </div>

          {!touch && (
            <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
              or press Enter
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
