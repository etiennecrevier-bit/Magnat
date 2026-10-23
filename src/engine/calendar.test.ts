import { describe, expect, it } from 'vitest'
import {
  dayOfDate,
  endOfMonth,
  gameYearOf,
  mondayOf,
  monthsSinceStart,
  onDates,
  startOfNextGameYear,
  startOfQuarter,
  sundayOf,
  toCalendar,
  type CalendarDate,
} from './calendar.ts'
import type { Day } from './types.ts'

// Month lengths of a non-leap year, kept apart from calendar.ts so the
// ten-year walk checks it against an independent spec.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

describe('toCalendar', () => {
  const cases: { when: string; day: Day; date: CalendarDate }[] = [
    {
      when: 'day 0 is Monday, May 1st, year 1',
      day: 0,
      date: { year: 1, month: 5, dayOfMonth: 1, weekday: 1 },
    },
    {
      when: 'the first Sunday is May 7th',
      day: 6,
      date: { year: 1, month: 5, dayOfMonth: 7, weekday: 7 },
    },
    {
      when: 'the week rolls over to Monday on May 8th',
      day: 7,
      date: { year: 1, month: 5, dayOfMonth: 8, weekday: 1 },
    },
    {
      when: 'May ends on the 31st',
      day: 30,
      date: { year: 1, month: 5, dayOfMonth: 31, weekday: 3 },
    },
    {
      when: 'June follows May',
      day: 31,
      date: { year: 1, month: 6, dayOfMonth: 1, weekday: 4 },
    },
    {
      when: 'year 1 ends on December 31st',
      day: 244,
      date: { year: 1, month: 12, dayOfMonth: 31, weekday: 7 },
    },
    {
      when: 'year 2 starts on January 1st',
      day: 245,
      date: { year: 2, month: 1, dayOfMonth: 1, weekday: 1 },
    },
    {
      when: 'February has 28 days',
      day: 303,
      date: { year: 2, month: 2, dayOfMonth: 28, weekday: 3 },
    },
    {
      when: 'March 1st follows February 28th, with no leap day',
      day: 304,
      date: { year: 2, month: 3, dayOfMonth: 1, weekday: 4 },
    },
    {
      when: 'the season starts again on May 1st, year 2',
      day: 365,
      date: { year: 2, month: 5, dayOfMonth: 1, weekday: 2 },
    },
    {
      when: 'the largest safe day still gets an exact date',
      day: Number.MAX_SAFE_INTEGER,
      date: { year: 24677258232168, month: 6, dayOfMonth: 6, weekday: 4 },
    },
  ]

  it.each(cases)('$when', ({ day, date }) => {
    expect(toCalendar(day)).toEqual(date)
  })

  it('advances one calendar day at a time for ten years', () => {
    let previous = toCalendar(0)
    for (let day = 1; day <= 3650; day += 1) {
      const { year, month, dayOfMonth, weekday } = previous
      const endOfMonth = dayOfMonth === DAYS_IN_MONTH[month - 1]
      const endOfYear = endOfMonth && month === 12
      const date = toCalendar(day)
      expect(date).toEqual({
        year: endOfYear ? year + 1 : year,
        month: endOfMonth ? (month % 12) + 1 : month,
        dayOfMonth: endOfMonth ? 1 : dayOfMonth + 1,
        weekday: (weekday % 7) + 1,
      })
      previous = date
    }
  })

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('rejects day %s', (day) => {
    expect(() => toCalendar(day)).toThrow(RangeError)
  })
})

describe('monthsSinceStart', () => {
  it.each([
    { when: 'all through the first May', days: [0, 30], months: 0 },
    { when: 'from June 1st, year 1', days: [31, 60], months: 1 },
    { when: 'in December, year 1', days: [214, 244], months: 7 },
    { when: 'in January, year 2', days: [245], months: 8 },
    { when: 'from May 1st, year 2', days: [365], months: 12 },
    { when: 'on May 1st, year 6', days: [1825], months: 60 },
    { when: 'on April 1st, year 11', days: [3620], months: 119 },
  ])('counts $months $when', ({ days, months }) => {
    for (const day of days) expect(monthsSinceStart(day)).toBe(months)
  })

  it('goes up by one on each 1st of the month, and only then, for ten years', () => {
    let previous = monthsSinceStart(0)
    for (let day = 1; day <= 3650; day += 1) {
      const months = monthsSinceStart(day)
      const isFirst = toCalendar(day).dayOfMonth === 1
      expect(months).toBe(isFirst ? previous + 1 : previous)
      previous = months
    }
    // Ten years from day 0 to day 3650, May 1st, year 11.
    expect(previous).toBe(120)
  })

  it.each([-1, 1.5, Number.NaN])('rejects day %s', (day) => {
    expect(() => monthsSinceStart(day)).toThrow(RangeError)
  })
})

describe('mondayOf and sundayOf', () => {
  it.each([
    { when: 'the first Monday is day 0', day: 0, monday: 0, sunday: 6 },
    {
      when: 'the first Sunday ends the first week',
      day: 6,
      monday: 0,
      sunday: 6,
    },
    { when: 'the second week starts on day 7', day: 7, monday: 7, sunday: 13 },
    { when: 'June 1st is a Thursday', day: 31, monday: 28, sunday: 34 },
    {
      when: 'May 1st, year 2, is a Tuesday',
      day: 365,
      monday: 364,
      sunday: 370,
    },
  ])('$when', ({ day, monday, sunday }) => {
    expect(mondayOf(day)).toBe(monday)
    expect(sundayOf(day)).toBe(sunday)
  })

  it('give the Monday and the Sunday around each day for ten years', () => {
    for (let day = 0; day <= 3650; day += 1) {
      const monday = mondayOf(day)
      const sunday = sundayOf(day)
      expect(toCalendar(monday).weekday).toBe(1)
      expect(toCalendar(sunday).weekday).toBe(7)
      expect(monday).toBeLessThanOrEqual(day)
      expect(sunday - monday).toBe(6)
      expect(sunday).toBeGreaterThanOrEqual(day)
    }
  })

  it.each([-1, 1.5, Number.NaN])('reject day %s', (day) => {
    expect(() => mondayOf(day)).toThrow(RangeError)
    expect(() => sundayOf(day)).toThrow(RangeError)
  })
})

describe('dayOfDate', () => {
  it.each([
    { month: 5, dayOfMonth: 1, day: 0 },
    { month: 5, dayOfMonth: 15, day: 14 },
    { month: 6, dayOfMonth: 1, day: 31 },
    { month: 7, dayOfMonth: 10, day: 70 },
    { month: 12, dayOfMonth: 31, day: 244 },
  ])('puts $month-$dayOfMonth of year 1 on day $day', (date) => {
    expect(dayOfDate(date)).toBe(date.day)
  })

  it('undoes toCalendar for every day of year 1 from May 1st', () => {
    for (let day = 0; toCalendar(day).year === 1; day += 1) {
      expect(dayOfDate(toCalendar(day))).toBe(day)
    }
  })

  it.each([
    { month: 4, dayOfMonth: 30 },
    { month: 1, dayOfMonth: 1 },
    { month: 6, dayOfMonth: 31 },
    { month: 2, dayOfMonth: 29 },
    { month: 5, dayOfMonth: 0 },
    { month: 13, dayOfMonth: 1 },
    { month: 0, dayOfMonth: 1 },
    { month: 5.5, dayOfMonth: 1 },
    { month: 5, dayOfMonth: 1.5 },
    { month: Number.NaN, dayOfMonth: 1 },
  ])('rejects $month-$dayOfMonth', (date) => {
    expect(() => dayOfDate(date)).toThrow(RangeError)
  })
})

describe('endOfMonth', () => {
  it.each([
    // May 1st and May 31st of year 1 end on May 31st.
    [0, 0, 30],
    [30, 0, 30],
    // A month on: June 30th, then July 31st.
    [0, 1, 60],
    [45, 1, 91],
    // Across the new year: December, then January and February.
    [214, 1, 275],
    [244, 2, 303],
    // A whole year on from May 1st: May 31st of year 2.
    [0, 12, 395],
  ])('from day %i, %i month(s) on, is day %i', (day, months, end) => {
    expect(endOfMonth(day, months)).toBe(end)
    expect(toCalendar(end + 1).dayOfMonth).toBe(1)
    expect(monthsSinceStart(end)).toBe(monthsSinceStart(day) + months)
  })

  it.each([-1, 1.5, Number.NaN])('rejects %d months', (months) => {
    expect(() => endOfMonth(0, months)).toThrow(RangeError)
  })

  it('rejects a day outside the game', () => {
    expect(() => endOfMonth(-1)).toThrow(RangeError)
  })
})

describe('gameYearOf', () => {
  it.each([
    [0, 1],
    [364, 1],
    [365, 2],
    [729, 2],
    [730, 3],
    [3649, 10],
  ])('puts day %i in year %i of the game', (day, year) => {
    expect(gameYearOf(day)).toBe(year)
  })

  it.each([-1, 1.5, Number.NaN])('rejects day %d', (day) => {
    expect(() => gameYearOf(day)).toThrow(RangeError)
  })
})

describe('startOfNextGameYear', () => {
  it.each([
    [0, 365],
    [364, 365],
    [365, 730],
    [427, 730],
    [633, 730],
  ])('puts the game year after day %i on day %i, a May 1st', (day, next) => {
    expect(startOfNextGameYear(day)).toBe(next)
    expect(toCalendar(next)).toMatchObject({ month: 5, dayOfMonth: 1 })
    expect(gameYearOf(next)).toBe(gameYearOf(day) + 1)
  })

  it.each([-1, 1.5, Number.NaN])('rejects day %d', (day) => {
    expect(() => startOfNextGameYear(day)).toThrow(RangeError)
  })
})

describe('startOfQuarter', () => {
  it.each([
    // May 1st and June 30th of year 1: April 1st, before the game.
    [0, -30],
    [60, -30],
    // July 1st and September 30th: July 1st.
    [61, 61],
    [152, 61],
    // October 1st and December 31st: October 1st.
    [153, 153],
    [244, 153],
    // January 1st and March 31st of year 2: January 1st.
    [245, 245],
    [334, 245],
    // April 1st of year 2.
    [335, 335],
  ])('starts the quarter of day %i on day %i', (day, start) => {
    expect(startOfQuarter(day)).toBe(start)
  })

  it('starts each quarter on the 1st of January, April, July or October, for ten years', () => {
    let start = startOfQuarter(0)
    for (let day = 0; day < 3650; day += 1) {
      const { month, dayOfMonth } = toCalendar(day)
      if (dayOfMonth === 1 && (month - 1) % 3 === 0) start = day
      expect(startOfQuarter(day), `day ${day}`).toBe(start)
    }
  })

  it('rejects a day outside the game', () => {
    expect(() => startOfQuarter(-1)).toThrow(RangeError)
  })
})

describe('onDates', () => {
  // Day 0 is May 1st of year 1, day 365 May 1st of year 2.
  const summer = { from: { month: 6, day: 1 }, to: { month: 9, day: 15 } }
  const winter = { from: { month: 12, day: 1 }, to: { month: 3, day: 31 } }

  it.each([
    [30, false],
    [31, true],
    [137, true],
    [138, false],
    [365 + 31, true],
    [365 + 138, false],
  ])('holds day %i within June 1st to September 15th: %s', (day, within) => {
    expect(onDates(day, summer)).toBe(within)
  })

  it.each([
    [213, false],
    [214, true],
    [244, true],
    [245, true],
    [334, true],
    [335, false],
  ])('holds day %i within December 1st to March 31st: %s', (day, within) => {
    expect(onDates(day, winter)).toBe(within)
  })

  it('holds a single date, and the whole year from a day to the day before', () => {
    const one = { from: { month: 5, day: 1 }, to: { month: 5, day: 1 } }
    expect(onDates(0, one)).toBe(true)
    expect(onDates(1, one)).toBe(false)
    expect(onDates(365, one)).toBe(true)
    const all = { from: { month: 5, day: 2 }, to: { month: 5, day: 1 } }
    for (let day = 0; day < 365; day += 1) expect(onDates(day, all)).toBe(true)
  })

  it('rejects a day outside the game', () => {
    expect(() => onDates(-1, summer)).toThrow(RangeError)
  })
})
