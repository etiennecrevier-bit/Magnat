import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import type { GameState } from '../engine/types.ts'
import { createGameStore, type GameStore } from './store.ts'
import { hideSlideInAfter, slideInWeek } from './weekSlideIn.ts'

const MS = 8000

/** A seed-1 game played with no event card to the morning of `day`. */
function playedTo(day: number): GameState {
  let game = createInitialState(1)
  while (game.day < day) {
    game = tick(
      game,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
    )
  }
  return game
}

const DAY_7 = playedTo(7)
const DAY_14 = playedTo(14)

/** A store on day 7 with the card of the week of day 0 sliding in. */
function sliding(): GameStore {
  const store = createGameStore(DAY_7, NO_EVENTS)
  store.setState({ slideIn: 0 })
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('slideInWeek', () => {
  it('shows the last week while it slides in and no panel is open', () => {
    const store = sliding()
    expect(slideInWeek(store.getState())).toBe(DAY_7.lastWeek)
    store.getState().openPanel('finances')
    expect(slideInWeek(store.getState())).toBeNull()
    store.getState().closePanel()
    expect(slideInWeek(store.getState())).toBe(DAY_7.lastWeek)
  })

  it('shows nothing when no card slides in, or for a week the game has left', () => {
    expect(slideInWeek(createGameStore(DAY_7).getState())).toBeNull()
    const store = sliding()
    store.setState({ slideIn: 7 })
    expect(slideInWeek(store.getState())).toBeNull()
  })
})

describe('hideSlideInAfter', () => {
  it('takes the card away once it has shown for the time given', () => {
    const store = sliding()
    hideSlideInAfter(store, MS)
    vi.advanceTimersByTime(MS - 1)
    expect(store.getState().slideIn).toBe(0)
    vi.advanceTimersByTime(1)
    expect(store.getState().slideIn).toBeNull()
  })

  it('counts only while the card shows, from the start again after a panel', () => {
    const store = sliding()
    hideSlideInAfter(store, MS)
    vi.advanceTimersByTime(5000)
    store.getState().openPanel('manage')
    vi.advanceTimersByTime(3 * MS)
    expect(store.getState().slideIn).toBe(0)

    store.getState().closePanel()
    vi.advanceTimersByTime(MS - 1)
    expect(store.getState().slideIn).toBe(0)
    vi.advanceTimersByTime(1)
    expect(store.getState().slideIn).toBeNull()
  })

  it('counts from the start again for the next week', () => {
    const store = sliding()
    hideSlideInAfter(store, MS)
    vi.advanceTimersByTime(5000)
    store.setState({ game: DAY_14, slideIn: 7 })
    vi.advanceTimersByTime(MS - 1)
    expect(store.getState().slideIn).toBe(7)
    vi.advanceTimersByTime(1)
    expect(store.getState().slideIn).toBeNull()
  })

  it('waits for a card to slide in, and stops when asked', () => {
    const store = createGameStore(DAY_7, NO_EVENTS)
    const stop = hideSlideInAfter(store, MS)
    vi.advanceTimersByTime(3 * MS)
    store.setState({ slideIn: 0 })
    vi.advanceTimersByTime(MS / 2)
    stop()
    vi.advanceTimersByTime(3 * MS)
    expect(store.getState().slideIn).toBe(0)
    store.setState({ slideIn: null })
    store.setState({ slideIn: 0 })
    vi.advanceTimersByTime(3 * MS)
    expect(store.getState().slideIn).toBe(0)
  })
})
