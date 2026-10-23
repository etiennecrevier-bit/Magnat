import { describe, expect, it } from 'vitest'
import { cents } from '../../src/engine/money.ts'
import type { BalanceRun, DifficultyRun, GameResult } from './play.ts'
import {
  formatCount,
  formatReport,
  HAND_WRITTEN,
  unchangedDecisions,
  withHandWritten,
} from './report.ts'
import type { Strategy } from './strategies.ts'
import {
  compareResults,
  median,
  medianCents,
  rank,
  ranked,
  summarize,
  type StrategySummary,
} from './summary.ts'

// Summing up a strategy's games, ranking the strategies and writing the
// report, on hand-made games.

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}

function game(seed: number, fields: Partial<GameResult> = {}): GameResult {
  return {
    seed,
    cashAtEnd: cents(0),
    netIncome: cents(0),
    lowestCash: cents(0),
    wentBelowZero: false,
    firstDayBelowZero: null,
    personalCash: cents(0),
    unpaidRents: 0,
    averageEnergy: 100,
    daysExhausted: 0,
    botched: 0,
    visits: 0,
    lostToLine: 0,
    unitsSold: 0,
    unitsSpoiled: 0,
    lostToStockouts: 0,
    lostToPrices: 0,
    financedAtEnd: cents(0),
    emergencyLoans: 0,
    shareSales: 0,
    journalHash: `books of seed ${seed}`,
    modifierDays: {
      walkIns: 0,
      appeal: 0,
      willingness: 0,
      unavailable: 0,
      closed: 0,
    },
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
      personalCash: cents(-200),
      unpaidRents: 2,
      averageEnergy: 80,
      daysExhausted: 0,
      botched: 3,
      lostToLine: 40,
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
      firstDayBelowZero: 31,
      personalCash: cents(5000),
      unpaidRents: 0,
      averageEnergy: 20.5,
      daysExhausted: 200,
      botched: 90,
      lostToLine: 10,
      unitsSold: 50,
      unitsSpoiled: 50,
      lostToStockouts: 2,
      lostToPrices: 10,
      emergencyLoans: 1,
      shareSales: 2,
    }),
    // Nothing sold nor spoiled: no spoilage.
    game(3, {
      cashAtEnd: cents(401),
      lowestCash: cents(200),
      personalCash: cents(99),
      unpaidRents: 1,
      averageEnergy: 50,
      daysExhausted: 7,
      botched: 1,
      lostToLine: 25,
      lostToStockouts: 9,
      lostToPrices: 1,
      emergencyLoans: 2,
      financedAtEnd: cents(300),
    }),
  ]

  it('takes the medians, the worst and the lowest over the games, and sums the financing', () => {
    expect(summarize(BASE, games, 4)).toEqual({
      strategy: BASE,
      index: 4,
      games: 3,
      // Each game's cash and personal cash together, less what is not the
      // owner's: 800, 4,700 and 500 − 300.
      medianWealth: 800,
      medianCashAtEnd: 401,
      worstCashAtEnd: -300,
      medianNetIncome: 0,
      medianPersonalCash: 99,
      medianUnpaidRents: 1,
      lowestCash: -800,
      gamesBelowZero: 1,
      medianAverageEnergy: 50,
      medianDaysExhausted: 7,
      medianBotched: 3,
      medianSpoilageRate: 0.1,
      medianLostToStockouts: 5,
      medianLostToPrices: 7,
      medianLostToLine: 25,
      emergencyLoans: 3,
      shareSales: 2,
    })
  })

  it("leaves out of the wealth the cash that is not the owner's", () => {
    const owned = game(1, { cashAtEnd: cents(1000), personalCash: cents(500) })
    const financed = { ...owned, financedAtEnd: cents(1200) }
    expect(summarize(BASE, [owned], 0).medianWealth).toBe(1500)
    expect(summarize(BASE, [financed], 0).medianWealth).toBe(300)
    expect(summarize(BASE, [financed], 0).medianCashAtEnd).toBe(1000)
  })

  it('takes the mean of the middle two of an even count', () => {
    const summary = summarize(
      BASE,
      [
        ...games,
        game(4, {
          cashAtEnd: cents(2000),
          netIncome: cents(51),
          personalCash: cents(0),
          unpaidRents: 4,
          averageEnergy: 60,
          lostToLine: 30,
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
      medianWealth: 1400,
      medianCashAtEnd: 701,
      medianNetIncome: 26,
      medianPersonalCash: 50,
      medianUnpaidRents: 1.5,
      medianAverageEnergy: 55,
      medianLostToLine: 27.5,
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
    medianWealth: number,
    medianUnpaidRents: number,
    medianNetIncome: number,
  ): StrategySummary {
    return {
      ...summarize(BASE, [game(1)], index),
      medianWealth: cents(medianWealth),
      medianUnpaidRents,
      medianNetIncome: cents(medianNetIncome),
    }
  }

  it('puts the most wealth first, then the fewest unpaid rents, then the most net income, then the run order', () => {
    const summaries = [
      summary(0, 100, 0, 5),
      summary(1, 300, 9, -10),
      summary(2, 100, 0, 7),
      summary(3, 100, 0, 5),
      summary(4, -50, 0, 1000),
      summary(5, 100, 1, 900),
    ]
    expect(rank(summaries).map(({ index }) => index)).toEqual([
      1, 2, 0, 3, 5, 4,
    ])
    expect(summaries.map(({ index }) => index)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('ranks by the wealth, not by the cash the pay leaves in the business', () => {
    const run: DifficultyRun = {
      difficulty: 'moyen',
      strategies: [
        {
          strategy: { ...BASE, ownerWeeklyPay: cents(40_000) },
          games: [
            game(1, {
              cashAtEnd: cents(9000),
              personalCash: cents(-1000),
              unpaidRents: 3,
            }),
          ],
        },
        {
          strategy: BASE,
          games: [
            game(1, { cashAtEnd: cents(6000), personalCash: cents(2000) }),
          ],
        },
      ],
    }
    expect(ranked(run).map(({ index }) => index)).toEqual([1, 0])
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

describe('compareResults', () => {
  const summary = (fields: Partial<StrategySummary>, index = 0) => ({
    ...summarize(BASE, [game(1)], index),
    ...fields,
  })

  it('is 0 for a tie on what was played, whatever the run order', () => {
    expect(compareResults(summary({}, 0), summary({}, 5))).toBe(0)
  })

  it('is below 0 when the first does better, above when it does worse', () => {
    const richer = summary({ medianWealth: cents(10) })
    const poorer = summary({ medianWealth: cents(5) })
    expect(compareResults(richer, poorer)).toBeLessThan(0)
    expect(compareResults(poorer, richer)).toBeGreaterThan(0)
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
    ownerWeeklyPay: cents(70_000),
  }
  const winning = [
    game(1, {
      cashAtEnd: cents(123_456),
      netIncome: cents(10_000),
      lowestCash: cents(-5),
      wentBelowZero: true,
      firstDayBelowZero: 3,
      personalCash: cents(50_000),
      unpaidRents: 0,
      averageEnergy: 61.25,
      daysExhausted: 10,
      botched: 40,
      visits: 30_000,
      lostToLine: 300,
      unitsSold: 900,
      unitsSpoiled: 100,
      lostToStockouts: 3,
      lostToPrices: 1200,
      emergencyLoans: 1,
      shareSales: 1,
      journalHash: 'a1',
    }),
    game(2, {
      cashAtEnd: cents(100_001),
      netIncome: cents(20_001),
      lowestCash: cents(50),
      personalCash: cents(49_999),
      unpaidRents: 1,
      averageEnergy: 70,
      daysExhausted: 12,
      botched: 45,
      visits: 31_000,
      lostToLine: 351,
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
      firstDayBelowZero: 0,
      personalCash: cents(-100_000),
      unpaidRents: 12,
      emergencyLoans: 2,
      shareSales: 2,
      journalHash: `b${seed}`,
    }),
  )
  const run: BalanceRun = {
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
              ownerWeeklyPay: cents(40_000),
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
  }
  const report = formatReport(run)
  const lines = report.split('\n')

  const HEADER =
    '| # | Prices | Croissants/day | Marketing/day | Days open | Pay/week | Median wealth at end | Median cash at end | Worst cash at end | Median net income | Personal cash at end | Unpaid rents | Lowest cash | Below zero | Average energy | Days exhausted | Botched | Spoilage | Lost to stockouts | Lost to prices | Lost to the line | Emergency loans | Share sales |'
  const ALIGN = `| ---: | --- |${' ---: |'.repeat(21)}`
  const FIRST =
    '| 1 | +20% | 110 | $30.00 | 7 | $700.00 | $1,617.28 | $1,117.29 | $1,000.01 | $150.01 | $500.00 | 0.5 | -$0.05 | 50% | 65.6 | 11 | 42.5 | 15.0% | 3.5 | 1,250.5 | 325.5 | 1 | 1 |'
  const SECOND =
    '| 2 | +20% | 110 | $0.00 | 7 | $700.00 | $1,617.28 | $1,117.29 | $1,000.01 | $150.01 | $500.00 | 0.5 | -$0.05 | 50% | 65.6 | 11 | 42.5 | 15.0% | 3.5 | 1,250.5 | 325.5 | 1 | 1 |'
  const LAST =
    '| 3 | -20% | 40 | $0.00 | 6 | $400.00 | -$21,000.00 | -$20,000.00 | -$20,000.00 | -$10,000.00 | -$1,000.00 | 12 | -$25,000.00 | 100% | 100.0 | 0 | 0 | 0.0% | 0 | 0 | 0 | 4 | 4 |'

  it('opens with the command that wrote it and what each game plays', () => {
    expect(lines.slice(0, 3)).toEqual([
      '# Balance report: phase 2',
      '',
      'Generated by `npm run balance -- --years 1 --games 2`: do not edit by hand, except under the comment at the end that says so. The numbers go stale whenever the engine or the content changes; run the command again then.',
    ])
    expect(lines).toContain(
      'Each game starts at one difficulty on one of seeds 1 to 2 and plays 365 days from May 1st, year 1, with one strategy in effect from day 0. A strategy sets:',
    )
    expect(lines).toContain(
      '- every price at -20%, base, +20%, +40% from the starting prices (Café $3.25, Chocolat chaud $3.50, Croissant $3.75, Limonade $4.00), rounded half up to the price step;',
    )
    expect(lines).toContain(
      '- the days open, a week: 5, 6, 7, where 6 closes on Monday and 5 on Sunday and Monday;',
    )
    expect(lines).toContain(
      "- the owner's pay, a week: $400.00, $700.00, $1,000.00.",
    )
    expect(lines).toContain(
      'Café and chocolat chaud keep their starting restock rules. Each difficulty plays 3 strategies × 2 games.',
    )
    expect(lines).toContain(
      '- **#**: the rank by median wealth at the end, highest first; ties go to the fewer median unpaid rents, then to the higher median net income, then to the strategy listed first in the grid.',
    )
    expect(report).not.toContain('#62')
  })

  it('checks the design targets of a one-year run, before the tables', () => {
    const start = lines.indexOf('## Design targets')
    const end = lines.indexOf('## Best and worst')
    expect(start).toBeGreaterThan(lines.indexOf('## Columns'))
    expect(end).toBeGreaterThan(start)
    const section = lines.slice(start, end)
    expect(section.slice(4, 6)).toEqual(['| Target | Moyen |', '| --- | --- |'])
    const rows = section.slice(6, -1)
    expect(rows).toHaveLength(8)
    expect(section.at(-1)).toBe('')
    // Moyen's net income target, the default decisions' (Facile only) and
    // the price target, as the run plays them.
    expect(rows[0]).toMatch(
      /^\| The best strategy's net income .* \| ✗ \$150\.01 \|$/,
    )
    expect(rows[2]).toMatch(/ \| n\/a \|$/)
    expect(rows[3]).toMatch(
      / \| ✓ best at \+20%: #1; best at -20% or \+40%: #3 \|$/,
    )
  })

  it('checks no design target over more than one year', () => {
    const twoYears = formatReport({ ...run, years: 2 })
    expect(twoYears).not.toContain('## Design targets')
    expect(twoYears).toContain('plays 730 days')
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

  it('names how the event cards were answered, when they came up', () => {
    const generated = (events?: 'first' | 'random' | 'none') =>
      formatReport({ ...run, events })
        .split('\n')
        .filter(
          (line) =>
            line.startsWith('Generated by') ||
            line.startsWith('The event cards'),
        )
    expect(generated()).toEqual(generated('none'))
    expect(generated('none')).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2`:',
      ),
    ])
    expect(generated('random')).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2 --events random`:',
      ),
      'The event cards come up, and the player answers each with a choice drawn at random, seeded from the game.',
    ])
    expect(generated('first')[1]).toBe(
      'The event cards come up, and the player answers each with its first choice.',
    )
  })

  it("names how the grocers' cards were answered, when a policy answered them", () => {
    const generated = (
      contracts?: 'all' | 'none' | 'first',
      events: 'first' | 'random' | 'none' = 'none',
    ) =>
      formatReport({ ...run, events, ...(contracts && { contracts }) })
        .split('\n')
        .filter(
          (line) =>
            line.startsWith('Generated by') ||
            line.startsWith('The grocers') ||
            line.startsWith('No card'),
        )
    expect(generated()).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2`:',
      ),
    ])
    expect(generated('all')).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2 --contracts all`:',
      ),
      'The grocers offer their contracts, their cards alone coming up, and the player accepts every one, renewals included.',
    ])
    expect(generated('first', 'random')).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2 --events random --contracts first`:',
      ),
      "The grocers offer their contracts and the player accepts the first grocer's, and its renewals, and refuses the others.",
    ])
    expect(generated('none')).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2 --contracts none`:',
      ),
      "No card comes up, not even the grocers': no contract is offered or signed.",
    ])
    expect(generated('none', 'random')[1]).toBe(
      'The grocers offer their contracts and the player refuses every one.',
    )
  })

  it("names how the financing's cards were answered, when a policy answered them", () => {
    const generated = (financing?: 'accept' | 'refuse') =>
      formatReport({ ...run, ...(financing && { financing }) })
        .split('\n')
        .filter(
          (line) =>
            line.startsWith('Generated by') ||
            line.startsWith('When the encaisse'),
        )
    expect(generated()).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2`:',
      ),
    ])
    expect(generated('accept')).toEqual([
      expect.stringContaining(
        'Generated by `npm run balance -- --years 1 --games 2 --financing accept`:',
      ),
      "When the encaisse closes below zero, the engine brings Mme Prudhomme's emergency loan or Max Duvent's offer for shares (#159), whatever the other cards, and the player accepts them: the loan, and the investor's shares. The wealth at the end leaves out the cash they bring in, which is not the owner's, and counts what they cost: the fee, the interest and the dividends. The last two columns show the strategies that needed them.",
    ])
    expect(generated('refuse')[1]).toBe(
      "When the encaisse closes below zero, the engine brings Mme Prudhomme's emergency loan or Max Duvent's offer for shares (#159), whatever the other cards, and the player refuses them.",
    )
    expect(lines).toContain(
      "- **Emergency loans**, **Share sales**: the emergency loans taken from Mme Prudhomme and the rounds of shares sold to Max Duvent, summed over the strategy's games; 0 when their cards never came up or were refused.",
    )
  })

  it('counts the days the street was changed, only when the event cards came up', () => {
    const changed = (seed: number, walkIns: number, closed: number) =>
      game(seed, {
        modifierDays: {
          walkIns,
          appeal: 5,
          willingness: 0,
          unavailable: 2,
          closed,
        },
      })
    const difficulty = (
      id: 'facile' | 'difficile',
      games: GameResult[][],
    ): DifficultyRun => ({
      difficulty: id,
      strategies: games.map((played, index) => ({
        strategy: { ...BASE, croissantsPerDay: 40 + index },
        games: played,
      })),
    })
    const withStreet: BalanceRun = {
      years: 2,
      games: 2,
      events: 'random',
      difficulties: [
        // The median over every game, whatever its strategy: 15, 20, 30
        // and 45 walk-in days.
        difficulty('facile', [
          [changed(1, 15, 0), changed(2, 45, 1)],
          [changed(1, 20, 3), changed(2, 30, 1)],
        ]),
        difficulty('difficile', [[changed(1, 0, 2), changed(2, 7, 2)]]),
      ],
    }
    const street = (text: string) => {
      const all = text.split('\n')
      const at = all.indexOf('## Street changes')
      return at === -1 ? [] : all.slice(at, all.indexOf('## Best and worst'))
    }
    expect(street(formatReport(withStreet))).toEqual([
      '## Street changes',
      '',
      'The days of a game each kind of change to the street was in effect, median over every game of the difficulty, whatever its strategy. A day counts once for a kind, however many changes of that kind it had.',
      '',
      '| Change | Facile | Difficile |',
      '| --- | ---: | ---: |',
      '| walkIns | 25 | 3.5 |',
      '| appeal | 5 | 5 |',
      '| willingness | 0 | 0 |',
      '| unavailable | 2 | 2 |',
      '| closed | 1 | 2 |',
      '',
    ])
    expect(street(formatReport({ ...withStreet, events: 'none' }))).toEqual([])
    expect(street(formatReport({ ...withStreet, events: undefined }))).toEqual(
      [],
    )
    expect(street(report)).toEqual([])
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

describe('withHandWritten', () => {
  const report = '# Report\n\nNew numbers.\n'

  it('keeps everything from the hand-written line on, after a blank line', () => {
    const previous = [
      '# Report',
      '',
      'Old numbers.',
      '',
      HAND_WRITTEN,
      '',
      '## Before and after',
      '',
      'Written by hand.',
      '',
    ].join('\n')
    expect(withHandWritten(previous, report)).toBe(
      [
        '# Report',
        '',
        'New numbers.',
        '',
        HAND_WRITTEN,
        '',
        '## Before and after',
        '',
        'Written by hand.',
        '',
      ].join('\n'),
    )
  })

  it('gives the report alone with no hand-written line or no file', () => {
    expect(withHandWritten('# Report\n\nOld numbers.\n', report)).toBe(report)
    expect(withHandWritten(null, report)).toBe(report)
  })

  it('writes the same file again when nothing changed', () => {
    const once = withHandWritten(`old\n${HAND_WRITTEN}\nmine\n`, report)
    expect(withHandWritten(once, report)).toBe(once)
  })
})
