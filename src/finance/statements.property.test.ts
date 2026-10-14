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

// The generators below copy those of journal.property.test.ts, but draw
// Encaisse more often. Bounds keep every run small: at most MAX_ENTRIES
// entries, MAX_GAP days apart, so the checks below that walk every day stay
// cheap. Amounts stay far enough below the safe integer range that no total
// can leave it.
const MAX_ENTRIES = 30
const MAX_GAP = 3
const MAX_MOVEMENTS = 5
const MAX_AMOUNT = 10_000_000_000
const NUM_RUNS = 200
const LAST_DAY = MAX_ENTRIES * MAX_GAP + 1

const CODES = ACCOUNTS.map(({ code }) => code)

// Encaisse on about a third of the sides, so that a cash entry often moves
// cash both ways, through more than one row, or from Encaisse to Encaisse.
// Drawn from the whole chart alone, it would be one side in more than 20.
const cashSide = fc.oneof(
  { arbitrary: fc.constant<AccountCode>('1000'), weight: 1 },
  { arbitrary: fc.constantFrom(...CODES), weight: 2 },
)

// An entry is a list of movements, each debiting one account and crediting
// another (possibly the same one) by the same amount, so it balances by
// construction. Days only go up, by gaps of zero or more.
const movement = fc.record({
  debit: cashSide,
  credit: cashSide,
  amount: fc.integer({ min: 1, max: MAX_AMOUNT }),
})
const draft = fc.record({
  gap: fc.integer({ min: 0, max: MAX_GAP }),
  movements: fc.array(movement, { minLength: 1, maxLength: MAX_MOVEMENTS }),
})
const drafts = fc.array(draft, { maxLength: MAX_ENTRIES })

// Single entries for the cash-flow properties.
const cashMovements = fc.array(movement, {
  minLength: 1,
  maxLength: MAX_MOVEMENTS,
})

type Draft = typeof draft extends fc.Arbitrary<infer T> ? T : never
type Movement = typeof movement extends fc.Arbitrary<infer T> ? T : never

/**
 * One entry per draft. With `readable`, a draft the état des flux de
 * trésorerie cannot read becomes one entry per movement, which it can.
 */
function toEntries(
  list: readonly Draft[],
  { readable = false }: { readable?: boolean } = {},
): JournalEntry[] {
  let day = 0
  return list.flatMap(({ gap, movements }, index) => {
    day += gap
    const memo = `Écriture ${index + 1}`
    const whole = toEntry(movements, day, memo)
    if (!readable || saysWhereCashWent(whole)) return [whole]
    return movements.map((one) => toEntry([one], day, memo))
  })
}

function toEntry(
  movements: readonly Movement[],
  day = 0,
  memo = 'Écriture',
): JournalEntry {
  const lines = movements.flatMap(({ debit, credit, amount }) => [
    { account: debit, debit: cents(amount), credit: cents(0) },
    { account: credit, debit: cents(0), credit: cents(amount) },
  ])
  return { day, memo, lines }
}

function toJournal(
  list: readonly Draft[],
  options: { readable?: boolean } = {},
): Journal {
  return toEntries(list, options).reduce(postEntry, emptyJournal())
}

// The row of the état des flux de trésorerie that cash paid against each
// account other than Encaisse feeds. statements.test.ts checks each one
// against its own list.
const ROW_OF = new Map<AccountCode, string>(
  CODES.filter((code) => code !== '1000').map((code) => {
    const payment = toEntry([{ debit: code, credit: '1000', amount: 1 }])
    const [row] = activities(cashFlowStatement(toJournalOf(payment), 0, 0))
      .flatMap(({ lines }) => lines)
      .filter(({ amount }) => amount !== 0)
    if (row === undefined) throw new Error(`No row for ${code}`)
    return [code, row.label]
  }),
)

function rowOf(code: AccountCode): string {
  const row = ROW_OF.get(code)
  if (row === undefined) throw new Error(`No row for ${code}`)
  return row
}

/**
 * The rule of src/finance/README.md, stated apart from statements.ts: an
 * entry says which rows its cash went through if it moves no cash, if its
 * other lines, net within each row, all go one way, or if its cash all goes
 * one way and a single row goes that way.
 */
function saysWhereCashWent({ lines }: JournalEntry): boolean {
  const cash = lines.filter(({ account }) => account === '1000')
  const nets = new Map<string, number>()
  for (const { account, debit, credit } of lines) {
    if (account === '1000') continue
    const row = rowOf(account)
    nets.set(row, (nets.get(row) ?? 0) + credit - debit)
  }
  const comingIn = [...nets.values()].filter((net) => net > 0).length
  const goingOut = [...nets.values()].filter((net) => net < 0).length
  if (cash.length === 0 || comingIn === 0 || goingOut === 0) return true
  if (cash.every(({ credit }) => credit === 0)) return comingIn === 1
  if (cash.every(({ debit }) => debit === 0)) return goingOut === 1
  return false
}

/**
 * Whether a row both moves cash one way and moves no cash the other way
 * among `movements`. The statement nets the lines of a row before it reads
 * the cash, the way the cost of a sale cancels out the stock it uses, so it
 * cannot see that part of the cash.
 */
function hidesCashInARow(movements: readonly Movement[]): boolean {
  const cash = new Map<string, number>()
  const noCash = new Map<string, number>()
  const move = (rows: Map<string, number>, row: string, amount: number) =>
    rows.set(row, (rows.get(row) ?? 0) + amount)
  for (const { debit, credit, amount } of movements) {
    if (debit === '1000' && credit === '1000') continue
    if (debit === '1000') move(cash, rowOf(credit), amount)
    else if (credit === '1000') move(cash, rowOf(debit), -amount)
    else {
      move(noCash, rowOf(credit), amount)
      move(noCash, rowOf(debit), -amount)
    }
  }
  return [...cash].some(
    ([row, amount]) => Math.sign(amount) * Math.sign(noCash.get(row) ?? 0) < 0,
  )
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
        const journal = toJournal(list, { readable: true })
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

  it('read a cash entry only when it says which rows its cash went through', () => {
    fc.assert(
      fc.property(cashMovements, (movements) => {
        const entry = toEntry(movements)
        const read = () => cashFlowStatement(toJournalOf(entry), 0, 0)
        if (saysWhereCashWent(entry)) expect(read).not.toThrow()
        else expect(read).toThrow(/^Cannot tell which rows the cash of/)
      }),
      { numRuns: NUM_RUNS },
    )
  })

  it('show the cash of an entry they read as if each movement were posted apart', () => {
    fc.assert(
      fc.property(cashMovements, (movements) => {
        fc.pre(!hidesCashInARow(movements))
        const entry = toEntry(movements)
        fc.pre(saysWhereCashWent(entry))
        const apart = movements
          .map((one) => toEntry([one]))
          .reduce(postEntry, emptyJournal())
        expect(cashFlowStatement(toJournalOf(entry), 0, 0)).toEqual(
          cashFlowStatement(apart, 0, 0),
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
  const cashEntries = samples
    .flatMap((list) => toEntries(list, { readable: true }))
    .filter(({ lines }) => lines.some(({ account }) => account === '1000'))
  const singles = fc
    .sample(cashMovements, { numRuns: 500, seed: 42 })
    .filter((movements) =>
      movements.some(
        ({ debit, credit }) => debit === '1000' || credit === '1000',
      ),
    )

  it('draw every account', () => {
    const seen = new Set<AccountCode>()
    for (const { lines } of entries) {
      for (const { account } of lines) seen.add(account)
    }
    expect([...seen].sort()).toEqual([...CODES].sort())
  })

  it('draw cash entries the statement reads that feed more than one cash-flow row', () => {
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

  it('draw single cash entries the statement cannot read', () => {
    expect(
      singles.some((movements) => !saysWhereCashWent(toEntry(movements))),
    ).toBe(true)
  })

  it('draw single cash entries it reads although some lines move no cash between rows', () => {
    expect(
      singles.some(
        (movements) =>
          saysWhereCashWent(toEntry(movements)) &&
          !hidesCashInARow(movements) &&
          movements.some(
            ({ debit, credit }) =>
              debit !== '1000' &&
              credit !== '1000' &&
              rowOf(debit) !== rowOf(credit),
          ),
      ),
    ).toBe(true)
  })
})

function toJournalOf(entry: JournalEntry): Journal {
  return postEntry(emptyJournal(), { ...entry, day: 0 })
}
