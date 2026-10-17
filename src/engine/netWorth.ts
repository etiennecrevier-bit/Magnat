import { balanceSheet } from '../finance/statements.ts'
import { add, cents, mulRatio, sub, sum, type Cents } from './money.ts'
import type { GameState } from './types.ts'

// « Valeur nette »: what the owner has, their share of the company and their
// own money, less what they owe. The top bar shows it, with its change since
// the last Sunday's close, and « Aujourd'hui » its four parts (#161). P4-07
// adds the owner's own assets and debts.

/** What `netWorth()` reads of a game. */
export type NetWorthGame = Pick<
  GameState,
  'day' | 'journal' | 'financing' | 'personal'
>

/** The owner's net worth and the four parts it adds up from. */
export interface NetWorthParts {
  /**
   * The company's equity, less the share of it each round of shares sold
   * gave away.
   */
  readonly companyShare: Cents
  /** The owner's own cash. */
  readonly personalCash: Cents
  /** What the owner owns, at its purchase price. */
  readonly personalAssets: Cents
  /** What the owner owes, as a positive amount. */
  readonly personalDebts: Cents
  /** The parts added up, the debts taken out. */
  readonly total: Cents
}

const ZERO = cents(0)

/**
 * The owner's net worth on the morning of `state.day`, or at its close in
 * what `playDay()` returns, in its parts: the company's equity, the
 * Capitaux propres of the bilan with every entry posted so far, less each
 * round of shares sold's `share` of it, rounded to the cent (see
 * `mulRatio`); the owner's personal cash; and their own assets and debts,
 * none until P4-07 brings them. Negative equity counts as it is, shares and
 * all.
 */
export function netWorthParts({
  day,
  journal,
  financing,
  personal,
}: NetWorthGame): NetWorthParts {
  const equity = balanceSheet(journal, day).equity.total.amount
  const sold = sum(
    financing.shareSales.map(({ share }) => mulRatio(equity, share)),
  )
  const companyShare = sub(equity, sold)
  const personalAssets = ZERO
  const personalDebts = ZERO
  return {
    companyShare,
    personalCash: personal.cash,
    personalAssets,
    personalDebts,
    total: sub(
      add(add(companyShare, personal.cash), personalAssets),
      personalDebts,
    ),
  }
}

/** The owner's net worth: the total of `netWorthParts()`. */
export function netWorth(state: NetWorthGame): Cents {
  return netWorthParts(state).total
}

/**
 * How much the owner's net worth moved since the close of the last Sunday
 * played: `netWorth(state)` less the last week of `weekHistory`'s. Null
 * until a Sunday is played, and when that week has no net worth, reported
 * by an older save.
 */
export function netWorthChange(
  state: NetWorthGame & Pick<GameState, 'weekHistory'>,
): Cents | null {
  const sunday = state.weekHistory.at(-1)?.netWorth ?? null
  return sunday === null ? null : sub(netWorth(state), sunday)
}
