import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, toCalendar } from '../engine/clock.ts'
import { NO_EVENTS } from '../engine/events.ts'
import type { Day, GameState } from '../engine/types.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
import { createSaveWriter, readStoredSave, type SaveStorage } from './saves.ts'
import { createGameStore } from './store.ts'

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
  const write = vi.fn<(game: GameState) => void>()
  const page = createFakeHost()
  const stop = startAutosave(store, write, page.host)
  const days = () => write.mock.calls.map(([game]) => game.day)
  return { store, write, page, stop, days }
}

describe('startAutosave', () => {
  it('saves the game as soon as it starts', () => {
    const { store, write } = start()
    expect(write).toHaveBeenCalledExactlyOnceWith(store.getState().game)
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

/** A tab playing `game`, autosaving into `storage` as App does. */
function openTab(storage: SaveStorage, game: GameState) {
  const store = createGameStore(game, NO_EVENTS)
  const page = createFakeHost()
  const stop = startAutosave(store, createSaveWriter(storage), page.host)
  return { store, page, stop }
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
    const continued = readStoredSave(storage)
    if (continued.status !== 'found') throw new Error('nothing to continue')
    const tabB = openTab(storage, continued.game)
    tabB.store.getState().advance(LAST_OF_MAY)
    tabB.page.setHidden(true)
    tabB.stop()
    expect(storedDay(storage)).toBe(LAST_OF_MAY)

    // Tab A, still on day 8, is closed last.
    tabA.page.setHidden(true)
    tabA.stop()
    expect(storedDay(storage)).toBe(LAST_OF_MAY)
  })
})
