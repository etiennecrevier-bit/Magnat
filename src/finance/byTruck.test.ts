import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import type { AccountCode } from './accounts.ts'
import { marginByTruck, salesByTruck } from './byTruck.ts'
import {
  emptyJournal,
  postEntry,
  type Journal,
  type JournalEntry,
  type JournalLine,
} from './journal.ts'
import { incomeStatement } from './statements.ts'

// Sales and margin by truck (#259), read from the lines that name a truck,
// adding up to the état des résultats.

function line(
  account: AccountCode,
  side: 'debit' | 'credit',
  amount: number,
  truck?: string,
): JournalLine {
  return {
    account,
    debit: cents(side === 'debit' ? amount : 0),
    credit: cents(side === 'credit' ? amount : 0),
    ...(truck === undefined ? {} : { truck }),
  }
}

function post(...entries: JournalEntry[]): Journal {
  return entries.reduce(postEntry, emptyJournal())
}

/** A cash sale of `amount` on `day`, at `truck`, and what it cost. */
function sale(
  day: number,
  amount: number,
  cost: number,
  truck?: string,
): JournalEntry[] {
  return [
    {
      day,
      memo: 'Ventes au comptant',
      lines: [
        line('1000', 'debit', amount),
        line('4000', 'credit', amount, truck),
      ],
    },
    {
      day,
      memo: 'Coût des marchandises vendues',
      lines: [line('5000', 'debit', cost, truck), line('1200', 'credit', cost)],
    },
  ]
}

const BOOKS = post(
  {
    day: 0,
    memo: 'Mise de fonds',
    lines: [line('1000', 'debit', 100_000), line('3000', 'credit', 100_000)],
  },
  ...sale(1, 1_000, 400, 'plateau'),
  ...sale(1, 700, 300, 'vieuxMontreal'),
  // A grocer's delivery, on credit, names no truck.
  {
    day: 2,
    memo: 'Vente à crédit · Épicerie',
    lines: [line('1100', 'debit', 500), line('4000', 'credit', 500)],
  },
  {
    day: 2,
    memo: 'Coût des marchandises vendues',
    lines: [line('5000', 'debit', 200), line('1200', 'credit', 200)],
  },
  ...sale(3, 900, 350, 'plateau'),
  // A refund, the other way: a debit to Ventes and a credit to its cost.
  {
    day: 3,
    memo: 'Remboursement',
    lines: [line('4000', 'debit', 100, 'plateau'), line('1000', 'credit', 100)],
  },
  {
    day: 3,
    memo: 'Retour en stock',
    lines: [line('1200', 'debit', 40), line('5000', 'credit', 40, 'plateau')],
  },
)

describe('salesByTruck', () => {
  it('nets Ventes by the truck its lines name, null for those that name none', () => {
    expect(salesByTruck(BOOKS, { toDay: 3 })).toEqual(
      new Map([
        ['plateau', 1_800],
        ['vieuxMontreal', 700],
        [null, 500],
      ]),
    )
  })

  it('reads any period, both days included, leaving out the trucks with no line in it', () => {
    expect(salesByTruck(BOOKS, { fromDay: 2, toDay: 2 })).toEqual(
      new Map([[null, 500]]),
    )
    expect(salesByTruck(BOOKS, { fromDay: 1, toDay: 1 })).toEqual(
      new Map([
        ['plateau', 1_000],
        ['vieuxMontreal', 700],
      ]),
    )
    expect(salesByTruck(BOOKS, { fromDay: 4, toDay: 9 })).toEqual(new Map())
  })

  it("adds up to the état des résultats' Ventes over every period", () => {
    for (let fromDay = 0; fromDay <= 3; fromDay += 1) {
      for (let toDay = fromDay; toDay <= 3; toDay += 1) {
        const total = [
          ...salesByTruck(BOOKS, { fromDay, toDay }).values(),
        ].reduce((sum, amount) => sum + amount, 0)
        expect(total).toBe(incomeStatement(BOOKS, fromDay, toDay).sales.amount)
      }
    }
  })

  it('rejects a day that is not a safe integer', () => {
    expect(() => salesByTruck(BOOKS, { toDay: 1.5 })).toThrow(RangeError)
    expect(() =>
      salesByTruck(BOOKS, { fromDay: Number.NaN, toDay: 2 }),
    ).toThrow(RangeError)
  })
})

describe('marginByTruck', () => {
  it('is each truck’s sales less its cost of goods, adding up to the marge brute', () => {
    const margins = marginByTruck(BOOKS, { toDay: 3 })
    expect(margins).toEqual(
      new Map([
        ['plateau', 1_800 - (400 + 350 - 40)],
        ['vieuxMontreal', 700 - 300],
        [null, 500 - 200],
      ]),
    )
    for (let fromDay = 0; fromDay <= 3; fromDay += 1) {
      const total = [
        ...marginByTruck(BOOKS, { fromDay, toDay: 3 }).values(),
      ].reduce((sum, amount) => sum + amount, 0)
      expect(total).toBe(incomeStatement(BOOKS, fromDay, 3).grossMargin.amount)
    }
  })
})
