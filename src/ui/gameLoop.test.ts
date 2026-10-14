import { describe, expect, it } from 'vitest'
import pacing from '../content/pacing.json'
import {
  MAX_TICKS_PER_FRAME,
  startGameLoop,
  stepClock,
  type LoopHost,
} from './gameLoop.ts'
import { PAUSED, createGameStore } from './store.ts'

const msPerDay = pacing.msPerDayAtNormalSpeed
const runningSpeeds = pacing.speeds.filter((speed) => speed > PAUSED)
const FRAME_MS = 16

/** Real ms at `speed` until the first day passes, frames landing on whole ms. */
function realMsToFirstDay(speed: number): number {
  return Math.ceil(msPerDay / speed)
}

/** A fake browser: a clock, a frame queue and a visibility flag. */
function createFakeHost({ hidden = false } = {}) {
  let now = 0
  let nextHandle = 1
  const frames = new Map<number, (time: number) => void>()
  const listeners = new Set<() => void>()

  const host: LoopHost = {
    requestFrame: (callback) => {
      const handle = nextHandle
      nextHandle += 1
      frames.set(handle, callback)
      return handle
    },
    cancelFrame: (handle) => {
      frames.delete(handle)
    },
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }

  /** Runs the frames requested so far at the current time. */
  function deliverFrame() {
    const pending = [...frames.values()]
    frames.clear()
    for (const callback of pending) callback(now)
  }

  return {
    host,
    deliverFrame,
    /** Lets `ms` pass with a frame every FRAME_MS and one at the very end. */
    runFor(ms: number) {
      const end = now + ms
      while (now < end) {
        now = Math.min(now + FRAME_MS, end)
        deliverFrame()
      }
    },
    /** Lets `ms` pass without any frame, like a stalled or hidden tab. */
    stall(ms: number) {
      now += ms
    },
    setHidden(value: boolean) {
      hidden = value
      for (const listener of [...listeners]) listener()
    },
    pendingFrames: () => frames.size,
    visibilityListeners: () => listeners.size,
  }
}

/** A store and a started loop, with the baseline frame already run. */
function startRunning(speed: number) {
  const store = createGameStore()
  store.getState().setSpeed(speed)
  const fake = createFakeHost()
  const stop = startGameLoop(store, fake.host)
  fake.deliverFrame()
  const day = () => store.getState().game.day
  return { store, fake, stop, day }
}

describe('stepClock', () => {
  it('adds nothing while paused or when no time passed', () => {
    expect(stepClock(500, 100, PAUSED, 1000)).toEqual({ days: 0, carryMs: 500 })
    expect(stepClock(500, 0, 10, 1000)).toEqual({ days: 0, carryMs: 500 })
    expect(stepClock(500, -5, 10, 1000)).toEqual({ days: 0, carryMs: 500 })
  })

  it('counts game time as real time times speed', () => {
    expect(stepClock(0, 100, 10, 1000)).toEqual({ days: 1, carryMs: 0 })
    expect(stepClock(500, 100, 3, 1000)).toEqual({ days: 0, carryMs: 800 })
    expect(stepClock(900, 250, 1, 1000)).toEqual({ days: 1, carryMs: 150 })
  })

  it('keeps the partial day across a speed change', () => {
    const slow = stepClock(0, 500, 1, 1000)
    expect(slow).toEqual({ days: 0, carryMs: 500 })
    expect(stepClock(slow.carryMs, 50, 10, 1000)).toEqual({
      days: 1,
      carryMs: 0,
    })
  })

  it('advances at most MAX_TICKS_PER_FRAME days and drops the rest', () => {
    expect(stepClock(0, MAX_TICKS_PER_FRAME * 1000 + 7, 1, 1000)).toEqual({
      days: MAX_TICKS_PER_FRAME,
      carryMs: 7,
    })
    expect(stepClock(250, 60_000, 10, 4000)).toEqual({
      days: MAX_TICKS_PER_FRAME,
      carryMs: 250,
    })
  })
})

describe('startGameLoop', () => {
  it('only sets a baseline on its first frame', () => {
    const store = createGameStore()
    const fake = createFakeHost()
    startGameLoop(store, fake.host)
    fake.stall(60_000)
    fake.deliverFrame()
    expect(store.getState().game.day).toBe(0)
  })

  it.each(runningSpeeds)(
    'at ×%i, advances one day every msPerDay / speed',
    (speed) => {
      const { fake, day } = startRunning(speed)
      const firstDay = realMsToFirstDay(speed)

      fake.runFor(firstDay - 1)
      expect(day()).toBe(0)
      fake.runFor(1)
      expect(day()).toBe(1)

      fake.runFor(10 * msPerDay)
      expect(day()).toBe(1 + 10 * speed)
    },
  )

  it('freezes time while paused and resumes the partial day at the last speed', () => {
    const { store, fake, day } = startRunning(3)
    const before = Math.floor(realMsToFirstDay(3) / 2)
    fake.runFor(before)

    store.getState().togglePause()
    fake.runFor(60_000)
    expect(day()).toBe(0)

    store.getState().togglePause()
    expect(store.getState().speed).toBe(3)
    const after = Math.ceil((msPerDay - before * 3) / 3)
    fake.runFor(after - 1)
    expect(day()).toBe(0)
    fake.runFor(1)
    expect(day()).toBe(1)
  })

  it('reads the speed every frame and keeps the partial day', () => {
    const { store, fake, day } = startRunning(1)
    const half = Math.floor(msPerDay / 2)
    fake.runFor(half)

    store.getState().setSpeed(10)
    const rest = Math.ceil((msPerDay - half) / 10)
    fake.runFor(rest - 1)
    expect(day()).toBe(0)
    fake.runFor(1)
    expect(day()).toBe(1)

    store.getState().setSpeed(1)
    fake.runFor(msPerDay - 10)
    expect(day()).toBe(1)
  })

  it('caps a long stall at MAX_TICKS_PER_FRAME days, with no catch-up after', () => {
    const { fake, day } = startRunning(10)
    fake.stall(60_000)
    fake.deliverFrame()
    expect(day()).toBe(MAX_TICKS_PER_FRAME)

    fake.runFor(msPerDay)
    expect(day()).toBe(MAX_TICKS_PER_FRAME + 10)
  })

  it('stops while the tab is hidden and does not count that time', () => {
    const { store, fake, day } = startRunning(1)
    fake.runFor(msPerDay)
    expect(day()).toBe(1)

    fake.setHidden(true)
    expect(fake.pendingFrames()).toBe(0)
    fake.stall(60_000)
    expect(store.getState().speed).toBe(1)

    fake.setHidden(false)
    expect(fake.pendingFrames()).toBe(1)
    fake.deliverFrame()
    expect(day()).toBe(1)
    fake.runFor(msPerDay)
    expect(day()).toBe(2)
  })

  it('stays paused after a tab switch when the player paused', () => {
    const { store, fake, day } = startRunning(1)
    store.getState().togglePause()
    fake.setHidden(true)
    fake.setHidden(false)
    expect(store.getState().speed).toBe(PAUSED)
    fake.runFor(2 * msPerDay)
    expect(day()).toBe(0)
  })

  it('waits for the tab to be visible when started hidden', () => {
    const store = createGameStore()
    const fake = createFakeHost({ hidden: true })
    startGameLoop(store, fake.host)
    expect(fake.pendingFrames()).toBe(0)
    expect(fake.visibilityListeners()).toBe(1)

    fake.setHidden(false)
    fake.deliverFrame()
    fake.runFor(msPerDay)
    expect(store.getState().game.day).toBe(1)
  })

  it('can stop and start again on the same store, as StrictMode does', () => {
    const store = createGameStore()
    const fake = createFakeHost()
    const day = () => store.getState().game.day

    const stopFirst = startGameLoop(store, fake.host)
    expect(fake.pendingFrames()).toBe(1)
    expect(fake.visibilityListeners()).toBe(1)
    stopFirst()
    expect(fake.pendingFrames()).toBe(0)
    expect(fake.visibilityListeners()).toBe(0)

    const stopSecond = startGameLoop(store, fake.host)
    expect(fake.pendingFrames()).toBe(1)
    expect(fake.visibilityListeners()).toBe(1)
    fake.deliverFrame()
    fake.runFor(msPerDay)
    expect(day()).toBe(1)
    expect(fake.pendingFrames()).toBe(1)

    stopSecond()
    expect(fake.pendingFrames()).toBe(0)
    expect(fake.visibilityListeners()).toBe(0)
    fake.setHidden(true)
    fake.setHidden(false)
    fake.runFor(msPerDay)
    expect(fake.pendingFrames()).toBe(0)
    expect(day()).toBe(1)
  })
})
