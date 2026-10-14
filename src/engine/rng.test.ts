import { describe, expect, it } from 'vitest'
import { int, next, normal, seedRng } from './rng.ts'

/** Draws `count` values in a row from `state`. */
function draws(state: number, count: number): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i += 1) {
    const [value, nextState] = next(state)
    values.push(value)
    state = nextState
  }
  return values
}

function isUint32(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < 2 ** 32
}

describe('next', () => {
  it('matches the reference mulberry32 for seed 42', () => {
    // Computed once with the original closure version of mulberry32. A change
    // here changes every saved game, so it must never happen silently.
    let state = seedRng(42)
    const values: number[] = []
    for (let i = 0; i < 5; i += 1) {
      const [value, nextState] = next(state)
      values.push(value)
      state = nextState
    }
    expect(values).toEqual([
      0.6011037519201636, 0.44829055899754167, 0.8524657934904099,
      0.6697340414393693, 0.17481389874592423,
    ])
    expect(state).toBe(567894515)
  })

  it('gives the same sequence for the same seed', () => {
    expect(draws(seedRng(1234), 1000)).toEqual(draws(seedRng(1234), 1000))
  })

  it('gives different sequences for different seeds', () => {
    expect(draws(seedRng(1), 10)).not.toEqual(draws(seedRng(2), 10))
  })

  it('continues the same sequence from a saved state', () => {
    let state = seedRng(42)
    for (let i = 0; i < 10; i += 1) state = next(state)[1]
    const restored: number = JSON.parse(JSON.stringify(state))

    expect(draws(restored, 10)).toEqual(draws(seedRng(42), 20).slice(10))
  })

  it('stays in [0, 1) with a uint32 state', () => {
    let state = seedRng(2 ** 32 - 1)
    for (let i = 0; i < 10_000; i += 1) {
      const [value, nextState] = next(state)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
      expect(isUint32(nextState)).toBe(true)
      state = nextState
    }
  })

  it('is pure: the same state draws the same value', () => {
    const state = seedRng(99)
    expect(next(state)).toEqual(next(state))
  })
})

describe('seedRng and next', () => {
  it.each([-1, 1.5, 2 ** 32, Number.NaN, Number.POSITIVE_INFINITY])(
    'reject %s',
    (n) => {
      expect(() => seedRng(n)).toThrow(RangeError)
      expect(() => next(n)).toThrow(RangeError)
    },
  )

  it('accept the ends of the uint32 range', () => {
    expect(seedRng(0)).toBe(0)
    expect(seedRng(2 ** 32 - 1)).toBe(2 ** 32 - 1)
  })
})

describe('int', () => {
  it('rolls every face of a die and nothing else', () => {
    const seen = new Set<number>()
    let state = seedRng(42)
    for (let i = 0; i < 6000; i += 1) {
      const [value, nextState] = int(state, 1, 6)
      seen.add(value)
      state = nextState
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('covers negative ranges', () => {
    const seen = new Set<number>()
    let state = seedRng(7)
    for (let i = 0; i < 1000; i += 1) {
      const [value, nextState] = int(state, -3, 3)
      seen.add(value)
      state = nextState
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([-3, -2, -1, 0, 1, 2, 3])
  })

  it('returns min when min equals max, still using one draw', () => {
    const state = seedRng(5)
    expect(int(state, 4, 4)).toEqual([4, next(state)[1]])
  })

  it('accepts a span of exactly 2^32', () => {
    const [value] = int(seedRng(5), 0, 2 ** 32 - 1)
    expect(isUint32(value)).toBe(true)
  })

  it.each([
    { min: 2, max: 1 },
    { min: 1.5, max: 3 },
    { min: 1, max: Number.NaN },
    { min: 0, max: 2 ** 32 },
  ])('rejects $min to $max', ({ min, max }) => {
    expect(() => int(seedRng(5), min, max)).toThrow(RangeError)
  })
})

describe('normal', () => {
  it('is deterministic', () => {
    const state = seedRng(42)
    expect(normal(state, 100, 15)).toEqual(normal(state, 100, 15))
  })

  it('returns the mean exactly when sd is 0', () => {
    expect(normal(seedRng(42), 100, 0)[0]).toBe(100)
  })

  it('uses exactly two draws', () => {
    const state = seedRng(42)
    expect(normal(state, 0, 1)[1]).toBe(next(next(state)[1])[1])
  })

  it('has the requested mean and standard deviation', () => {
    const samples: number[] = []
    let state = seedRng(42)
    for (let i = 0; i < 10_000; i += 1) {
      const [value, nextState] = normal(state, 100, 15)
      samples.push(value)
      state = nextState
    }
    const mean = samples.reduce((total, x) => total + x, 0) / samples.length
    const variance =
      samples.reduce((total, x) => total + (x - mean) ** 2, 0) / samples.length
    expect(Math.abs(mean - 100)).toBeLessThan(0.5)
    expect(Math.abs(Math.sqrt(variance) - 15)).toBeLessThan(0.5)
  })

  it.each([
    { mean: 0, sd: -1 },
    { mean: 0, sd: Number.NaN },
    { mean: 0, sd: Number.POSITIVE_INFINITY },
    { mean: Number.NaN, sd: 1 },
    { mean: Number.NEGATIVE_INFINITY, sd: 1 },
  ])('rejects mean $mean, sd $sd', ({ mean, sd }) => {
    expect(() => normal(seedRng(42), mean, sd)).toThrow(RangeError)
  })
})
