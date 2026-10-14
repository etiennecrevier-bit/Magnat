import { describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { NORMAL_SPEED, PAUSED, createGameStore } from './store.ts'

describe('createGameStore', () => {
  it('starts a new game on day 0, running at normal speed', () => {
    const { game, speed, lastSpeed } = createGameStore().getState()
    expect(game).toEqual(createInitialState(game.seed))
    expect(speed).toBe(NORMAL_SPEED)
    expect(lastSpeed).toBe(NORMAL_SPEED)
  })

  it('can start from a given state', () => {
    const game = { ...createInitialState(7), day: 42 }
    expect(createGameStore(game).getState().game).toEqual(game)
  })
})

describe('setSpeed', () => {
  it('remembers every speed but pause as the last speed', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    expect(store.getState()).toMatchObject({ speed: 10, lastSpeed: 10 })
    store.getState().setSpeed(PAUSED)
    expect(store.getState()).toMatchObject({ speed: PAUSED, lastSpeed: 10 })
  })
})

describe('togglePause', () => {
  it('pauses, then resumes at the last speed used', () => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(3)
  })

  it('resumes at the last speed after the pause button', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().setSpeed(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(10)
  })
})

describe('advance', () => {
  it('ticks the given number of days with one update', () => {
    const start = Object.freeze(createInitialState(1))
    const store = createGameStore(start)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(5)

    let expected = start
    for (let i = 0; i < 5; i += 1) expected = tick(expected)
    expect(store.getState().game).toEqual(expected)
    expect(store.getState().game.day).toBe(5)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(start).toEqual(createInitialState(1))
  })

  it('does nothing for zero days', () => {
    const store = createGameStore()
    const before = store.getState().game
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(0)

    expect(store.getState().game).toBe(before)
    expect(listener).not.toHaveBeenCalled()
  })
})
