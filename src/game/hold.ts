/**
 * The pause at a gate: counts down, waits while the visitor is reading
 * (pointer or keyboard focus on the card), then releases the car.
 */
type Options = {
  seconds: number
  onTick: (secondsLeft: number) => void
  onDone: () => void
  onPause?: (paused: boolean) => void
}

export function createGateHold({ seconds, onTick, onDone, onPause }: Options) {
  let timer: ReturnType<typeof setInterval> | null = null
  let remaining = 0
  const reasons = new Set<string>()

  const stop = () => {
    if (timer !== null) clearInterval(timer)
    timer = null
    reasons.clear()
    onPause?.(false)
  }

  const finish = () => {
    stop()
    onDone()
  }

  return {
    /** Restarts the countdown; a pause left over from the last card is dropped. */
    start() {
      stop()
      remaining = seconds * 1000
      onTick(seconds)
      timer = setInterval(() => {
        if (reasons.size) return
        remaining -= 100
        onTick(Math.max(0, remaining / 1000))
        if (remaining <= 0) finish()
      }, 100)
    },
    setPaused(reason: 'hover' | 'focus', paused: boolean) {
      if (timer === null) return
      if (paused) reasons.add(reason)
      else reasons.delete(reason)
      onPause?.(reasons.size > 0)
    },
    isPaused: () => reasons.size > 0,
    /** Release the car now. Does nothing when no hold is running. */
    end() {
      if (timer !== null) finish()
    },
    /** Drop the hold without releasing, e.g. when the run itself is reset. */
    cancel: stop,
  }
}
