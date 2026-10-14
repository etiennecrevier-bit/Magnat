import { describe, expect, it } from 'vitest'

// Throwaway canary for issue #3: CI must go red when a test fails. Never merge.
describe('CI canary', () => {
  it('fails on purpose', () => {
    expect(1 + 1).toBe(3)
  })
})
