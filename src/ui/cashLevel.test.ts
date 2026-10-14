import { describe, expect, it } from 'vitest'
import cashGauge from '../content/cashGauge.json'
import foodTruck from '../content/foodtruck.json'
import { cents } from '../engine/money.ts'
import { DAILY_FIXED_COSTS, LOW_BELOW_DAYS, cashLevel } from './cashLevel.ts'

describe('cashLevel', () => {
  const daily = cents(6_500)
  const threshold = 7 * 6_500

  it.each([
    { cash: -1, level: 'negative' },
    { cash: -1_000_000, level: 'negative' },
    { cash: 0, level: 'low' },
    { cash: threshold - 1, level: 'low' },
    { cash: threshold, level: 'healthy' },
    { cash: 1_000_000, level: 'healthy' },
  ])('reads $cash cents as $level', ({ cash, level }) => {
    expect(cashLevel(cents(cash), daily, 7)).toBe(level)
  })

  it('reads the shipped content by default', () => {
    const threshold = DAILY_FIXED_COSTS * LOW_BELOW_DAYS
    expect(cashLevel(cents(threshold - 1))).toBe('low')
    expect(cashLevel(cents(threshold))).toBe('healthy')
  })
})

describe('DAILY_FIXED_COSTS', () => {
  it('adds up the fixed costs in the content', () => {
    const { rentAndPermit, fuelAndMaintenance } = foodTruck.dailyFixedCostsCents
    expect(DAILY_FIXED_COSTS).toBe(rentAndPermit + fuelAndMaintenance)
    expect(LOW_BELOW_DAYS).toBe(cashGauge.lowBelowDaysOfFixedCosts)
  })
})
