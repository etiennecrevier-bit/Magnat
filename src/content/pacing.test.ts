import { describe, expect, it } from 'vitest'
import pacing from './pacing.json'

// The game loop waits msPerDayAtNormalSpeed / speed between ticks and runs at
// most maxTicksPerFrame ticks per frame, so check the shape it relies on, not
// the values: those are tunable.
describe('pacing.json', () => {
  it('has a positive whole number of milliseconds per day', () => {
    expect(Number.isInteger(pacing.msPerDayAtNormalSpeed)).toBe(true)
    expect(pacing.msPerDayAtNormalSpeed).toBeGreaterThan(0)
  })

  it('starts with pause, then strictly faster whole-number speeds', () => {
    const [pause, ...speeds] = pacing.speeds
    expect(pause).toBe(0)
    expect(speeds).not.toHaveLength(0)
    let slower = 0
    for (const speed of speeds) {
      expect(Number.isInteger(speed)).toBe(true)
      expect(speed).toBeGreaterThan(slower)
      slower = speed
    }
  })

  it('lets a frame advance a positive whole number of days', () => {
    expect(Number.isInteger(pacing.maxTicksPerFrame)).toBe(true)
    expect(pacing.maxTicksPerFrame).toBeGreaterThan(0)
  })
})
