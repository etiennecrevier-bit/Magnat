import { describe, expect, it } from 'vitest'
import type { DifficultyId } from '../../src/content/schema.ts'
import { createInitialState } from '../../src/engine/clock.ts'
import { applyDecision } from '../../src/engine/decisions.ts'
import { cents } from '../../src/engine/money.ts'
import type { DifficultyRun, GameResult } from './play.ts'
import {
  strategyChanges,
  type DaysOpen,
  type PriceChange,
  type Strategy,
} from './strategies.ts'
import { ranked } from './summary.ts'
import { DEFAULT_STRATEGY, designTargets, type TargetCheck } from './targets.ts'

// Each design target of #58 met, missed and out of reach, on hand-made
// games: one difficulty at a time, with only the strategies a target reads.

const BASE: Strategy = DEFAULT_STRATEGY

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
    journalHash: `books of seed ${seed}`,
    ...fields,
  }
}

/** A strategy whose games all end with `wealth` in the bank. */
function played(
  strategy: Partial<Strategy>,
  wealth: number,
  fields: Partial<GameResult> = {},
  seeds = 1,
) {
  return {
    strategy: { ...BASE, ...strategy },
    games: Array.from({ length: seeds }, (_, index) =>
      game(index + 1, { cashAtEnd: cents(wealth), ...fields }),
    ),
  }
}

/** The check of target number `target` (from 1) for one difficulty. */
function check(
  target: number,
  difficulty: DifficultyId,
  strategies: DifficultyRun['strategies'],
): TargetCheck {
  const run: DifficultyRun = { difficulty, strategies }
  const row = designTargets([{ run, ranked: ranked(run) }])[target - 1]
  const result = row?.checks[0]
  if (result === undefined) throw new Error(`No target ${target}`)
  return result
}

const NOT_APPLICABLE: TargetCheck = { met: null, measured: '' }

describe('designTargets', () => {
  it('checks eight targets, one check per difficulty in the order played', () => {
    const run = (difficulty: DifficultyId): DifficultyRun => ({
      difficulty,
      strategies: [played({}, 100)],
    })
    const rows = designTargets(
      (['difficile', 'facile'] as const).map((difficulty) => ({
        run: run(difficulty),
        ranked: ranked(run(difficulty)),
      })),
    )
    expect(rows).toHaveLength(8)
    for (const { checks } of rows) expect(checks).toHaveLength(2)
    // The default decisions are Facile's target only.
    expect(rows[2]?.checks).toEqual([
      NOT_APPLICABLE,
      { met: true, measured: '0 of 1 games below zero' },
    ])
  })

  describe('1. the best net income', () => {
    it.each([
      ['facile', 2_500_000, true],
      ['facile', 2_499_999, false],
      ['moyen', 2_500_000, true],
      ['moyen', 2_500_001, false],
      ['difficile', 500_000, true],
      ['difficile', 1_600_000, false],
    ] as const)('at %s, %i cents is met: %s', (difficulty, income, met) => {
      expect(
        check(1, difficulty, [
          played({}, 100, { netIncome: cents(income) }),
          // Richer, so ranked first, whatever the second one earned.
          played({ priceChange: 20 }, 50, { netIncome: cents(0) }),
        ]),
      ).toEqual({ met, measured: expect.stringMatching(/^\$/) })
    })

    it("reads the best strategy's, not the highest", () => {
      expect(
        check(1, 'moyen', [
          played({}, 100, { netIncome: cents(2_000_000) }),
          played({ priceChange: 20 }, 200, { netIncome: cents(0) }),
        ]),
      ).toEqual({ met: false, measured: '$0.00' })
    })
  })

  describe('2. careless play goes below zero before October 1st', () => {
    const careless = { priceChange: 40, croissantsPerDay: 110 } as const
    // September 30th is day 152; October 1st, day 153.
    const early = { wentBelowZero: true, firstDayBelowZero: 152 }
    const late = { wentBelowZero: true, firstDayBelowZero: 153 }

    function strategy(
      changes: Partial<Strategy>,
      outcomes: readonly Partial<GameResult>[],
    ) {
      return {
        strategy: { ...BASE, ...careless, ...changes },
        games: outcomes.map((fields, index) => game(index + 1, fields)),
      }
    }

    it('is met when every careless strategy goes below early in most games', () => {
      expect(
        check(2, 'moyen', [
          strategy({}, [early, early, {}]),
          strategy({ daysOpen: 5 }, [early, late, early]),
          // Not careless: never below zero, and not counted.
          played({}, 0),
        ]),
      ).toEqual({ met: true, measured: '2 of 2 strategies; lowest 67%' })
    })

    it('is missed by a strategy that goes below in only half its games, or late', () => {
      expect(
        check(2, 'difficile', [
          strategy({}, [early, {}]),
          strategy({ daysOpen: 5 }, [late, late]),
        ]),
      ).toEqual({ met: false, measured: '0 of 2 strategies; lowest 0%' })
    })

    it('is missed by one strategy that never goes below, however many others do', () => {
      // Pooled, 6 of these 9 games go below early: a false pass.
      expect(
        check(2, 'moyen', [
          strategy({}, [early, early, early]),
          strategy({ daysOpen: 5 }, [early, early, early]),
          strategy({ daysOpen: 7 }, [{}, {}, {}]),
        ]),
      ).toEqual({ met: false, measured: '2 of 3 strategies; lowest 0%' })
    })

    it('does not apply at Facile, nor without careless strategies', () => {
      expect(check(2, 'facile', [strategy({}, [early])])).toEqual(
        NOT_APPLICABLE,
      )
      expect(check(2, 'moyen', [played({}, 0)])).toEqual(NOT_APPLICABLE)
    })
  })

  describe('3. the default decisions survive year 1 at Facile', () => {
    it('keeps the starting decisions, as the content sets them', () => {
      const start = createInitialState(1)
      const { pendingDecisions } = strategyChanges(DEFAULT_STRATEGY).reduce(
        (state, change) => applyDecision(state, change),
        start,
      )
      expect(pendingDecisions).toEqual(start.decisions)
    })

    it('is met with no game below zero, missed with one', () => {
      expect(check(3, 'facile', [played({}, 0, {}, 3)])).toEqual({
        met: true,
        measured: '0 of 3 games below zero',
      })
      expect(
        check(3, 'facile', [
          {
            strategy: BASE,
            games: [game(1), game(2, { wentBelowZero: true })],
          },
        ]),
      ).toEqual({ met: false, measured: '1 of 2 games below zero' })
    })

    it('reads only the default strategy', () => {
      expect(
        check(3, 'facile', [
          played({ daysOpen: 7 }, 0, { wentBelowZero: true }),
        ]),
      ).toEqual(NOT_APPLICABLE)
    })
  })

  describe('4. the best prices are neither the cheapest nor the dearest', () => {
    it('is met when prices in between do strictly better', () => {
      expect(
        check(4, 'moyen', [
          played({ priceChange: -20 }, 100),
          played({ priceChange: 20 }, 300),
          played({ priceChange: 40 }, 200),
        ]),
      ).toEqual({
        met: true,
        measured: 'best at +20%: #1; best at -20% or +40%: #2',
      })
    })

    it('is missed when the cheapest does best', () => {
      expect(
        check(4, 'moyen', [
          played({ priceChange: -20 }, 400),
          played({ priceChange: 0 }, 300),
        ]),
      ).toMatchObject({ met: false })
    })

    it('is missed on a tie that only the grid order breaks', () => {
      expect(
        check(4, 'moyen', [
          played({ priceChange: 0 }, 300),
          played({ priceChange: 40 }, 300),
        ]),
      ).toEqual({
        met: false,
        measured: 'best at base: #1, tied; best at -20% or +40%: #2',
      })
    })
  })

  describe('5. marketing has a sweet spot at premium prices', () => {
    /** At +20% and +40%, each budget's wealth. */
    function budgets(atPlus20: number[], atPlus40: number[]) {
      return ([20, 40] as const).flatMap((priceChange, index) =>
        [0, 3000, 8000].map((budget, which) =>
          played(
            { priceChange, marketingDaily: cents(budget) },
            (index === 0 ? atPlus20 : atPlus40)[which] ?? 0,
          ),
        ),
      )
    }

    it('is met when $30 beats both $0 and $80 at both prices', () => {
      expect(check(5, 'moyen', budgets([100, 300, 200], [50, 90, 60]))).toEqual(
        {
          met: true,
          measured:
            '+20%: $0.00 #3, $30.00 #1, $80.00 #2; +40%: $0.00 #6, $30.00 #4, $80.00 #5',
        },
      )
    })

    it('is missed when $80 does as well as $30 at one price', () => {
      expect(
        check(5, 'moyen', budgets([100, 300, 200], [50, 90, 90])),
      ).toMatchObject({ met: false })
    })

    it('is missed when no marketing does best', () => {
      expect(
        check(5, 'moyen', budgets([400, 300, 200], [50, 90, 60])),
      ).toMatchObject({ met: false })
    })

    it('needs every budget at both prices', () => {
      expect(
        check(5, 'moyen', budgets([100, 300, 200], [50, 90, 60]).slice(0, 5)),
      ).toEqual(NOT_APPLICABLE)
    })
  })

  describe('6. cheap prices lose customers to the line', () => {
    function line(priceChange: PriceChange, daysOpen: DaysOpen, lost: number) {
      return played(
        { priceChange, daysOpen },
        0,
        { visits: 1000, lostToLine: lost },
        2,
      )
    }

    it('pools the rested games at each price, leaving out 7 days', () => {
      expect(
        check(6, 'moyen', [
          line(-20, 5, 40),
          line(-20, 6, 80),
          line(-20, 7, 900),
          line(0, 5, 10),
          line(0, 6, 20),
          line(0, 7, 0),
        ]),
      ).toEqual({ met: true, measured: '-20%: 6.0%; base: 1.5%' })
    })

    it('is missed under 5%, or under twice the share at base prices', () => {
      expect(check(6, 'moyen', [line(-20, 6, 49), line(0, 6, 1)])).toEqual({
        met: false,
        measured: '-20%: 4.9%; base: 0.1%',
      })
      expect(check(6, 'moyen', [line(-20, 6, 100), line(0, 6, 51)])).toEqual({
        met: false,
        measured: '-20%: 10.0%; base: 5.1%',
      })
    })

    it('needs rested games at both prices', () => {
      expect(check(6, 'moyen', [line(-20, 6, 100), line(0, 7, 0)])).toEqual(
        NOT_APPLICABLE,
      )
    })
  })

  describe('7. opening 7 days is never the best', () => {
    it('is met when fewer days do strictly better', () => {
      expect(
        check(7, 'facile', [
          played({ daysOpen: 6 }, 200),
          played({ daysOpen: 7 }, 100),
        ]),
      ).toEqual({ met: true, measured: 'best on 7 days: #2' })
    })

    it('is missed when 7 days does best', () => {
      expect(
        check(7, 'facile', [
          played({ daysOpen: 5 }, 100),
          played({ daysOpen: 7 }, 200),
        ]),
      ).toEqual({ met: false, measured: 'best on 7 days: #1' })
    })

    it('is missed on a tie that only the grid order breaks', () => {
      // 6 days comes first in the grid, so it ranks first on a tie.
      expect(
        check(7, 'difficile', [
          played({ daysOpen: 6 }, 100, { netIncome: cents(5) }),
          played({ daysOpen: 7 }, 100, { netIncome: cents(5) }),
        ]),
      ).toEqual({ met: false, measured: 'best on 7 days: #2, tied' })
    })
  })

  describe('8. paying $400 a week leaves a rent unpaid', () => {
    const low = { ownerWeeklyPay: cents(40_000) }

    it('is met when every $400 game misses a rent', () => {
      expect(
        check(8, 'moyen', [
          played(low, 0, { unpaidRents: 1 }, 3),
          // Another pay is not read.
          played({}, 0, { unpaidRents: 0 }),
        ]),
      ).toEqual({ met: true, measured: '3 of 3 games' })
    })

    it('is missed by one game that pays every rent', () => {
      expect(
        check(8, 'difficile', [
          {
            strategy: { ...BASE, ...low },
            games: [game(1, { unpaidRents: 2 }), game(2)],
          },
        ]),
      ).toEqual({ met: false, measured: '1 of 2 games' })
    })

    it('does not apply at Facile', () => {
      expect(check(8, 'facile', [played(low, 0, { unpaidRents: 1 })])).toEqual(
        NOT_APPLICABLE,
      )
    })
  })
})
