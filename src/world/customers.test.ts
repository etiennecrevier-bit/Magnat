import { describe, expect, it } from 'vitest'
import { countText } from './customers.ts'

describe('countText', () => {
  it.each([
    [0, '0 client servi'],
    [1, '1 client servi'],
    [2, '2 clients servis'],
    [87, '87 clients servis'],
  ])('writes %i as « %s »', (count, text) => {
    expect(countText(count, 'client servi', 'clients servis')).toBe(text)
  })
})
