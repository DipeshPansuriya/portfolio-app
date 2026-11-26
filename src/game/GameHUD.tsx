import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { telemetry } from './store'
import { touchInput } from './useControls'
import { CloseIcon } from '../components/Icons'
import { useIsTouch } from '../hooks/useMediaQuery'
import { formatMs } from './store'

type Props = {
  zoneLabel: string | null
  discovered: number
  chapters: number
  clockMs: number
  onExit: () => void
  onReset: () => void
  /** Present when the current gate has a card that can be opened. */
  onOpenZone?: () => void
  /** A short message, such as the gate just passed. */
  toast: string | null
}

function Speedo() {
  const [speed, setSpeed] = useState(0)
  const [boost, setBoost] = useState(false)

  useEffect(() => {
    let raf = 0
    let last = 0
    const tick = (t: number) => {
      if (t - last > 66) {
        last = t
        setSpeed(Math.round(telemetry.speed * 4.2))
        setBoost(telemetry.boosting)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const pct = Math.min(1, telemetry.speed / (telemetry.maxSpeed * 1.35))

  return (
    <div className="glass rounded-xl px-3 py-2">
      <div className="flex items-baseline gap-1.5">
        <span className={`font-display text-lg font-semibold tabular-nums ${boost ? 'text-accent-3' : 'text-ink'}`}>
          {speed}
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">km/h</span>
      </div>
      <div className="mt-1.5 h-0.5 w-24 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-150"
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  )
}

function TouchPad() {
  const btn =
    'grid place-items-center rounded-lg border border-line-strong bg-bg/70 text-ink backdrop-blur-sm active:bg-surface-2 select-none touch-none'

  const hold = (key: keyof typeof touchInput) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault()
      touchInput[key] = true
    },
    onPointerUp: () => {
      touchInput[key] = false
    },
    onPointerLeave: () => {
      touchInput[key] = false
    },
    onPointerCancel: () => {
      touchInput[key] = false
    },
  })

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between p-4">
      <div className="pointer-events-auto grid grid-cols-3 grid-rows-2 gap-1.5">
        <span />
        <button type="button" aria-label="Accelerate" className={`${btn} size-12`} {...hold('forward')}>
          ▲
        </button>
        <span />
        <button type="button" aria-label="Steer left" className={`${btn} size-12`} {...hold('left')}>
          ◀
        </button>
        <button type="button" aria-label="Steer right" className={`${btn} size-12`} {...hold('right')}>
          ▶
        </button>
        <button type="button" aria-label="Brake or reverse" className={`${btn} size-12`} {...hold('back')}>
          ▼
        </button>
      </div>
      <div className="pointer-events-auto flex flex-col gap-1.5">
        <button type="button" aria-label="Boost" className={`${btn} size-12 text-accent-3`} {...hold('boost')}>
          ⚡
        </button>
        <button type="button" aria-label="Handbrake" className={`${btn} size-12 text-accent`} {...hold('brake')}>
          ⤒
        </button>
      </div>
    </div>
  )
}

export function GameHUD({
  zoneLabel,
  discovered,
  chapters,
  clockMs,
  onExit,
  onReset,
  onOpenZone,
  toast,
}: Props) {
  const touch = useIsTouch()

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3 p-4 sm:p-6">
        <div className="relative flex flex-col gap-2">
          <div className="glass flex items-center gap-2 rounded-xl px-3 py-2">
            <span className="size-1.5 rounded-full bg-accent animate-pulse-dot" />
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              Lap
            </span>
            <span className="h-3 w-px bg-line-strong" />
            <span className="font-display text-[12px] font-semibold tabular-nums text-ink">
              {formatMs(clockMs)}
            </span>
          </div>
          <Speedo />
          {/* Mounted before the first message: a change inside a live region is what is announced. */}
          <p role="status" className="sr-only">
            {toast}
          </p>
          {/* In the corner, narrower than the room beside the gate card, so it covers neither it nor the sign. */}
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast}
                aria-hidden="true"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="absolute left-0 top-full mt-2 w-max max-w-[10.5rem]"
              >
                <div className="glass rounded-xl px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-accent">
                  {toast}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="glass flex items-center gap-2 rounded-xl px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Found</span>
            <span className="font-display text-sm font-semibold tabular-nums">
              {discovered}
              <span className="text-faint">/{chapters}</span>
            </span>
          </div>
          {/* One unit, so a narrow phone wraps them together and Exit stays on screen. */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onReset}
              className="glass rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted transition-colors hover:text-ink"
            >
              Reset
            </button>
            <button
              type="button"
              onClick={onExit}
              aria-label="Exit explore mode"
              className="glass grid size-9 place-items-center rounded-xl text-muted transition-colors hover:text-ink"
            >
              <CloseIcon className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* chapter progress */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 mt-2 px-4 sm:px-6">
        <div className="mx-auto h-px w-full max-w-md overflow-hidden rounded-full bg-line">
          <div
            data-tour-bar
            className="h-full rounded-full bg-gradient-to-r from-accent via-accent-2 to-accent-3 transition-[width] duration-300"
            style={{ width: `${Math.round((discovered / Math.max(1, chapters)) * 100)}%` }}
          />
        </div>
      </div>

      {/* zone banner */}
      <AnimatePresence>
        {zoneLabel && (
          <motion.div
            key={zoneLabel}
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className={`pointer-events-none absolute inset-x-0 z-20 flex justify-center md:bottom-8 ${
              touch ? 'bottom-36' : 'bottom-24'
            }`}
          >
            <div className="glass flex items-center gap-2.5 rounded-full px-4 py-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Entered</span>
              <span className="font-display text-sm font-medium">{zoneLabel}</span>
              {onOpenZone &&
                (touch ? (
                  <button
                    type="button"
                    onClick={onOpenZone}
                    className="pointer-events-auto -my-1 rounded-full border border-line-strong px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-accent"
                  >
                    Open
                  </button>
                ) : (
                  <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">press E</span>
                ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* controls hint */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-3 z-20 hidden justify-center ${
          touch ? '' : 'md:flex'
        }`}
      >
        <div className="flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          <span>W A S D drive</span>
          <span className="h-2.5 w-px bg-line-strong" />
          <span>Drag look</span>
          <span className="h-2.5 w-px bg-line-strong" />
          <span>Space brake</span>
          <span className="h-2.5 w-px bg-line-strong" />
          <span>Shift boost</span>
          <span className="h-2.5 w-px bg-line-strong" />
          <span>E chapter</span>
          <span className="h-2.5 w-px bg-line-strong" />
          <span>Esc exit</span>
        </div>
      </div>

      {touch && <TouchPad />}
    </>
  )
}
