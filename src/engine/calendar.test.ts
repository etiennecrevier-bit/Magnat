import { describe, expect, it } from 'vitest'
import {
  dayOfDate,
  mondayOf,
  monthsSinceStart,
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
