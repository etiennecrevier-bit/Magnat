import type { Cents } from '../engine/money.ts'
import type { AccountCode } from '../finance/accounts.ts'
import type { Journal } from '../finance/journal.ts'
import type {
  BalanceSheet,
  CashFlowStatement,
  IncomeStatement,
  StatementLine,
  StatementSection,
} from '../finance/statements.ts'
import { formatGamePeriod, formatShortGameDate } from './formatGameDate.ts'
import { formatStatementAmount } from './formatMoney.ts'
import {
  createStatementsReader,
  type PeriodKey,
  type StatementTab,
  type Statements,
} from './statementPeriods.ts'
import {
  breakdownTip,
  equipmentCashFlows,
  equipmentOnBooks,
  wagesByPerson,
  type BreakdownRow,
} from './statementBreakdown.ts'
import { useGame } from './store.ts'
import Tooltip from './Tooltip.tsx'
import type { TipContent } from './tooltip.ts'
import './FinancialStatements.css'

const EQUIPMENT = '1500' satisfies AccountCode
const WAGES = '6000' satisfies AccountCode

const PERIODS: Record<PeriodKey, string> = {
  thisMonth: 'Ce mois-ci',
  lastMonth: 'Mois dernier',
  yearToDate: "Depuis le début de l'année",
}

/**
 * One table row. Headings have no amount; `depth` sets the indent. A row
 * with a `tip` shows what its line holds when its label is hovered.
 */
interface Row {
  kind: 'heading' | 'line' | 'total' | 'grandTotal'
  label: string
  amount?: Cents
  depth: number
  tip?: TipContent
}

/** What a line holds, when its tooltip lists it; else undefined. */
type LineTips = (line: StatementLine) => readonly BreakdownRow[] | undefined

const NO_TIPS: LineTips = () => undefined

function lineRow(
  line: StatementLine,
  depth: number,
  kind: Row['kind'] = 'line',
  tips: LineTips = NO_TIPS,
): Row {
  const { label, amount } = line
  const parts = tips(line)
  return parts === undefined || parts.length === 0
    ? { kind, label, amount, depth }
    : { kind, label, amount, depth, tip: breakdownTip(label, parts, amount) }
}

function sectionRows(
  section: StatementSection,
  depth: number,
  tips: LineTips = NO_TIPS,
): Row[] {
  return [
    { kind: 'heading', label: section.label, depth },
    ...section.lines.map((line) => lineRow(line, depth + 1, 'line', tips)),
    lineRow(section.total, depth, 'total'),
  ]
}

function balanceSheetRows(sheet: BalanceSheet, tips: LineTips): Row[] {
  const { assets } = sheet
  return [
    { kind: 'heading', label: assets.label, depth: 0 },
    ...sectionRows(assets.current, 1),
    ...sectionRows(assets.longTerm, 1, tips),
    lineRow(assets.total, 0, 'grandTotal'),
    ...sectionRows(sheet.liabilities, 0),
    ...sectionRows(sheet.equity, 0),
    lineRow(sheet.totalLiabilitiesAndEquity, 0, 'grandTotal'),
  ]
}

function incomeStatementRows(
  statement: IncomeStatement,
  tips: LineTips,
): Row[] {
  return [
    lineRow(statement.sales, 0),
    lineRow(statement.costOfGoodsSold, 0),
    lineRow(statement.grossMargin, 0, 'total'),
    ...sectionRows(statement.expenses, 0, tips),
    lineRow(statement.netIncome, 0, 'grandTotal'),
  ]
}

function cashFlowRows(statement: CashFlowStatement, tips: LineTips): Row[] {
  return [
    ...sectionRows(statement.operating, 0),
    ...sectionRows(statement.investing, 0, tips),
    ...sectionRows(statement.financing, 0),
    lineRow(statement.netChange, 0, 'total'),
    lineRow(statement.openingCash, 0),
    lineRow(statement.closingCash, 0, 'grandTotal'),
  ]
}

/**
 * The rows of the statement `tab` shows, and the dates they cover. With
 * `journal`, the « Équipement » lines and « Salaires » tell what they hold.
 */
function contentFor(
  tab: StatementTab,
  statements: Statements,
  journal: Journal | null,
) {
  const { fromDay, toDay } = statements.period
  const read = (tips: LineTips): LineTips => (journal === null ? NO_TIPS : tips)
  switch (tab) {
    case 'balanceSheet':
      return {
        dates: `Au ${formatShortGameDate(toDay)}`,
        rows: balanceSheetRows(
          statements.balanceSheet,
          read((line) =>
            line.account === EQUIPMENT && journal !== null
              ? equipmentOnBooks(journal, toDay)
              : undefined,
          ),
        ),
      }
    case 'incomeStatement':
      return {
        dates: formatGamePeriod(fromDay, toDay),
        rows: incomeStatementRows(
          statements.incomeStatement,
          read((line) =>
            line.account === WAGES && journal !== null
              ? wagesByPerson(journal, fromDay, toDay)
              : undefined,
          ),
        ),
      }
    case 'cashFlow':
      return {
        dates: formatGamePeriod(fromDay, toDay),
        rows: cashFlowRows(
          statements.cashFlow,
          read((line) =>
            line.label === 'Équipement' && journal !== null
              ? equipmentCashFlows(journal, fromDay, toDay)
              : undefined,
          ),
        ),
      }
  }
}

function StatementTable({
  rows,
  labelledBy,
}: {
  rows: readonly Row[]
  labelledBy: string
}) {
  return (
    <table className="data-table statement" aria-labelledby={labelledBy}>
      <tbody>
        {rows.map(({ kind, label, amount, depth, tip }, index) => (
          // Rows never move within a statement, so their place is their key.
          <tr key={index} className={`statement__${kind}`}>
            {amount === undefined ? (
              <th colSpan={2} className={`statement__depth-${depth}`}>
                {label}
              </th>
            ) : (
              <>
                <th scope="row" className={`statement__depth-${depth}`}>
                  {tip === undefined ? (
                    label
                  ) : (
                    <Tooltip content={tip}>
                      {(anchor) => (
                        <span
                          className="statement__tip"
                          tabIndex={0}
                          {...anchor}
                        >
                          {label}
                        </span>
                      )}
                    </Tooltip>
                  )}
                </th>
                <td className="number">{formatStatementAmount(amount)}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface StatementViewProps {
  statement: StatementTab
  periodKey: PeriodKey
  /** The statements for `periodKey`, or null when it has no days yet. */
  statements: Statements | null
  /** The id of the statement's heading, which names its table. */
  labelledBy: string
  onPeriodChange: (key: PeriodKey) => void
  /**
   * The books the statements are read from, for the tooltips of the lines
   * that tell what they hold; none without it.
   */
  journal?: Journal | null
}

/**
 * One statement, `statement`, under its own heading: its period picker,
 * the dates it covers, and its table, negative amounts in parentheses.
 */
export function StatementView({
  statement,
  periodKey,
  statements,
  labelledBy,
  onPeriodChange,
  journal = null,
}: StatementViewProps) {
  const content =
    statements === null ? null : contentFor(statement, statements, journal)
  return (
    <div className="statements">
      <div className="toggle-group" role="group" aria-label="Période">
        {(Object.keys(PERIODS) as PeriodKey[]).map((option) => (
          <button
            key={option}
            type="button"
            className="toggle"
            aria-pressed={option === periodKey}
            onClick={() => onPeriodChange(option)}
          >
            {PERIODS[option]}
          </button>
        ))}
      </div>
      {content === null ? (
        <p>Aucune donnée pour cette période.</p>
      ) : (
        <>
          <p className="statements__dates">{content.dates}</p>
          <StatementTable rows={content.rows} labelledBy={labelledBy} />
        </>
      )}
    </div>
  )
}

// Shared by every mount, so opening another statement or coming back to
// one on the same day computes nothing.
const readStatements = createStatementsReader()

/**
 * `statement` wired to the app store, over the period the store keeps for
 * it, so it stays as the accordion or the drawer closes.
 */
export default function FinancialStatement({
  statement,
  labelledBy,
}: {
  statement: StatementTab
  labelledBy: string
}) {
  const journal = useGame((state) => state.game.journal)
  const today = useGame((state) => state.game.day)
  const periodKey = useGame((state) => state.financeSections.periods[statement])
  const setStatementPeriod = useGame((state) => state.setStatementPeriod)
  return (
    <StatementView
      statement={statement}
      periodKey={periodKey}
      statements={readStatements(journal, today, periodKey)}
      labelledBy={labelledBy}
      onPeriodChange={(key) => setStatementPeriod(statement, key)}
      journal={journal}
    />
  )
}
