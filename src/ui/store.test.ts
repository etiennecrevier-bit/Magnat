import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
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
    expect(createGameStore().getState().resumeSpeed).toBeNull()
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

describe('openPanel and closePanel', () => {
  it('pause the game while a panel is open, then resume at its speed', () => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    store.getState().openPanel()
    expect(store.getState()).toMatchObject({ speed: PAUSED, resumeSpeed: 3 })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      speed: 3,
      lastSpeed: 3,
      resumeSpeed: null,
    })
  })

  it('leave a paused game paused', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().togglePause()
    store.getState().openPanel()
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ speed: PAUSED, lastSpeed: 10 })
    store.getState().togglePause()
    expect(store.getState().speed).toBe(10)
  })

  it('keep the speed from before the panel when it is opened twice', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().openPanel()
    store.getState().openPanel()
    store.getState().closePanel()
    expect(store.getState().speed).toBe(10)
  })

  it('do nothing when no panel is open', () => {
    const store = createGameStore()
    store.getState().setSpeed(3)
    const listener = vi.fn()
    store.subscribe(listener)
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ speed: 3, resumeSpeed: null })
    expect(listener).not.toHaveBeenCalled()
  })

  it('keep the game paused against the speed buttons and Space', () => {
    const store = createGameStore()
    store.getState().openPanel()
    store.getState().setSpeed(10)
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().togglePause()
    expect(store.getState().speed).toBe(PAUSED)
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      speed: NORMAL_SPEED,
      lastSpeed: NORMAL_SPEED,
    })
  })
})

describe('decide', () => {
  it('leaves the change waiting for the next morning', () => {
    const start = createInitialState(1)
    const store = createGameStore(start)
    store.getState().setSpeed(3)
    store.getState().openPanel()

    store
      .getState()
      .decide({ kind: 'price', product: 'cafe', price: cents(300) })
    store.getState().decide({ kind: 'marketingDaily', budget: cents(1500) })

    const { game, speed, resumeSpeed } = store.getState()
    expect(game.decisions).toEqual(start.decisions)
    expect(game.pendingDecisions).toEqual({
      ...start.decisions,
      prices: { ...start.decisions.prices, cafe: 300 },
      marketingDaily: 1500,
    })
    expect({ speed, resumeSpeed }).toEqual({ speed: PAUSED, resumeSpeed: 3 })
  })

  it("throws the engine's error for a change outside the limits", () => {
    const store = createGameStore(createInitialState(1))
    expect(() =>
      store
        .getState()
        .decide({ kind: 'price', product: 'cafe', price: cents(1) }),
    ).toThrow(RangeError)
    expect(store.getState().game.pendingDecisions).toBeNull()
  })
})
