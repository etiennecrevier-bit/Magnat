import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import { ACCOUNTS, type AccountCode } from './accounts.ts'
import {
  balance,
  emptyJournal,
  postEntry,
  type Journal,
  type JournalEntry,
} from './journal.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type CashFlowStatement,
  type StatementSection,
} from './statements.ts'

// The generators below copy those of journal.property.test.ts. Bounds keep
// every run small: at most MAX_ENTRIES entries, MAX_GAP days apart, so the
// checks below that walk every day stay cheap. Amounts stay far enough below
// the safe integer range that no total can leave it.
const MAX_ENTRIES = 30
const MAX_GAP = 3
const MAX_MOVEMENTS = 5
const MAX_AMOUNT = 10_000_000_000
const NUM_RUNS = 200
const LAST_DAY = MAX_ENTRIES * MAX_GAP + 1

const CODES = ACCOUNTS.map(({ code }) => code)

// An entry is a list of movements, each debiting one account and crediting
// another (possibly the same one) by the same amount, so it balances by
// construction. Days only go up, by gaps of zero or more.
const movement = fc.record({
  debit: fc.constantFrom(...CODES),
  credit: fc.constantFrom(...CODES),
  amount: fc.integer({ min: 1, max: MAX_AMOUNT }),
})
const draft = fc.record({
  gap: fc.integer({ min: 0, max: MAX_GAP }),
  movements: fc.array(movement, { minLength: 1, maxLength: MAX_MOVEMENTS }),
})
const drafts = fc.array(draft, { maxLength: MAX_ENTRIES })

type Draft = typeof draft extends fc.Arbitrary<infer T> ? T : never

function toEntries(list: readonly Draft[]): JournalEntry[] {
  let day = 0
  return list.map(({ gap, movements }, index) => {
    day += gap
    const lines = movements.flatMap(({ debit, credit, amount }) => [
      { account: debit, debit: cents(amount), credit: cents(0) },
      { account: credit, debit: cents(0), credit: cents(amount) },
    ])
    return { day, memo: `Écriture ${index + 1}`, lines }
  })
}

function toJournal(list: readonly Draft[]): Journal {
  return toEntries(list).reduce(postEntry, emptyJournal())
}

const day = fc.integer({ min: -1, max: LAST_DAY })
const period = fc
  .tuple(day, day)
  .map(([a, b]) => (a <= b ? ([a, b] as const) : ([b, a] as const)))

function total(amounts: readonly number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0)
}

function expectAddsUp(section: StatementSection): void {
  expect(section.total.amount).toBe(
    total(section.lines.map(({ amount }) => amount)),
  )
}

function activities({ operating, investing, financing }: CashFlowStatement) {
  return [operating, investing, financing]
}

describe('statement properties', () => {
  it('balance the bilan on every day, with every total adding up', () => {
    fc.assert(
      fc.property(drafts, (list) => {
        const journal = toJournal(list)
        const last = journal.entries.at(-1)?.day ?? 0
        for (let atDay = -1; atDay <= last + 1; atDay += 1) {
          const { assets, liabilities, equity, totalLiabilitiesAndEquity } =
            balanceSheet(journal, atDay)
          for (const section of [
            assets.current,
            assets.longTerm,
            liabilities,
            equity,
          ]) {
            expectAddsUp(section)
          }
          expect(assets.total.amount).toBe(
            assets.current.total.amount + assets.longTerm.total.amount,
          )
          expect(totalLiabilitiesAndEquity.amount).toBe(
            liabilities.total.amount + equity.total.amount,
          )
          expect(assets.total.amount).toBe(totalLiabilitiesAndEquity.amount)
        }
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('add up the état des résultats over any period', () => {
    fc.assert(
      fc.property(drafts, period, (list, [fromDay, toDay]) => {
        const { sales, costOfGoodsSold, grossMargin, expenses, netIncome } =
          incomeStatement(toJournal(list), fromDay, toDay)
        expect(grossMargin.amount).toBe(sales.amount - costOfGoodsSold.amount)
        expectAddsUp(expenses)
        expect(netIncome.amount).toBe(
          grossMargin.amount - expenses.total.amount,
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('make the net cash flow equal the change in Encaisse over any period', () => {
    fc.assert(
      fc.property(drafts, period, (list, [fromDay, toDay]) => {
        const journal = toJournal(list)
        const statement = cashFlowStatement(journal, fromDay, toDay)
        const { netChange, openingCash, closingCash } = statement
        for (const section of activities(statement)) expectAddsUp(section)
        expect(netChange.amount).toBe(
          total(activities(statement).map((section) => section.total.amount)),
        )
        expect(openingCash.amount).toBe(
          balance(journal, '1000', { toDay: fromDay - 1 }),
        )
        expect(closingCash.amount).toBe(balance(journal, '1000', { toDay }))
        expect(netChange.amount).toBe(closingCash.amount - openingCash.amount)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('show no more cash coming in or going out than went through Encaisse', () => {
    fc.assert(
      fc.property(draft, (one) => {
        const [entry] = toEntries([one])
        if (entry === undefined) throw new Error('One draft makes one entry')
        const cash = entry.lines.filter(({ account }) => account === '1000')
        const rows = activities(cashFlowStatement(toJournalOf(entry), 0, 0))
          .flatMap(({ lines }) => lines)
          .map(({ amount }) => amount)
        expect(total(rows.filter((amount) => amount > 0))).toBeLessThanOrEqual(
          total(cash.map(({ debit }) => debit)),
        )
        expect(-total(rows.filter((amount) => amount < 0))).toBeLessThanOrEqual(
          total(cash.map(({ credit }) => credit)),
        )
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('make Bénéfices non répartis the account plus the net income to date', () => {
    fc.assert(
      fc.property(
        drafts,
        fc.integer({ min: 0, max: LAST_DAY }),
        (list, atDay) => {
          const journal = toJournal(list)
          const retained = balanceSheet(journal, atDay).equity.lines.find(
            ({ account }) => account === '3100',
          )
          expect(retained?.amount).toBe(
            balance(journal, '3100', { toDay: atDay }) +
              incomeStatement(journal, 0, atDay).netIncome.amount,
          )
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })

  it('split the net income of a period across two halves of it', () => {
    fc.assert(
      fc.property(
        drafts,
        day,
        fc.nat({ max: LAST_DAY }),
        fc.nat({ max: LAST_DAY }),
        (list, start, firstLength, secondLength) => {
          const journal = toJournal(list)
          const middle = start + firstLength
          const end = middle + 1 + secondLength
          const first = incomeStatement(journal, start, middle)
          const second = incomeStatement(journal, middle + 1, end)
          const whole = incomeStatement(journal, start, end)
          expect(first.sales.amount + second.sales.amount).toBe(
            whole.sales.amount,
          )
          expect(
            first.expenses.total.amount + second.expenses.total.amount,
          ).toBe(whole.expenses.total.amount)
          expect(first.netIncome.amount + second.netIncome.amount).toBe(
            whole.netIncome.amount,
          )
        },
      ),
      { numRuns: NUM_RUNS },
    )
  })
})

// Keeps the generators honest: they must reach the cases the properties rely
// on, or a passing run proves less than it seems.
describe('statement property generators', () => {
  const samples = fc.sample(drafts, { numRuns: 500, seed: 42 })
  const entries = samples.flatMap((list) => toEntries(list))
  const cashEntries = entries.filter(({ lines }) =>
    lines.some(({ account }) => account === '1000'),
  )

  it('draw every account', () => {
    const seen = new Set<AccountCode>()
    for (const { lines } of entries) {
      for (const { account } of lines) seen.add(account)
    }
    expect([...seen].sort()).toEqual([...CODES].sort())
  })

  it('draw cash entries that feed more than one cash-flow row', () => {
    const rowsFed = cashEntries.map((cashEntry) => {
      const statement = cashFlowStatement(toJournalOf(cashEntry), 0, 0)
      return activities(statement)
        .flatMap(({ lines }) => lines)
        .filter(({ amount }) => amount !== 0).length
    })
    expect(rowsFed.some((count) => count > 1)).toBe(true)
  })

  it('draw cash entries whose cash lines net to zero', () => {
    const netsToZero = cashEntries.filter(({ lines }) => {
      const cash = lines.filter(({ account }) => account === '1000')
      return total(cash.map(({ debit, credit }) => debit - credit)) === 0
    })
    expect(
      netsToZero.some(({ lines }) =>
        lines.some(({ account }) => account !== '1000'),
      ),
    ).toBe(true)
  })
})

function toJournalOf(entry: JournalEntry): Journal {
  return postEntry(emptyJournal(), { ...entry, day: 0 })
}
