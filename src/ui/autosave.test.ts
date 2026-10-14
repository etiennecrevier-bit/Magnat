import { describe, expect, it, vi } from 'vitest'
import { createInitialState, toCalendar } from '../engine/clock.ts'
import type { GameState } from '../engine/types.ts'
import { startAutosave, type AutosaveHost } from './autosave.ts'
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

function start() {
  const store = createGameStore(createInitialState(42))
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
