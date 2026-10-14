import type { Cents } from '../engine/money.ts'

// fr-CA writes 1 234,56 $. The spaces are no-break spaces (U+00A0), so an
// amount never splits across lines. Integer arithmetic only, rather than
// Intl.NumberFormat, so the output is exact for every safe integer and does
// not depend on the browser's locale data.
const NO_BREAK_SPACE = '\u00a0'
const CENTS_PER_DOLLAR = 100
const DIGITS_PER_GROUP = /\B(?=(\d{3})+(?!\d))/g

/** `1 234,56 $` for the size of `amount`, without its sign. */
function formatMagnitude(amount: Cents): string {
  const magnitude = Math.abs(amount)
  const centsPart = magnitude % CENTS_PER_DOLLAR
  // The difference is a whole multiple of 100, so the quotient is exact.
  const dollars = (magnitude - centsPart) / CENTS_PER_DOLLAR
  const grouped = String(dollars).replace(DIGITS_PER_GROUP, NO_BREAK_SPACE)
  const centsText = String(centsPart).padStart(2, '0')
  return `${grouped},${centsText}${NO_BREAK_SPACE}$`
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
