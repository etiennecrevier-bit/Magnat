import { describe, expect, it } from 'vitest'
import type { DifficultyId } from '../../src/content/schema.ts'
import { cents } from '../../src/engine/money.ts'
import {
  CONTRACT_PLANS,
  GROWTH_STRATEGIES,
  type GrowthGame,
  type GrowthStrategy,
} from './growth.ts'
import {
  CAREFUL,
  GROWTH_END,
  GROWTH_MARKERS,
  GROWTH_START,
  NAIVE,
  formatGrowthSection,
  growthCommand,
  growthTargets,
  rankStrategies,
  sameStrategy,
  strategiesAt,
  titleFloor,
  type GrowthReportRun,
  type Verdict,
} from './growthReport.ts'
import {
  HAND_WRITTEN,
  sectionOf,
  withHandWritten,
  withSection,
} from './report.ts'

// The growth section of the phase-4 report, from games made up for the
// test.

const DIFFICULTIES: readonly DifficultyId[] = ['facile', 'moyen', 'difficile']

/** A game that never goes below zero, at a net worth of $50,000. */
function game(overrides: Partial<GrowthGame> = {}): GrowthGame {
  return {
    seed: 1,
    netWorthAtMonthEnds: [],
    netWorthAtEnd: cents(5_000_000),
    firstDayBelowZero: null,
    lowestClose: cents(100_000),
    emergencyLoans: 0,
    shareSales: 0,
    duventCame: false,
    endedDay: null,
    magnat: false,
    rungsBought: 0,
    signings: [],
    withoutDuvent: null,
    ...overrides,
  }
}

/**
 * A run of two seeds at every difficulty and strategy, each game as
 * `games` makes it, by default `game()`.
 */
function run(
  games: (
    strategy: GrowthStrategy,
    difficulty: DifficultyId,
    seed: number,
  ) => GrowthGame = () => game(),
): GrowthReportRun {
  return {
    games: 2,
    months: 24,
    runs: DIFFICULTIES.flatMap((difficulty) =>
      CONTRACT_PLANS.map((contracts) => ({
        difficulty,
        contracts,
        games: 2,
        months: 24,
        strategies: GROWTH_STRATEGIES.filter(
          (strategy) => strategy.contracts === contracts,
        ).map((strategy) => ({
          strategy,
          games: [1, 2].map((seed) => ({
            ...games(strategy, difficulty, seed),
            seed,
          })),
        })),
      })),
    ),
  }
}

const isNaive = (strategy: GrowthStrategy) => sameStrategy(strategy, NAIVE)
const isCareful = (strategy: GrowthStrategy) =>
  sameStrategy(strategy, { ...CAREFUL, financing: strategy.financing })
const BEST: GrowthStrategy = {
  contracts: 'two',
  bakery: 'day0',
  atTruck: false,
  dream: false,
  financing: 'accept',
}

/** A run where every target of #166 holds. */
function onTarget(): GrowthReportRun {
  return run((strategy, difficulty, seed) => {
    if (isNaive(strategy)) {
      return difficulty === 'facile'
        ? game({ firstDayBelowZero: 100, emergencyLoans: 1 })
        : // Day 40, June 10th: month 2.
          game({ firstDayBelowZero: 40, emergencyLoans: 1 })
    }
    if (sameStrategy(strategy, BEST)) {
      const title = difficulty === 'difficile' ? 'Débrouillard' : 'Commerçant'
      return game({ netWorthAtEnd: cents(titleFloor(title) + 1) })
    }
    // A few of the games that took Max Duvent's money gain by it.
    if (strategy.contracts === 'three' && strategy.financing === 'accept') {
      return game({
        firstDayBelowZero: 40,
        emergencyLoans: 1,
        shareSales: 1,
        duventCame: true,
        withoutDuvent: {
          endedDay: null,
          netWorthAtEnd: cents(
            strategy.bakery === 'never' && seed === 1 ? 4_000_000 : 6_000_000,
          ),
        },
      })
    }
    return game()
  })
}

/** Each target's verdicts, Facile, Moyen and Difficile. */
function verdicts(played: GrowthReportRun): Verdict[][] {
  return growthTargets(played).map(({ checks }) =>
    DIFFICULTIES.map((difficulty) => checks[difficulty].verdict),
  )
}

describe('rankStrategies', () => {
  it('ranks by the median net worth at the end, a tie to the strategy first in the grid', () => {
    const played = strategiesAt(
      run((strategy) =>
        game({
          netWorthAtEnd: cents(
            sameStrategy(strategy, BEST)
              ? 9_000_000
              : strategy.contracts === 'careful'
                ? 7_000_000
                : 5_000_000,
          ),
        }),
      ),
      'moyen',
    )
    expect(played.map(({ strategy }) => strategy)).toEqual(GROWTH_STRATEGIES)
    const ranked = rankStrategies([...played].reverse())
    expect(ranked[0]).toMatchObject({ rank: 1, strategy: BEST })
    // The careful ones next, in the grid's order, then the rest in theirs.
    const careful = GROWTH_STRATEGIES.filter(
      ({ contracts }) => contracts === 'careful',
    )
    expect(ranked.slice(1, 1 + careful.length).map((r) => r.strategy)).toEqual(
      careful,
    )
    expect(ranked[1 + careful.length]?.strategy).toEqual(GROWTH_STRATEGIES[0])
    expect(ranked.at(-1)).toMatchObject({
      rank: 120,
      medianNetWorth: 5_000_000,
    })
  })
})

describe('growthTargets', () => {
  it('meets every target of #166 when the games do, the titles set only at Facile and Difficile', () => {
    const targets = growthTargets(onTarget())
    expect(targets.map(({ target }) => target)).toEqual([
      'The naive strategy (three contracts on day 30, nothing else): at Moyen and Difficile, more than half its games first close below zero in month 2 or 3; elsewhere, more than half take an emergency loan and none goes bankrupt',
      'The careful strategy (one contract at a time, with a reserve, nothing else) never closes below zero, the financing accepted or refused',
      "The best strategy's median net worth at the end of month 24 earns at least « Commerçant » at Facile and « Débrouillard » at Difficile",
      'No game of any strategy reaches « Magnat » within 24 months',
      "Max Duvent's money is worth taking in 10% to 50% of the games that take it",
    ])
    expect(verdicts(onTarget())).toEqual([
      ['met', 'met', 'met'],
      ['met', 'met', 'met'],
      ['met', 'n/a', 'met'],
      ['met', 'met', 'met'],
      ['met', 'met', 'met'],
    ])
    const [naive, careful, title, magnat, duvent] = targets
    expect(naive?.checks.facile.measured).toBe(
      '2 of 2 take a loan, 0 go bankrupt',
    )
    expect(naive?.checks.moyen.measured).toBe(
      '2 of 2 in month 2 or 3, median month 2.0',
    )
    expect(careful?.checks.moyen.measured).toBe(
      '0 of 4 close below zero (2 seeds, both policies); signs at the median on never, never, never',
    )
    expect(title?.checks.moyen.measured).toBe(
      '« Commerçant », $100,000.01 (contracts two, bakery day0, no employee, no dream, financing accept)',
    )
    expect(magnat?.checks.difficile.measured).toBe('0 of 240 games')
    expect(duvent?.checks.facile.measured).toBe('14%, 3 of 22')
  })

  it('misses each target when the games say so', () => {
    // Every game at $20,000: below « Débrouillard », the first title.
    const poor = (played: GrowthGame) => ({
      ...played,
      netWorthAtEnd: cents(2_000_000),
    })
    const missed = run((strategy, difficulty, seed) => {
      if (isNaive(strategy)) {
        // Below zero in month 4 at Moyen and Difficile; bankrupt at Facile.
        return poor(
          difficulty === 'facile'
            ? game({ emergencyLoans: 1, endedDay: 300 })
            : game({ firstDayBelowZero: 100 }),
        )
      }
      if (isCareful(strategy) && seed === 2) {
        return poor(game({ firstDayBelowZero: 200 }))
      }
      if (sameStrategy(strategy, BEST)) {
        return poor(game({ magnat: difficulty === 'moyen' }))
      }
      // Max Duvent always worth taking.
      if (strategy.contracts === 'three' && strategy.financing === 'accept') {
        return poor(
          game({
            duventCame: true,
            withoutDuvent: { endedDay: 300, netWorthAtEnd: cents(0) },
          }),
        )
      }
      return poor(game())
    })
    expect(verdicts(missed)).toEqual([
      ['missed', 'missed', 'missed'],
      ['missed', 'missed', 'missed'],
      ['missed', 'n/a', 'missed'],
      ['met', 'missed', 'met'],
      ['missed', 'missed', 'missed'],
    ])
    const [naive, careful, , , duvent] = growthTargets(missed)
    expect(naive?.checks.facile.measured).toBe(
      '2 of 2 take a loan, 2 go bankrupt',
    )
    expect(naive?.checks.difficile.measured).toBe(
      '0 of 2 in month 2 or 3, median month 4.0',
    )
    expect(careful?.checks.facile.measured).toMatch(/^2 of 4 close below zero/)
    expect(duvent?.checks.moyen.measured).toBe('100%, 22 of 22')
  })

  it('meets a title with a higher one, and knows only the titles of dream.json', () => {
    const rich = run((strategy) =>
      sameStrategy(strategy, BEST)
        ? game({ netWorthAtEnd: cents(titleFloor('Entrepreneur')) })
        : game({ netWorthAtEnd: cents(titleFloor('Débrouillard') - 1) }),
    )
    const [, , title] = growthTargets(rich)
    expect(DIFFICULTIES.map((d) => title?.checks[d].verdict)).toEqual([
      'met',
      'n/a',
      'met',
    ])
    expect(title?.checks.facile.measured).toMatch(/^« Entrepreneur », /)
    // Just under « Commerçant » at Facile.
    const short = run((strategy) =>
      game({
        netWorthAtEnd: cents(
          sameStrategy(strategy, BEST)
            ? titleFloor('Commerçant') - 1
            : titleFloor('Débrouillard'),
        ),
      }),
    )
    expect(growthTargets(short)[2]?.checks.facile).toMatchObject({
      verdict: 'missed',
      measured: expect.stringMatching(/^« Débrouillard », \$99,999\.99 /),
    })
    expect(() => titleFloor('Baron')).toThrow('No title is named Baron')
  })

  it('needs more than half of the naive games, and at least one game that took Max Duvent', () => {
    // One of two naive games in month 2: not more than half.
    const half = run((strategy, _difficulty, seed) =>
      isNaive(strategy)
        ? game({
            firstDayBelowZero: seed === 1 ? 40 : 200,
            emergencyLoans: seed - 1,
          })
        : game(),
    )
    const [naive, , , , duvent] = verdicts(half)
    expect(naive).toEqual(['missed', 'missed', 'missed'])
    expect(duvent).toEqual(['n/a', 'n/a', 'n/a'])
    expect(growthTargets(half)[4]?.checks.moyen.measured).toBe('he never came')
  })

  it('is not applicable to a difficulty the run did not play', () => {
    const played = onTarget()
    const facileOnly = {
      ...played,
      runs: played.runs.filter(({ difficulty }) => difficulty === 'facile'),
    }
    expect(verdicts(facileOnly).map(([, moyen]) => moyen)).toEqual([
      'n/a',
      'n/a',
      'n/a',
      'n/a',
      'n/a',
    ])
  })
})

describe('formatGrowthSection', () => {
  const section = formatGrowthSection(onTarget())

  it('stands between its markers and says how to write it again', () => {
    const lines = section.split('\n')
    expect(lines[0]).toBe(GROWTH_START)
    expect(lines.at(-1)).toBe(GROWTH_END)
    expect(growthCommand(onTarget())).toBe(
      'npm run balance -- --growth --games 2 --months 24',
    )
    expect(section).toContain(
      'Generated by `npm run balance -- --growth --games 2 --months 24`',
    )
  })

  it('has its parts, a table of the 120 strategies per difficulty', () => {
    expect(section.split('\n').filter((line) => line.startsWith('#'))).toEqual([
      '## Growth (#166)',
      '### What each game plays',
      '### Targets (#166)',
      '### Strategies by difficulty',
      '#### Facile',
      '#### Moyen',
      '#### Difficile',
      '### Max Duvent',
    ])
    const rows = section.split('\n').filter((line) => /^\| \d+ \|/.test(line))
    expect(rows).toHaveLength(3 * 120)
    expect(rows[0]).toBe(
      '| 1 | two | day0 | no | no | accept | Commerçant | $100,000.01 | $100,000.01 | $1,000.00 | 0 of 2 | - | 0 | 0 | 0 | 0 |',
    )
    expect(section).toContain(
      '| three | never | no | no | accept | Débrouillard | $50,000.00 | $50,000.00 | $1,000.00 | 2 of 2 | 2 | 2 | 0 | 0 | 0 |',
    )
  })

  it('shows the targets, and what Max Duvent was worth at each difficulty', () => {
    expect(section).toContain(
      '| No game of any strategy reaches « Magnat » within 24 months | ✓ 0 of 240 games | ✓ 0 of 240 games | ✓ 0 of 240 games |',
    )
    expect(section).toMatch(/\| n\/a « Commerçant », \$100,000\.01 /)
    expect(section).toContain('| Facile | 22 | 14%, 3 | 0 | 3 | 0 |')
  })

  it("is kept by --bakery's report, and keeps the rest of the file", () => {
    const bakery = '# Balance report: phase 4\n\nBaked.\n'
    const tail = [HAND_WRITTEN, '', '## Mine', '', 'Kept.', '']
    const written = [bakery.trimEnd(), '', section, '', ...tail].join('\n')
    // --growth again: only its section changes.
    const regrown = withSection(written, section, GROWTH_MARKERS)
    expect(regrown).toBe(written)
    const replaced = withSection(
      written,
      [GROWTH_START, 'New.', GROWTH_END].join('\n'),
      GROWTH_MARKERS,
    )
    expect(replaced).toBe(
      [
        bakery.trimEnd(),
        '',
        GROWTH_START,
        'New.',
        GROWTH_END,
        '',
        ...tail,
      ].join('\n'),
    )
    // --bakery again: a new report, the growth section and the hand-written
    // part kept, in that order.
    const rebaked = withHandWritten(
      written,
      withSection(
        '# Balance report: phase 4\n\nBaked again.\n',
        sectionOf(written, GROWTH_MARKERS),
        GROWTH_MARKERS,
      ),
    )
    expect(rebaked).toBe(
      [
        '# Balance report: phase 4',
        '',
        'Baked again.',
        '',
        section,
        '',
        ...tail,
      ].join('\n'),
    )
    // The first --growth goes before the hand-written part.
    expect(
      withSection(
        [bakery.trimEnd(), '', ...tail].join('\n'),
        section,
        GROWTH_MARKERS,
      ),
    ).toBe(written)
    expect(sectionOf(bakery, GROWTH_MARKERS)).toBeNull()
  })
})
