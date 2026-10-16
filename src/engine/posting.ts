import type { AccountCode } from '../finance/accounts.ts'
import {
  postEntry,
  type Journal,
  type JournalLine,
} from '../finance/journal.ts'
import { add, cents, type Cents } from './money.ts'
import type { Day } from './types.ts'

// How the engine posts its entries: the lines of an entry, a payment out of
// Encaisse and a month of straight-line depreciation. day.ts and bakery.ts
// share them.

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

/** An entry paying `amount` out of Encaisse, charged to `account`. */
export function pay(
  journal: Journal,
  day: Day,
  memo: string,
  account: AccountCode,
  amount: Cents,
): Journal {
  return post(journal, day, memo, [
    debit(account, amount),
    credit(CASH, amount),
  ])
}

export function debit(account: AccountCode, amount: Cents): JournalLine {
  return { account, debit: amount, credit: ZERO }
}

export function credit(account: AccountCode, amount: Cents): JournalLine {
  return { account, debit: ZERO, credit: amount }
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
 * before month 0 or after the last.
 */
export function depreciate(
  journal: Journal,
  day: Day,
  month: number,
  { priceCents, usefulLifeMonths }: Depreciable,
  memo: string,
): Journal {
  if (month < 0 || month >= usefulLifeMonths) return journal
  const remainder = priceCents % usefulLifeMonths
  const monthly = cents((priceCents - remainder) / usefulLifeMonths)
  const amount =
    month === usefulLifeMonths - 1 ? add(monthly, cents(remainder)) : monthly
  return post(journal, day, memo, [
    debit(DEPRECIATION, amount),
    credit(ACCUMULATED_DEPRECIATION, amount),
  ])
}
