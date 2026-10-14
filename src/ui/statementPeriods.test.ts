import { describe, expect, it, vi } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  computeStatements,
  createStatementsReader,
  periodFor,
} from './statementPeriods.ts'

describe('periodFor', () => {
  it.each([
    {
      when: 'on the first day of the game (May 1st, year 1)',
      today: 0,
      thisMonth: { fromDay: 0, toDay: 0 },
      lastMonth: null,
      yearToDate: { fromDay: 0, toDay: 0 },
    },
    {
      when: 'late in the first month',
      today: 30,
      thisMonth: { fromDay: 0, toDay: 30 },
      lastMonth: null,
      yearToDate: { fromDay: 0, toDay: 30 },
    },
    {
      when: 'on June 1st, year 1',
      today: 31,
      thisMonth: { fromDay: 31, toDay: 31 },
      lastMonth: { fromDay: 0, toDay: 30 },
      yearToDate: { fromDay: 0, toDay: 31 },
    },
    {
      when: 'mid-June, year 1',
      today: 45,
      thisMonth: { fromDay: 31, toDay: 45 },
      lastMonth: { fromDay: 0, toDay: 30 },
      yearToDate: { fromDay: 0, toDay: 45 },
    },
    {
      when: 'on January 1st, year 2',
      today: 245,
      thisMonth: { fromDay: 245, toDay: 245 },
      lastMonth: { fromDay: 214, toDay: 244 },
      yearToDate: { fromDay: 245, toDay: 245 },
    },
    {
      when: 'on March 1st, year 2, after a 28-day February',
      today: 304,
      thisMonth: { fromDay: 304, toDay: 304 },
      lastMonth: { fromDay: 276, toDay: 303 },
      yearToDate: { fromDay: 245, toDay: 304 },
    },
    {
      when: 'in June, year 2',
      today: 400,
      thisMonth: { fromDay: 396, toDay: 400 },
      lastMonth: { fromDay: 365, toDay: 395 },
      yearToDate: { fromDay: 245, toDay: 400 },
    },
  ])('covers the right days $when', (row) => {
    expect(periodFor('thisMonth', row.today)).toEqual(row.thisMonth)
    expect(periodFor('lastMonth', row.today)).toEqual(row.lastMonth)
    expect(periodFor('yearToDate', row.today)).toEqual(row.yearToDate)
  })
})

describe('computeStatements', () => {
  it('builds the three statements for the period, the bilan at its end', () => {
    let game = createInitialState(42)
    for (let i = 0; i < 40; i += 1) game = tick(game)
    const period = { fromDay: 31, toDay: 40 }

    const statements = computeStatements(game.journal, period)

    expect(statements.period).toBe(period)
    expect(statements.balanceSheet.atDay).toBe(40)
    expect(statements.incomeStatement).toMatchObject({ fromDay: 31, toDay: 40 })
    expect(statements.cashFlow).toMatchObject({ fromDay: 31, toDay: 40 })
  })
})

describe('createStatementsReader', () => {
  function setUp() {
    const compute = vi.fn(computeStatements)
    const read = createStatementsReader(compute)
    let game = createInitialState(7)
    for (let i = 0; i < 35; i += 1) game = tick(game)
    return { compute, read, game }
  }

  it('computes a period once per day, however often it is read', () => {
    const { compute, read, game } = setUp()
    const first = read(game.journal, game.day, 'thisMonth')
    expect(read(game.journal, game.day, 'thisMonth')).toBe(first)
    expect(compute).toHaveBeenCalledTimes(1)
    expect(compute).toHaveBeenCalledWith(game.journal, {
      fromDay: 31,
      toDay: 35,
    })
  })

  it('keeps each period read today when switching between them', () => {
    const { compute, read, game } = setUp()
    const thisMonth = read(game.journal, game.day, 'thisMonth')
    const lastMonth = read(game.journal, game.day, 'lastMonth')
    expect(compute).toHaveBeenCalledTimes(2)
    expect(lastMonth).not.toBe(thisMonth)

    expect(read(game.journal, game.day, 'thisMonth')).toBe(thisMonth)
    expect(read(game.journal, game.day, 'lastMonth')).toBe(lastMonth)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('computes again once the next day is played', () => {
    const { compute, read, game } = setUp()
    const before = read(game.journal, game.day, 'thisMonth')
    const next = tick(game)

    const after = read(next.journal, next.day, 'thisMonth')

    expect(compute).toHaveBeenCalledTimes(2)
    expect(after).not.toBe(before)
    expect(after?.period).toEqual({ fromDay: 31, toDay: 36 })
  })

  it('returns null, without computing, for a period with no days', () => {
    const compute = vi.fn(computeStatements)
    const read = createStatementsReader(compute)
    const game = createInitialState(7)
    expect(read(game.journal, game.day, 'lastMonth')).toBeNull()
    expect(read(game.journal, game.day, 'lastMonth')).toBeNull()
    expect(compute).not.toHaveBeenCalled()
  })
})
