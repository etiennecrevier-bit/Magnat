import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Marketing } from '../content/schema.ts'
import { FOOD_TRUCK } from './day.ts'
import {
  awareness,
  extraCustomers,
  marketingCrowd,
  rememberSpend,
} from './marketing.ts'
import { cents, type Cents } from './money.ts'

const SHIPPED = FOOD_TRUCK.marketing

/** Seven days of awareness, bringing 0,5 walk-ins per √cent. */
const WEEK: Marketing = {
  awarenessDays: 7,
  extraCustomersPerSqrtCent: 0.5,
  segmentShares: { aubaine: 0.1, habitue: 0.3, chic: 0.6 },
}

function spend(...amounts: number[]): Cents[] {
  return amounts.map((amount) => cents(amount))
}

/** `amount` spent on each of seven days. */
function week(amount: number): Cents[] {
  return spend(...Array.from({ length: 7 }, () => amount))
}

describe('awareness', () => {
  it('is 0 before anything was spent', () => {
    expect(awareness([], WEEK)).toBe(0)
  })

  it('averages the spend over every day of the window, missing days as 0', () => {
    expect(awareness(spend(7_000), WEEK)).toBe(1_000)
    expect(awareness(spend(7_000, 7_000), WEEK)).toBe(2_000)
    expect(awareness(week(3_000), WEEK)).toBe(3_000)
  })

  it('counts a closed day as 0', () => {
    expect(awareness(spend(7_000, 0, 7_000, 0, 7_000, 0, 7_000), WEEK)).toBe(
      4_000,
    )
  })

  it('counts only the last awarenessDays days', () => {
    const history = spend(70_000, 700, 700, 700, 700, 700, 700, 700)
    expect(awareness(history, WEEK)).toBe(700)
    expect(awareness(spend(900, 300), { ...WEEK, awarenessDays: 1 })).toBe(300)
  })
})

describe('extraCustomers', () => {
  it('brings no one with no awareness', () => {
    expect(extraCustomers(0, WEEK)).toBe(0)
    expect(
      extraCustomers(10_000, { ...WEEK, extraCustomersPerSqrtCent: 0 }),
    ).toBe(0)
  })

  it('is k × √awareness', () => {
    expect(extraCustomers(10_000, WEEK)).toBe(50)
    expect(extraCustomers(2_500, WEEK)).toBe(25)
  })

  it('brings more with more awareness, but fewer than double for double', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1e9, noNaN: true }), (level) => {
        const once = extraCustomers(level, SHIPPED)
        const twice = extraCustomers(2 * level, SHIPPED)
        expect(twice).toBeGreaterThan(once)
        expect(twice).toBeLessThan(2 * once)
        expect(twice / once).toBeCloseTo(Math.SQRT2, 9)
      }),
    )
  })
})

describe('marketingCrowd', () => {
  it("brings the history's walk-ins, from the marketing's segment shares", () => {
    expect(marketingCrowd(week(10_000), WEEK)).toEqual({
      customers: 50,
      segmentShares: WEEK.segmentShares,
    })
    expect(marketingCrowd([], WEEK).customers).toBe(0)
  })
})

describe('rememberSpend', () => {
  it('adds the day last, keeping the last awarenessDays', () => {
    let history: readonly Cents[] = []
    for (let day = 1; day <= 9; day += 1) {
      history = rememberSpend(history, cents(day * 100), WEEK)
    }
    expect(history).toEqual(spend(300, 400, 500, 600, 700, 800, 900))
    expect(rememberSpend(spend(5), cents(0), WEEK)).toEqual(spend(5, 0))
  })

  it('never mutates the history', () => {
    const history = Object.freeze(spend(1, 2, 3, 4, 5, 6, 7))
    const after = rememberSpend(history, cents(8), WEEK)
    expect(history).toEqual(spend(1, 2, 3, 4, 5, 6, 7))
    expect(after).toEqual(spend(2, 3, 4, 5, 6, 7, 8))
  })
})
