import { AnimatePresence, motion } from 'framer-motion'
import { useContent } from '../content/ContentProvider'
import { CloseIcon, ArrowUpRight, ArrowRight } from '../components/Icons'
import type { Gate } from './track'
import { GATE_HOLD_SECONDS } from './store'
import { useIsTouch } from '../hooks/useMediaQuery'
import { contactChapterId } from '../content/text'

type Props = {
  zone: Gate | null
  /** Seconds left before the car resumes; null when not holding. */
  holdLeft: number | null
  holdPaused: boolean
  /** Reading the card (pointer or keyboard focus) pauses the countdown. */
  onHoldPause: (reason: 'hover' | 'focus', paused: boolean) => void
  onClose: () => void
  onJumpToSection: (id: string) => void
  onNext: () => void
}

/** Without a touch pad: a bottom sheet on narrow screens, else a column on the right. */
const PLACE =
  'inset-x-3 bottom-3 max-h-[64vh] sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:max-h-[70vh] sm:w-[27rem]'

/**
 * With one, the card must never lie on the pad (`TouchPad`: 134px high, 11rem wide
 * on the left, 4rem on the right), or a thumb that is steering presses "Read in
 * full" and the lap is gone. Upright it stays above the pad; on a short landscape
 * screen it goes between the two halves.
 */
const PLACE_TOUCH = [
  'inset-x-3 bottom-36 max-h-[min(44dvh,calc(100dvh-17rem))]',
  'sm:inset-x-auto sm:right-6 sm:top-24 sm:bottom-auto sm:max-h-[min(70dvh,calc(100dvh-15.25rem))] sm:w-[27rem]',
  '[@media(orientation:landscape)_and_(max-height:600px)]:inset-x-auto',
  '[@media(orientation:landscape)_and_(max-height:600px)]:right-[4.75rem]',
  '[@media(orientation:landscape)_and_(max-height:600px)]:top-24',
  '[@media(orientation:landscape)_and_(max-height:600px)]:bottom-auto',
  '[@media(orientation:landscape)_and_(max-height:600px)]:w-[min(27rem,calc(100vw-17rem))]',
  '[@media(orientation:landscape)_and_(max-height:600px)]:max-h-[calc(100dvh-6.75rem)]',
].join(' ')

function Shell({
  zone,
  holdLeft,
  holdPaused,
  onHoldPause,
  onClose,
  children,
}: {
  zone: Gate
  holdLeft: number | null
  holdPaused: boolean
  onHoldPause: Props['onHoldPause']
  onClose: () => void
  children: React.ReactNode
}) {
  const touch = useIsTouch()
  return (
    <motion.aside
      key={zone.id}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHoldPause('hover', true)}
      onPointerLeave={() => onHoldPause('hover', false)}
      // Keyboard focus only: a mouse click must not leave the car parked.
      onFocus={(e) => e.target.matches(':focus-visible') && onHoldPause('focus', true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) onHoldPause('focus', false)
      }}
      data-lenis-prevent
      initial={{ opacity: 0, x: 30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={`pointer-events-auto absolute z-30 overflow-y-auto rounded-2xl border border-line bg-bg/92 p-5 backdrop-blur-xl ${touch ? PLACE_TOUCH : PLACE}`}
      aria-label={`${zone.label} chapter`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full" style={{ background: zone.color }} />
            <span className="mono-label">{zone.kicker}</span>
          </div>
          <h3 className="mt-1.5 font-display text-xl font-semibold tracking-tight">{zone.label}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition-colors hover:text-ink"
        >
          <CloseIcon className="size-4" />
        </button>
      </div>
      {holdLeft !== null && (
        <div className="mt-3">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
            <span>{holdPaused ? 'Paused while you read' : 'Resuming'}</span>
            <span className="tabular-nums">{holdLeft.toFixed(1)}s</span>
          </div>
          <div className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-line">
            <div
              data-hold-bar
              className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2 transition-[width] duration-100"
              style={{ width: `${Math.max(0, Math.min(1, holdLeft / GATE_HOLD_SECONDS)) * 100}%` }}
            />
          </div>
        </div>
      )}
      <div className="mt-4">{children}</div>
    </motion.aside>
  )
}

export function ZonePanel({
  zone,
  holdLeft,
  holdPaused,
  onHoldPause,
  onClose,
  onJumpToSection,
  onNext,
}: Props) {
  const { content } = useContent()
  const chapter = zone ? content.chapters.find((c) => c.id === zone.id) : undefined

  return (
    <AnimatePresence mode="wait">
      {zone && chapter && (
        <Shell
          zone={zone}
          holdLeft={holdLeft}
          holdPaused={holdPaused}
          onHoldPause={onHoldPause}
          onClose={onClose}
        >
          <p className="font-display text-[17px] font-medium leading-snug tracking-tight">
            {chapter.title}
          </p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{chapter.body}</p>

          <ul className="mt-4 space-y-2">
            {chapter.bullets.map((b, i) => (
              <li key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-faint">
                <span
                  className="mt-[7px] size-1 shrink-0 rounded-full"
                  style={{ background: zone.color }}
                />
                <span>{b}</span>
              </li>
            ))}
          </ul>

          {chapter.id === contactChapterId(content.chapters) && (
            <a
              href={`mailto:${content.profile.email}`}
              className="mt-4 flex items-center justify-between rounded-lg bg-ink px-3 py-2.5 text-[12px] font-medium text-bg"
            >
              {content.profile.email}
              <ArrowUpRight className="size-3.5" />
            </a>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => onJumpToSection(zone.id)}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-[12px] text-ink transition-colors hover:bg-surface"
            >
              Read in full
              <ArrowUpRight className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={onNext}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-[12px] text-muted transition-colors hover:text-ink"
            >
              Next
              <ArrowRight className="size-3.5" />
            </button>
          </div>
        </Shell>
      )}
    </AnimatePresence>
  )
}
