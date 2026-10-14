// The three financial statements, read from the journal: the état des
// résultats, the bilan and the état des flux de trésorerie. They are plain
// data, French labels and amounts in cents; the UI formats them. Which
// account goes where, and every label, is the structure of the statements,
// not a tunable, so it stays here like the chart of accounts.

import { add, cents, sub, sum, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import { ACCOUNTS, getAccount, type AccountCode } from './accounts.ts'
import { entriesOf, type Journal } from './journal.ts'

/** One row of a statement. */
export interface StatementLine {
  readonly label: string
  /** Signed: a loss, a contra-asset or a cash outflow is negative. */
  readonly amount: Cents
  /** The account the row shows, on rows that show a single account. */
  readonly account?: AccountCode
}

/** A heading, its rows, and a row with their total. */
export interface StatementSection {
  readonly label: string
  readonly lines: readonly StatementLine[]
  readonly total: StatementLine
}

/** The état des résultats for a period, both days included. */
export interface IncomeStatement {
  readonly fromDay: Day
  readonly toDay: Day
  readonly sales: StatementLine
  readonly costOfGoodsSold: StatementLine
  /** Sales minus the cost of goods sold. */
  readonly grossMargin: StatementLine
  /** Every other charge account, in chart order. */
  readonly expenses: StatementSection
  /** Bénéfice net, or Perte nette with a negative amount. */
  readonly netIncome: StatementLine
}

export interface BalanceSheetAssets {
  readonly label: string
  readonly current: StatementSection
  readonly longTerm: StatementSection
  readonly total: StatementLine
}

/** The bilan at the end of a day. */
export interface BalanceSheet {
  readonly atDay: Day
  readonly assets: BalanceSheetAssets
  readonly liabilities: StatementSection
  /**
   * Bénéfices non répartis include the net income to date, so the books need
   * no closing entries.
   */
  readonly equity: StatementSection
  /** Always equal to the total of the assets. */
  readonly totalLiabilitiesAndEquity: StatementLine
}

/**
 * The état des flux de trésorerie for a period, both days included, by the
 * direct method.
 */
export interface CashFlowStatement {
  readonly fromDay: Day
  readonly toDay: Day
  readonly operating: StatementSection
  readonly investing: StatementSection
  readonly financing: StatementSection
  /**
   * The three sections added up: an Augmentation nette, or a Diminution nette
   * with a negative amount. Always closing minus opening cash.
   */
  readonly netChange: StatementLine
  readonly openingCash: StatementLine
  readonly closingCash: StatementLine
}

type Nets = ReadonlyMap<AccountCode, Cents>

const ZERO = cents(0)

const LABEL = {
  grossMargin: 'Marge brute',
  netIncome: 'Bénéfice net',
  netLoss: 'Perte nette',
  assets: 'Actifs',
  totalAssets: 'Total des actifs',
  totalLiabilitiesAndEquity: 'Total des passifs et des capitaux propres',
  netIncrease: "Augmentation nette de l'encaisse",
  netDecrease: "Diminution nette de l'encaisse",
  openingCash: 'Encaisse au début de la période',
  closingCash: 'Encaisse à la fin de la période',
} as const

// Where each account shows up, with the side its amount is read from: assets
// and charges show their net debits, the others their net credits, so
// Amortissement cumulé comes out negative among the assets.
const PLACES = {
  currentAssets: {
    side: 'debit',
    label: 'Actifs à court terme',
    total: 'Total des actifs à court terme',
  },
  longTermAssets: {
    side: 'debit',
    label: 'Actifs à long terme',
    total: 'Total des actifs à long terme',
  },
  liabilities: {
    side: 'credit',
    label: 'Passifs',
    total: 'Total des passifs',
  },
  equity: {
    side: 'credit',
    label: 'Capitaux propres',
    total: 'Total des capitaux propres',
  },
  sales: { side: 'credit' },
  costOfGoodsSold: { side: 'debit' },
  expenses: { side: 'debit', label: 'Charges', total: 'Total des charges' },
} as const

type Place = keyof typeof PLACES
type SectionPlace = {
  [P in Place]: (typeof PLACES)[P] extends { label: string } ? P : never
}[Place]

// Typed over every account code, so a new account does not compile until it
// has a place.
const PLACE: Record<AccountCode, Place> = {
  '1000': 'currentAssets',
  '1100': 'currentAssets',
  '1200': 'currentAssets',
  '1500': 'longTermAssets',
  '1510': 'longTermAssets',
  '2000': 'liabilities',
  '2500': 'liabilities',
  '3000': 'equity',
  '3100': 'equity',
  '4000': 'sales',
  '5000': 'costOfGoodsSold',
  '5100': 'expenses',
  '6000': 'expenses',
  '6100': 'expenses',
  '6200': 'expenses',
  '6300': 'expenses',
  '6400': 'expenses',
  '7000': 'expenses',
}

// The état des résultats shows sales and the cost of goods sold on one row
// each, so each of these places holds exactly one account.
const SALES = onlyAccountAt('sales')
const COST_OF_GOODS_SOLD = onlyAccountAt('costOfGoodsSold')
const RETAINED_EARNINGS = '3100' satisfies AccountCode
const CASH = '1000' satisfies AccountCode

const ACTIVITIES = {
  operating: {
    label: "Activités d'exploitation",
    total: "Flux de trésorerie liés aux activités d'exploitation",
  },
  investing: {
    label: "Activités d'investissement",
    total: "Flux de trésorerie liés aux activités d'investissement",
  },
  financing: {
    label: 'Activités de financement',
    total: 'Flux de trésorerie liés aux activités de financement',
  },
} as const

type Activity = keyof typeof ACTIVITIES

// The rows of the état des flux de trésorerie, in the order they show.
const CASH_FLOW_ROWS = [
  {
    key: 'customers',
    activity: 'operating',
    label: 'Encaissements des clients',
  },
  {
    key: 'suppliers',
    activity: 'operating',
    label: 'Paiements aux fournisseurs',
  },
  { key: 'wages', activity: 'operating', label: 'Salaires' },
  { key: 'otherExpenses', activity: 'operating', label: 'Autres charges' },
  { key: 'equipment', activity: 'investing', label: 'Équipement' },
  { key: 'loans', activity: 'financing', label: 'Emprunts bancaires' },
  { key: 'shareCapital', activity: 'financing', label: 'Capital-actions' },
] as const satisfies readonly {
  key: string
  activity: Activity
  label: string
}[]

type CashFlowRow = (typeof CASH_FLOW_ROWS)[number]['key']

// The row each counterpart of Encaisse feeds, typed over every other account
// so a new account does not compile until it has a row. Interest paid is an
// operating flow, as ASPE section 1540 has it. Stocks and Pertes sur stocks
// go with the suppliers, so the cost of a sale and the stock it uses cancel
// out within one row when the engine posts them with the sale.
const CASH_FLOW_ROW: Record<Exclude<AccountCode, typeof CASH>, CashFlowRow> = {
  '1100': 'customers',
  '1200': 'suppliers',
  '1500': 'equipment',
  '1510': 'equipment',
  '2000': 'suppliers',
  '2500': 'loans',
  '3000': 'shareCapital',
  '3100': 'shareCapital',
  '4000': 'customers',
  '5000': 'suppliers',
  '5100': 'suppliers',
  '6000': 'wages',
  '6100': 'otherExpenses',
  '6200': 'otherExpenses',
  '6300': 'otherExpenses',
  '6400': 'otherExpenses',
  '7000': 'otherExpenses',
}

/**
 * The état des résultats over the entries from `fromDay` to `toDay`, both
 * included. Throws a RangeError unless both days are safe integers and
 * `fromDay` is no later than `toDay`, or if an amount leaves the safe integer
 * range, and a TypeError unless `emptyJournal()` or `postEntry()` made
 * `journal`.
 */
export function incomeStatement(
  journal: Journal,
  fromDay: Day,
  toDay: Day,
): IncomeStatement {
  checkPeriod(fromDay, toDay)
  const nets = netDebits(journal, { fromDay, toDay })
  return Object.freeze({ fromDay, toDay, ...incomeLines(nets) })
}

/**
 * The bilan after every entry up to and including `atDay`; a day before the
 * first entry gives zeros. Throws a RangeError unless `atDay` is a safe
 * integer, or if an amount leaves the safe integer range, and a TypeError
 * unless `emptyJournal()` or `postEntry()` made `journal`.
 */
export function balanceSheet(journal: Journal, atDay: Day): BalanceSheet {
  checkDay(atDay)
  return balanceSheetFrom(atDay, netDebits(journal, { toDay: atDay }))
}

/**
 * The état des flux de trésorerie over the entries from `fromDay` to `toDay`,
 * both included. Throws a RangeError unless both days are safe integers and
 * `fromDay` is no later than `toDay`, or if an amount leaves the safe integer
 * range, and a TypeError unless `emptyJournal()` or `postEntry()` made
 * `journal`.
 */
export function cashFlowStatement(
  journal: Journal,
  fromDay: Day,
  toDay: Day,
): CashFlowStatement {
  checkPeriod(fromDay, toDay)
  let openingCash = ZERO
  let closingCash = ZERO
  const flows = new Map<CashFlowRow, Cents>()
  // Each entry that touches Encaisse, even one whose cash lines net to zero,
  // feeds each of its other lines into the row of that line's account. A
  // balanced entry's other lines add up to its net cash movement, so the rows
  // add up to the change in Encaisse. Entries that leave Encaisse alone, such
  // as purchases on credit, spoilage or depreciation, move no cash. Two other
  // lines of one entry whose accounts feed different rows (depreciation
  // posted with a sale, say) move cash between those rows, so the engine
  // should post such pairs as entries of their own.
  for (const { day, lines } of entriesOf(journal)) {
    // Days never go down, so no later entry can be in range either.
    if (day > toDay) break
    if (!lines.some(({ account }) => account === CASH)) continue
    for (const { account, debit, credit } of lines) {
      if (account === CASH) {
        const net = sub(debit, credit)
        closingCash = add(closingCash, net)
        if (day < fromDay) openingCash = add(openingCash, net)
      } else if (day >= fromDay) {
        const row = CASH_FLOW_ROW[account]
        flows.set(row, add(flows.get(row) ?? ZERO, sub(credit, debit)))
      }
    }
  }

  const operating = activitySection('operating', flows)
  const investing = activitySection('investing', flows)
  const financing = activitySection('financing', flows)
  const netChange = sum(
    [operating, investing, financing].map(({ total }) => total.amount),
  )
  return Object.freeze({
    fromDay,
    toDay,
    operating,
    investing,
    financing,
    netChange: line(
      netChange >= 0 ? LABEL.netIncrease : LABEL.netDecrease,
      netChange,
    ),
    openingCash: line(LABEL.openingCash, openingCash, CASH),
    closingCash: line(LABEL.closingCash, closingCash, CASH),
  })
}

/** Every row of the état des résultats, from each account's net debits. */
function incomeLines(nets: Nets) {
  const sales = accountLine(SALES, nets)
  const costOfGoodsSold = accountLine(COST_OF_GOODS_SOLD, nets)
  const grossMargin = line(
    LABEL.grossMargin,
    sub(sales.amount, costOfGoodsSold.amount),
  )
  const expenses = placeSection('expenses', nets)
  const net = sub(grossMargin.amount, expenses.total.amount)
  const netIncome = line(net >= 0 ? LABEL.netIncome : LABEL.netLoss, net)
  return { sales, costOfGoodsSold, grossMargin, expenses, netIncome }
}

/** The bilan from each account's net debits since the first entry. */
function balanceSheetFrom(atDay: Day, nets: Nets): BalanceSheet {
  const current = placeSection('currentAssets', nets)
  const longTerm = placeSection('longTermAssets', nets)
  const liabilities = placeSection('liabilities', nets)
  const { netIncome } = incomeLines(nets)
  const equity = placeSection('equity', nets, (code, amount) =>
    code === RETAINED_EARNINGS ? add(amount, netIncome.amount) : amount,
  )
  return Object.freeze({
    atDay,
    assets: Object.freeze({
      label: LABEL.assets,
      current,
      longTerm,
      total: line(
        LABEL.totalAssets,
        add(current.total.amount, longTerm.total.amount),
      ),
    }),
    liabilities,
    equity,
    totalLiabilitiesAndEquity: line(
      LABEL.totalLiabilitiesAndEquity,
      add(liabilities.total.amount, equity.total.amount),
    ),
  })
}

/**
 * A section with a row for each account at `place`, in chart order. `adjust`
 * can change an account's amount before it shows.
 */
function placeSection(
  place: SectionPlace,
  nets: Nets,
  adjust: (code: AccountCode, amount: Cents) => Cents = (_, amount) => amount,
): StatementSection {
  const { label, total } = PLACES[place]
  const lines = accountsAt(place).map((code) => {
    const { name } = getAccount(code)
    return line(name, adjust(code, amountOf(code, nets)), code)
  })
  return section(label, lines, total)
}

function activitySection(
  activity: Activity,
  flows: ReadonlyMap<CashFlowRow, Cents>,
): StatementSection {
  const { label, total } = ACTIVITIES[activity]
  const lines = CASH_FLOW_ROWS.filter((row) => row.activity === activity).map(
    (row) => line(row.label, flows.get(row.key) ?? ZERO),
  )
  return section(label, lines, total)
}

function accountLine(code: AccountCode, nets: Nets): StatementLine {
  return line(getAccount(code).name, amountOf(code, nets), code)
}

/** The account's net amount on the side its place reads. */
function amountOf(code: AccountCode, nets: Nets): Cents {
  const net = nets.get(code) ?? ZERO
  return PLACES[PLACE[code]].side === 'debit' ? net : sub(ZERO, net)
}

function accountsAt(place: Place): AccountCode[] {
  return ACCOUNTS.map(({ code }) => code).filter(
    (code) => PLACE[code] === place,
  )
}

function onlyAccountAt(place: Place): AccountCode {
  const [code, ...others] = accountsAt(place)
  if (code === undefined || others.length > 0) {
    throw new Error(`Exactly one account must show as ${place}`)
  }
  return code
}

function section(
  label: string,
  lines: StatementLine[],
  totalLabel: string,
): StatementSection {
  const total = sum(lines.map(({ amount }) => amount))
  return Object.freeze({
    label,
    lines: Object.freeze(lines),
    total: line(totalLabel, total),
  })
}

function line(
  label: string,
  amount: Cents,
  account?: AccountCode,
): StatementLine {
  return Object.freeze(
    account === undefined ? { label, amount } : { label, amount, account },
  )
}

/**
 * Each account's debits minus its credits, over the entries from `fromDay`
 * (or the first entry) to `toDay`, both included. Accounts without lines are
 * missing from the map.
 */
function netDebits(
  journal: Journal,
  { fromDay = -Infinity, toDay }: { fromDay?: Day; toDay: Day },
): Nets {
  const nets = new Map<AccountCode, Cents>()
  for (const { day, lines } of entriesOf(journal)) {
    // Days never go down, so no later entry can be in range either.
    if (day > toDay) break
    if (day < fromDay) continue
    for (const { account, debit, credit } of lines) {
      nets.set(account, add(nets.get(account) ?? ZERO, sub(debit, credit)))
    }
  }
  return nets
}

function checkDay(day: Day): void {
  if (!Number.isSafeInteger(day)) {
    throw new RangeError(`Invalid game day: ${day}`)
  }
}

function checkPeriod(fromDay: Day, toDay: Day): void {
  checkDay(fromDay)
  checkDay(toDay)
  if (fromDay > toDay) {
    throw new RangeError(`Invalid period: from day ${fromDay} to day ${toDay}`)
  }
}
