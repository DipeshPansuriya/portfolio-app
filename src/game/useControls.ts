/**
 * Keyboard + touch input for the driving game.
 *
 * Keys are tracked in a module-level Set so the physics loop can read them
 * without React involvement; discrete actions (reset, interact, pause) are
 * delivered through a callback registry.
 */
import { useEffect } from 'react'

export type Action = 'reset' | 'interact' | 'pause' | 'close'

const pressed = new Set<string>()
const actionHandlers = new Set<(a: Action) => void>()

const KEY_MAP: Record<string, string> = {
  KeyW: 'forward',
  ArrowUp: 'forward',
  KeyS: 'back',
  ArrowDown: 'back',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'brake',
  ShiftLeft: 'boost',
  ShiftRight: 'boost',
}

const ACTION_MAP: Record<string, Action> = {
  KeyR: 'reset',
  KeyE: 'interact',
  Enter: 'interact',
  KeyP: 'pause',
  Escape: 'close',
}

export function isDown(name: string) {
  return pressed.has(name)
}

export function onAction(fn: (a: Action) => void) {
  actionHandlers.add(fn)
  return () => {
    actionHandlers.delete(fn)
  }
}

export function emitAction(a: Action) {
  actionHandlers.forEach((fn) => fn(a))
}

/** Virtual buttons (touch) write here. */
export const touchInput = {
  forward: false,
  back: false,
  left: false,
  right: false,
  brake: false,
  boost: false,
}

export function readInput() {
  return {
    forward: isDown('forward') || touchInput.forward,
    back: isDown('back') || touchInput.back,
    left: isDown('left') || touchInput.left,
    right: isDown('right') || touchInput.right,
    brake: isDown('brake') || touchInput.brake,
    boost: isDown('boost') || touchInput.boost,
  }
}

export function clearInput() {
  pressed.clear()
  touchInput.forward = false
  touchInput.back = false
  touchInput.left = false
  touchInput.right = false
  touchInput.brake = false
  touchInput.boost = false
}

/**
 * Pointer look deltas, accumulated between frames. `consumeLook` drains them so
 * a fast drag is never lost when several moves land inside one frame.
 */
const lookDelta = { x: 0, y: 0 }

export function addLook(dx: number, dy: number) {
  lookDelta.x += dx
  lookDelta.y += dy
}

export function consumeLook() {
  const out = { x: lookDelta.x, y: lookDelta.y }
  lookDelta.x = 0
  lookDelta.y = 0
  return out
}

const FIELDS = 'input, textarea, select'
const CONTROLS = 'button, a[href], input, textarea, select, summary'

type KeyLike = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'target'>

/**
 * What a key press means to the game, or `null` when it belongs to the browser:
 * shortcuts with a modifier, typing in a field, and Enter/Space on a focused control.
 */
export function classifyKey(
  e: KeyLike,
): { action?: Action; drive?: string; preventDefault: boolean } | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  const el = e.target as (Element & { isContentEditable?: boolean }) | null
  if (e.code !== 'Escape' && (el?.isContentEditable || el?.closest?.(FIELDS))) return null
  if ((e.code === 'Enter' || e.code === 'Space') && el?.closest?.(CONTROLS)) return null

  const action = ACTION_MAP[e.code]
  if (action) return { action, preventDefault: action !== 'close' }
  const drive = KEY_MAP[e.code]
  if (!drive) return null
  return { drive, preventDefault: e.code === 'Space' || e.code.startsWith('Arrow') }
}

/** Listens only while `active`, so the page keeps its keyboard when the game is closed. */
export function useKeyboard(active: boolean) {
  useEffect(() => {
    if (!active) return

    const onKeyDown = (e: KeyboardEvent) => {
      const hit = classifyKey(e)
      if (!hit) return
      if (hit.preventDefault) e.preventDefault()
      if (hit.action) emitAction(hit.action)
      if (hit.drive) pressed.add(hit.drive)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      const mapped = KEY_MAP[e.code]
      if (mapped) pressed.delete(mapped)
    }

    const onBlur = () => clearInput()

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      clearInput()
    }
  }, [active])
}
