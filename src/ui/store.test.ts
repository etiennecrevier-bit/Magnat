import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  NORMAL_SPEED,
  PAUSED,
  createGameStore,
  newGame,
  seedFromSearch,
} from './store.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Makes `crypto.getRandomValues` return `seed`, the random seed's source. */
function stubRandomSeed(seed: number) {
  return vi
    .spyOn(crypto, 'getRandomValues')
    .mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array) array.fill(seed)
      return array
    })
}

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

describe('seedFromSearch', () => {
  it.each([
    ['?seed=42', 42],
    ['?seed=0', 0],
    ['?x=1&seed=7', 7],
    ['?seed=4294967295', 4294967295],
    ['?seed=4294967296', 4294967296],
  ])('reads %s as %d', (search, seed) => {
    expect(seedFromSearch(search)).toBe(seed)
  })

  it.each([
    '',
    '?x=1',
    '?seed=',
    '?seed=-1',
    '?seed=1.5',
    '?seed=1e3',
    '?seed=0x2a',
    '?seed=%207',
    '?seed=+7',
    `?seed=${'9'.repeat(400)}`,
  ])('finds no seed in "%s"', (search) => {
    expect(seedFromSearch(search)).toBeNull()
  })
})

describe('newGame', () => {
  it.each([
    ['?seed=42', 42],
    ['?seed=0', 0],
    ['?x=1&seed=7', 7],
    ['?seed=4294967295', 4294967295],
  ])('starts %s on seed %d, without drawing one', (search, seed) => {
    const random = stubRandomSeed(123)
    expect(newGame(search)).toEqual(createInitialState(seed))
    expect(random).not.toHaveBeenCalled()
  })

  it.each([
    '',
    '?seed=',
    '?seed=-1',
    '?seed=1.5',
    '?seed=1e3',
    '?seed=0x2a',
    '?seed=%207',
    '?seed=4294967296',
    `?seed=${'9'.repeat(400)}`,
  ])('starts "%s" on a random seed', (search) => {
    const random = stubRandomSeed(123)
    expect(newGame(search)).toEqual(createInitialState(123))
    expect(random).toHaveBeenCalledTimes(1)
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
