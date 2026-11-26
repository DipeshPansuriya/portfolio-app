import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useContent } from '../content/ContentProvider'
import { useKeyboard, onAction, addLook, classifyKey, clearInput } from './useControls'
import {
  clock,
  GATE_HOLD_SECONDS,
  getState,
  markAssisted,
  resetGame,
  setState,
  startRun,
  teleportTo,
  useGameState,
} from './store'
import { GameHUD } from './GameHUD'
import { ZonePanel } from './ZonePanel'
import { IntroCard } from './IntroCard'
import { WinCard } from './WinCard'
import { buildTrack, type Gate } from './track'
import { scrollToSection } from '../hooks/useSmoothScroll'
import { createGateHold } from './hold'
import { DriveFallback } from './DriveFallback'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { hasWebGL } from '../three/webgl'

const GameCanvas = lazy(() =>
  import('./GameCanvas').then((m) => ({ default: m.GameCanvas })),
)

type Props = {
  open: boolean
  onClose: () => void
}

export function DriveMode({ open, onClose }: Props) {
  const { content } = useContent()
  const { phase, score, discovered, finalMs, bestMs, holding, assisted } = useGameState()
  const [zone, setZone] = useState<Gate | null>(null)
  const [panel, setPanel] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [now, setNow] = useState(0)

  const track = useMemo(() => buildTrack(content.chapters), [content.chapters])
  const zones = track.gates
  const total = track.gates.length - 1
  const drag = useRef<{ x: number; y: number } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<number | null>(null)
  const holdingRef = useRef(false)
  holdingRef.current = holding
  const [holdLeft, setHoldLeft] = useState(0)
  const [holdPaused, setHoldPaused] = useState(false)
  const [contextLost, setContextLost] = useState(false)
  const [hold] = useState(() =>
    createGateHold({
      seconds: GATE_HOLD_SECONDS,
      onTick: setHoldLeft,
      onPause: setHoldPaused,
      onDone: () => {
        setPanel(false)
        setState({ holding: false })
      },
    }),
  )

  useKeyboard(open)

  const panelRef = useRef(panel)
  panelRef.current = panel

  /** Forget everything the screen remembers about the previous run. */
  const clearRunUi = useCallback(() => {
    hold.cancel()
    setPanel(false)
    setZone(null)
    setToast(null)
  }, [hold])

  /** Hide the chapter card and let the car go. */
  const dismissPanel = useCallback(() => {
    hold.end()
    setPanel(false)
  }, [hold])

  const reset = useCallback(() => {
    clearRunUi()
    resetGame()
  }, [clearRunUi])

  const start = useCallback(() => {
    clearRunUi()
    startRun()
  }, [clearRunUi])

  const close = useCallback(() => {
    reset()
    setContextLost(false)
    onClose()
  }, [reset, onClose])

  // Esc closes the card first, then leaves the island.
  useEffect(() => {
    if (!open) return
    const off = onAction((a) => {
      if (a === 'interact' && zone && zone.id !== '__start' && phase === 'playing') {
        if (panelRef.current) dismissPanel()
        else setPanel(true)
      }
      if (a === 'close') {
        if (panelRef.current) dismissPanel()
        else close()
      }
      if (a === 'reset') reset()
    })
    return off
  }, [open, zone, phase, close, reset, dismissPanel])

  // Enter starts the run from the intro or replays after a win. A focused
  // button keeps its own Enter/Space.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Enter' && e.code !== 'Space') return
      if (e.repeat || !classifyKey(e)) return
      if (phase === 'intro' || phase === 'won') {
        e.preventDefault()
        start()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, phase, start])

  // Tab stays inside the dialog.
  useEffect(() => {
    if (!open) return
    const onTab = (e: KeyboardEvent) => {
      const root = dialogRef.current
      if (e.key !== 'Tab' || !root) return
      const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]')]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = root.contains(document.activeElement) && document.activeElement !== root
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onTab)
    return () => window.removeEventListener('keydown', onTab)
  }, [open])

  // Intro and finish cards focus their own button; while driving the dialog holds focus.
  useEffect(() => {
    if (!open) return
    clearInput() // a pedal held through a phase change must not stay down
    if (phase === 'playing') dialogRef.current?.focus({ preventScroll: true })
  }, [open, phase])

  useEffect(() => {
    if (!zone) setPanel(false)
  }, [zone])

  // The win card takes over the screen; drop the chapter panel behind it.
  useEffect(() => {
    if (phase === 'won') setPanel(false)
  }, [phase])

  useEffect(() => {
    if (!open) return
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [open])

  // Run clock ticker — only while the island is open. Re-renders at ~10 Hz so
  // the HUD timer stays readable without driving React at frame rate.
  useEffect(() => {
    if (!open) return
    let raf = 0
    let last = 0
    let lastPaint = 0
    const tick = (t: number) => {
      // The gate hold is dead time: pause the lap clock so reading a card or
      // hovering it never costs the player their time.
      if (clock.running && !holdingRef.current) clock.elapsed += t - (last || t)
      last = t
      if (t - lastPaint > 100) {
        lastPaint = t
        setNow(clock.elapsed)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [open])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2200)
  }, [])

  /**
   * Passing a gate stops the car, opens that chapter's card for a few seconds,
   * then closes it and lets the lap continue. Pointer or keyboard focus on the
   * card pauses the countdown.
   */
  const onDiscover = useCallback(
    (id: string) => {
      const chapter = content.chapters.find((c) => c.id === id)
      if (chapter) showToast(`${chapter.label} passed`)
      if (getState().phase !== 'playing') return // the last gate ends the lap

      setPanel(true)
      setState({ holding: true })
      hold.start()
    },
    [content.chapters, showToast, hold],
  )

  // Clear any pending hold when the island unmounts.
  useEffect(() => hold.cancel, [hold])

  const jump = useCallback(
    (id: string) => {
      close()
      window.setTimeout(() => scrollToSection(id), 260)
    },
    [close],
  )

  /** Fast travel to the next chapter gate. The lap is then not ranked. */
  const next = useCallback(() => {
    if (!zone) return
    const gates = zones.filter((z) => z.id !== '__start')
    const target = gates[(gates.findIndex((z) => z.id === zone.id) + 1) % gates.length]
    if (!target) return
    markAssisted()
    teleportTo([target.position.x, 0, target.position.z])
    setZone(target)
    setPanel(true)
  }, [zone, zones])

  const unavailable = open && (contextLost || !hasWebGL())
  if (unavailable) return <DriveFallback onExit={close} />

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-80 bg-bg"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          ref={dialogRef}
          tabIndex={-1}
          // After a mouse click, give focus back so Space brakes instead of re-clicking.
          onClick={(e) => {
            if (e.detail > 0 && getState().phase === 'playing') {
              dialogRef.current?.focus({ preventScroll: true })
            }
          }}
          role="dialog"
          aria-modal="true"
          aria-label="The island"
        >
          {/* clicks pass through the canvas; the fallback card opts back in */}
          <div className="pointer-events-none absolute inset-0 [&_[role=alert]]:pointer-events-auto [&_[role=alert]]:relative">
            <Suspense
              fallback={
                <div className="grid h-full place-items-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="size-8 animate-spin rounded-full border border-line border-t-accent" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
                      Building the island
                    </span>
                  </div>
                </div>
              }
            >
              <ErrorBoundary fallback={<DriveFallback onExit={close} />}>
                <GameCanvas
                  chapters={content.chapters}
                  onGateChange={setZone}
                  onPass={onDiscover}
                  onContextLost={() => setContextLost(true)}
                />
              </ErrorBoundary>
            </Suspense>
          </div>

          {/* drag to look — sits above the canvas, below the HUD */}
          {phase === 'playing' && !holding && (
            <div
              className="absolute inset-0 z-[5] cursor-grab touch-none active:cursor-grabbing"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId)
                drag.current = { x: e.clientX, y: e.clientY }
              }}
              onPointerMove={(e) => {
                if (!drag.current) return
                addLook(e.clientX - drag.current.x, e.clientY - drag.current.y)
                drag.current = { x: e.clientX, y: e.clientY }
              }}
              onPointerUp={() => {
                drag.current = null
              }}
              onPointerCancel={() => {
                drag.current = null
              }}
            />
          )}

          {phase === 'playing' && (
            <GameHUD
              zoneLabel={zone?.label ?? null}
              discovered={discovered.length}
              chapters={track.gates.length - 1}
              clockMs={now}
              onExit={close}
              onReset={reset}
              onOpenZone={zone && zone.id !== '__start' ? () => setPanel(true) : undefined}
              toast={toast}
            />
          )}

          <ZonePanel
            zone={panel ? zone : null}
            holdLeft={holding ? holdLeft : null}
            holdPaused={holdPaused}
            onHoldPause={hold.setPaused}
            onClose={dismissPanel}
            onJumpToSection={jump}
            onNext={next}
          />

          <AnimatePresence>
            {phase === 'intro' && (
              <IntroCard
                key="intro"
                chapters={content.chapters}
                bestMs={bestMs}
                onStart={start}
                onExit={close}
              />
            )}
            {phase === 'won' && (
              <WinCard
                key="won"
                finalMs={finalMs}
                bestMs={bestMs}
                shards={discovered.length}
                totalShards={total}
                score={score}
                assisted={assisted}
                chapters={content.chapters}
                onReplay={start}
                onExplore={close}
                onJump={jump}
              />
            )}
          </AnimatePresence>

          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10"
            style={{
              background:
                'radial-gradient(120% 90% at 50% 50%, transparent 45%, rgba(5,6,10,0.55) 100%)',
            }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
