import type { Cents } from '../engine/money.ts'

// fr-CA writes 1 234,56 $. The spaces are no-break spaces (U+00A0), so an
// amount never splits across lines. Integer arithmetic only, rather than
// Intl.NumberFormat, so the output is exact for every safe integer and does
// not depend on the browser's locale data.
const NO_BREAK_SPACE = '\u00a0'
// The minus sign (U+2212), as the event cards' tags write a loss.
const MINUS_SIGN = '\u2212'
const NO_CENTS = ',00'
const CENTS_PER_DOLLAR = 100
const DIGITS_PER_GROUP = /\B(?=(\d{3})+(?!\d))/g

/**
 * The size of `amount` without its sign or the dollar sign, e.g. `1 234,56`:
 * the value of a field where the player types an amount.
 */
export function formatAmount(amount: Cents): string {
  const magnitude = Math.abs(amount)
  const centsPart = magnitude % CENTS_PER_DOLLAR
  // The difference is a whole multiple of 100, so the quotient is exact.
  const dollars = (magnitude - centsPart) / CENTS_PER_DOLLAR
  const grouped = String(dollars).replace(DIGITS_PER_GROUP, NO_BREAK_SPACE)
  const centsText = String(centsPart).padStart(2, '0')
  return `${grouped},${centsText}`
}

/** `1 234,56 $` for the size of `amount`, without its sign. */
function formatMagnitude(amount: Cents): string {
  return `${formatAmount(amount)}${NO_BREAK_SPACE}$`
}

/** fr-CA money, e.g. `1 234,56 $` or `-1 234,56 $`. */
export function formatMoney(amount: Cents): string {
  const text = formatMagnitude(amount)
  return amount < 0 ? `-${text}` : text
}

/** Money on a financial statement: negatives in parentheses, `(1 234,56 $)`. */
export function formatStatementAmount(amount: Cents): string {
  const text = formatMagnitude(amount)
  return amount < 0 ? `(${text})` : text
}

/** The size of `amount` with the cents only when there are some: `750 $`. */
function formatBriefMagnitude(amount: Cents): string {
  const text = formatAmount(amount)
  const size = text.endsWith(NO_CENTS) ? text.slice(0, -NO_CENTS.length) : text
  return `${size}${NO_BREAK_SPACE}$`
}

/**
 * Money in a sentence, with the cents only when there are some: `750 $`,
 * `2,50 $`, `-1 200 $`.
 */
export function formatBriefMoney(amount: Cents): string {
  const text = formatBriefMagnitude(amount)
  return amount < 0 ? `-${text}` : text
}

/**
 * A change of money as the event cards write it, with its sign and the
 * cents only when there are some: `+750 $`, `−2,50 $` (U+2212).
 */
export function formatSignedMoney(amount: Cents): string {
  const sign = amount < 0 ? MINUS_SIGN : '+'
  return `${sign}${formatBriefMagnitude(amount)}`
}
