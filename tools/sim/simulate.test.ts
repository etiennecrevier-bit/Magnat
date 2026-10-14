import { describe, expect, it } from 'vitest'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents } from '../../src/engine/money.ts'
import type { PerProduct } from '../../src/engine/types.ts'
import { getAccount } from '../../src/finance/accounts.ts'
import { emptyJournal, postEntry } from '../../src/finance/journal.ts'
import { journalHash, simulate } from './simulate.ts'

// The headless runner: what it plays, how it splits the run into years, and
// that every number it sums up agrees with the books and the days played.
// The ten-year runs live in tests/invariants.test.ts.

const run = simulate(7, 400)

function units(counts: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + counts[product], 0)
}

function spans(result: {
  years: readonly { fromDay: number; toDay: number }[]
}) {
  return result.years.map(({ fromDay, toDay }) => [fromDay, toDay])
}

describe('simulate', () => {
  it('plays every day from day 0', () => {
    expect(run).toMatchObject({ seed: 7, days: 400 })
    expect(run.daySummaries.map(({ day }) => day)).toEqual(
      Array.from({ length: 400 }, (_, day) => day),
    )
    expect(run.journal.at(-1)?.day).toBe(399)
  })

  it('counts years from the first day of play, the last one cut short', () => {
    expect(run.years.map(({ year }) => year)).toEqual([1, 2])
    expect(spans(run)).toEqual([
      [0, 364],
      [365, 399],
    ])
  })

  it('ends a run of exactly one year without starting another', () => {
    expect(spans(simulate(7, 365))).toEqual([[0, 364]])
  })

  it('sums up a run shorter than a year as one year', () => {
    expect(spans(simulate(7, 40))).toEqual([[0, 39]])
  })

  it('reads revenue from the books, in agreement with the days played', () => {
    for (const year of run.years) {
      const played = run.daySummaries.slice(year.fromDay, year.toDay + 1)
      expect(year.revenue).toBe(
        played.reduce((total, { revenue }) => total + revenue, 0),
      )
      expect(year.revenue).toBeGreaterThan(0)
    }
  })

  it('reads net income and cash at year end from the books', () => {
    for (const year of run.years) {
      const inYear = run.journal.filter(
        ({ day }) => day >= year.fromDay && day <= year.toDay,
      )
      // Income and charge accounts are the only ones in net income: their
      // credits minus their debits.
      const netIncome = inYear
        .flatMap(({ lines }) => lines)
        .filter(({ account }) =>
          ['produit', 'charge'].includes(getAccount(account).type),
        )
        .reduce((total, { debit, credit }) => total + credit - debit, 0)
      expect(year.netIncome).toBe(netIncome)

      const cash = run.journal
        .filter(({ day }) => day <= year.toDay)
        .flatMap(({ lines }) => lines)
        .filter(({ account }) => account === '1000')
        .reduce((total, { debit, credit }) => total + debit - credit, 0)
      expect(year.cashAtYearEnd).toBe(cash)
    }
  })

  it('adds up spoiled units and lost sales over every product', () => {
    for (const year of run.years) {
      const played = run.daySummaries.slice(year.fromDay, year.toDay + 1)
      expect(year.unitsSpoiled).toBe(
        played.reduce((total, { spoiled }) => total + units(spoiled), 0),
      )
      expect(year.lostSales).toBe(
        played.reduce((total, { lostSales }) => total + units(lostSales), 0),
      )
    }
    expect(run.years[0]?.unitsSpoiled).toBeGreaterThan(0)
  })

  it('hashes the journal it returns', () => {
    const books = run.journal.reduce(postEntry, emptyJournal())
    expect(run.journalHash).toBe(journalHash(books))
  })

  it.each([0, -1, 1.5, Number.NaN, Infinity, 2 ** 53])(
    'rejects %s days',
    (days) => {
      expect(() => simulate(7, days)).toThrow(RangeError)
    },
  )

  it('rejects a seed the engine rejects', () => {
    expect(() => simulate(-1, 10)).toThrow(RangeError)
  })
})

describe('journalHash', () => {
  it('is the same for the same seed and differs for another', () => {
    const hash = simulate(7, 40).journalHash
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(simulate(7, 40).journalHash).toBe(hash)
    expect(simulate(8, 40).journalHash).not.toBe(hash)
  })

  it('changes when a single cent changes', () => {
    function books(amount: number) {
      return postEntry(emptyJournal(), {
        day: 0,
        memo: 'Mise de fonds',
        lines: [
          { account: '1000', debit: cents(amount), credit: cents(0) },
          { account: '3000', debit: cents(0), credit: cents(amount) },
        ],
      })
    }
    expect(journalHash(books(100_000))).toBe(journalHash(books(100_000)))
    expect(journalHash(books(100_001))).not.toBe(journalHash(books(100_000)))
  })
})
