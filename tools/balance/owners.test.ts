import { describe, expect, it } from 'vitest'
import { EVENTS } from '../../src/engine/day.ts'
import { cents } from '../../src/engine/money.ts'
import { PERCENTILES as SHIPPED } from '../../src/engine/percentiles.ts'
import { incomeStatement } from '../../src/finance/statements.ts'
import {
  eventChooser,
  journalHash,
  playMorning,
  simulate,
  startGame,
} from '../sim/simulate.ts'
import {
  adapts,
  DAYS_PER_WEEK,
  halfAwayFromZero,
  ownerStrategy,
  percentileRow,
  percentileRows,
  playOwner,
  quantileCents,
  runOwners,
  stagedPercentiles,
  type OwnerGame,
} from './owners.ts'
import { STRATEGIES, strategyChanges } from './strategies.ts'

// The simulated owners: the strategy each holds, the bénéfice net noted at
// each Sunday's close, the occurrence of each card branched, the standing
// that drew each card at Facile, the table they make against themselves,
// and the percentiles of a week.

describe('ownerStrategy', () => {
  it('draws the same strategy of the grid for a seed, every time', () => {
    for (const seed of [0, 1, 2, 999, 2 ** 32 - 1]) {
      const strategy = ownerStrategy(seed)
      expect(STRATEGIES).toContain(strategy)
      expect(ownerStrategy(seed)).toBe(strategy)
    }
  })

  it('spreads the owners over the grid', () => {
    const drawn = new Set(
      Array.from({ length: 1000 }, (_, index) => ownerStrategy(index + 1)),
    )
    expect(drawn.size).toBeGreaterThan(STRATEGIES.length * 0.9)
  })

  it('throws on a seed the generator does not accept', () => {
    expect(() => ownerStrategy(-1)).toThrow(RangeError)
    expect(() => ownerStrategy(1.5)).toThrow(RangeError)
  })
})

describe('playOwner', () => {
  const seed = 7
  const weeks = 12
  const game = playOwner(seed, 'moyen', weeks)

  it('notes the bénéfice net from day 0 to each Sunday, as the books of the same game have it', () => {
    // The same game as `npm run sim -- --events random` with the owner's
    // decisions, by its books.
    const choose = eventChooser('random', seed)
    let state = startGame(seed, 'moyen', strategyChanges(ownerStrategy(seed)))
    for (let day = 0; day < weeks * DAYS_PER_WEEK; day += 1) {
      state = playMorning(state, EVENTS, choose)
    }
    expect(journalHash(state.journal)).toBe(
      simulate(
        seed,
        weeks * DAYS_PER_WEEK,
        'moyen',
        strategyChanges(ownerStrategy(seed)),
        'random',
      ).journalHash,
    )
    expect(game.strategy).toBe(ownerStrategy(seed))
    expect(game.weeklyNetIncome).toEqual(
      Array.from(
        { length: weeks },
        (_, week) =>
          incomeStatement(state.journal, 0, DAYS_PER_WEEK * (week + 1) - 1)
            .netIncome.amount,
      ),
    )
  })

  it('branches one occurrence of each card that came up, in the order of the content, without changing the game', () => {
    const played = simulate(
      seed,
      weeks * DAYS_PER_WEEK,
      'moyen',
      strategyChanges(ownerStrategy(seed)),
      'random',
    )
    const cameUp = EVENTS.events
      .map(({ id }) => id)
      .filter((id) => played.eventHistory.some(({ event }) => event === id))
    expect(cameUp.length).toBeGreaterThan(1)
    expect(game.events.map(({ event }) => event)).toEqual(cameUp)
    for (const { event, day, choices } of game.events) {
      expect(
        played.eventHistory.some(
          (record) => record.event === event && record.day === day,
        ),
      ).toBe(true)
      const card = EVENTS.events.find(({ id }) => id === event)
      expect(choices.map(({ choice }) => choice)).toEqual(
        card?.choices.map(({ id }) => id),
      )
    }
    expect(playOwner(seed, 'moyen', weeks, { branch: false })).toEqual({
      ...game,
      events: [],
    })
  })

  it('plays the same game for the same seed', () => {
    expect(playOwner(seed, 'moyen', weeks)).toEqual(game)
  })

  it('notes the standing that drew each card where the draw follows it, and only there', () => {
    expect(adapts(EVENTS, 'facile')).toBe(true)
    expect(adapts(EVENTS, 'moyen')).toBe(false)
    expect(game.draws).toEqual([])
    const facile = playOwner(seed, 'facile', weeks, { branch: false })
    const played = simulate(
      seed,
      weeks * DAYS_PER_WEEK,
      'facile',
      strategyChanges(ownerStrategy(seed)),
      'random',
    )
    expect(facile.draws.map(({ event }) => event)).toEqual(
      played.eventHistory
        .filter(({ followUp }) => !followUp)
        .map(({ event }) => event),
    )
    for (const { standing } of facile.draws) {
      expect(['behind', 'average', 'ahead']).toContain(standing)
    }
  })

  it.each([0, 1.5, -2])('throws on %d weeks', (bad) => {
    expect(() => playOwner(seed, 'moyen', bad)).toThrow(RangeError)
  })
})

describe('runOwners', () => {
  it('plays seeds 1 to games for years of 52 weeks', () => {
    const run = runOwners({ years: 1, games: 2, difficulty: 'facile' })
    expect(run.difficulty).toBe('facile')
    expect(run.games.map(({ seed }) => seed)).toEqual([1, 2])
    for (const { weeklyNetIncome } of run.games) {
      expect(weeklyNetIncome).toHaveLength(52)
    }
  }, 30_000)

  it('plays the Facile owners against the table they make, so it does not depend on the table before', () => {
    // The owners of a generation play against the table shipped by the one
    // before. With the table these owners make shipped, the next generation
    // plays the same games, and so makes the same table.
    const games = 12
    const weeks = 10
    const table = stagedPercentiles(games, 'facile', weeks)
    const rows = table.difficulties.facile
    expect(rows).toHaveLength(weeks)
    const next = Array.from({ length: games }, (_, index) =>
      playOwner(index + 1, 'facile', weeks, {
        branch: false,
        percentiles: table,
      }),
    )
    expect(percentileRows(next)).toEqual(rows)
    // Not by chance: against the shipped table, the same owners stand
    // elsewhere, so the table each owner reads matters.
    const shipped = Array.from({ length: games }, (_, index) =>
      playOwner(index + 1, 'facile', weeks, {
        branch: false,
        percentiles: SHIPPED,
      }),
    )
    expect(shipped.map(({ draws }) => draws)).not.toEqual(
      next.map(({ draws }) => draws),
    )
  }, 30_000)

  it.each([
    [{ years: 0, games: 1 }, 'Years must be a whole number from 1: 0'],
    [{ years: 1, games: 0 }, 'Games must be a whole number from 1: 0'],
  ])('throws on %j', (options, message) => {
    expect(() => runOwners({ ...options, difficulty: 'moyen' })).toThrow(
      message,
    )
  })
})

describe('an owner who goes bankrupt (#160)', () => {
  // Owner 3 at Difficile: the close of day 244, the Sunday of week 35, ends
  // the game. Two weeks more are played around it.
  const WEEKS = 37

  it('stops at the end, its bénéfice net that of its last close every week after', () => {
    let state = startGame(3, 'difficile', strategyChanges(ownerStrategy(3)))
    const choose = eventChooser('random', 3)
    while (state.ended === null) state = playMorning(state, EVENTS, choose)
    expect(state.ended).toEqual({ reason: 'bankruptcy', day: 244 })
    const { weeklyNetIncome } = playOwner(3, 'difficile', WEEKS, {
      branch: false,
    })
    expect(weeklyNetIncome).toHaveLength(WEEKS)
    const last = incomeStatement(state.journal, 0, 244).netIncome.amount
    expect(weeklyNetIncome.slice(34)).toEqual([last, last, last])
  })

  it('leaves the table the owners make the one they played, a bankrupt owner among them', () => {
    const staged = stagedPercentiles(3, 'difficile', WEEKS)
    const played = [1, 2, 3].map((seed) =>
      playOwner(seed, 'difficile', WEEKS, {
        branch: false,
        percentiles: staged,
      }),
    )
    expect(staged.difficulties.difficile).toHaveLength(WEEKS)
    expect(percentileRows(played)).toEqual(staged.difficulties.difficile)
  })
})

describe('quantileCents', () => {
  it('is linear between the closest ranks', () => {
    const sorted = [10, 20, 30, 40, 50]
    expect(quantileCents(sorted, 0)).toBe(10)
    expect(quantileCents(sorted, 10)).toBe(14)
    expect(quantileCents(sorted, 50)).toBe(30)
    expect(quantileCents(sorted, 95)).toBe(48)
    expect(quantileCents(sorted, 100)).toBe(50)
  })

  it('rounds half away from zero to the cent', () => {
    expect(quantileCents([1, 2], 50)).toBe(2)
    expect(quantileCents([-2, -1], 50)).toBe(-2)
    expect(quantileCents([-3, -2], 25)).toBe(-3)
    expect(quantileCents([0, 1], 49)).toBe(0)
    expect(quantileCents([0, 1], 51)).toBe(1)
  })

  it('gives the one amount there is at every percentile', () => {
    for (const percentile of [0, 5, 50, 95, 100]) {
      expect(quantileCents([-1234], percentile)).toBe(-1234)
    }
  })

  it('is exact for large amounts', () => {
    const big = 900_000_000_000
    expect(quantileCents([big, big + 1], 50)).toBe(big + 1)
  })

  it('throws on no amounts or a percentile outside 0 to 100', () => {
    expect(() => quantileCents([], 50)).toThrow(RangeError)
    for (const bad of [-1, 101, 2.5, Number.NaN]) {
      expect(() => quantileCents([1, 2], bad)).toThrow(RangeError)
    }
  })
})

describe('halfAwayFromZero', () => {
  it.each([
    [5, 2, 3],
    [3, 2, 2],
    [-5, 2, -3],
    [149, 100, 1],
    [150, 100, 2],
    [-150, 100, -2],
    [0, 100, 0],
  ])('%d / %d is %d', (numerator, denominator, expected) => {
    expect(halfAwayFromZero(numerator, denominator)).toBe(expected)
  })
})

describe('percentileRows', () => {
  function game(seed: number, weekly: readonly number[]): OwnerGame {
    return {
      seed,
      strategy: ownerStrategy(seed),
      weeklyNetIncome: weekly.map(cents),
      draws: [],
      events: [],
    }
  }

  it('gives each week the percentiles of every game that week', () => {
    const games = [
      game(1, [300, -10]),
      game(2, [100, -30]),
      game(3, [200, -20]),
    ]
    expect(percentileRows(games, [10, 50, 90])).toEqual([
      [120, 200, 280],
      [-28, -20, -12],
    ])
  })

  it('takes the amounts of one week in any order', () => {
    expect(percentileRow([300, 100, 200], [10, 50, 90])).toEqual([
      120, 200, 280,
    ])
  })

  it('throws on no games, or games of different lengths', () => {
    expect(() => percentileRows([])).toThrow('No games')
    expect(() => percentileRows([game(1, [1, 2]), game(2, [1])])).toThrow(
      'different numbers of weeks',
    )
  })
})
