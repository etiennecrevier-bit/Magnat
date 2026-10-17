import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createInitialState,
  startChallenge,
  tick,
  toCalendar,
} from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision } from '../engine/decisions.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents } from '../engine/money.ts'
import { defaultProfile } from '../engine/profile.ts'
import type { Day, GameState } from '../engine/types.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
import { createSaveWriter, readStoredSave, type SaveStorage } from './saves.ts'
import { createGameStore, newGame } from './store.ts'

// Day 0 is May 1st: May has 31 days, so day 30 is May 31st and day 31 is
// June 1st.
const LAST_OF_MAY = 30

/** A fake page: a visibility flag the test flips. */
function createFakeHost() {
  let hidden = false
  const listeners = new Set<() => void>()
  const host: AutosaveHost = {
    isHidden: () => hidden,
    onVisibilityChange: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
  return {
    host,
    setHidden(value: boolean) {
      hidden = value
      for (const listener of [...listeners]) listener()
    },
    listeners: () => listeners.size,
  }
}

/** A store with no event card to stop the days, and autosave started. */
function start() {
  const store = createGameStore(createInitialState(42), NO_EVENTS)
  const write = vi.fn<(game: GameState, replaces: boolean) => void>()
  const page = createFakeHost()
  const stop = startAutosave(store, write, page.host)
  const days = () => write.mock.calls.map(([game]) => game.day)
  return { store, write, page, stop, days }
}

describe('startAutosave', () => {
  it('saves the game as soon as it starts', () => {
    const { store, write } = start()
    expect(write).toHaveBeenCalledExactlyOnceWith(store.getState().game, false)
  })

  it('does not save again within the same month', () => {
    const { store, days } = start()
    store.getState().advance(LAST_OF_MAY)
    expect(toCalendar(store.getState().game.day).month).toBe(5)
    expect(days()).toEqual([0])
  })

  it('saves on the first day of each new month', () => {
    const { store, days } = start()
    store.getState().advance(LAST_OF_MAY + 1)
    expect(toCalendar(31)).toMatchObject({ month: 6, dayOfMonth: 1 })
    store.getState().advance(29)
    store.getState().advance(1)
    expect(toCalendar(61)).toMatchObject({ month: 7, dayOfMonth: 1 })
    expect(days()).toEqual([0, 31, 61])
  })

  it('saves once when the days of one frame cross into a new month', () => {
    const { store, days } = start()
    store.getState().advance(LAST_OF_MAY - 5)
    store.getState().advance(10)
    expect(days()).toEqual([0, 35])
  })

  it('saves a game started over in another month', () => {
    const { store, days } = start()
    store.getState().startGame({ ...createInitialState(7), day: 100 })
    expect(days()).toEqual([0, 100])
  })

  it('saves a game started in place at once, though it is of the same month', () => {
    const { store, write } = start()
    store.getState().advance(10)
    const imported = createInitialState(7)
    store.getState().startGame(imported)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith(imported, true)
    // The month it saved in is that game's.
    store.getState().advance(LAST_OF_MAY)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('tells the writer only a game started in place replaces the saved one', () => {
    const { store, write, page } = start()
    store.getState().advance(LAST_OF_MAY + 1)
    page.setHidden(true)
    store.getState().startGame(createInitialState(7))
    page.setHidden(false)
    page.setHidden(true)
    store.getState().advance(LAST_OF_MAY + 1)
    expect(
      write.mock.calls.map(([game, replaces]) => [game.day, replaces]),
    ).toEqual([
      [0, false],
      [31, false],
      [31, false],
      [0, true],
      [0, false],
      [31, false],
    ])
  })

  it('ignores store changes that leave the game alone', () => {
    const { store, write } = start()
    store.getState().setSpeed(10)
    store.getState().togglePause()
    expect(write).toHaveBeenCalledOnce()
  })

  it('saves whenever the page is hidden, not when it is shown', () => {
    const { store, page, days } = start()
    store.getState().advance(3)
    page.setHidden(true)
    expect(days()).toEqual([0, 3])
    page.setHidden(false)
    expect(days()).toEqual([0, 3])
    page.setHidden(true)
    expect(days()).toEqual([0, 3, 3])
  })

  it('stops for good', () => {
    const { store, page, write, stop } = start()
    stop()
    store.getState().advance(LAST_OF_MAY + 1)
    page.setHidden(true)
    expect(write).toHaveBeenCalledOnce()
    expect(page.listeners()).toBe(0)
  })

  it('never saves a Défi, which would replace the long game', () => {
    // « Les travaux de la rue Saint-Denis » crosses into June.
    const store = createGameStore(
      startChallenge('travauxSaintDenis', 42),
      NO_EVENTS,
    )
    const write = vi.fn<(game: GameState, replaces: boolean) => void>()
    const page = createFakeHost()
    startAutosave(store, write, page.host)
    store.getState().advance(LAST_OF_MAY)
    page.setHidden(true)
    expect(toCalendar(store.getState().game.day).month).toBe(6)
    expect(write).not.toHaveBeenCalled()
  })

  it('saves the game that follows a Défi in the same store', () => {
    const store = createGameStore(
      startChallenge('travauxSaintDenis', 42),
      NO_EVENTS,
    )
    const write = vi.fn<(game: GameState, replaces: boolean) => void>()
    startAutosave(store, write, createFakeHost().host)
    const long = createInitialState(42)
    store.getState().startGame(long)
    store.getState().advance(LAST_OF_MAY + 1)
    expect(write.mock.calls).toEqual([
      [long, true],
      [store.getState().game, false],
    ])
  })
})

/** One `localStorage` that every tab of the browser shares. */
function sharedStorage(): SaveStorage {
  const items = new Map<string, string>()
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
}

/**
 * A tab playing `game`, autosaving into `storage` as App does: `failed()` is
 * whether its last save failed, which shows App's banner.
 */
function openTab(storage: SaveStorage, game: GameState) {
  const store = createGameStore(game, NO_EVENTS)
  const page = createFakeHost()
  const save = createSaveWriter(storage)
  let failed = false
  const stop = startAutosave(
    store,
    (saved, replaces) => {
      failed = !save(saved, replaces)
    },
    page.host,
  )
  return { store, page, stop, failed: () => failed }
}

/** The game a tab gets from « Continuer ». */
function continued(storage: SaveStorage): GameState {
  const stored = readStoredSave(storage)
  if (stored.status !== 'found') throw new Error('nothing to continue')
  return stored.game
}

function storedDay(storage: SaveStorage): Day | null {
  const stored = readStoredSave(storage)
  return stored.status === 'found' ? stored.game.day : null
}

describe('startAutosave in two tabs on the same game', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the newer days when the tab behind is hidden last', () => {
    const storage = sharedStorage()
    const tabA = openTab(storage, createInitialState(5))
    tabA.store.getState().advance(8)

    // Tab B continues the stored game and plays further than tab A.
    const tabB = openTab(storage, continued(storage))
    tabB.store.getState().advance(LAST_OF_MAY)
    tabB.page.setHidden(true)
    tabB.stop()
    expect(storedDay(storage)).toBe(LAST_OF_MAY)

    // Tab A, still on day 8, is closed last.
    tabA.page.setHidden(true)
    tabA.stop()
    expect(storedDay(storage)).toBe(LAST_OF_MAY)
    expect(tabA.failed()).toBe(true)
  })

  it('keeps the newer days when the tab ahead is hidden last', () => {
    const storage = sharedStorage()
    const tabA = openTab(storage, createInitialState(5))
    const tabB = openTab(storage, continued(storage))
    tabA.store.getState().advance(12)
    tabB.store.getState().advance(LAST_OF_MAY)

    // Tab A, behind, is closed first.
    tabA.page.setHidden(true)
    tabA.stop()
    expect(storedDay(storage)).toBe(12)

    tabB.page.setHidden(true)
    tabB.stop()
    expect(storedDay(storage)).toBe(LAST_OF_MAY)
    expect(tabB.failed()).toBe(false)
  })
})

describe('startAutosave and a bankruptcy (#160)', () => {
  /**
   * Seed 7 at Difficile, its owner paying themself 3 000 $ a week from day
   * 1: the close of November 30th, day 213, ends it. The morning of
   * November 24th, day 207, played with no event.
   */
  function nearTheEnd(): GameState {
    let game = applyDecision(
      createInitialState(7, FOOD_TRUCK, {
        ...defaultProfile(),
        difficulty: 'difficile',
      }),
      { kind: 'ownerWeeklyPay', pay: cents(300_000) },
    )
    while (game.day < 207) game = tick(game)
    return game
  }
  const NEAR_THE_END = nearTheEnd()
  const END = { reason: 'bankruptcy', day: 213 } as const

  /** The morning after the end, played in a store. */
  function ended(): GameState {
    const store = createGameStore(NEAR_THE_END, NO_EVENTS)
    store.getState().advance(20)
    return store.getState().game
  }

  function watched(game: GameState) {
    const store = createGameStore(game, NO_EVENTS)
    const write = vi.fn<(game: GameState, replaces: boolean) => void>()
    const page = createFakeHost()
    startAutosave(store, write, page.host)
    return { store, write, page }
  }

  it('saves the game the morning it ends, then never again', () => {
    const { store, write, page } = watched(NEAR_THE_END)
    store.getState().advance(20)
    const over = store.getState().game
    expect(over.ended).toEqual(END)
    page.setHidden(true)
    page.setHidden(false)
    page.setHidden(true)
    store.getState().advance(10)
    store.getState().closePanel()
    expect(write.mock.calls).toEqual([
      [NEAR_THE_END, false],
      [over, false],
    ])
  })

  it('saves no game continued already ended, but the one « Recommencer » starts in its place', () => {
    const { store, write, page } = watched(ended())
    page.setHidden(true)
    expect(write).not.toHaveBeenCalled()
    const next = newGame('?seed=8', NEAR_THE_END.profile)
    store.getState().startGame(next)
    expect(write.mock.calls).toEqual([[next, true]])
  })

  it('saves a game that went bankrupt started in place of another, once', () => {
    const first = createInitialState(42)
    const { store, write, page } = watched(first)
    const over = ended()
    store.getState().startGame(over)
    page.setHidden(true)
    expect(write.mock.calls).toEqual([
      [first, false],
      [over, true],
    ])
  })

  it('leaves the game ended in the browser, so « Continuer » shows its end again', () => {
    const storage = sharedStorage()
    const tab = openTab(storage, NEAR_THE_END)
    tab.store.getState().advance(20)
    tab.page.setHidden(true)
    tab.stop()
    const back = continued(storage)
    expect(back.ended).toEqual(END)
    expect(createGameStore(back).getState().panel).toBe('bankruptcy')
  })
})
