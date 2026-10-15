import { afterEach, describe, expect, it, vi } from 'vitest'
import eventsJson from '../content/events.json'
import { loadEventContent } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { resolveEvent } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { GameState, Profile } from '../engine/types.ts'
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
    expect(createGameStore().getState().panel).toBeNull()
    expect(createGameStore().getState().eventBefore).toBeNull()
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

  it('starts with the default profile', () => {
    expect(newGame('?seed=42').profile).toEqual(defaultProfile())
  })

  it.each<Profile>([
    { businessName: 'Café Facile', avatar: 'femme', difficulty: 'facile' },
    { businessName: "Le P'tit Camion", avatar: 'homme', difficulty: 'moyen' },
    { businessName: 'Chez Mimi', avatar: 'femme', difficulty: 'difficile' },
  ])('keeps the $difficulty profile the player picked', (profile) => {
    stubRandomSeed(123)
    expect(newGame('', profile)).toEqual(
      createInitialState(123, FOOD_TRUCK, profile),
    )
    expect(newGame('?seed=42', profile)).toEqual(
      createInitialState(42, FOOD_TRUCK, profile),
    )
  })

  it('rejects a profile the engine rejects', () => {
    stubRandomSeed(123)
    const profile = { ...defaultProfile(), businessName: '' }
    expect(() => newGame('?seed=42', profile)).toThrow(RangeError)
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

describe('startGame', () => {
  it('plays the game it is given, from normal speed', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().setSpeed(10)
    store.getState().setSpeed(PAUSED)
    const game = { ...createInitialState(7), day: 42 }

    store.getState().startGame(game)

    expect(store.getState()).toMatchObject({
      game,
      speed: NORMAL_SPEED,
      lastSpeed: NORMAL_SPEED,
    })
    store.getState().togglePause()
    store.getState().togglePause()
    expect(store.getState().speed).toBe(NORMAL_SPEED)
  })

  it('closes a panel left open, so the new game is not stuck paused', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().openPanel('manage')

    store.getState().startGame(createInitialState(7))

    expect(store.getState()).toMatchObject({
      speed: NORMAL_SPEED,
      resumeSpeed: null,
      panel: null,
    })
    store.getState().setSpeed(10)
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
    for (let i = 0; i < 5; i += 1) {
      expected = tick(
        expected,
        FOOD_TRUCK,
        CUSTOMERS,
        DIFFICULTIES,
        PERSONAL,
        ENERGY,
        EVENTS,
      )
    }
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

// The essai card alone on every morning from day 0: the shipped pacing and
// weight keep it out of a real game.
const ESSAI_EVERY_DAY = loadEventContent({
  ...eventsJson,
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
  events: eventsJson.events
    .filter(({ id }) => id === 'essai')
    .map((event) => ({ ...event, weight: 1 })),
})

function tickWithEssai(state: GameState): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    ESSAI_EVERY_DAY,
  )
}

/** Day 0 with the essai card waiting for the player's choice. */
function essaiWaiting(): GameState {
  const game = createInitialState(1)
  return {
    ...game,
    events: { ...game.events, pending: { event: 'essai', followUp: false } },
  }
}

describe('the event card', () => {
  it('opens on the morning an event comes up, pausing the game', () => {
    const start = createInitialState(1)
    const store = createGameStore(start, ESSAI_EVERY_DAY)
    store.getState().setSpeed(3)
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().advance(5)

    expect(store.getState().game).toEqual(tickWithEssai(start))
    expect(store.getState()).toMatchObject({
      game: { day: 1, events: { pending: { event: 'essai' } } },
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 3,
      lastSpeed: 3,
      eventBefore: null,
    })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('keeps the game from advancing before a choice', () => {
    const store = createGameStore(createInitialState(1), ESSAI_EVERY_DAY)
    store.getState().advance(1)
    const waiting = store.getState().game
    const listener = vi.fn()
    store.subscribe(listener)

    expect(() => store.getState().advance(3)).not.toThrow()
    store.getState().setSpeed(10)
    store.getState().togglePause()
    store.getState().openPanel('manage')
    store.getState().closePanel()

    expect(store.getState()).toMatchObject({
      game: waiting,
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
    })
    expect(listener).not.toHaveBeenCalled()
  })

  it('plays the choice through the engine, showing it until Continuer', () => {
    const store = createGameStore(createInitialState(1), ESSAI_EVERY_DAY)
    store.getState().setSpeed(10)
    store.getState().advance(1)
    const waiting = store.getState().game

    store.getState().chooseEvent('toutEssayer')

    expect(store.getState()).toMatchObject({
      game: resolveEvent(waiting, 'toutEssayer', ESSAI_EVERY_DAY),
      eventBefore: waiting,
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 10,
    })
    expect(store.getState().game.events.pending).toBeNull()
    store.getState().advance(1)
    store.getState().setSpeed(3)
    expect(store.getState().game.day).toBe(1)
    expect(store.getState().speed).toBe(PAUSED)

    store.getState().closePanel()

    expect(store.getState()).toMatchObject({
      speed: 10,
      lastSpeed: 10,
      resumeSpeed: null,
      panel: null,
      eventBefore: null,
    })
    store.getState().advance(1)
    expect(store.getState().game.day).toBe(2)
  })

  it('ignores a second choice', () => {
    const store = createGameStore(essaiWaiting(), ESSAI_EVERY_DAY)
    store.getState().chooseEvent('rienFaire')
    const chosen = store.getState()
    const listener = vi.fn()
    store.subscribe(listener)

    store.getState().chooseEvent('toutEssayer')

    expect(store.getState().game).toBe(chosen.game)
    expect(store.getState().eventBefore).toBe(chosen.eventBefore)
    expect(listener).not.toHaveBeenCalled()
  })

  it("throws the engine's error for a choice the event does not have", () => {
    const store = createGameStore(essaiWaiting(), ESSAI_EVERY_DAY)
    expect(() => store.getState().chooseEvent('inconnu')).toThrow(RangeError)
    expect(store.getState().game.events.pending).not.toBeNull()
  })

  it('opens, paused, for a game loaded with an event waiting', () => {
    const waiting = essaiWaiting()
    const expected = {
      game: waiting,
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: NORMAL_SPEED,
      lastSpeed: NORMAL_SPEED,
      eventBefore: null,
    }
    expect(createGameStore(waiting).getState()).toMatchObject(expected)

    const store = createGameStore(createInitialState(1))
    store.getState().setSpeed(10)
    store.getState().startGame(waiting)
    expect(store.getState()).toMatchObject(expected)
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState().speed).toBe(NORMAL_SPEED)
  })

  it('waits for a panel already open to close, then opens', () => {
    const store = createGameStore(createInitialState(1), ESSAI_EVERY_DAY)
    store.getState().setSpeed(10)
    store.getState().openPanel('finances')

    store.getState().advance(1)

    expect(store.getState()).toMatchObject({
      game: { day: 1, events: { pending: { event: 'essai' } } },
      panel: 'finances',
      speed: PAUSED,
      resumeSpeed: 10,
    })
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({
      panel: 'event',
      speed: PAUSED,
      resumeSpeed: 10,
    })
    store.getState().chooseEvent('rienFaire')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ panel: null, speed: 10 })
  })

  it('stops the days on the morning a shipped card comes up, never before the first day', () => {
    const store = createGameStore(createInitialState(1))
    store.getState().advance(60)
    const { game, panel, speed } = store.getState()
    expect(game.events.pending).not.toBeNull()
    expect(game.events.history).toEqual([])
    expect(game.day).toBeGreaterThanOrEqual(EVENTS.pacing.firstDay)
    expect(game.day).toBeLessThan(60)
    expect(panel).toBe('event')
    expect(speed).toBe(PAUSED)
  })
})

describe('openPanel and closePanel', () => {
  it.each(['manage', 'finances'] as const)(
    'pause the game while the %s panel is open, then resume at its speed',
    (panel) => {
      const store = createGameStore()
      store.getState().setSpeed(3)
      store.getState().openPanel(panel)
      expect(store.getState()).toMatchObject({
        speed: PAUSED,
        resumeSpeed: 3,
        panel,
      })
      store.getState().closePanel()
      expect(store.getState()).toMatchObject({
        speed: 3,
        lastSpeed: 3,
        resumeSpeed: null,
        panel: null,
      })
    },
  )

  it('keep the first panel open when another is asked for', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().openPanel('finances')
    store.getState().openPanel('manage')
    expect(store.getState()).toMatchObject({
      panel: 'finances',
      resumeSpeed: 10,
    })
  })

  it('leave a paused game paused', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().togglePause()
    store.getState().openPanel('manage')
    store.getState().closePanel()
    expect(store.getState()).toMatchObject({ speed: PAUSED, lastSpeed: 10 })
    store.getState().togglePause()
    expect(store.getState().speed).toBe(10)
  })

  it('keep the speed from before the panel when it is opened twice', () => {
    const store = createGameStore()
    store.getState().setSpeed(10)
    store.getState().openPanel('manage')
    store.getState().openPanel('manage')
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
    store.getState().openPanel('manage')
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
    store.getState().openPanel('manage')

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
