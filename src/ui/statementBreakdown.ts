import type { DreamContent } from '../content/schema.ts'
import { BAKERY_MEMO } from '../engine/bakery.ts'
import { DREAM, DREAM_MEMO, dreamLabel } from '../engine/dream.ts'
import { add, cents, sub, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  entriesOf,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import { formatStatementAmount } from './formatMoney.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What a line of the statements holds (#282): the entries behind it, read
// from the journal and grouped by what they were for, so the rows add up to
// the line. Only reads the books the engine wrote.

const CASH = '1000' satisfies AccountCode
const EQUIPMENT = '1500' satisfies AccountCode
// The accounts whose cash the état des flux de trésorerie shows on its «
// Équipement » row (see `CASH_FLOW_ROW` in statements.ts).
const EQUIPMENT_ROW: ReadonlySet<AccountCode> = new Set([
  '1500',
  '1510',
  '6400',
])

/** What a part of a line was for, and its amount. */
export interface BreakdownRow {
  readonly label: string
  readonly amount: Cents
}

/**
 * The asset an entry on Équipement is for: the oven; each upgrade of «
 * Améliorations » by its name; the old truck sold back, and anything else
 * on the books' first day, where only the truck's purchase or contribution
 * posts to it, as the truck; any other entry by its memo.
 */
function assetOf(
  { day, memo }: JournalEntry,
  rungs: ReadonlyMap<string, string>,
): string {
  if (memo === BAKERY_MEMO.ovenBought) return 'Four'
  const rung = rungs.get(memo)
  if (rung !== undefined) return rung
  if (day === 0 || memo === DREAM_MEMO.truckSold) return 'Camion'
  return memo
}

/** Each company rung's name, by the memo of its purchase. */
function rungMemos(content: DreamContent): Map<string, string> {
  return new Map(
    content.company.map(({ name }) => [
      dreamLabel(DREAM_MEMO.bought, name),
      name,
    ]),
  )
}

/** `amounts` in the order first met, without the zeros. */
function rowsOf(amounts: ReadonlyMap<string, Cents>): BreakdownRow[] {
  return [...amounts]
    .filter(([, amount]) => amount !== 0)
    .map(([label, amount]) => ({ label, amount }))
}

function added(
  amounts: Map<string, Cents>,
  label: string,
  amount: Cents,
): void {
  amounts.set(label, add(amounts.get(label) ?? cents(0), amount))
}

/**
 * What the bilan's « Équipement » holds after every entry up to `toDay`:
 * each asset's debits less its credits on 1500, at cost. The rows add up
 * to the line; an asset sold back leaves no row.
 */
export function equipmentOnBooks(
  journal: Journal,
  toDay: Day,
  content: DreamContent = DREAM,
): BreakdownRow[] {
  const rungs = rungMemos(content)
  const amounts = new Map<string, Cents>()
  for (const entry of entriesOf(journal)) {
    if (entry.day > toDay) break
    for (const { account, debit, credit } of entry.lines) {
      if (account !== EQUIPMENT) continue
      added(amounts, assetOf(entry, rungs), sub(debit, credit))
    }
  }
  return rowsOf(amounts)
}

/**
 * What the « Équipement » row of the état des flux de trésorerie from
 * `fromDay` to `toDay` holds: the cash each asset's entries moved, out for
 * a purchase, in for the old truck sold back. The rows add up to the row.
 */
export function equipmentCashFlows(
  journal: Journal,
  fromDay: Day,
  toDay: Day,
  content: DreamContent = DREAM,
): BreakdownRow[] {
  const rungs = rungMemos(content)
  const amounts = new Map<string, Cents>()
  for (const entry of entriesOf(journal)) {
    if (entry.day > toDay) break
    if (entry.day < fromDay) continue
    if (!entry.lines.some(({ account }) => account === CASH)) continue
    let flow = cents(0)
    for (const { account, debit, credit } of entry.lines) {
      if (EQUIPMENT_ROW.has(account)) flow = add(flow, sub(credit, debit))
    }
    if (flow !== 0) added(amounts, assetOf(entry, rungs), flow)
  }
  return rowsOf(amounts)
}

/**
 * A line's tooltip: its label as the title, a row for each part, then the
 * total under a line, as the statement writes amounts.
 */
export function breakdownTip(
  title: string,
  rows: readonly BreakdownRow[],
  total: Cents,
): TipContent {
  const parts: TipRow[] = rows.map(({ label, amount }) => ({
    label,
    value: formatStatementAmount(amount),
  }))
  return {
    title,
    rows: [
      ...parts,
      { label: 'Total', value: formatStatementAmount(total), divider: true },
    ],
  }
}
