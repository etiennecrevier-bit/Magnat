import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  difficultyIdSchema,
  loadDefiPercentileContent,
  loadPercentileContent,
  type DefiPercentileContent,
  type PercentileContent,
} from '../content/schema.ts'
import { defiById } from './challenge.ts'
import { DEFIS } from './day.ts'
import { cents } from './money.ts'
import {
  DEFI_PERCENTILES,
  defiPercentileOf,
  PERCENTILES,
  percentileOf,
} from './percentiles.ts'
import type { ChallengeProgress } from './types.ts'

// Where the player stands among the simulated owners: the edges of the
// table, the interpolation between its amounts, and that a higher income
// never reads as a lower percentile, on a small table written here and on
// the shipped one. Then where a Défi over stands among the simulated games,
// on a small Défi table written here and on the shipped one.

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

/**
 * Ten games of three Défis at three percentiles: a share that broke a
 * condition, every game broken, and a goal where lower is better.
 */
const DEFI_TABLE: DefiPercentileContent = loadDefiPercentileContent({
  games: 10,
  percentiles: [10, 50, 90],
  defis: {
    moisSansConge: {
      metric: 'netIncome',
      brokenShare: 0.3,
      values: [-1000, 0, 2000],
    },
    semaineDesMilleDollars: {
      metric: 'netIncome',
      brokenShare: 1,
      values: null,
    },
    zeroGaspillage: {
      metric: 'spoilageRate',
      brokenShare: 0,
      values: [0.01, 0.02, 0.025],
    },
    festivalDuPasPire: {
      metric: 'customersServed',
      brokenShare: 0,
      values: [1, 2, 3],
    },
  },
})

/** A Défi over that broke none of the shipped Défis' conditions. */
const PROGRESS: ChallengeProgress = {
  daysPlayed: 14,
  sales: cents(0),
  netIncome: cents(0),
  lowestCash: cents(100_000),
  customersServed: 0,
  unitsSold: 100,
  unitsSpoiled: 0,
  lowestEnergy: 100,
}

const moisSansConge = defiById(DEFIS, 'moisSansConge')

/** « Zéro gaspillage » with its goal on the share of goods thrown out. */
const lessSpoilage = {
  ...defiById(DEFIS, 'zeroGaspillage'),
  goal: {
    metric: 'spoilageRate',
    medals: { or: 0.005, argent: 0.01, bronze: 0.02 },
  },
} as const

function defiOf(netIncome: number, changes: Partial<ChallengeProgress> = {}) {
  return defiPercentileOf(
    moisSansConge,
    { ...PROGRESS, netIncome: cents(netIncome), ...changes },
    DEFI_TABLE,
  )
}

function spoiled(unitsSpoiled: number, unitsSold: number) {
  return defiPercentileOf(
    lessSpoilage,
    { ...PROGRESS, unitsSold, unitsSpoiled },
    DEFI_TABLE,
  )
}

describe('defiPercentileOf', () => {
  it('ranks a game that broke no condition above the share that broke one', () => {
    // 3 games broke one; the value is on the 50th percentile of the 7
    // others. 100 × (0.3 + 0.7 × 0.5) would read 64.99… in floats.
    expect(defiOf(0)).toBe(65)
    expect(defiOf(-1000)).toBe(37)
    expect(defiOf(-500)).toBe(51)
  })

  it('reads the percentile as percentileOf does at the edges', () => {
    expect(defiOf(-1001)).toBe(30)
    expect(defiOf(2000)).toBe(93)
    expect(defiOf(1_000_000)).toBe(93)
  })

  it('reads 0 for a game that broke a condition, whatever its goal', () => {
    expect(defiOf(1_000_000, { lowestEnergy: 19.4 })).toBe(0)
    expect(spoiled(4, 96)).toBe(0)
  })

  it('reads 100 for a game that broke none when every simulated game broke one', () => {
    const milleDollars = defiById(DEFIS, 'semaineDesMilleDollars')
    expect(defiPercentileOf(milleDollars, PROGRESS, DEFI_TABLE)).toBe(100)
  })

  it('reads 100 minus the percentile for spoilageRate, where lower is better', () => {
    expect(spoiled(0, 100)).toBe(100)
    expect(spoiled(1, 99)).toBe(90)
    expect(spoiled(2, 98)).toBe(50)
    expect(spoiled(1, 39)).toBe(10)
    expect(spoiled(11, 389)).toBe(10)
  })

  it('is null when the table has no row for the Défi measuring its goal', () => {
    for (const id of ['travauxSaintDenis', 'festivalDuPasPire']) {
      expect(defiPercentileOf(defiById(DEFIS, id), PROGRESS, DEFI_TABLE)).toBe(
        null,
      )
    }
  })

  it('reads every shipped Défi, from 0 to 100, never going down as its goal goes up', () => {
    for (const defi of DEFIS.defis) {
      const { values } = DEFI_PERCENTILES.defis[defi.id] ?? {}
      const lowest = values?.[0] ?? 0
      const spread = (values?.at(-1) ?? 0) - lowest + 100
      const { metric } = defi.goal
      fc.assert(
        fc.property(
          fc.integer({ min: lowest - spread, max: lowest + 2 * spread }),
          fc.integer({ min: 0, max: spread }),
          (value, more) => {
            const low = defiPercentileOf(defi, { ...PROGRESS, [metric]: value })
            const high = defiPercentileOf(defi, {
              ...PROGRESS,
              [metric]: value + more,
            })
            return (
              low !== null &&
              high !== null &&
              0 <= low &&
              low <= high &&
              high <= 100
            )
          },
        ),
      )
    }
  })
})
