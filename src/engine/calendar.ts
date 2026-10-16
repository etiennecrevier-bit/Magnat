import type { Day } from './types.ts'

// The game calendar: 365-day years with real month lengths and no leap years.
// Day 0 is Monday, May 1st, year 1, when food truck season starts. These are
// calendar facts, not tunables, so they stay here rather than in src/content/.
const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const MONTHS_PER_YEAR = MONTH_LENGTHS.length
const DAYS_PER_YEAR = MONTH_LENGTHS.reduce((total, length) => total + length, 0)
const DAYS_PER_WEEK = 7
const MONTHS_PER_QUARTER = 3
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

/**
 * The game day of `month` and `dayOfMonth` in year 1, the inverse of
 * `toCalendar` there: May 1st is day 0, December 31st day 244. Throws a
 * RangeError unless the date exists and falls on May 1st or later.
 */
export function dayOfDate({
  month,
  dayOfMonth,
}: Pick<CalendarDate, 'month' | 'dayOfMonth'>): Day {
  const length = MONTH_LENGTHS[month - 1]
  if (
    !Number.isSafeInteger(month) ||
    !Number.isSafeInteger(dayOfMonth) ||
    length === undefined ||
    dayOfMonth < 1 ||
    dayOfMonth > length ||
    month < START_MONTH
  ) {
    throw new RangeError(
      `Not a date of year 1 from May 1st: ${month}-${dayOfMonth}`,
    )
  }
  const dayOfYear = MONTH_LENGTHS.slice(0, month - 1).reduce(
    (total, days) => total + days,
    dayOfMonth - 1,
  )
  return dayOfYear - START_DAY_OF_YEAR
}

/**
 * The Monday that starts the week of `day`; day 0 is a Monday, so it is
 * never negative. Throws a RangeError unless `day` is a non-negative safe
 * integer.
 */
export function mondayOf(day: Day): Day {
  return day - (toCalendar(day).weekday - 1)
}

/**
 * The Sunday that ends the week of `day`. Throws a RangeError unless `day`
 * is a non-negative safe integer.
 */
export function sundayOf(day: Day): Day {
  return mondayOf(day) + DAYS_PER_WEEK - 1
}

/**
 * Calendar months from the month of day 0 to the month of `day`: 0 all
 * through the first May, 1 in June, 12 from May 1st of year 2. Throws a
 * RangeError unless `day` is a non-negative safe integer.
 */
export function monthsSinceStart(day: Day): number {
  const { year, month } = toCalendar(day)
  return (year - START_YEAR) * MONTHS_PER_YEAR + (month - START_MONTH)
}

/**
 * The last day of the calendar month `months` after the month of `day`: of
 * `day`'s own month for 0, of the next one for 1. Throws a RangeError unless
 * `day` and `months` are non-negative safe integers.
 */
export function endOfMonth(day: Day, months: number = 0): Day {
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new RangeError(`Invalid number of months: ${months}`)
  }
  const { month, dayOfMonth } = toCalendar(day)
  let end = day + lengthOf(month) - dayOfMonth
  for (let ahead = 1; ahead <= months; ahead += 1) {
    end += lengthOf(((month - 1 + ahead) % MONTHS_PER_YEAR) + 1)
  }
  return end
}

/**
 * The year of the game `day` falls in, counted in years of 365 days from
 * day 0, as the headless runs count them: 1 from day 0 to day 364, 2 from
 * day 365. Throws a RangeError unless `day` is a non-negative safe integer.
 */
export function gameYearOf(day: Day): number {
  if (!Number.isSafeInteger(day) || day < 0) {
    throw new RangeError(`Invalid game day: ${day}`)
  }
  return Math.floor(day / DAYS_PER_YEAR) + 1
}

/**
 * The first day of the calendar quarter of `day`, January 1st, April 1st,
 * July 1st or October 1st: negative for a day of year 1 before July, whose
 * quarter started before May 1st, day 0. Throws a RangeError unless `day`
 * is a non-negative safe integer.
 */
export function startOfQuarter(day: Day): Day {
  const { month, dayOfMonth } = toCalendar(day)
  const first = month - ((month - 1) % MONTHS_PER_QUARTER)
  let start = day - (dayOfMonth - 1)
  for (let earlier = first; earlier < month; earlier += 1) {
    start -= lengthOf(earlier)
  }
  return start
}

function lengthOf(month: number): number {
  const length = MONTH_LENGTHS[month - 1]
  if (length === undefined) throw new RangeError(`Invalid month: ${month}`)
  return length
}
