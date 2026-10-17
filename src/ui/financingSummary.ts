import { endOfMonth, startOfQuarter, toCalendar } from '../engine/calendar.ts'
import {
  FINANCING_MEMO,
  chargesOn,
  financingMemo,
  isLoanOpen,
} from '../engine/financing.ts'
import { add, cents, sub, sum, type Cents } from '../engine/money.ts'
import type { Day, GameState } from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { entriesSince, type JournalEntry } from '../finance/journal.ts'

// What the « Financement » block of « Aujourd'hui » shows (#163): the
// emergency loans and the shares sold, as the engine keeps them
// (src/engine/financing.ts), with what the books say of them.

const CASH = '1000' satisfies AccountCode
// A share shows to a tenth of a percent.
const TENTHS_PER_WHOLE = 1000

/** An emergency loan still open. */
export interface LoanLine {
  /** Who lent it, as the journal names them. */
  readonly lender: string
  /** What is still owed of it: the principal less what was paid back. */
  readonly owed: Cents
  /** The next payment, interest and principal, and its day; null if none. */
  readonly next: { readonly amount: Cents; readonly day: Day } | null
}

/** An investor and their share of the business. */
export interface ShareLine {
  readonly investor: string
  /** Their share, in tenths of a percent: 200 for 20 %. */
  readonly tenths: number
}

/** The dividends of the next 1st of a quarter. */
export interface DividendLine {
  /** The 1st of the quarter that pays them. */
  readonly day: Day
  /**
   * What they come to: the quarter's profit so far, before that morning;
   * exactly what it pays on that morning itself.
   */
  readonly amount: Cents
  /** Whether that 1st is today, so the amount is final. */
  readonly final: boolean
}

/** The « Financement » block. */
export interface FinancingSummary {
  /** Whether any emergency loan was taken, paid back or not. */
  readonly hadLoans: boolean
  readonly loans: readonly LoanLine[]
  /** By investor, in the order of their first round. */
  readonly shares: readonly ShareLine[]
  /** Null when no share was sold. */
  readonly dividend: DividendLine | null
}

/**
 * The « Financement » block of `game` on the morning of `game.day`; null
 * when it never took an emergency loan nor sold shares. Each loan still
 * open (see `isLoanOpen`) owes its principal less its « Remboursement »
 * entries since it was taken, and pays next on the coming 1st, today if
 * this is one, what `chargesOn` has it pay then. The dividends are those
 * `chargesOn` has the next 1st of a quarter pay, today if this is one,
 * read from the books as they stand.
 */
export function financingSummary(
  game: Pick<GameState, 'day' | 'journal' | 'financing'>,
): FinancingSummary | null {
  const { day, journal, financing } = game
  if (financing.loans.length === 0 && financing.shareSales.length === 0) {
    return null
  }
  const nextFirst = toCalendar(day).dayOfMonth === 1 ? day : endOfMonth(day) + 1
  const payments = chargesOn(journal, financing, nextFirst)
  const loans = financing.loans
    .filter((loan) => isLoanOpen(loan, day))
    .map(({ day: taken, lender, principal }): LoanLine => {
      const repaid = paidOut(
        entriesSince(journal, taken),
        financingMemo(FINANCING_MEMO.principal, lender),
      )
      const amount = add(
        paidOut(payments, financingMemo(FINANCING_MEMO.interest, lender)),
        paidOut(payments, financingMemo(FINANCING_MEMO.principal, lender)),
      )
      return {
        lender,
        owed: sub(principal, repaid),
        next: amount > 0 ? { amount, day: nextFirst } : null,
      }
    })
  const tenths = new Map<string, number>()
  for (const { investor, share } of financing.shareSales) {
    tenths.set(
      investor,
      (tenths.get(investor) ?? 0) + Math.round(share * TENTHS_PER_WHOLE),
    )
  }
  const shares = [...tenths].map(([investor, total]) => ({
    investor,
    tenths: total,
  }))
  let dividend: DividendLine | null = null
  if (financing.shareSales.length > 0) {
    let quarter = nextFirst
    while (startOfQuarter(quarter) !== quarter)
      quarter = endOfMonth(quarter) + 1
    const due = chargesOn(journal, financing, quarter)
    dividend = {
      day: quarter,
      amount: sum(
        shares.map(({ investor }) =>
          paidOut(due, financingMemo(FINANCING_MEMO.dividend, investor)),
        ),
      ),
      final: quarter === day,
    }
  }
  return {
    hadLoans: financing.loans.length > 0,
    loans,
    shares,
    dividend,
  }
}

/** What the entries of `entries` with `memo` pay out of Encaisse. */
function paidOut(entries: readonly JournalEntry[], memo: string): Cents {
  let total = cents(0)
  for (const { memo: of, lines } of entries) {
    if (of !== memo) continue
    for (const { account, credit } of lines) {
      if (account === CASH) total = add(total, credit)
    }
  }
  return total
}
