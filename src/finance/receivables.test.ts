import { describe, expect, it } from 'vitest'
import { cents, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from './accounts.ts'
import {
  emptyJournal,
  postEntry,
  type Journal,
  type JournalEntry,
  type JournalLine,
} from './journal.ts'
import { badDebt, collection, creditSale, otherCharge } from './receivables.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type CashFlowStatement,
  type StatementLine,
} from './statements.ts'

const MAX = Number.MAX_SAFE_INTEGER
const CLIENT = 'Hôtel du Vieux-Port'

function dr(account: AccountCode, amount: number): JournalLine {
  return { account, debit: cents(amount), credit: cents(0) }
}

function cr(account: AccountCode, amount: number): JournalLine {
  return { account, debit: cents(0), credit: cents(amount) }
}

function entry(day: Day, memo: string, ...lines: JournalLine[]): JournalEntry {
  return { day, memo, lines }
}

function post(...entries: JournalEntry[]): Journal {
  return entries.reduce(postEntry, emptyJournal())
}

/** The amount on the row with `label` in one section of a statement. */
function amountIn(lines: readonly StatementLine[], label: string): number {
  const found = lines.filter((line) => line.label === label)
  expect(found).toHaveLength(1)
  return found[0]?.amount ?? NaN
}

/** The amount on the bilan's row for `account` among the current assets. */
function currentAsset(journal: Journal, account: AccountCode, atDay: Day) {
  const found = balanceSheet(journal, atDay).assets.current.lines.filter(
    (line) => line.account === account,
  )
  expect(found).toHaveLength(1)
  return found[0]?.amount ?? NaN
}

/** The rows of the three activities that show a cash flow. */
function cashRows(statement: CashFlowStatement): StatementLine[] {
  return [statement.operating, statement.investing, statement.financing]
    .flatMap(({ lines }) => lines)
    .filter(({ amount }) => amount !== 0)
}

function expectBalanced(journal: Journal, atDay: Day): void {
  const { assets, totalLiabilitiesAndEquity } = balanceSheet(journal, atDay)
  expect(assets.total.amount).toBe(totalLiabilitiesAndEquity.amount)
}

const BUILDERS = [
  {
    name: 'creditSale',
    build: creditSale,
    memo: `Vente à crédit · ${CLIENT}`,
    debit: '1100',
    credit: '4000',
  },
  {
    name: 'collection',
    build: collection,
    memo: `Encaissement · ${CLIENT}`,
    debit: '1000',
    credit: '1100',
  },
  {
    name: 'badDebt',
    build: badDebt,
    memo: `Mauvaise créance · ${CLIENT}`,
    debit: '6950',
    credit: '1100',
  },
  {
    name: 'otherCharge',
    build: (day: Day, _: string, amount: Cents) =>
      otherCharge(day, 'Amende de stationnement', amount),
    memo: 'Amende de stationnement',
    debit: '6900',
    credit: '1000',
  },
] as const

describe('the receivable entries', () => {
  it.each(BUILDERS)(
    '$name posts Dr $debit / Cr $credit',
    ({ build, memo, debit, credit }) => {
      const built = build(4, CLIENT, cents(75_000))
      expect(built).toEqual(
        entry(4, memo, dr(debit, 75_000), cr(credit, 75_000)),
      )
      expect(post(built).entries).toEqual([built])
    },
  )

  it.each(BUILDERS)('$name is frozen, down to each line', ({ build }) => {
    const built = build(0, CLIENT, cents(100))
    expect(Object.isFrozen(built)).toBe(true)
    expect(Object.isFrozen(built.lines)).toBe(true)
    for (const line of built.lines) expect(Object.isFrozen(line)).toBe(true)
  })

  it.each(BUILDERS)('$name accepts 1 cent and the most cents', ({ build }) => {
    expect(build(0, CLIENT, cents(1)).lines[0]?.debit).toBe(1)
    expect(build(0, CLIENT, cents(MAX)).lines[1]?.credit).toBe(MAX)
  })

  it.each(
    BUILDERS.flatMap(({ name, build }) =>
      [0, -1, 1.5, NaN, Infinity, -Infinity, MAX + 1].map((amount) => ({
        name,
        build,
        amount,
      })),
    ),
  )('$name rejects an amount of $amount', ({ build, amount }) => {
    expect(() => build(0, CLIENT, amount as Cents)).toThrow(RangeError)
  })

  it.each(['', ' ', '\t\n '])('rejects a blank client: %j', (client) => {
    for (const build of [creditSale, collection, badDebt]) {
      expect(() => build(0, client, cents(100))).toThrow(
        /^Not a name or a description/,
      )
    }
  })

  it.each(['', ' ', '\t\n '])('rejects a blank description: %j', (text) => {
    expect(() => otherCharge(0, text, cents(100))).toThrow(
      /^Not a name or a description/,
    )
  })
})

// The owner starts with 1 000 $ and sells 200 $ for cash on day 0. On day 1,
// a hotel buys 750 $ on credit, and pays on day 5.
const OPENING = [
  entry(0, 'Mise de fonds', dr('1000', 100_000), cr('3000', 100_000)),
  entry(0, 'Ventes du jour', dr('1000', 20_000), cr('4000', 20_000)),
]
const SALE_DAY = 1
const PAY_DAY = 5
const SOLD = post(...OPENING, creditSale(SALE_DAY, CLIENT, cents(75_000)))
const PAID = post(...SOLD.entries, collection(PAY_DAY, CLIENT, cents(75_000)))

describe('the statements with receivables', () => {
  it('raise Ventes and the bénéfice net by 750 $ on the day of a credit sale, with no cash', () => {
    const before = incomeStatement(SOLD, 0, SALE_DAY - 1)
    const after = incomeStatement(SOLD, 0, SALE_DAY)
    expect(after.sales.amount - before.sales.amount).toBe(75_000)
    expect(after.netIncome.amount - before.netIncome.amount).toBe(75_000)
    expect(incomeStatement(SOLD, SALE_DAY, SALE_DAY)).toMatchObject({
      sales: { amount: 75_000 },
      netIncome: { label: 'Bénéfice net', amount: 75_000 },
    })
    const cash = cashFlowStatement(SOLD, SALE_DAY, SALE_DAY)
    expect(cashRows(cash)).toEqual([])
    expect(cash.netChange.amount).toBe(0)
  })

  it('show Comptes clients on the bilan among the Actifs à court terme', () => {
    const { assets } = balanceSheet(SOLD, SALE_DAY)
    expect(assets.current.label).toBe('Actifs à court terme')
    expect(amountIn(assets.current.lines, 'Comptes clients')).toBe(75_000)
    expect(assets.current.total.amount).toBe(195_000)
    expect(currentAsset(SOLD, '1000', SALE_DAY)).toBe(
      currentAsset(SOLD, '1000', SALE_DAY - 1),
    )
    expectBalanced(SOLD, SALE_DAY)
  })

  it('move Encaisse and « Encaissements des clients » only on the day of the collection', () => {
    for (let day = SALE_DAY; day < PAY_DAY; day++) {
      expect(currentAsset(PAID, '1000', day)).toBe(120_000)
      expect(
        amountIn(
          cashFlowStatement(PAID, day, day).operating.lines,
          'Encaissements des clients',
        ),
      ).toBe(0)
    }
    expect(currentAsset(PAID, '1000', PAY_DAY)).toBe(195_000)
    const cash = cashFlowStatement(PAID, PAY_DAY, PAY_DAY)
    expect(cashRows(cash)).toEqual([
      { label: 'Encaissements des clients', amount: 75_000 },
    ])
    expect(cash.netChange.amount).toBe(75_000)
    expect(currentAsset(PAID, '1100', PAY_DAY)).toBe(0)
    expect(incomeStatement(PAID, PAY_DAY, PAY_DAY).sales.amount).toBe(0)
    expectBalanced(PAID, PAY_DAY)
  })

  it('lower the bénéfice and Comptes clients on a write-off, never Encaisse', () => {
    const books = post(
      ...SOLD.entries,
      collection(2, CLIENT, cents(45_000)),
      badDebt(3, CLIENT, cents(30_000)),
    )
    const writeOff = incomeStatement(books, 3, 3)
    expect(amountIn(writeOff.expenses.lines, 'Créances irrécouvrables')).toBe(
      30_000,
    )
    expect(writeOff.netIncome).toEqual({
      label: 'Perte nette',
      amount: -30_000,
    })
    expect(currentAsset(books, '1100', 2)).toBe(30_000)
    expect(currentAsset(books, '1100', 3)).toBe(0)
    expect(currentAsset(books, '1000', 3)).toBe(currentAsset(books, '1000', 2))
    const cash = cashFlowStatement(books, 3, 3)
    expect(cashRows(cash)).toEqual([])
    expect(cash.netChange.amount).toBe(0)
    expectBalanced(books, 3)
  })

  it('show only the cash collected when one entry collects part of a debt and writes off the rest', () => {
    const books = post(
      ...SOLD.entries,
      entry(
        2,
        'Règlement final',
        dr('1000', 45_000),
        dr('6950', 30_000),
        cr('1100', 75_000),
      ),
    )
    expect(cashRows(cashFlowStatement(books, 2, 2))).toEqual([
      { label: 'Encaissements des clients', amount: 45_000 },
    ])
  })

  it('show an other charge on both statements and take it out of Encaisse', () => {
    const books = post(
      ...OPENING,
      otherCharge(2, 'Amende de stationnement', cents(15_000)),
    )
    expect(
      amountIn(incomeStatement(books, 2, 2).expenses.lines, 'Autres charges'),
    ).toBe(15_000)
    const cash = cashFlowStatement(books, 2, 2)
    expect(cashRows(cash)).toEqual([
      { label: 'Autres charges', amount: -15_000 },
    ])
    expect(currentAsset(books, '1000', 2)).toBe(105_000)
    expectBalanced(books, 2)
  })
})
