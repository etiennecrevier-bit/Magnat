import { describe, expect, it } from 'vitest'
import { cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from './accounts.ts'
import {
  emptyJournal,
  postEntry,
  type Journal,
  type JournalEntry,
  type JournalLine,
} from './journal.ts'
import { loanSchedule } from './loan.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type CashFlowStatement,
  type StatementLine,
} from './statements.ts'

// The opening and first year of each difficulty (#44), posted as README.md
// says the engine posts them. Day 0 is May 1st and the first year runs to
// day 364, April 30th; each month's business is posted on its last day. The
// expected rows were worked out apart from statements.ts, by adding up the
// entries below; the loan's come from loan.test.ts's spreadsheet schedule.

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

/** Every row of a statement in the order it shows, totals included. */
function rowsOf(value: unknown): StatementLine[] {
  if (typeof value !== 'object' || value === null) return []
  if ('amount' in value) return [value as StatementLine]
  return Object.values(value).flatMap(rowsOf)
}

/** Each row's label and amount, in the order they show. */
function table(statement: object): [string, number][] {
  return rowsOf(statement).map(({ label, amount }) => [label, amount])
}

/** The amount on the row with `label` in one section of a statement. */
function amountIn(lines: readonly StatementLine[], label: string): number {
  const found = lines.filter((line) => line.label === label)
  expect(found).toHaveLength(1)
  return found[0]?.amount ?? NaN
}

const LAST_DAY = 364
const MONTH_ENDS: Day[] = [
  30, 60, 91, 122, 152, 183, 213, 244, 275, 303, 334, 364,
]

// 85 000 $ over 10 years.
const DEPRECIATION = 70_833
const LOAN = loanSchedule(cents(7_000_000), 800, 60)

/** A month's business, the same in every difficulty. */
function business(day: Day): JournalEntry[] {
  return [
    entry(day, 'Achat de stocks', dr('1200', 320_000), cr('1000', 320_000)),
    entry(
      day,
      'Ventes',
      dr('1000', 1_200_000),
      cr('4000', 1_200_000),
      dr('5000', 300_000),
      cr('1200', 300_000),
    ),
    entry(day, 'Emballages', dr('5200', 60_000), cr('1000', 60_000)),
    entry(day, 'Frais de cartes', dr('6500', 25_500), cr('1000', 25_500)),
    entry(
      day,
      'Carburant et entretien',
      dr('6200', 44_000),
      cr('1000', 44_000),
    ),
    entry(
      day,
      'Paie du propriétaire',
      dr('6000', 300_000),
      cr('1000', 300_000),
    ),
    entry(day, 'Marketing', dr('6300', 20_000), cr('1000', 20_000)),
    entry(
      day,
      'Permis, stationnement et cuisine',
      dr('6100', 150_000),
      cr('1000', 150_000),
    ),
    entry(day, 'Assurances', dr('6150', 25_000), cr('1000', 25_000)),
  ]
}

function depreciation(day: Day): JournalEntry {
  return entry(
    day,
    'Amortissement',
    dr('6400', DEPRECIATION),
    cr('1510', DEPRECIATION),
  )
}

/**
 * The loan's payment number `index`, from 0, as two entries so each feeds one
 * cash-flow row.
 */
function loanPayment(day: Day, index: number): JournalEntry[] {
  const payment = LOAN.payments[index]
  if (payment === undefined) throw new Error(`No loan payment ${index}`)
  const { interest, principal } = payment
  return [
    entry(
      day,
      "Intérêts de l'emprunt",
      dr('7000', interest),
      cr('1000', interest),
    ),
    entry(
      day,
      "Remboursement de l'emprunt",
      dr('2500', principal),
      cr('1000', principal),
    ),
  ]
}

const DIFFICULTIES = {
  // The truck is already the owner's, put into the business with 15 000 $.
  facile: {
    opening: [
      entry(0, 'Mise de fonds', dr('1000', 1_500_000), cr('3000', 1_500_000)),
      entry(
        0,
        'Camion apporté par le propriétaire',
        dr('1500', 8_500_000),
        cr('3000', 8_500_000),
      ),
    ],
    monthly: (day: Day) => [depreciation(day)],
  },
  // 25 000 $ of capital and a 70 000 $ loan buy the 85 000 $ truck.
  moyen: {
    opening: [
      entry(0, 'Mise de fonds', dr('1000', 2_500_000), cr('3000', 2_500_000)),
      entry(0, 'Emprunt', dr('1000', 7_000_000), cr('2500', 7_000_000)),
      entry(0, 'Achat du camion', dr('1500', 8_500_000), cr('1000', 8_500_000)),
    ],
    monthly: (day: Day, index: number) => [
      ...loanPayment(day, index),
      depreciation(day),
    ],
  },
  // 5 000 $ and a leased truck.
  difficile: {
    opening: [
      entry(0, 'Mise de fonds', dr('1000', 500_000), cr('3000', 500_000)),
    ],
    monthly: (day: Day) => [
      entry(
        day,
        'Location du camion',
        dr('6120', 180_000),
        cr('1000', 180_000),
      ),
    ],
  },
} satisfies Record<
  string,
  {
    opening: JournalEntry[]
    monthly: (day: Day, index: number) => JournalEntry[]
  }
>

type Difficulty = keyof typeof DIFFICULTIES

function firstYear(difficulty: Difficulty): Journal {
  const { opening, monthly } = DIFFICULTIES[difficulty]
  return post(
    ...opening,
    ...MONTH_ENDS.flatMap((day, index) => [
      ...business(day),
      ...monthly(day, index),
    ]),
  )
}

/** The checks every statement of a period must pass. */
function expectConsistent(journal: Journal, toDay: Day): void {
  const flows = cashFlowStatement(journal, 0, toDay)
  const bilan = balanceSheet(journal, toDay)
  const activities = [flows.operating, flows.investing, flows.financing]
  for (const { lines, total } of activities) {
    expect(lines.reduce((sum, { amount }) => sum + amount, 0)).toBe(
      total.amount,
    )
  }
  expect(activities.reduce((sum, { total }) => sum + total.amount, 0)).toBe(
    flows.netChange.amount,
  )
  expect(flows.closingCash.amount - flows.openingCash.amount).toBe(
    flows.netChange.amount,
  )
  expect(flows.closingCash.amount).toBe(
    amountIn(bilan.assets.current.lines, 'Encaisse'),
  )
  expect(bilan.assets.total.amount).toBe(bilan.totalLiabilitiesAndEquity.amount)
  expect(amountIn(bilan.equity.lines, 'Bénéfices non répartis')).toBe(
    incomeStatement(journal, 0, toDay).netIncome.amount,
  )
}

/** The non-zero rows of the three activities. */
function cashRows(statement: CashFlowStatement): [string, number][] {
  return [statement.operating, statement.investing, statement.financing]
    .flatMap(({ lines }) => lines)
    .filter(({ amount }) => amount !== 0)
    .map(({ label, amount }) => [label, amount])
}

describe('Facile', () => {
  const journal = firstYear('facile')

  it("opens with 15 000 $ of cash and the owner's truck", () => {
    expect(table(balanceSheet(journal, 0))).toEqual([
      ['Encaisse', 1_500_000],
      ['Comptes clients', 0],
      ['Stocks', 0],
      ['Total des actifs à court terme', 1_500_000],
      ['Équipement', 8_500_000],
      ['Amortissement cumulé', 0],
      ['Total des actifs à long terme', 8_500_000],
      ['Total des actifs', 10_000_000],
      ['Comptes fournisseurs', 0],
      ['Emprunts bancaires', 0],
      ['Total des passifs', 0],
      ['Capital-actions', 10_000_000],
      ['Bénéfices non répartis', 0],
      ['Total des capitaux propres', 10_000_000],
      ['Total des passifs et des capitaux propres', 10_000_000],
    ])
    expect(table(cashFlowStatement(journal, 0, 0))).toEqual([
      ['Encaissements des clients', 0],
      ['Paiements aux fournisseurs', 0],
      ['Salaires', 0],
      ['Autres charges', 0],
      ['Intérêts payés', 0],
      ["Flux de trésorerie liés aux activités d'exploitation", 0],
      ['Équipement', 0],
      ["Flux de trésorerie liés aux activités d'investissement", 0],
      ['Emprunts bancaires', 0],
      ['Capital-actions', 1_500_000],
      ['Flux de trésorerie liés aux activités de financement', 1_500_000],
      ["Augmentation nette de l'encaisse", 1_500_000],
      ['Encaisse au début de la période', 0],
      ['Encaisse à la fin de la période', 1_500_000],
    ])
    expectConsistent(journal, 0)
  })

  it('leaves the contributed truck out of the état des flux de trésorerie', () => {
    const opening = cashFlowStatement(journal, 0, 0)
    expect(cashRows(opening)).toEqual([['Capital-actions', 1_500_000]])
    expect(
      cashRows(cashFlowStatement(journal, 0, LAST_DAY)),
    ).not.toContainEqual(['Équipement', expect.any(Number)])
  })

  it('closes its first year', () => {
    expect(table(incomeStatement(journal, 0, LAST_DAY))).toEqual([
      ['Ventes', 14_400_000],
      ['Coût des marchandises vendues', 3_600_000],
      ['Marge brute', 10_800_000],
      ['Pertes sur stocks', 0],
      ['Emballages', 720_000],
      ['Salaires', 3_600_000],
      ['Loyer et permis', 1_800_000],
      ['Location du camion', 0],
      ['Location du fournil', 0],
      ['Assurances', 300_000],
      ['Carburant et entretien', 528_000],
      ['Marketing', 240_000],
      ['Amortissement', 849_996],
      ['Frais bancaires et de cartes', 306_000],
      ['Autres charges', 0],
      ['Créances irrécouvrables', 0],
      ['Intérêts', 0],
      ['Total des charges', 8_343_996],
      ['Bénéfice net', 2_456_004],
    ])
    expect(table(balanceSheet(journal, LAST_DAY))).toEqual([
      ['Encaisse', 4_566_000],
      ['Comptes clients', 0],
      ['Stocks', 240_000],
      ['Total des actifs à court terme', 4_806_000],
      ['Équipement', 8_500_000],
      ['Amortissement cumulé', -849_996],
      ['Total des actifs à long terme', 7_650_004],
      ['Total des actifs', 12_456_004],
      ['Comptes fournisseurs', 0],
      ['Emprunts bancaires', 0],
      ['Total des passifs', 0],
      ['Capital-actions', 10_000_000],
      ['Bénéfices non répartis', 2_456_004],
      ['Total des capitaux propres', 12_456_004],
      ['Total des passifs et des capitaux propres', 12_456_004],
    ])
    expect(table(cashFlowStatement(journal, 0, LAST_DAY))).toEqual([
      ['Encaissements des clients', 14_400_000],
      ['Paiements aux fournisseurs', -4_560_000],
      ['Salaires', -3_600_000],
      ['Autres charges', -3_174_000],
      ['Intérêts payés', 0],
      ["Flux de trésorerie liés aux activités d'exploitation", 3_066_000],
      ['Équipement', 0],
      ["Flux de trésorerie liés aux activités d'investissement", 0],
      ['Emprunts bancaires', 0],
      ['Capital-actions', 1_500_000],
      ['Flux de trésorerie liés aux activités de financement', 1_500_000],
      ["Augmentation nette de l'encaisse", 4_566_000],
      ['Encaisse au début de la période', 0],
      ['Encaisse à la fin de la période', 4_566_000],
    ])
    expectConsistent(journal, LAST_DAY)
  })
})

describe('Moyen', () => {
  const journal = firstYear('moyen')

  it('opens with the loan and the truck bought, 10 000 $ of cash left', () => {
    expect(table(balanceSheet(journal, 0))).toEqual([
      ['Encaisse', 1_000_000],
      ['Comptes clients', 0],
      ['Stocks', 0],
      ['Total des actifs à court terme', 1_000_000],
      ['Équipement', 8_500_000],
      ['Amortissement cumulé', 0],
      ['Total des actifs à long terme', 8_500_000],
      ['Total des actifs', 9_500_000],
      ['Comptes fournisseurs', 0],
      ['Emprunts bancaires', 7_000_000],
      ['Total des passifs', 7_000_000],
      ['Capital-actions', 2_500_000],
      ['Bénéfices non répartis', 0],
      ['Total des capitaux propres', 2_500_000],
      ['Total des passifs et des capitaux propres', 9_500_000],
    ])
    expect(table(cashFlowStatement(journal, 0, 0))).toEqual([
      ['Encaissements des clients', 0],
      ['Paiements aux fournisseurs', 0],
      ['Salaires', 0],
      ['Autres charges', 0],
      ['Intérêts payés', 0],
      ["Flux de trésorerie liés aux activités d'exploitation", 0],
      ['Équipement', -8_500_000],
      ["Flux de trésorerie liés aux activités d'investissement", -8_500_000],
      ['Emprunts bancaires', 7_000_000],
      ['Capital-actions', 2_500_000],
      ['Flux de trésorerie liés aux activités de financement', 9_500_000],
      ["Augmentation nette de l'encaisse", 1_000_000],
      ['Encaisse au début de la période', 0],
      ['Encaisse à la fin de la période', 1_000_000],
    ])
    expect(cashRows(cashFlowStatement(journal, 0, 0))).toEqual([
      ['Équipement', -8_500_000],
      ['Emprunts bancaires', 7_000_000],
      ['Capital-actions', 2_500_000],
    ])
    expectConsistent(journal, 0)
  })

  it('closes its first year', () => {
    expect(table(incomeStatement(journal, 0, LAST_DAY))).toEqual([
      ['Ventes', 14_400_000],
      ['Coût des marchandises vendues', 3_600_000],
      ['Marge brute', 10_800_000],
      ['Pertes sur stocks', 0],
      ['Emballages', 720_000],
      ['Salaires', 3_600_000],
      ['Loyer et permis', 1_800_000],
      ['Location du camion', 0],
      ['Location du fournil', 0],
      ['Assurances', 300_000],
      ['Carburant et entretien', 528_000],
      ['Marketing', 240_000],
      ['Amortissement', 849_996],
      ['Frais bancaires et de cartes', 306_000],
      ['Autres charges', 0],
      ['Créances irrécouvrables', 0],
      ['Intérêts', 517_138],
      ['Total des charges', 8_861_134],
      ['Bénéfice net', 1_938_866],
    ])
    expect(table(balanceSheet(journal, LAST_DAY))).toEqual([
      ['Encaisse', 2_362_780],
      ['Comptes clients', 0],
      ['Stocks', 240_000],
      ['Total des actifs à court terme', 2_602_780],
      ['Équipement', 8_500_000],
      ['Amortissement cumulé', -849_996],
      ['Total des actifs à long terme', 7_650_004],
      ['Total des actifs', 10_252_784],
      ['Comptes fournisseurs', 0],
      ['Emprunts bancaires', 5_813_918],
      ['Total des passifs', 5_813_918],
      ['Capital-actions', 2_500_000],
      ['Bénéfices non répartis', 1_938_866],
      ['Total des capitaux propres', 4_438_866],
      ['Total des passifs et des capitaux propres', 10_252_784],
    ])
    expect(table(cashFlowStatement(journal, 0, LAST_DAY))).toEqual([
      ['Encaissements des clients', 14_400_000],
      ['Paiements aux fournisseurs', -4_560_000],
      ['Salaires', -3_600_000],
      ['Autres charges', -3_174_000],
      ['Intérêts payés', -517_138],
      ["Flux de trésorerie liés aux activités d'exploitation", 2_548_862],
      ['Équipement', -8_500_000],
      ["Flux de trésorerie liés aux activités d'investissement", -8_500_000],
      ['Emprunts bancaires', 5_813_918],
      ['Capital-actions', 2_500_000],
      ['Flux de trésorerie liés aux activités de financement', 8_313_918],
      ["Augmentation nette de l'encaisse", 2_362_780],
      ['Encaisse au début de la période', 0],
      ['Encaisse à la fin de la période', 2_362_780],
    ])
    expectConsistent(journal, LAST_DAY)
  })

  it('shows interest paid in operating and principal repaid in financing', () => {
    // A year of payments: 12 × 1 419,35 $, of which 5 171,38 $ is interest.
    const year = cashFlowStatement(journal, 1, LAST_DAY)
    expect(amountIn(year.operating.lines, 'Intérêts payés')).toBe(-517_138)
    expect(amountIn(year.financing.lines, 'Emprunts bancaires')).toBe(
      -1_186_082,
    )
    expect(
      amountIn(
        incomeStatement(journal, 0, LAST_DAY).expenses.lines,
        'Intérêts',
      ),
    ).toBe(517_138)
  })

  it('feeds one cash-flow row with each entry of a loan payment', () => {
    const loan = entry(
      0,
      'Emprunt',
      dr('1000', 7_000_000),
      cr('2500', 7_000_000),
    )
    const rowsFed = loanPayment(30, 0).map((part) =>
      cashRows(cashFlowStatement(post(loan, part), 1, LAST_DAY)),
    )
    expect(rowsFed).toEqual([
      [['Intérêts payés', -46_667]],
      [['Emprunts bancaires', -95_268]],
    ])
  })
})

describe('Difficile', () => {
  const journal = firstYear('difficile')

  it('opens with 5 000 $ of cash and no truck', () => {
    expect(table(balanceSheet(journal, 0))).toEqual([
      ['Encaisse', 500_000],
      ['Comptes clients', 0],
      ['Stocks', 0],
      ['Total des actifs à court terme', 500_000],
      ['Équipement', 0],
      ['Amortissement cumulé', 0],
      ['Total des actifs à long terme', 0],
      ['Total des actifs', 500_000],
      ['Comptes fournisseurs', 0],
      ['Emprunts bancaires', 0],
      ['Total des passifs', 0],
      ['Capital-actions', 500_000],
      ['Bénéfices non répartis', 0],
      ['Total des capitaux propres', 500_000],
      ['Total des passifs et des capitaux propres', 500_000],
    ])
    expect(table(cashFlowStatement(journal, 0, 0))).toEqual([
      ['Encaissements des clients', 0],
      ['Paiements aux fournisseurs', 0],
      ['Salaires', 0],
      ['Autres charges', 0],
      ['Intérêts payés', 0],
      ["Flux de trésorerie liés aux activités d'exploitation", 0],
      ['Équipement', 0],
      ["Flux de trésorerie liés aux activités d'investissement", 0],
      ['Emprunts bancaires', 0],
      ['Capital-actions', 500_000],
      ['Flux de trésorerie liés aux activités de financement', 500_000],
      ["Augmentation nette de l'encaisse", 500_000],
      ['Encaisse au début de la période', 0],
      ['Encaisse à la fin de la période', 500_000],
    ])
    expectConsistent(journal, 0)
  })

  it('closes its first year', () => {
    expect(table(incomeStatement(journal, 0, LAST_DAY))).toEqual([
      ['Ventes', 14_400_000],
      ['Coût des marchandises vendues', 3_600_000],
      ['Marge brute', 10_800_000],
      ['Pertes sur stocks', 0],
      ['Emballages', 720_000],
      ['Salaires', 3_600_000],
      ['Loyer et permis', 1_800_000],
      ['Location du camion', 2_160_000],
      ['Location du fournil', 0],
      ['Assurances', 300_000],
      ['Carburant et entretien', 528_000],
      ['Marketing', 240_000],
      ['Amortissement', 0],
      ['Frais bancaires et de cartes', 306_000],
      ['Autres charges', 0],
      ['Créances irrécouvrables', 0],
      ['Intérêts', 0],
      ['Total des charges', 9_654_000],
      ['Bénéfice net', 1_146_000],
    ])
    expect(table(balanceSheet(journal, LAST_DAY))).toEqual([
      ['Encaisse', 1_406_000],
      ['Comptes clients', 0],
      ['Stocks', 240_000],
      ['Total des actifs à court terme', 1_646_000],
      ['Équipement', 0],
      ['Amortissement cumulé', 0],
      ['Total des actifs à long terme', 0],
      ['Total des actifs', 1_646_000],
      ['Comptes fournisseurs', 0],
      ['Emprunts bancaires', 0],
      ['Total des passifs', 0],
      ['Capital-actions', 500_000],
      ['Bénéfices non répartis', 1_146_000],
      ['Total des capitaux propres', 1_646_000],
      ['Total des passifs et des capitaux propres', 1_646_000],
    ])
    expect(table(cashFlowStatement(journal, 0, LAST_DAY))).toEqual([
      ['Encaissements des clients', 14_400_000],
      ['Paiements aux fournisseurs', -4_560_000],
      ['Salaires', -3_600_000],
      ['Autres charges', -5_334_000],
      ['Intérêts payés', 0],
      ["Flux de trésorerie liés aux activités d'exploitation", 906_000],
      ['Équipement', 0],
      ["Flux de trésorerie liés aux activités d'investissement", 0],
      ['Emprunts bancaires', 0],
      ['Capital-actions', 500_000],
      ['Flux de trésorerie liés aux activités de financement', 500_000],
      ["Augmentation nette de l'encaisse", 1_406_000],
      ['Encaisse au début de la période', 0],
      ['Encaisse à la fin de la période', 1_406_000],
    ])
    expectConsistent(journal, LAST_DAY)
  })

  it('shows the lease under Autres charges, in operating', () => {
    const lease = post(
      entry(0, 'Mise de fonds', dr('1000', 500_000), cr('3000', 500_000)),
      entry(30, 'Location du camion', dr('6120', 180_000), cr('1000', 180_000)),
    )
    const month = cashFlowStatement(lease, 1, 30)
    expect(cashRows(month)).toEqual([['Autres charges', -180_000]])
    expect(month.operating.total.amount).toBe(-180_000)
  })
})
