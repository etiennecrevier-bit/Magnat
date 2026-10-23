import pacing from '../content/pacing.json'
import type { GameStore } from './store.ts'

/**
 * Most game days one animation frame may advance. After a long stall (a
 * frozen tab, a debugger pause) the extra days are dropped, not caught up.
 */
export const MAX_TICKS_PER_FRAME = pacing.maxTicksPerFrame

export interface ClockStep {
  days: number
  carryMs: number
}

/**
 * Turns real elapsed time into whole game days. `carryMs` is game time
 * (real ms × speed) not yet spent on a day, so at speed `s` a day passes
 * every `msPerDay / s` real ms and a speed change keeps the partial day.
 */
export function stepClock(
  carryMs: number,
  elapsedMs: number,
  speed: number,
  msPerDay: number,
): ClockStep {
  if (speed <= 0 || elapsedMs <= 0) return { days: 0, carryMs }
  const total = carryMs + elapsedMs * speed
  const days = Math.floor(total / msPerDay)
  if (days > MAX_TICKS_PER_FRAME) {
    return { days: MAX_TICKS_PER_FRAME, carryMs: total % msPerDay }
  }
  return { days, carryMs: total - days * msPerDay }
}

/** The browser APIs the loop needs, injectable so tests can fake them. */
export interface LoopHost {
  requestFrame: (callback: (time: number) => void) => number
  cancelFrame: (handle: number) => void
  isHidden: () => boolean
  /** Calls `listener` when the page is hidden or shown; returns unsubscribe. */
  onVisibilityChange: (listener: () => void) => () => void
}

// Reads window and document only when called, so importing this module
// outside a browser (tests, server rendering) is safe.
export const browserHost: LoopHost = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (handle) => window.cancelAnimationFrame(handle),
  isHidden: () => document.hidden,
  onVisibilityChange: (listener) => {
    document.addEventListener('visibilitychange', listener)
    return () => document.removeEventListener('visibilitychange', listener)
  },
}

/**
 * Advances `store` in real time at its current speed. The loop stops while
 * the page is hidden and starts fresh when it is shown again, so time spent
 * away never counts; `speed` is left alone. It stops too while the game is
 * paused, so a paused game asks the browser for no frame (#281), and starts
 * fresh when it goes on, keeping the partial day. Returns a function that
 * stops the loop for good.
 */
export function startGameLoop(
  store: GameStore,
  host: LoopHost = browserHost,
): () => void {
  const msPerDay = pacing.msPerDayAtNormalSpeed
  let frame: number | null = null
  let lastTime: number | null = null
  let carryMs = 0

  const onFrame = (time: number) => {
    frame = host.requestFrame(onFrame)
    // The first frame after a (re)start only sets the baseline.
    if (lastTime !== null) {
      const { speed, advance } = store.getState()
      const step = stepClock(carryMs, time - lastTime, speed, msPerDay)
      carryMs = step.carryMs
      if (step.days > 0) advance(step.days)
    }
    lastTime = time
  }

  const run = () => {
    if (frame !== null) return
    lastTime = null
    frame = host.requestFrame(onFrame)
  }

  const halt = () => {
    if (frame === null) return
    host.cancelFrame(frame)
    frame = null
  }

  const follow = () => {
    if (host.isHidden() || store.getState().speed <= 0) halt()
    else run()
  }
  const unsubscribe = host.onVisibilityChange(follow)
  const unfollow = store.subscribe((state, previous) => {
    if (state.speed !== previous.speed) follow()
  })
  follow()

  return () => {
    unsubscribe()
    unfollow()
    halt()
  }
}
