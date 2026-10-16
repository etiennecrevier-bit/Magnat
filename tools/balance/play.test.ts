import { describe, expect, it } from 'vitest'
import { difficultyIdSchema } from '../../src/content/schema.ts'
import { ENERGY } from '../../src/engine/day.ts'
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
  financedAtEnd,
  firstDayBelowZero,
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
  ownerWeeklyPay: cents(70_000),
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
    expect(game.modifierDays).toEqual(run.modifierDays)
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

  it("sums up the owner's side, the counter and the line from the days played", () => {
    // Every day open and paid $400 a week at Moyen: the owner tires out and
    // misses rents, the counter botches and the line turns customers away.
    const strategy: Strategy = {
      ...EVERY_DAY,
      priceChange: -20,
      ownerWeeklyPay: cents(40_000),
    }
    const days = 120
    const game = playStrategy(strategy, 'moyen', 2, days)
    const run = simulate(2, days, 'moyen', strategyChanges(strategy))
    const { morningEnergy, personalCash, unpaidRents } = run.owner

    expect(game.personalCash).toBe(personalCash)
    expect(game.unpaidRents).toBe(unpaidRents.length)
    expect(game.averageEnergy).toBeCloseTo(
      morningEnergy.reduce((total, energy) => total + energy, 0) / days,
      12,
    )
    expect(game.daysExhausted).toBe(
      morningEnergy.filter((energy) => energy < ENERGY.exhausted.below).length,
    )
    const visits = run.daySummaries.flatMap(({ visits }) => visits)
    expect(game.visits).toBe(visits.length)
    expect(game.lostToLine).toBe(
      visits.filter(({ outcome }) => outcome === 'leftLine').length,
    )
    expect(game.botched).toBe(
      visits.reduce((total, { botched }) => total + botched, 0),
    )
    for (const count of [
      game.unpaidRents,
      game.daysExhausted,
      game.botched,
      game.lostToLine,
    ]) {
      expect(count).toBeGreaterThan(0)
    }
    expect(game.averageEnergy).toBeLessThan(100)
  })

  it('finds the first day the cash went below zero, or none', () => {
    // Difficile pays its charges before its first sale: in the red on day 0
    // with nothing but croissants to sell at the starting prices.
    const broke: Strategy = { ...BASE, croissantsPerDay: 500 }
    const days = 200
    const game = playStrategy(broke, 'difficile', 1, days)
    const run = simulate(1, days, 'difficile', strategyChanges(broke))
    const cash = cashAfterEachEntry(run.journal)
    const first = cash.findIndex((amount) => amount < 0)
    expect(first).toBeGreaterThan(-1)
    expect(game.firstDayBelowZero).toBe(run.journal[first]?.day)
    expect(game.wentBelowZero).toBe(true)

    const safe = playStrategy(BASE, 'facile', 1, 30)
    expect(safe.firstDayBelowZero).toBeNull()
    expect(safe.wentBelowZero).toBe(false)
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

describe('firstDayBelowZero', () => {
  const paidIn = entry(0, 'Mise de fonds', [
    ['1000', 10_000, 0],
    ['3000', 0, 10_000],
  ])

  it('gives the day of the first entry that left the cash below zero', () => {
    expect(
      firstDayBelowZero([
        paidIn,
        entry(3, 'Achats', [
          ['1200', 10_000, 0],
          ['1000', 0, 10_000],
        ]),
        entry(5, 'Achats', [
          ['1200', 1, 0],
          ['1000', 0, 1],
        ]),
        entry(9, 'Achats', [
          ['1200', 5_000, 0],
          ['1000', 0, 5_000],
        ]),
      ]),
    ).toBe(5)
  })

  it('is null when the cash never goes below zero, or with no entries', () => {
    expect(firstDayBelowZero([paidIn])).toBeNull()
    expect(firstDayBelowZero([])).toBeNull()
  })

  it('takes an entry whole, by its net change in cash', () => {
    expect(
      firstDayBelowZero([
        paidIn,
        entry(2, 'Aller-retour', [
          ['1000', 0, 30_000],
          ['1000', 25_000, 0],
          ['6000', 5_000, 0],
        ]),
      ]),
    ).toBeNull()
  })
})

describe('financedAtEnd', () => {
  const LENDER = 'Caisse populaire Saint-Prudent'

  it('adds what the emergency loans still owe to what the shares sold brought in', () => {
    const books = [
      entry(0, "Remboursement de l'emprunt", [
        ['2500', 9_000, 0],
        ['1000', 0, 9_000],
      ]),
      entry(60, `Emprunt d'urgence · ${LENDER}`, [
        ['1000', 500_000, 0],
        ['2500', 0, 500_000],
      ]),
      entry(61, `Remboursement · ${LENDER}`, [
        ['2500', 38_000, 0],
        ['1000', 0, 38_000],
      ]),
      entry(61, `Intérêts · ${LENDER}`, [
        ['7000', 7_500, 0],
        ['1000', 0, 7_500],
      ]),
    ]
    const sale = {
      day: 61,
      investor: 'Duvent Capital',
      amount: cents(2_000_000),
      share: 0.2,
    }
    // The startup loan's payment is no emergency loan's.
    expect(financedAtEnd(books, [])).toBe(500_000 - 38_000)
    expect(financedAtEnd(books, [sale, sale])).toBe(462_000 + 4_000_000)
    expect(financedAtEnd([], [])).toBe(0)
  })

  it('is 0 for a game that took no financing, and what is still owed for one that did', () => {
    expect(playStrategy(BASE, 'facile', 1, 30).financedAtEnd).toBe(0)
    const broke: Strategy = {
      ...BASE,
      priceChange: -20,
      daysOpen: 5,
      ownerWeeklyPay: cents(100_000),
    }
    const run = simulate(
      1,
      DAYS_PER_YEAR,
      'difficile',
      strategyChanges(broke),
      'none',
      undefined,
      undefined,
      null,
      'accept',
    )
    expect(run.loans.length).toBeGreaterThan(0)
    const game = playStrategy(
      broke,
      'difficile',
      1,
      DAYS_PER_YEAR,
      'none',
      null,
      'accept',
    )
    expect(game.financedAtEnd).toBeGreaterThan(0)
    expect(game.financedAtEnd).toBe(financedAtEnd(run.journal, run.shareSales))
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
