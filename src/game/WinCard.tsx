import { motion } from 'framer-motion'
import type { Chapter } from '../content/types'
import { ArrowUpRight, PlayIcon, SparkIcon } from '../components/Icons'
import { formatMs } from './store'

type Props = {
  finalMs: number
  bestMs: number | null
  shards: number
  totalShards: number
  score: number
  assisted: boolean
  chapters: Chapter[]
  onReplay: () => void
  onExplore: () => void
  onJump: (id: string) => void
}

export function WinCard({
  finalMs,
  bestMs,
  shards,
  totalShards,
  score,
  assisted,
  chapters,
  onReplay,
  onExplore,
  onJump,
}: Props) {
  const isBest = !assisted && bestMs !== null && Math.abs(bestMs - finalMs) < 1

  return (
    <motion.div
      className="absolute inset-0 z-40 flex justify-center bg-bg/75 px-4 py-4 backdrop-blur-[3px]"
      data-lenis-prevent
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
    >
      <motion.div
        initial={{ opacity: 0, y: 26, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -18 }}
        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        // Never taller than the screen: it opens at the result, and the two buttons stay put.
        className="relative my-auto flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-bg/94"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(80% 120% at 15% 0%, color-mix(in oklab, var(--accent-3) 20%, transparent), transparent 62%), radial-gradient(70% 110% at 90% 25%, color-mix(in oklab, var(--accent) 18%, transparent), transparent 64%)',
          }}
        />

        <div className="relative min-h-0 overflow-y-auto overscroll-contain px-6 pt-6 sm:px-8 sm:pt-8 [@media(max-height:480px)]:pt-4">
          <div className="flex items-center gap-2">
            <SparkIcon className="size-3.5 text-accent-3" />
            <span className="mono-label">Lap complete</span>
          </div>

          <h2 className="mt-3 font-display text-[clamp(1.7rem,3.6vw,2.2rem)] font-semibold leading-tight tracking-[-0.035em]">
            Lap complete — all {chapters.length} gates passed.
          </h2>

          <div className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line wrap-normal">
            <div className="bg-bg/80 px-3 py-3">
              <span className="mono-label">Time</span>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                {formatMs(finalMs)}
              </p>
            </div>
            <div className="bg-bg/80 px-3 py-3">
              <span className="mono-label">Gates</span>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums">
                {shards}
                <span className="text-faint">/{totalShards}</span>
              </p>
            </div>
            <div className="bg-bg/80 px-3 py-3">
              <span className="mono-label">Score</span>
              <p className="mt-1 font-display text-lg font-semibold tabular-nums text-accent">
                {score}
              </p>
            </div>
          </div>

          {isBest && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-accent-3">
              New personal best
            </p>
          )}
          {assisted && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Fast travel used, so this time is not ranked
            </p>
          )}
          {!assisted && !isBest && bestMs !== null && (
            <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
              Best {formatMs(bestMs)}
            </p>
          )}

          <div className="mt-5 grid gap-2">
            {chapters.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onJump(c.id)}
                className="group flex items-center gap-2.5 rounded-lg border border-line bg-surface px-3 py-2 text-left transition-colors hover:border-line-strong"
              >
                <span className="size-1.5 shrink-0 rounded-full" style={{ background: c.accent }} />
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-faint">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5">
                  <span className="text-[12px] text-ink">{c.label}</span>
                  <span className="flex-1 basis-20 text-right text-[11px] text-faint transition-colors group-hover:text-muted">
                    {c.title}
                  </span>
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-faint transition-colors group-hover:text-accent" />
              </button>
            ))}
          </div>

        </div>

        <div className="relative flex shrink-0 flex-wrap gap-2 px-6 pb-6 pt-4 sm:px-8 sm:pb-8 [@media(max-height:480px)]:pb-4">
          <button
            type="button"
            autoFocus
            onClick={onReplay}
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-medium text-bg transition-transform hover:-translate-y-0.5"
          >
            <PlayIcon className="size-3.5" />
            Race again
          </button>
          <button
            type="button"
            onClick={onExplore}
            className="rounded-xl border border-line-strong bg-surface px-4 py-3 text-sm text-ink transition-colors hover:bg-surface-2"
          >
            Read it instead
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
