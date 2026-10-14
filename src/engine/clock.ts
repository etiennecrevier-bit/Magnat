import { seedRng } from './rng.ts'
import type { Day, GameState } from './types.ts'

// The game calendar: 365-day years with real month lengths and no leap years.
// Day 0 is Monday, May 1st, year 1, when food truck season starts. These are
// calendar facts, not tunables, so they stay here rather than in src/content/.
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const DAYS_PER_YEAR = MONTH_LENGTHS.reduce((total, length) => total + length, 0)
const DAYS_PER_WEEK = 7
const START_YEAR = 1
const START_MONTH = 5
const START_WEEKDAY = 1
/** Days from January 1st to the start date, so day 0 is this day of year 1. */
const START_DAY_OF_YEAR = MONTH_LENGTHS.slice(0, START_MONTH - 1).reduce(
  (total, length) => total + length,
  0,
)

/**
 * A game day as people read it. Every field counts from 1: `year` from 1,
 * `month` 1–12 (1 = January), `dayOfMonth` 1–31 and `weekday` in ISO 8601
 * order, 1 = Monday to 7 = Sunday.
 */
export interface CalendarDate {
  year: number
  month: number
  dayOfMonth: number
  weekday: number
}

/**
 * Starts a game on day 0 with its generator seeded from `seed`. Throws a
 * RangeError unless `seed` is an integer in [0, 2^32).
 */
export function createInitialState(seed: number): GameState {
  return { day: 0, seed, rngState: seedRng(seed) }
}

/** Advances the game by one day. Returns a new state; never mutates `state`. */
export function tick(state: GameState): GameState {
  return { ...state, day: state.day + 1 }
}

/** Throws a RangeError unless `day` is a non-negative safe integer. */
export function toCalendar(day: Day): CalendarDate {
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new RangeError(`Invalid game day: ${day}`)
  }

  // Take whole years out before adding the start offset, so the arithmetic
  // stays exact up to the largest safe day.
  const dayInYear = day % DAYS_PER_YEAR
  let year = START_YEAR + (day - dayInYear) / DAYS_PER_YEAR
  let dayOfYear = START_DAY_OF_YEAR + dayInYear
  if (dayOfYear >= DAYS_PER_YEAR) {
    year += 1
    dayOfYear -= DAYS_PER_YEAR
  }

  let month = 1
  let dayOfMonth = dayOfYear + 1
  for (const length of MONTH_LENGTHS) {
    if (dayOfMonth <= length) break
    dayOfMonth -= length
    month += 1
  }

  const weekday =
    ((START_WEEKDAY - 1 + (day % DAYS_PER_WEEK)) % DAYS_PER_WEEK) + 1

  return { year, month, dayOfMonth, weekday }
}
