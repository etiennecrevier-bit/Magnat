import { describe, expect, it } from 'vitest'
import { difficultyIdSchema } from '../../src/content/schema.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents } from '../../src/engine/money.ts'
import type { DaySummary, PerProduct } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import {
  balance,
  emptyJournal,
  postEntry,
  type JournalEntry,
} from '../../src/finance/journal.ts'
import { incomeStatement } from '../../src/finance/statements.ts'
import { simulate } from '../sim/simulate.ts'
import {
  DAYS_PER_YEAR,
  lowestCash,
  playStrategy,
  runBalance,
  type DifficultyRun,
} from './play.ts'
import { strategyChanges, type Strategy } from './strategies.ts'

// Playing a strategy and summing up the game: that a game always plays the
// same, and that each number agrees with the books and the days played.

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
}
const EVERY_DAY: Strategy = { ...BASE, daysOpen: 7 }

function units(counts: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + counts[product], 0)
}

function outcomes(
  daySummaries: readonly DaySummary[],
  outcome: 'soldOut' | 'tooExpensive',
): number {
  return daySummaries
    .flatMap(({ visits }) => visits)
    .filter((visit) => visit.outcome === outcome).length
}

/** Encaisse after each entry, from the first: the slow way. */
function cashAfterEachEntry(entries: readonly JournalEntry[]): number[] {
  return entries.map((_, index) =>
    entries
      .slice(0, index + 1)
      .flatMap(({ lines }) => lines)
      .filter(({ account }) => account === '1000')
      .reduce((total, { debit, credit }) => total + debit - credit, 0),
  )
}

function entry(
  day: number,
  memo: string,
  lines: readonly [AccountCode, number, number][],
): JournalEntry {
  return {
    day,
    memo,
    lines: lines.map(([account, debit, credit]) => ({
      account,
      debit: cents(debit),
      credit: cents(credit),
    })),
  }
}

describe('playStrategy', () => {
  it.each(difficultyIdSchema.options)(
    'gives the same result for the same strategy and seed, at %s',
    (difficulty) => {
      const result = playStrategy(BASE, difficulty, 3, DAYS_PER_YEAR)
      expect(playStrategy(BASE, difficulty, 3, DAYS_PER_YEAR)).toEqual(result)
      expect(result.journalHash).toMatch(/^[0-9a-f]{64}$/)

      // Not the same result for anything: another seed or another price
      // plays another game.
      expect(playStrategy(BASE, difficulty, 4, DAYS_PER_YEAR)).not.toEqual(
        result,
      )
      expect(
        playStrategy(
          { ...BASE, priceChange: 20 },
          difficulty,
          3,
          DAYS_PER_YEAR,
        ),
      ).not.toEqual(result)
    },
  )

  it('agrees with the books and the days played', () => {
    const strategy: Strategy = { ...EVERY_DAY, croissantsPerDay: 40 }
    const days = 70
    const game = playStrategy(strategy, 'difficile', 5, days)
    const run = simulate(5, days, 'difficile', strategyChanges(strategy))
    const books = run.journal.reduce(postEntry, emptyJournal())
    const lastDay = days - 1

    expect(game.seed).toBe(5)
    expect(game.journalHash).toBe(run.journalHash)
    expect(game.cashAtEnd).toBe(balance(books, '1000', { toDay: lastDay }))
    expect(game.netIncome).toBe(
      incomeStatement(books, 0, lastDay).netIncome.amount,
    )
    expect(game.unitsSold).toBe(
      run.daySummaries.reduce((total, { sold }) => total + units(sold), 0),
    )
    expect(game.unitsSpoiled).toBe(
      run.daySummaries.reduce(
        (total, { spoiled }) => total + units(spoiled),
        0,
      ),
    )
    // The segments' tallies, counted again from each visit.
    expect(game.lostToStockouts).toBe(outcomes(run.daySummaries, 'soldOut'))
    expect(game.lostToPrices).toBe(outcomes(run.daySummaries, 'tooExpensive'))
    expect(game.lostToStockouts).toBeGreaterThan(0)
    expect(game.lostToPrices).toBeGreaterThan(0)
    expect(game.unitsSpoiled).toBeGreaterThan(0)

    // The lowest cash after any entry, no lower than at any close.
    expect(game.lowestCash).toBe(Math.min(...cashAfterEachEntry(run.journal)))
    const atClose = Array.from({ length: days }, (_, toDay) =>
      balance(books, '1000', { toDay }),
    )
    expect(game.lowestCash).toBeLessThanOrEqual(Math.min(...atClose))
    expect(game.wentBelowZero).toBe(game.lowestCash < 0)
  })

  it("counts the cash between a day's purchases and its sales", () => {
    // Day 0 opens: the 1st of the month's charges and the morning's
    // purchases are paid before any sale comes in, so the cash at the close
    // is higher than its low point of the day.
    const run = simulate(1, 1, 'difficile', strategyChanges(EVERY_DAY))
    const books = run.journal.reduce(postEntry, emptyJournal())
    const game = playStrategy(EVERY_DAY, 'difficile', 1, 1)
    expect(game.lowestCash).toBe(Math.min(...cashAfterEachEntry(run.journal)))
    expect(game.lowestCash).toBeLessThan(balance(books, '1000', { toDay: 0 }))
  })

  it('rejects what simulate rejects', () => {
    expect(() => playStrategy(BASE, 'moyen', 1, 0)).toThrow(RangeError)
    expect(() => playStrategy(BASE, 'moyen', -1, 1)).toThrow(RangeError)
    expect(() =>
      playStrategy({ ...BASE, croissantsPerDay: 501 }, 'moyen', 1, 1),
    ).toThrow(RangeError)
  })
})

describe('lowestCash', () => {
  it('sees a purchase take the cash below zero before the sales restore it', () => {
    const entries = [
      entry(0, 'Mise de fonds', [
        ['1000', 10_000, 0],
        ['3000', 0, 10_000],
      ]),
      entry(1, 'Achats', [
        ['1200', 15_000, 0],
        ['1000', 0, 15_000],
      ]),
      entry(1, 'Ventes', [
        ['1000', 20_000, 0],
        ['4000', 0, 20_000],
      ]),
    ]
    const books = entries.reduce(postEntry, emptyJournal())
    // Every close has cash: $100.00, then $150.00.
    expect(balance(books, '1000', { toDay: 0 })).toBe(10_000)
    expect(balance(books, '1000', { toDay: 1 })).toBe(15_000)
    expect(lowestCash(entries)).toBe(-5_000)
  })

  it('starts from the books, not from zero', () => {
    expect(
      lowestCash([
        entry(0, 'Mise de fonds', [
          ['1000', 10_000, 0],
          ['3000', 0, 10_000],
        ]),
        entry(0, 'Ventes', [
          ['1000', 500, 0],
          ['4000', 0, 500],
        ]),
      ]),
    ).toBe(10_000)
  })

  it('takes an entry whole, by its net change in cash', () => {
    expect(
      lowestCash([
        entry(0, 'Mise de fonds', [
          ['1000', 10_000, 0],
          ['3000', 0, 10_000],
        ]),
        entry(0, 'Aller-retour', [
          ['1000', 0, 30_000],
          ['1000', 25_000, 0],
          ['6000', 5_000, 0],
        ]),
      ]),
    ).toBe(5_000)
  })

  it('rejects books with no entries', () => {
    expect(() => lowestCash([])).toThrow(RangeError)
  })
})

describe('runBalance', () => {
  const strategies = [BASE, EVERY_DAY]

  it('plays every strategy at every difficulty on seeds 1 to games', () => {
    const progress: DifficultyRun[] = []
    const run = runBalance({
      years: 1,
      games: 2,
      strategies,
      difficulties: ['difficile', 'facile'],
      onProgress: (played) => progress.push(played),
    })
    expect(run.years).toBe(1)
    expect(run.games).toBe(2)
    expect(run.difficulties.map(({ difficulty }) => difficulty)).toEqual([
      'difficile',
      'facile',
    ])
    expect(progress).toEqual(run.difficulties)
    for (const { difficulty, strategies: played } of run.difficulties) {
      expect(played.map(({ strategy }) => strategy)).toEqual(strategies)
      for (const { strategy, games } of played) {
        expect(games).toEqual(
          [1, 2].map((seed) =>
            playStrategy(strategy, difficulty, seed, DAYS_PER_YEAR),
          ),
        )
      }
    }
  })

  it('plays every difficulty, easiest first, by default', () => {
    const run = runBalance({ years: 1, games: 1, strategies: [] })
    expect(run.difficulties.map(({ difficulty }) => difficulty)).toEqual([
      'facile',
      'moyen',
      'difficile',
    ])
  })

  it.each([
    [{ years: 0, games: 1 }, 'Years must be a whole number from 1: 0'],
    [{ years: 1.5, games: 1 }, 'Years must be a whole number from 1: 1.5'],
    [{ years: 1, games: 0 }, 'Games must be a whole number from 1: 0'],
    [{ years: 1, games: Infinity }, 'Games must be a whole number from 1'],
  ])('rejects %j', (options, message) => {
    expect(() => runBalance({ ...options, strategies })).toThrow(message)
  })
})
