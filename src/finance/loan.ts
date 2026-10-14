// A bank loan's monthly payments, as a bank or a spreadsheet works them out:
// a fixed payment (PMT) that pays the month's interest first and the
// principal with the rest. The math runs on exact fractions, so no float
// rounding can move a cent.

import { cents, type Cents } from '../engine/money.ts'

/** One month of a loan. */
export interface LoanPayment {
  /** 1 for the first payment, a month after the loan. */
  readonly month: number
  /** The interest plus the principal. */
  readonly payment: Cents
  readonly interest: Cents
  readonly principal: Cents
  /** What is left to pay back after this payment. */
  readonly balance: Cents
}

export interface LoanSchedule {
  /** The payment of every month but the last, which absorbs the rounding. */
  readonly monthlyPayment: Cents
  /** One per month, in order. */
  readonly payments: readonly LoanPayment[]
}

// The units of a yearly rate in basis points, not tunables: a month's rate is
// the yearly rate over 12, and 10 000 basis points make 100 %.
const MONTHS_PER_YEAR = 12n
const BASIS_POINTS = 10_000n
const MONTHLY_DIVISOR = MONTHS_PER_YEAR * BASIS_POINTS

const MAX_CENTS = BigInt(Number.MAX_SAFE_INTEGER)

/**
 * The schedule of a loan of `principal` at a yearly rate of
 * `annualRateBasisPoints` (800 for 8 %), paid back monthly over `months`.
 * The monthly payment is a spreadsheet's `=ROUND(PMT(rate/12; months;
 * -principal); 2)`, and each month's interest is `=ROUND(balance × rate/12;
 * 2)`, both rounded half up from the exact amount. The principal is the rest
 * of the payment, never more than the balance, so a small loan whose payment
 * rounds up is paid off early and its later payments are zero. The last
 * payment pays off the balance, whatever the rounding left. Pure: the same
 * inputs give the same schedule, which is frozen. Takes time and memory in
 * proportion to `months`. Throws a RangeError unless `principal` and `months`
 * are positive safe integers and `annualRateBasisPoints` a non-negative safe
 * integer, or if an amount leaves the safe integer range.
 */
export function loanSchedule(
  principal: Cents,
  annualRateBasisPoints: number,
  months: number,
): LoanSchedule {
  if (!Number.isSafeInteger(principal) || principal <= 0) {
    throw new RangeError(`Not a loan principal: ${principal}`)
  }
  if (
    !Number.isSafeInteger(annualRateBasisPoints) ||
    annualRateBasisPoints < 0
  ) {
    throw new RangeError(`Not a rate in basis points: ${annualRateBasisPoints}`)
  }
  if (!Number.isSafeInteger(months) || months <= 0) {
    throw new RangeError(`Not a loan term in months: ${months}`)
  }

  const rate = BigInt(annualRateBasisPoints)
  const payment = monthlyPaymentOf(BigInt(principal), rate, BigInt(months))
  const monthlyPayment = toCents(payment)
  const payments: LoanPayment[] = []
  let balance = BigInt(principal)
  for (let month = 1; month <= months; month++) {
    const interest = divRound(balance * rate, MONTHLY_DIVISOR)
    // The interest never tops the payment: it is highest in the first month,
    // and the exact payment is more than the exact first interest.
    const repaid = month === months ? balance : min(payment - interest, balance)
    balance -= repaid
    payments.push(
      Object.freeze({
        month,
        payment: toCents(interest + repaid),
        interest: toCents(interest),
        principal: toCents(repaid),
        balance: toCents(balance),
      }),
    )
  }
  return Object.freeze({ monthlyPayment, payments: Object.freeze(payments) })
}

/**
 * PMT, rounded half up. With a monthly rate r = rate / 120 000, PMT is
 * principal × r × (1 + r)ⁿ / ((1 + r)ⁿ − 1). Multiplying both sides of the
 * fraction by 120 000ⁿ⁺¹ keeps every term a whole number.
 */
function monthlyPaymentOf(
  principal: bigint,
  rate: bigint,
  months: bigint,
): bigint {
  if (rate === 0n) return divRound(principal, months)
  const grown = (MONTHLY_DIVISOR + rate) ** months
  const base = MONTHLY_DIVISOR ** months
  return divRound(principal * rate * grown, MONTHLY_DIVISOR * (grown - base))
}

/** `n / d` rounded half up, for `n` ≥ 0 and `d` > 0. */
function divRound(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d)
}

function min(a: bigint, b: bigint): bigint {
  return a < b ? a : b
}

/** Throws a RangeError if `amount` leaves the safe integer range. */
function toCents(amount: bigint): Cents {
  if (amount > MAX_CENTS) {
    throw new RangeError(`Loan amount out of range: ${amount}`)
  }
  return cents(Number(amount))
}
