import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  difficultyIdSchema,
  loadPercentileContent,
  type PercentileContent,
} from '../content/schema.ts'
import { cents } from './money.ts'
import { PERCENTILES, percentileOf } from './percentiles.ts'

// Where the player stands among the simulated owners: the edges of the
// table, the interpolation between its amounts, and that a higher income
// never reads as a lower percentile, on a small table written here and on
// the shipped one.

/** Two weeks at three percentiles, the second with a run of equal amounts. */
const TABLE: PercentileContent = loadPercentileContent({
  games: 10,
  percentiles: [10, 50, 90],
  difficulties: {
    facile: [
      [-1000, 0, 2000],
      [-500, 500, 500],
    ],
    moyen: [[0, 0, 0]],
    difficile: [[100, 200, 300]],
  },
})

function of(week: number, income: number, content = TABLE): number {
  return percentileOf('facile', week, cents(income), content)
}

describe('percentileOf', () => {
  it('gives 0 below the lowest percentile, and the highest at or above it', () => {
    expect(of(1, -1001)).toBe(0)
    expect(of(1, -1_000_000)).toBe(0)
    expect(of(1, 2000)).toBe(90)
    expect(of(1, 1_000_000)).toBe(90)
  })

  it('gives each percentile at its amount', () => {
    expect(of(1, -1000)).toBe(10)
    expect(of(1, 0)).toBe(50)
    expect(of(1, 2000)).toBe(90)
  })

  it('is linear between two amounts', () => {
    expect(of(1, -500)).toBe(30)
    expect(of(1, 1000)).toBe(70)
    expect(of(1, 1)).toBeCloseTo(50.02, 10)
  })

  it('takes the highest percentile of a run of equal amounts', () => {
    expect(of(2, 499)).toBeCloseTo(49.96, 10)
    expect(of(2, 500)).toBe(90)
    expect(percentileOf('moyen', 1, cents(0), TABLE)).toBe(90)
    expect(percentileOf('moyen', 1, cents(-1), TABLE)).toBe(0)
  })

  it('reads the last week after the table ends', () => {
    expect(of(2, 0)).toBe(30)
    expect(of(3, 0)).toBe(30)
    expect(of(10_000, 0)).toBe(30)
    expect(percentileOf('difficile', 105, cents(150), TABLE)).toBe(30)
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity])('throws on week %d', (week) => {
    expect(() => of(week, 0)).toThrow(RangeError)
  })

  it.each([0.5, Number.NaN, Infinity, 2 ** 53])(
    'throws on an income of %d',
    (income) => {
      expect(() => percentileOf('facile', 1, income as never, TABLE)).toThrow(
        RangeError,
      )
    },
  )

  it('never goes down as the income goes up, on this table and the shipped one', () => {
    for (const content of [TABLE, PERCENTILES]) {
      const weeks = Math.max(
        ...Object.values(content.difficulties).map((rows) => rows.length),
      )
      fc.assert(
        fc.property(
          fc.constantFrom(...difficultyIdSchema.options),
          fc.integer({ min: 1, max: weeks + 5 }),
          fc.integer({ min: -20_000_000, max: 20_000_000 }),
          fc.integer({ min: 0, max: 5_000_000 }),
          (difficulty, week, income, more) => {
            const low = percentileOf(difficulty, week, cents(income), content)
            const high = percentileOf(
              difficulty,
              week,
              cents(income + more),
              content,
            )
            const top = content.percentiles.at(-1) ?? 0
            return low >= 0 && high <= top && low <= high
          },
        ),
      )
    }
  })

  it('reads the shipped table at its knots, its edges and after week 104', () => {
    const { percentiles, difficulties } = PERCENTILES
    for (const difficulty of difficultyIdSchema.options) {
      const rows = difficulties[difficulty]
      for (const week of [1, rows.length]) {
        const row = rows[week - 1] ?? []
        const lowest = row[0] ?? 0
        expect(percentileOf(difficulty, week, cents(lowest - 1))).toBe(0)
        // A knot reads its own percentile unless the next has the same
        // amount, which takes the higher one.
        row.forEach((amount, index) => {
          const read = percentileOf(difficulty, week, amount)
          expect(read).toBeGreaterThanOrEqual(percentiles[index] ?? 0)
          if (row[index + 1] !== amount) expect(read).toBe(percentiles[index])
        })
      }
      const last = rows.at(-1)?.[5] ?? cents(0)
      expect(percentileOf(difficulty, rows.length + 1, last)).toBe(
        percentileOf(difficulty, rows.length, last),
      )
    }
  })
})

describe('PERCENTILES', () => {
  it('ships 104 weeks of the 11 percentiles for every difficulty', () => {
    expect(PERCENTILES.percentiles).toEqual([
      5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95,
    ])
    for (const difficulty of difficultyIdSchema.options) {
      const rows = PERCENTILES.difficulties[difficulty]
      expect(rows).toHaveLength(104)
      for (const row of rows) expect(row).toHaveLength(11)
    }
  })
})
