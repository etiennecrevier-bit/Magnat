import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import { ACCOUNTS, getAccount, type AccountCode } from './accounts.ts'
import {
  emptyJournal,
  postEntry,
  type Journal,
  type JournalEntry,
  type JournalLine,
} from './journal.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type CashFlowStatement,
  type StatementLine,
} from './statements.ts'

const MAX = Number.MAX_SAFE_INTEGER

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

/** A row that shows one account. */
function accountRow(account: AccountCode, label: string, amount: number) {
  return { label, amount, account }
}

function row(label: string, amount: number) {
  return { label, amount }
}

/** Every row of a statement, totals included. */
function rowsOf(value: unknown): StatementLine[] {
  if (typeof value !== 'object' || value === null) return []
  if ('amount' in value) return [value as StatementLine]
  return Object.values(value).flatMap(rowsOf)
}

function expectDeepFrozen(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child)
}

// A food truck's first week: the owner puts in capital and borrows, buys the
// truck, buys stock on credit, sells for cash, throws out spoiled food, pays
// wages, fuel and the supplier, depreciates the truck and pays back part of
// the loan with interest.
const FIRST_WEEK = [
  entry(0, 'Mise de fonds', dr('1000', 2_000_000), cr('3000', 2_000_000)),
  entry(0, 'Emprunt', dr('1000', 1_500_000), cr('2500', 1_500_000)),
  entry(1, 'Camion', dr('1500', 3_000_000), cr('1000', 3_000_000)),
  entry(1, 'Stocks à crédit', dr('1200', 80_000), cr('2000', 80_000)),
  entry(
    2,
    'Ventes du jour',
    dr('1000', 45_000),
    cr('4000', 45_000),
    dr('5000', 18_000),
    cr('1200', 18_000),
  ),
  entry(3, 'Nourriture périmée', dr('5100', 4_000), cr('1200', 4_000)),
  entry(
    3,
    'Paie et essence',
    dr('6000', 25_000),
    dr('6200', 6_000),
    cr('1000', 31_000),
  ),
  entry(4, 'Paiement fournisseur', dr('2000', 50_000), cr('1000', 50_000)),
  entry(4, 'Amortissement', dr('6400', 1_000), cr('1510', 1_000)),
  entry(
    5,
    'Remboursement',
    dr('2500', 100_000),
    dr('7000', 5_000),
    cr('1000', 105_000),
  ),
]

const journal = post(...FIRST_WEEK)

describe('incomeStatement', () => {
  it('lists sales, the cost of goods sold, each charge and the net loss', () => {
    expect(incomeStatement(journal, 0, 5)).toEqual({
      fromDay: 0,
      toDay: 5,
      sales: accountRow('4000', 'Ventes', 45_000),
      costOfGoodsSold: accountRow(
        '5000',
        'Coût des marchandises vendues',
        18_000,
      ),
      grossMargin: row('Marge brute', 27_000),
      expenses: {
        label: 'Charges',
        lines: [
          accountRow('5100', 'Pertes sur stocks', 4_000),
          accountRow('6000', 'Salaires', 25_000),
          accountRow('6100', 'Loyer et permis', 0),
          accountRow('6200', 'Carburant et entretien', 6_000),
          accountRow('6300', 'Marketing', 0),
          accountRow('6400', 'Amortissement', 1_000),
          accountRow('7000', 'Intérêts', 5_000),
        ],
        total: row('Total des charges', 41_000),
      },
      netIncome: row('Perte nette', -14_000),
    })
  })

  it('only counts the entries in the period', () => {
    expect(incomeStatement(journal, 2, 2)).toMatchObject({
      fromDay: 2,
      toDay: 2,
      sales: { amount: 45_000 },
      costOfGoodsSold: { amount: 18_000 },
      grossMargin: { amount: 27_000 },
      expenses: { total: { amount: 0 } },
      netIncome: row('Bénéfice net', 27_000),
    })
    expect(incomeStatement(journal, 3, 5)).toMatchObject({
      sales: { amount: 0 },
      expenses: { total: { amount: 41_000 } },
      netIncome: row('Perte nette', -41_000),
    })
  })

  it('shows every row at zero, with a Bénéfice net of zero, when nothing happened', () => {
    const empty = incomeStatement(emptyJournal(), 0, 10)
    expect(rowsOf(empty).every(({ amount }) => amount === 0)).toBe(true)
    expect(empty.expenses.lines).toHaveLength(7)
    expect(empty.netIncome).toEqual(row('Bénéfice net', 0))
    expect(incomeStatement(journal, -5, -1)).toEqual({
      ...empty,
      fromDay: -5,
      toDay: -1,
    })
  })
})

describe('balanceSheet', () => {
  it('balances, with the net loss to date in Bénéfices non répartis', () => {
    expect(balanceSheet(journal, 5)).toEqual({
      atDay: 5,
      assets: {
        label: 'Actifs',
        current: {
          label: 'Actifs à court terme',
          lines: [
            accountRow('1000', 'Encaisse', 359_000),
            accountRow('1100', 'Comptes clients', 0),
            accountRow('1200', 'Stocks', 58_000),
          ],
          total: row('Total des actifs à court terme', 417_000),
        },
        longTerm: {
          label: 'Actifs à long terme',
          lines: [
            accountRow('1500', 'Équipement', 3_000_000),
            accountRow('1510', 'Amortissement cumulé', -1_000),
          ],
          total: row('Total des actifs à long terme', 2_999_000),
        },
        total: row('Total des actifs', 3_416_000),
      },
      liabilities: {
        label: 'Passifs',
        lines: [
          accountRow('2000', 'Comptes fournisseurs', 30_000),
          accountRow('2500', 'Emprunts bancaires', 1_400_000),
        ],
        total: row('Total des passifs', 1_430_000),
      },
      equity: {
        label: 'Capitaux propres',
        lines: [
          accountRow('3000', 'Capital-actions', 2_000_000),
          accountRow('3100', 'Bénéfices non répartis', -14_000),
        ],
        total: row('Total des capitaux propres', 1_986_000),
      },
      totalLiabilitiesAndEquity: row(
        'Total des passifs et des capitaux propres',
        3_416_000,
      ),
    })
  })

  it('only counts entries up to and including atDay', () => {
    const bilan = balanceSheet(journal, 2)
    expect(bilan.assets.current.lines).toEqual([
      accountRow('1000', 'Encaisse', 545_000),
      accountRow('1100', 'Comptes clients', 0),
      accountRow('1200', 'Stocks', 62_000),
    ])
    expect(bilan.assets.longTerm.lines).toEqual([
      accountRow('1500', 'Équipement', 3_000_000),
      accountRow('1510', 'Amortissement cumulé', 0),
    ])
    expect(bilan.assets.total.amount).toBe(3_607_000)
    expect(bilan.liabilities.total.amount).toBe(1_580_000)
    expect(bilan.equity.lines).toEqual([
      accountRow('3000', 'Capital-actions', 2_000_000),
      accountRow('3100', 'Bénéfices non répartis', 27_000),
    ])
    expect(bilan.equity.total.amount).toBe(2_027_000)
    expect(bilan.totalLiabilitiesAndEquity.amount).toBe(3_607_000)
  })

  it('adds a balance in Bénéfices non répartis to the net income to date', () => {
    const books = post(
      entry(0, 'Mise de fonds', dr('1000', 100_000), cr('3000', 100_000)),
      entry(0, 'Bénéfices reportés', dr('1000', 10_000), cr('3100', 10_000)),
      entry(1, 'Vente', dr('1000', 5_000), cr('4000', 5_000)),
    )
    const { assets, equity, totalLiabilitiesAndEquity } = balanceSheet(books, 1)
    expect(equity.lines).toEqual([
      accountRow('3000', 'Capital-actions', 100_000),
      accountRow('3100', 'Bénéfices non répartis', 15_000),
    ])
    expect(assets.total.amount).toBe(115_000)
    expect(totalLiabilitiesAndEquity.amount).toBe(115_000)
  })

  it('shows every row at zero before the first entry', () => {
    for (const bilan of [
      balanceSheet(emptyJournal(), 0),
      balanceSheet(journal, -1),
    ]) {
      expect(rowsOf(bilan).every(({ amount }) => amount === 0)).toBe(true)
      expect(rowsOf(bilan)).toHaveLength(15)
    }
  })

  it('shows an overdrawn Encaisse as a negative asset', () => {
    const overdrawn = post(entry(0, 'Paie', dr('6000', 100), cr('1000', 100)))
    const { assets, equity } = balanceSheet(overdrawn, 0)
    expect(assets.current.lines[0]).toEqual(
      accountRow('1000', 'Encaisse', -100),
    )
    expect(assets.total.amount).toBe(-100)
    expect(equity.total.amount).toBe(-100)
  })
})

describe('cashFlowStatement', () => {
  it('classifies every movement of Encaisse and adds up to its change', () => {
    expect(cashFlowStatement(journal, 0, 5)).toEqual({
      fromDay: 0,
      toDay: 5,
      operating: {
        label: "Activités d'exploitation",
        lines: [
          row('Encaissements des clients', 45_000),
          row('Paiements aux fournisseurs', -50_000),
          row('Salaires', -25_000),
          row('Autres charges', -11_000),
        ],
        total: row(
          "Flux de trésorerie liés aux activités d'exploitation",
          -41_000,
        ),
      },
      investing: {
        label: "Activités d'investissement",
        lines: [row('Équipement', -3_000_000)],
        total: row(
          "Flux de trésorerie liés aux activités d'investissement",
          -3_000_000,
        ),
      },
      financing: {
        label: 'Activités de financement',
        lines: [
          row('Emprunts bancaires', 1_400_000),
          row('Capital-actions', 2_000_000),
        ],
        total: row(
          'Flux de trésorerie liés aux activités de financement',
          3_400_000,
        ),
      },
      netChange: row("Augmentation nette de l'encaisse", 359_000),
      openingCash: accountRow('1000', 'Encaisse au début de la période', 0),
      closingCash: accountRow(
        '1000',
        'Encaisse à la fin de la période',
        359_000,
      ),
    })
  })

  it('starts from the cash at the end of the day before the period', () => {
    const statement = cashFlowStatement(journal, 3, 5)
    expect(statement.operating.lines).toEqual([
      row('Encaissements des clients', 0),
      row('Paiements aux fournisseurs', -50_000),
      row('Salaires', -25_000),
      row('Autres charges', -11_000),
    ])
    expect(statement.operating.total.amount).toBe(-86_000)
    expect(statement.investing.total.amount).toBe(0)
    expect(statement.financing.lines).toEqual([
      row('Emprunts bancaires', -100_000),
      row('Capital-actions', 0),
    ])
    expect(statement.netChange).toEqual(
      row("Diminution nette de l'encaisse", -186_000),
    )
    expect(statement.openingCash.amount).toBe(545_000)
    expect(statement.closingCash.amount).toBe(359_000)
  })

  it('classifies an entry whose cash lines net to zero', () => {
    const books = post(
      entry(
        0,
        'Ventes et paie',
        dr('1000', 45_000),
        cr('4000', 45_000),
        dr('6000', 45_000),
        cr('1000', 45_000),
      ),
    )
    const statement = cashFlowStatement(books, 0, 0)
    expect(statement.operating.lines).toEqual([
      row('Encaissements des clients', 45_000),
      row('Paiements aux fournisseurs', 0),
      row('Salaires', -45_000),
      row('Autres charges', 0),
    ])
    expect(statement.netChange).toEqual(
      row("Augmentation nette de l'encaisse", 0),
    )
    expect(statement.closingCash.amount).toBe(0)
  })

  it('leaves out entries that do not touch Encaisse', () => {
    const books = post(
      entry(0, 'Mise de fonds', dr('1000', 100_000), cr('3000', 100_000)),
      entry(1, 'Stocks à crédit', dr('1200', 8_000), cr('2000', 8_000)),
      entry(1, 'Nourriture périmée', dr('5100', 500), cr('1200', 500)),
      entry(1, 'Amortissement', dr('6400', 1_000), cr('1510', 1_000)),
    )
    const statement = cashFlowStatement(books, 1, 1)
    const { openingCash, closingCash, ...flows } = statement
    expect(rowsOf(flows).every(({ amount }) => amount === 0)).toBe(true)
    expect(openingCash.amount).toBe(100_000)
    expect(closingCash.amount).toBe(100_000)
  })

  // The row each counterpart of Encaisse feeds, kept apart from
  // statements.ts so the test checks it against an independent spec.
  const COUNTERPARTS: {
    account: AccountCode
    activity: keyof Pick<
      CashFlowStatement,
      'operating' | 'investing' | 'financing'
    >
    label: string
  }[] = [
    {
      account: '1100',
      activity: 'operating',
      label: 'Encaissements des clients',
    },
    {
      account: '1200',
      activity: 'operating',
      label: 'Paiements aux fournisseurs',
    },
    { account: '1500', activity: 'investing', label: 'Équipement' },
    { account: '1510', activity: 'investing', label: 'Équipement' },
    {
      account: '2000',
      activity: 'operating',
      label: 'Paiements aux fournisseurs',
    },
    { account: '2500', activity: 'financing', label: 'Emprunts bancaires' },
    { account: '3000', activity: 'financing', label: 'Capital-actions' },
    { account: '3100', activity: 'financing', label: 'Capital-actions' },
    {
      account: '4000',
      activity: 'operating',
      label: 'Encaissements des clients',
    },
    {
      account: '5000',
      activity: 'operating',
      label: 'Paiements aux fournisseurs',
    },
    {
      account: '5100',
      activity: 'operating',
      label: 'Paiements aux fournisseurs',
    },
    { account: '6000', activity: 'operating', label: 'Salaires' },
    { account: '6100', activity: 'operating', label: 'Autres charges' },
    { account: '6200', activity: 'operating', label: 'Autres charges' },
    { account: '6300', activity: 'operating', label: 'Autres charges' },
    { account: '6400', activity: 'operating', label: 'Autres charges' },
    { account: '7000', activity: 'operating', label: 'Autres charges' },
  ]

  it('has a row for every account other than Encaisse', () => {
    expect(COUNTERPARTS.map(({ account }) => account)).toEqual(
      ACCOUNTS.map(({ code }) => code).filter((code) => code !== '1000'),
    )
  })

  it.each(COUNTERPARTS)(
    'puts cash paid against $account in $activity: $label',
    ({ account, activity, label }) => {
      const books = post(
        entry(0, 'Paiement', dr(account, 100), cr('1000', 100)),
      )
      const statement = cashFlowStatement(books, 0, 0)
      expect(
        statement[activity].lines.filter(({ amount }) => amount !== 0),
      ).toEqual([row(label, -100)])
      expect(statement.netChange.amount).toBe(-100)
    },
  )

  it('needs no day before the period to find the opening cash', () => {
    const all = cashFlowStatement(journal, -MAX, MAX)
    expect(all).toEqual({
      ...cashFlowStatement(journal, 0, 5),
      fromDay: -MAX,
      toDay: MAX,
    })
  })
})

describe('the statements together', () => {
  it('show every account exactly once between the bilan and the état des résultats', () => {
    const shown = [
      ...rowsOf(balanceSheet(journal, 5)),
      ...rowsOf(incomeStatement(journal, 0, 5)),
    ].flatMap(({ account }) => (account === undefined ? [] : [account]))
    expect(shown.sort()).toEqual(ACCOUNTS.map(({ code }) => code).sort())
  })

  it('file each account under a section of its type', () => {
    const { assets, liabilities, equity } = balanceSheet(journal, 5)
    const { sales, costOfGoodsSold, expenses } = incomeStatement(journal, 0, 5)
    const typesOf = (lines: readonly StatementLine[]) =>
      new Set(lines.map(({ account }) => account && getAccount(account).type))
    expect(
      typesOf([...assets.current.lines, ...assets.longTerm.lines]),
    ).toEqual(new Set(['actif']))
    expect(typesOf(liabilities.lines)).toEqual(new Set(['passif']))
    expect(typesOf(equity.lines)).toEqual(new Set(['capitaux propres']))
    expect(typesOf([sales])).toEqual(new Set(['produit']))
    expect(typesOf([costOfGoodsSold, ...expenses.lines])).toEqual(
      new Set(['charge']),
    )
  })

  it('are frozen', () => {
    expectDeepFrozen(incomeStatement(journal, 0, 5))
    expectDeepFrozen(balanceSheet(journal, 5))
    expectDeepFrozen(cashFlowStatement(journal, 0, 5))
  })

  it.each([1.5, NaN, Infinity, -Infinity, MAX + 1])('reject day %s', (day) => {
    expect(() => incomeStatement(journal, day, 5)).toThrow(RangeError)
    expect(() => incomeStatement(journal, 0, day)).toThrow(RangeError)
    expect(() => balanceSheet(journal, day)).toThrow(RangeError)
    expect(() => cashFlowStatement(journal, day, 5)).toThrow(RangeError)
    expect(() => cashFlowStatement(journal, 0, day)).toThrow(RangeError)
  })

  it('reject a period that ends before it starts', () => {
    expect(() => incomeStatement(journal, 3, 2)).toThrow(
      /Invalid period: from day 3 to day 2/,
    )
    expect(() => cashFlowStatement(journal, 3, 2)).toThrow(RangeError)
  })

  it('reject a journal that emptyJournal() and postEntry() did not make', () => {
    // A spread type-checks as a Journal; the cast stands for any way past
    // the type check, should that one close.
    const forged = {
      ...journal,
      entries: [
        ...journal.entries,
        entry(6, 'Vente (crédit oublié)', dr('1000', 10_000)),
      ],
    } as object as Journal
    expect(() => incomeStatement(forged, 0, 6)).toThrow(TypeError)
    expect(() => balanceSheet(forged, 6)).toThrow(TypeError)
    expect(() => cashFlowStatement(forged, 0, 6)).toThrow(TypeError)
  })

  it('throw when a total leaves the safe integer range', () => {
    const rich = post(
      entry(0, 'Mise de fonds', dr('1000', MAX), cr('3000', MAX)),
      entry(1, 'Vente à crédit', dr('1100', 1), cr('4000', 1)),
    )
    expect(balanceSheet(rich, 0).assets.total.amount).toBe(MAX)
    expect(() => balanceSheet(rich, 1)).toThrow(RangeError)
  })
})
