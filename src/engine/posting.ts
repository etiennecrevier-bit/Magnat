import type { AccountCode } from '../finance/accounts.ts'
import {
  postEntry,
  type Journal,
  type JournalLine,
} from '../finance/journal.ts'
import { add, cents, type Cents } from './money.ts'
import type { Day, TruckId } from './types.ts'

// How the engine posts its entries: the lines of an entry, a payment out of
// Encaisse and a month of straight-line depreciation. day.ts and bakery.ts
// share them. A truck's own sale or charge names the truck on the line of
// the état des résultats only (#259); its Encaisse, Stocks and Amortissement
// cumulé lines name none.

const CASH: AccountCode = '1000'
const ACCUMULATED_DEPRECIATION: AccountCode = '1510'
const DEPRECIATION: AccountCode = '6400'

const ZERO = cents(0)

/**
 * Posts an entry made of the lines with an amount; the journal takes no
 * zero line, so an entry with none is not posted at all.
 */
export function post(
  journal: Journal,
  day: Day,
  memo: string,
  lines: readonly JournalLine[],
): Journal {
  const moved = lines.filter(({ debit, credit }) => debit > 0 || credit > 0)
  return moved.length === 0
    ? journal
    : postEntry(journal, { day, memo, lines: moved })
}

/**
 * An entry paying `amount` out of Encaisse, charged to `account`, for the
 * truck `truck` when it is one's.
 */
export function pay(
  journal: Journal,
  day: Day,
  memo: string,
  account: AccountCode,
  amount: Cents,
  truck?: TruckId,
): Journal {
  return post(journal, day, memo, [
    debit(account, amount, truck),
    credit(CASH, amount),
  ])
}

/** A debit line, naming `truck` when it is one's. */
export function debit(
  account: AccountCode,
  amount: Cents,
  truck?: TruckId,
): JournalLine {
  return tagged({ account, debit: amount, credit: ZERO }, truck)
}

/** A credit line, naming `truck` when it is one's. */
export function credit(
  account: AccountCode,
  amount: Cents,
  truck?: TruckId,
): JournalLine {
  return tagged({ account, debit: ZERO, credit: amount }, truck)
}

function tagged(line: JournalLine, truck: TruckId | undefined): JournalLine {
  return truck === undefined ? line : { ...line, truck }
}

/** Equipment the books carry and depreciate. */
export interface Depreciable {
  /** What it cost. */
  readonly priceCents: Cents
  /** Months it is depreciated over, straight line. */
  readonly usefulLifeMonths: number
}

/**
 * Month `month`'s straight-line depreciation of `asset`, under `memo`: its
 * price over its useful life, rounded down to the cent, with the last month
 * taking what the rounding left, so the months add up to the price. Nothing
 * before month 0 or after the last. The charge names `truck` when the asset
 * is a truck's.
 */
export function depreciate(
  journal: Journal,
  day: Day,
  month: number,
  { priceCents, usefulLifeMonths }: Depreciable,
  memo: string,
  truck?: TruckId,
): Journal {
  if (month < 0 || month >= usefulLifeMonths) return journal
  const remainder = priceCents % usefulLifeMonths
  const monthly = cents((priceCents - remainder) / usefulLifeMonths)
  const amount =
    month === usefulLifeMonths - 1 ? add(monthly, cents(remainder)) : monthly
  return post(journal, day, memo, [
    debit(DEPRECIATION, amount, truck),
    credit(ACCUMULATED_DEPRECIATION, amount),
  ])
}
