import { Ticker, UPDATE_PRIORITY } from 'pixi.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  animating,
  startFrameGate,
  type FrameState,
  type GateHost,
} from './frameGate.ts'

const WALKING = [1, 3]

const PLAYED: FrameState = {
  hidden: false,
  playing: true,
  covered: false,
  speed: 1,
  view: 'street',
}

describe('animating', () => {
  it('moves the street at ×1 and ×3 only, in a game shown', () => {
    expect(animating(PLAYED, WALKING)).toBe(true)
    expect(animating({ ...PLAYED, speed: 3 }, WALKING)).toBe(true)
    expect(animating({ ...PLAYED, speed: 0 }, WALKING)).toBe(false)
    expect(animating({ ...PLAYED, speed: 10 }, WALKING)).toBe(false)
  })

  it('moves the city at any speed but paused', () => {
    const city = { ...PLAYED, view: 'city' as const }
    expect(animating({ ...city, speed: 10 }, WALKING)).toBe(true)
    expect(animating({ ...city, speed: 0 }, WALKING)).toBe(false)
  })

  it.each([
    ['on the start menu', { playing: false }],
    ['in a hidden tab', { hidden: true }],
    ['under a full-screen panel', { covered: true }],
  ])('stands still %s', (_, change) => {
    expect(animating({ ...PLAYED, ...change }, WALKING)).toBe(false)
    expect(animating({ ...PLAYED, ...change, view: 'city' }, WALKING)).toBe(
      false,
    )
  })
})

/**
 * The fake clock, with the browser's frames on it every 16 ms, which Node
 * has none of.
 */
function fakeFrames(): void {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'performance'],
  })
  vi.stubGlobal('requestAnimationFrame', (onFrame: FrameRequestCallback) =>
    setTimeout(() => onFrame(performance.now()), 16),
  )
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
}

/** Pixi's ticker on the fake clock, with a render counted as Pixi adds it. */
function gated(state: { current: FrameState }, rate = { current: 30 }) {
  const ticker = new Ticker()
  let renders = 0
  const frames: number[] = []
  ticker.add((t) => frames.push(t.deltaMS))
  ticker.add(() => (renders += 1), null, UPDATE_PRIORITY.LOW)
  const host: GateHost = {
    requestFrame: (onFrame) => requestAnimationFrame(() => onFrame()),
    cancelFrame: (id) => cancelAnimationFrame(id),
  }
  const gate = startFrameGate(
    ticker,
    () => state.current,
    () => rate.current,
    WALKING,
    host,
  )
  return { ticker, gate, renders: () => renders, frames }
}

describe('startFrameGate', () => {
  beforeEach(() => {
    fakeFrames()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it.each([
    ['on the start menu', { playing: false }],
    ['paused', { speed: 0 }],
  ])('draws one frame, then none for 5 s, %s', (_, change) => {
    const state = { current: { ...PLAYED, ...change } }
    const { ticker, renders } = gated(state)
    expect(ticker.started).toBe(false)
    vi.advanceTimersByTime(100)
    expect(renders()).toBe(1)
    vi.advanceTimersByTime(5000)
    expect(renders()).toBe(1)
  })

  it('draws exactly one frame for a change, however many come before it', () => {
    const state = { current: { ...PLAYED, speed: 0 } }
    const { gate, renders, frames } = gated(state)
    vi.advanceTimersByTime(1000)
    expect(renders()).toBe(1)
    gate.invalidate()
    gate.invalidate()
    gate.invalidate()
    vi.advanceTimersByTime(1000)
    expect(renders()).toBe(2)
    // Nothing that moves with time moves in that frame.
    expect(frames.at(-1)).toBeLessThanOrEqual(1)
  })

  it('runs at most at the player’s rate while customers walk', () => {
    const state = { current: PLAYED }
    const rate = { current: 30 }
    const { ticker, renders } = gated(state, rate)
    expect(ticker.started).toBe(true)
    vi.advanceTimersByTime(1000)
    const at30 = renders()
    expect(at30).toBeGreaterThan(20)
    expect(at30).toBeLessThanOrEqual(31)
    expect(ticker.maxFPS).toBe(30)
  })

  it('runs faster at 60 images a second', () => {
    const state = { current: PLAYED }
    const rate = { current: 60 }
    const { renders, ticker } = gated(state, rate)
    vi.advanceTimersByTime(1000)
    expect(ticker.maxFPS).toBe(60)
    expect(renders()).toBeGreaterThan(40)
  })

  it('stops when the tab hides, and goes on when it shows', () => {
    const state = { current: PLAYED }
    const { ticker, gate, renders } = gated(state)
    vi.advanceTimersByTime(500)
    state.current = { ...PLAYED, hidden: true }
    gate.invalidate()
    expect(ticker.started).toBe(false)
    vi.advanceTimersByTime(100)
    const hidden = renders()
    vi.advanceTimersByTime(5000)
    expect(renders()).toBe(hidden)
    state.current = PLAYED
    gate.invalidate()
    expect(ticker.started).toBe(true)
    vi.advanceTimersByTime(1000)
    expect(renders()).toBeGreaterThan(hidden + 20)
  })

  it('leaves the ticker running, as Pixi had it, once stopped', () => {
    const state = { current: { ...PLAYED, speed: 0 } }
    const { ticker, gate } = gated(state)
    gate.stop()
    expect(ticker.started).toBe(true)
    gate.invalidate()
    expect(ticker.started).toBe(true)
    ticker.stop()
  })
})
