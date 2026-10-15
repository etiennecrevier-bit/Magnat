import { describe, expect, it } from 'vitest'
import cashGauge from './cashGauge.json'

// The cash gauge reads low below this many months of fixed costs, so check
// the shape it relies on, not the value: that is tunable.
describe('cashGauge.json', () => {
  it('has a positive whole number of months of fixed costs', () => {
    expect(Number.isInteger(cashGauge.lowBelowMonthsOfFixedCosts)).toBe(true)
    expect(cashGauge.lowBelowMonthsOfFixedCosts).toBeGreaterThan(0)
  })
})
