import { describe, expect, it } from 'vitest'
import { emptyJournal } from '../finance/journal.ts'
import {
  createInitialState,
  tick,
  toCalendar,
  type CalendarDate,
} from './clock.ts'
import { seedRng } from './rng.ts'
import type { Day } from './types.ts'

// Month lengths of a non-leap year, kept apart from clock.ts so the ten-year
// walk checks it against an independent spec.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

describe('createInitialState', () => {
  it('starts on day 0 with the generator seeded and empty books', () => {
    expect(createInitialState(42)).toEqual({
      day: 0,
      seed: 42,
      rngState: seedRng(42),
      journal: emptyJournal(),
    })
  })

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('rejects seed %s', (seed) => {
    expect(() => createInitialState(seed)).toThrow(RangeError)
  })
})

describe('tick', () => {
  it('returns a new state one day later without mutating its input', () => {
    const state = Object.freeze(createInitialState(42))
    const next = tick(state)
    expect(next).toEqual({ ...state, day: 1 })
    expect(next).not.toBe(state)
    expect(state).toEqual(createInitialState(42))
  })

  it('counts one day per tick and keeps the seed and generator state', () => {
    const start = createInitialState(7)
    let state = start
    for (let i = 0; i < 400; i += 1) state = tick(state)
    expect(state).toEqual({ ...start, day: 400 })
  })
})

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
