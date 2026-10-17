import { balanceSheet } from '../finance/statements.ts'
import { add, mulRatio, sub, sum, type Cents } from './money.ts'
import type { GameState } from './types.ts'

// « Valeur nette »: what the owner has, their share of the company and their
// own money. The minimal form #160 needs for the « Faillite » screen, of
// the formula #161 decided; P4-06 adds it to the top bar, and P4-07 the
// owner's own assets and debts.

/**
 * The owner's net worth on the morning of `state.day`, or at its close in
 * what `playDay()` returns: the company's equity, the Capitaux propres of
 * the bilan with every entry posted so far, less each round of shares
 * sold's `share` of it, rounded to the cent (see `mulRatio`), plus the
 * owner's personal cash. Negative equity counts as it is, shares and all.
 */
export function netWorth({
  day,
  journal,
  financing,
  personal,
}: GameState): Cents {
  const equity = balanceSheet(journal, day).equity.total.amount
  const sold = sum(
    financing.shareSales.map(({ share }) => mulRatio(equity, share)),
  )
  return add(sub(equity, sold), personal.cash)
}
