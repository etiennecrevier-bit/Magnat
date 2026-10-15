import { describe, expect, it } from 'vitest'
import cashGauge from '../content/cashGauge.json'
import foodTruck from '../content/foodtruck.json'
import { cents } from '../engine/money.ts'
import {
  LOW_BELOW_MONTHS,
  MONTHLY_FIXED_COSTS,
  cashLevel,
} from './cashLevel.ts'

describe('cashLevel', () => {
  const monthly = cents(175_000)
  const threshold = 2 * 175_000

  it.each([
    { cash: -1, level: 'negative' },
    { cash: -1_000_000, level: 'negative' },
    { cash: 0, level: 'low' },
    { cash: threshold - 1, level: 'low' },
    { cash: threshold, level: 'healthy' },
    { cash: 1_000_000, level: 'healthy' },
  ])('reads $cash cents as $level', ({ cash, level }) => {
    expect(cashLevel(cents(cash), monthly, 2)).toBe(level)
  })

  it('reads the shipped content by default', () => {
    const threshold = MONTHLY_FIXED_COSTS * LOW_BELOW_MONTHS
    expect(cashLevel(cents(threshold - 1))).toBe('low')
    expect(cashLevel(cents(threshold))).toBe('healthy')
  })
})

describe('MONTHLY_FIXED_COSTS', () => {
  it('adds up the monthly costs in the content', () => {
    const { permitParkingAndCommissary, insurance } =
      foodTruck.monthlyCostsCents
    expect(MONTHLY_FIXED_COSTS).toBe(permitParkingAndCommissary + insurance)
    expect(LOW_BELOW_MONTHS).toBe(cashGauge.lowBelowMonthsOfFixedCosts)
  })
})
