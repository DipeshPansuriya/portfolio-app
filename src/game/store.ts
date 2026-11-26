/**
 * Tiny external store for the island game.
 *
 * The player writes to `telemetry` every frame (mutable, no React work) and to
 * `clock` while a run is live. Discrete events — entering a chapter, collecting
 * a shard, winning — go through `setState` so the HUD re-renders only when
 * something actually changes.
 */
import { useSyncExternalStore } from 'react'

export type Phase = 'intro' | 'playing' | 'won'

export type GameState = {
  phase: Phase
  activeZone: string | null
  shards: number
  totalShards: number
  /** Chapter ids the player has stood on this run. */
  discovered: string[]
  score: number
  /** Finishing time in ms, committed when the run ends. */
  finalMs: number
  bestMs: number | null
  paused: boolean
  /** True while the car is held at a gate the player just passed. */
  holding: boolean
  /** Bumped by every start and reset; the car and gates restart when it changes. */
  runId: number
  /** True once fast travel was used, so the lap time is not ranked. */
  assisted: boolean
}

const BEST_KEY = 'dp-island-best-ms'

function readBest(): number | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = window.localStorage.getItem(BEST_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null // storage blocked
  }
}

function writeBest(ms: number) {
  try {
    window.localStorage.setItem(BEST_KEY, String(Math.round(ms)))
  } catch {
    /* storage can be unavailable in private mode */
  }
}

let state: GameState = {
  phase: 'intro',
  activeZone: null,
  shards: 0,
  totalShards: 0,
  discovered: [],
  score: 0,
  finalMs: 0,
  bestMs: readBest(),
  paused: false,
  holding: false,
  runId: 0,
  assisted: false,
}

const listeners = new Set<() => void>()

export function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function getState() {
  return state
}

export function setState(patch: Partial<GameState>) {
  let changed = false
  for (const key of Object.keys(patch) as (keyof GameState)[]) {
    if (state[key] !== patch[key]) {
      changed = true
      break
    }
  }
  if (!changed) return
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}

/** Run clock. Mutable so the HUD can read it without re-rendering. */
export const clock = { elapsed: 0, running: false }

function freshRun(phase: Phase): void {
  state = {
    ...state,
    phase,
    activeZone: null,
    shards: 0,
    discovered: [],
    score: 0,
    finalMs: 0,
    paused: false,
    holding: false,
    runId: state.runId + 1,
    assisted: false,
  }
  listeners.forEach((fn) => fn())
}

export function startRun() {
  clock.elapsed = 0
  clock.running = true
  freshRun('playing')
}

export function resetGame() {
  clock.elapsed = 0
  clock.running = false
  freshRun('intro')
}

export function winRun() {
  clock.running = false
  const ms = clock.elapsed
  let best = state.bestMs
  if (!state.assisted && (best === null || ms < best)) {
    best = ms
    writeBest(ms)
  }
  state = { ...state, phase: 'won', finalMs: ms, bestMs: best, paused: true, holding: false }
  listeners.forEach((fn) => fn())
}

export function markAssisted() {
  setState({ assisted: true })
}

/**
 * Records a chapter gate for the current run and finishes the lap on the last
 * one. Returns false when it does not count (no run, or already passed).
 */
export function passGate(id: string, total: number): boolean {
  if (state.phase !== 'playing' || state.discovered.includes(id)) return false
  const discovered = [...state.discovered, id]
  setState({ discovered, shards: discovered.length, score: discovered.length * 100 })
  if (discovered.length >= total) winRun()
  return true
}

/** Per-frame values. Read, never subscribe. */
export const telemetry = {
  x: 0,
  y: 0,
  z: 0,
  heading: 0,
  speed: 0,
  maxSpeed: 24,
  grounded: true,
  boosting: false,
}

/** One-shot commands the player consumes on its next frame. */
export const commands = {
  teleportTo: null as [number, number, number] | null,
}

export function teleportTo(position: [number, number, number]) {
  commands.teleportTo = position
}

/** Seconds the car is held at a gate before the lap resumes. */
export const GATE_HOLD_SECONDS = 5

export function useGameState(): GameState {
  return useSyncExternalStore(subscribe, getState, getState)
}

/** 83400 → "1:23.4" */
export function formatMs(ms: number) {
  const total = Math.max(0, ms)
  const minutes = Math.floor(total / 60000)
  const seconds = Math.floor((total % 60000) / 1000)
  const tenths = Math.floor((total % 1000) / 100)
  return `${minutes}:${String(seconds).padStart(2, '0')}.${tenths}`
}
