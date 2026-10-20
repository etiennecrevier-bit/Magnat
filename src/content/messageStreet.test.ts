import { describe, expect, it } from 'vitest'
import messageStreet from './messageStreet.json'

// A message shows on the street for this many game days, then folds into
// the chip, so check the shape it relies on, not the value: that is tunable.
describe('messageStreet.json', () => {
  it('has a positive whole number of days on the street', () => {
    expect(Number.isInteger(messageStreet.streetDays)).toBe(true)
    expect(messageStreet.streetDays).toBeGreaterThan(0)
  })
})
