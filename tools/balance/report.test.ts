import { describe, expect, it } from 'vitest'
import { cents } from '../../src/engine/money.ts'
import type { DifficultyRun, GameResult } from './play.ts'
import {
  formatCount,
  formatPriceChange,
  formatReport,
  median,
  medianCents,
  rank,
  ranked,
  summarize,
  unchangedDecisions,
  type StrategySummary,
} from './report.ts'
import type { Strategy } from './strategies.ts'

// Summing up a strategy's games, ranking the strategies and writing the
// report, on hand-made games.

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
}

function game(seed: number, fields: Partial<GameResult> = {}): GameResult {
  return {
    seed,
    cashAtEnd: cents(0),
    netIncome: cents(0),
    lowestCash: cents(0),
    wentBelowZero: false,
    unitsSold: 0,
    unitsSpoiled: 0,
    lostToStockouts: 0,
    lostToPrices: 0,
    journalHash: `books of seed ${seed}`,
    ...fields,
  }
}

describe('median', () => {
  it.each([
    [[7], 7],
    [[3, 1, 2], 2],
    [[4, 1, 3, 2], 2.5],
    [[0.1, 0.5, 0, 0.75], 0.3],
    [[-5, 5], 0],
  ])('of %j is %d', (values, expected) => {
    expect(median(values)).toBeCloseTo(expected, 12)
  })

  it('leaves its input in order', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })

  it('rejects no values', () => {
    expect(() => median([])).toThrow(RangeError)
    expect(() => medianCents([])).toThrow(RangeError)
  })
})

describe('medianCents', () => {
  it.each([
    [[500, -300, 401], 401],
    [[100, 300], 200],
    [[1, 2], 2],
    [[-1, -2], -2],
    [[-300, 401, 1000, 2000], 701],
  ])('of %j is %i, half a cent rounded away from zero', (values, expected) => {
    expect(medianCents(values.map(cents))).toBe(expected)
  })
})

describe('summarize', () => {
  const games = [
    game(1, {
      cashAtEnd: cents(1000),
      netIncome: cents(100),
      lowestCash: cents(500),
      unitsSold: 90,
      unitsSpoiled: 10,
      lostToStockouts: 5,
      lostToPrices: 7,
    }),
    game(2, {
      cashAtEnd: cents(-300),
      netIncome: cents(-50),
      lowestCash: cents(-800),
      wentBelowZero: true,
      unitsSold: 50,
      unitsSpoiled: 50,
      lostToStockouts: 2,
      lostToPrices: 10,
    }),
    // Nothing sold nor spoiled: no spoilage.
    game(3, {
      cashAtEnd: cents(401),
      lowestCash: cents(200),
      lostToStockouts: 9,
      lostToPrices: 1,
    }),
  ]

  it('takes the medians, the worst and the lowest over the games', () => {
    expect(summarize(BASE, games, 4)).toEqual({
      strategy: BASE,
      index: 4,
      games: 3,
      medianCashAtEnd: 401,
      worstCashAtEnd: -300,
      medianNetIncome: 0,
      lowestCash: -800,
      gamesBelowZero: 1,
      medianSpoilageRate: 0.1,
      medianLostToStockouts: 5,
      medianLostToPrices: 7,
    })
  })

  it('takes the mean of the middle two of an even count', () => {
    const summary = summarize(
      BASE,
      [
        ...games,
        game(4, {
          cashAtEnd: cents(2000),
          netIncome: cents(51),
          unitsSold: 25,
          unitsSpoiled: 75,
          lostToStockouts: 4,
          lostToPrices: 2,
        }),
      ],
      0,
    )
    expect(summary).toMatchObject({
      games: 4,
      medianCashAtEnd: 701,
      medianNetIncome: 26,
      medianLostToStockouts: 4.5,
      medianLostToPrices: 4.5,
    })
    expect(summary.medianSpoilageRate).toBeCloseTo(0.3, 12)
  })

  it('rejects no games', () => {
    expect(() => summarize(BASE, [], 0)).toThrow(RangeError)
  })
})

describe('rank', () => {
  function summary(
    index: number,
    medianCashAtEnd: number,
    medianNetIncome: number,
  ): StrategySummary {
    return {
      ...summarize(BASE, [game(1)], index),
      medianCashAtEnd: cents(medianCashAtEnd),
      medianNetIncome: cents(medianNetIncome),
    }
  }

  it('puts the most cash first, then the most net income, then the run order', () => {
    const summaries = [
      summary(0, 100, 5),
      summary(1, 300, -10),
      summary(2, 100, 7),
      summary(3, 100, 5),
      summary(4, -50, 1000),
    ]
    expect(rank(summaries).map(({ index }) => index)).toEqual([1, 2, 0, 3, 4])
    expect(summaries.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4])
  })

  it('numbers the ranks of a run from 1', () => {
    const run: DifficultyRun = {
      difficulty: 'moyen',
      strategies: [
        { strategy: BASE, games: [game(1, { cashAtEnd: cents(5) })] },
        {
          strategy: { ...BASE, daysOpen: 7 },
          games: [game(1, { cashAtEnd: cents(9) })],
        },
      ],
    }
    expect(
      ranked(run).map(({ rank, index, strategy }) => [rank, index, strategy]),
    ).toEqual([
      [1, 1, { ...BASE, daysOpen: 7 }],
      [2, 0, BASE],
    ])
  })
})

describe('unchangedDecisions', () => {
  const marketing = [cents(0), cents(3000)]
  const days = [6, 7] as const
  /** Two seeds of each strategy; the books depend on `books(strategy, seed)`. */
  function run(
    books: (strategy: Strategy, seed: number) => string,
  ): DifficultyRun {
    const strategies = marketing.flatMap((marketingDaily) =>
      days.map((daysOpen) => ({ ...BASE, marketingDaily, daysOpen })),
    )
    return {
      difficulty: 'moyen',
      strategies: strategies.map((strategy) => ({
        strategy,
        games: [1, 2].map((seed) =>
          game(seed, { journalHash: books(strategy, seed) }),
        ),
      })),
    }
  }

  it('lists a choice whose values all played the same books', () => {
    expect(
      unchangedDecisions(
        run(({ daysOpen }, seed) => `${daysOpen} days, seed ${seed}`),
      ),
    ).toEqual(['marketingDaily'])
  })

  it('leaves out a choice that changed one seed', () => {
    expect(
      unchangedDecisions(
        run(
          ({ daysOpen, marketingDaily }, seed) =>
            `${daysOpen} days, seed ${seed}${seed === 2 && marketingDaily > 0 ? ', marketing' : ''}`,
        ),
      ),
    ).toEqual([])
  })

  it('lists every choice that changed nothing, in field order', () => {
    expect(unchangedDecisions(run((_, seed) => `seed ${seed}`))).toEqual([
      'marketingDaily',
      'daysOpen',
    ])
  })
})

describe('formatPriceChange', () => {
  it.each([
    [-20, '-20%'],
    [0, 'base'],
    [20, '+20%'],
    [40, '+40%'],
  ])('writes %i as %s', (priceChange, text) => {
    expect(formatPriceChange(priceChange)).toBe(text)
  })
})

describe('formatCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1,000'],
    [1250.5, '1,250.5'],
    [1_234_567, '1,234,567'],
  ])('writes %d as %s', (count, text) => {
    expect(formatCount(count)).toBe(text)
  })
})

describe('formatReport', () => {
  const winner: Strategy = {
    priceChange: 20,
    croissantsPerDay: 110,
    marketingDaily: cents(3000),
    daysOpen: 7,
  }
  const winning = [
    game(1, {
      cashAtEnd: cents(123_456),
      netIncome: cents(10_000),
      lowestCash: cents(-5),
      wentBelowZero: true,
      unitsSold: 900,
      unitsSpoiled: 100,
      lostToStockouts: 3,
      lostToPrices: 1200,
      journalHash: 'a1',
    }),
    game(2, {
      cashAtEnd: cents(100_001),
      netIncome: cents(20_001),
      lowestCash: cents(50),
      unitsSold: 800,
      unitsSpoiled: 200,
      lostToStockouts: 4,
      lostToPrices: 1301,
      journalHash: 'a2',
    }),
  ]
  const losing = [1, 2].map((seed) =>
    game(seed, {
      cashAtEnd: cents(-2_000_000),
      netIncome: cents(-1_000_000),
      lowestCash: cents(-2_500_000),
      wentBelowZero: true,
      journalHash: `b${seed}`,
    }),
  )
  const report = formatReport({
    years: 1,
    games: 2,
    difficulties: [
      {
        difficulty: 'moyen',
        strategies: [
          { strategy: winner, games: winning },
          {
            strategy: {
              priceChange: -20,
              croissantsPerDay: 40,
              marketingDaily: cents(0),
              daysOpen: 6,
            },
            games: losing,
          },
          // The winner without marketing, which played the same books.
          {
            strategy: { ...winner, marketingDaily: cents(0) },
            games: winning,
          },
        ],
      },
    ],
  })
  const lines = report.split('\n')

  const HEADER =
    '| # | Prices | Croissants/day | Marketing/day | Days open | Median cash at end | Worst cash at end | Median net income | Lowest cash | Below zero | Spoilage | Lost to stockouts | Lost to prices |'
  const ALIGN =
    '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |'
  const FIRST =
    '| 1 | +20% | 110 | $30.00 | 7 | $1,117.29 | $1,000.01 | $150.01 | -$0.05 | 50% | 15.0% | 3.5 | 1,250.5 |'
  const SECOND =
    '| 2 | +20% | 110 | $0.00 | 7 | $1,117.29 | $1,000.01 | $150.01 | -$0.05 | 50% | 15.0% | 3.5 | 1,250.5 |'
  const LAST =
    '| 3 | -20% | 40 | $0.00 | 6 | -$20,000.00 | -$20,000.00 | -$10,000.00 | -$25,000.00 | 100% | 0.0% | 0 | 0 |'

  it('opens with the command that wrote it and what each game plays', () => {
    expect(lines.slice(0, 3)).toEqual([
      '# Balance report: phase 2',
      '',
      'Generated by `npm run balance -- --years 1 --games 2`: do not edit by hand. The numbers go stale whenever the engine or the content changes; run the command again then.',
    ])
    expect(lines).toContain(
      'Each game starts at one difficulty on one of seeds 1 to 2 and plays 365 days from May 1st, year 1, with one strategy in effect from day 0. A strategy sets:',
    )
    expect(lines).toContain(
      '- every price at -20%, base, +20%, +40% from the starting prices (Café $3.25, Chocolat chaud $3.50, Croissant $3.75), rounded half up to the price step;',
    )
    expect(lines).toContain(
      'Café and chocolat chaud keep their starting restock rules and the owner keeps the starting pay of $700.00 a week. Each difficulty plays 3 strategies × 2 games.',
    )
    expect(lines).toContain(
      '- Customers lost to the line are not counted: the game has no line until #62 (P2-03).',
    )
  })

  it('lists the best and the worst first, then every strategy', () => {
    expect(lines.slice(lines.indexOf('## Best and worst'))).toEqual([
      '## Best and worst',
      '',
      '### Moyen',
      '',
      '**10 best**',
      '',
      HEADER,
      ALIGN,
      FIRST,
      SECOND,
      LAST,
      '',
      '**10 worst, worst first**',
      '',
      HEADER,
      ALIGN,
      LAST,
      SECOND,
      FIRST,
      '',
      'Changed nothing at Moyen: marketing budget. With the other choices held, every seed played the same books whatever the value.',
      '',
      '## All strategies',
      '',
      '### Moyen',
      '',
      HEADER,
      ALIGN,
      FIRST,
      SECOND,
      LAST,
      '',
    ])
  })

  it('names a single seed as such', () => {
    const single = formatReport({
      years: 2,
      games: 1,
      difficulties: [
        {
          difficulty: 'facile',
          strategies: [{ strategy: BASE, games: [game(1)] }],
        },
      ],
    })
    expect(single).toContain(
      'Each game starts at one difficulty on seed 1 and plays 730 days',
    )
    expect(single).toContain('### Facile')
  })
})
