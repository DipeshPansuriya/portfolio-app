/** Longitudinal car physics, kept free of three.js so it can be tested directly. */
export const MAX_SPEED = 46
export const BOOST_SPEED = 58
export const MAX_REVERSE = 9
const ACCEL = 21
const BRAKE = 42
const REVERSE_ACCEL = 12
const DRAG = 0.9
const ROLL_RESIST = 3.2

type Pedals = { forward: boolean; back: boolean; brake: boolean; boost: boolean }

export const isBoosting = (speed: number, input: Pedals) => input.boost && !input.brake && speed > 1

/** Speed after `dt` seconds. The handbrake wins over the pedals and never reverses. */
export function stepSpeed(speed: number, input: Pedals, dt: number) {
  const top = isBoosting(speed, input) ? BOOST_SPEED : MAX_SPEED
  let next = speed

  if (input.brake) {
    next = Math.sign(next) * Math.max(0, Math.abs(next) - BRAKE * dt)
  } else if (input.forward) {
    next += ACCEL * dt
  } else if (input.back) {
    next -= (next > 0.5 ? BRAKE : REVERSE_ACCEL) * dt
  } else {
    next -= next * DRAG * dt
    next -= Math.sign(next) * ROLL_RESIST * dt
    if (Math.abs(next) < 0.2) next = 0
  }

  // `+ 0` turns a braked -0 into 0.
  return Math.min(top, Math.max(-MAX_REVERSE, next)) + 0
}
