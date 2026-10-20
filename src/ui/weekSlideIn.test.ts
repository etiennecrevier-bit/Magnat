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
import { hideSlideInAfter, slideInReport } from './weekSlideIn.ts'

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

/**
 * A store with the monthly report, on June 1st (day 31) with the card of
 * May sliding in.
 */
function monthSliding(): GameStore {
  const store = createGameStore(playedTo(29), NO_EVENTS, {
    everyWeek: () => false,
    cadence: () => 'month',
  })
  store.getState().advance(10)
  return store
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('slideInReport', () => {
  it('shows the last week while it slides in and no panel is open', () => {
    const store = sliding()
    expect(slideInReport(store.getState())).toBe(DAY_7.lastWeek)
    store.getState().openPanel('staff')
    expect(slideInReport(store.getState())).toBeNull()
    store.getState().closePanel()
    expect(slideInReport(store.getState())).toBe(DAY_7.lastWeek)
  })

  it('shows nothing when no card slides in, or for a week the game has left', () => {
    expect(slideInReport(createGameStore(DAY_7).getState())).toBeNull()
    const store = sliding()
    store.setState({ slideIn: 7 })
    expect(slideInReport(store.getState())).toBeNull()
  })

  it('shows the month while its card slides in and no panel is open', () => {
    const store = monthSliding()
    const { monthReport, game } = store.getState()
    expect(monthReport).not.toBeNull()
    expect(game.lastWeek?.firstDay).toBe(21)
    expect(slideInReport(store.getState())).toBe(monthReport)
    store.getState().openPanel('manage')
    expect(slideInReport(store.getState())).toBeNull()
    store.getState().closePanel()
    expect(slideInReport(store.getState())).toBe(monthReport)
  })

  it('shows the week, not the month, once a week came after it', () => {
    const store = monthSliding()
    store.setState({ reportShown: 'week', slideIn: 21 })
    expect(slideInReport(store.getState())).toBe(store.getState().game.lastWeek)
    store.setState({ slideIn: 0 })
    expect(slideInReport(store.getState())).toBeNull()
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

  it('keeps counting while the days go on under the month’s card, a week closing included', () => {
    const store = monthSliding()
    hideSlideInAfter(store, MS)
    vi.advanceTimersByTime(5000)
    for (let day = 32; day <= 35; day += 1) store.getState().advance(1)
    expect(store.getState()).toMatchObject({
      game: { day: 35, lastWeek: { firstDay: 28 } },
      slideIn: 0,
    })
    vi.advanceTimersByTime(MS - 5000 - 1)
    expect(store.getState().slideIn).toBe(0)
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
