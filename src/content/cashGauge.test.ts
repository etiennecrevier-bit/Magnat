import { describe, expect, it } from 'vitest'
import cashGauge from './cashGauge.json'

// The cash gauge reads low below this many days of fixed costs, so check the
// shape it relies on, not the value: that is tunable.
describe('cashGauge.json', () => {
  it('has a positive whole number of days of fixed costs', () => {
    expect(Number.isInteger(cashGauge.lowBelowDaysOfFixedCosts)).toBe(true)
    expect(cashGauge.lowBelowDaysOfFixedCosts).toBeGreaterThan(0)
  })
})
