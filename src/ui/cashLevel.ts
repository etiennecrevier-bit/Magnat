import cashGauge from '../content/cashGauge.json'
import { mulInt, type Cents } from '../engine/money.ts'

// The engine reads the fixed costs too, for the event cards' draw (#137).
export { monthlyFixedCosts } from '../engine/fixedCosts.ts'

/** How the cash gauge reads the encaisse. */
export type CashLevel = 'healthy' | 'low' | 'negative'

/** Cash reads low below this many months of fixed costs. */
export const LOW_BELOW_MONTHS = cashGauge.lowBelowMonthsOfFixedCosts

/**
 * Negative below zero, low below `lowBelowMonths` months of
 * `monthlyFixedCosts`, healthy from there up.
 */
export function cashLevel(
  cash: Cents,
  monthlyFixedCosts: Cents,
  lowBelowMonths: number = LOW_BELOW_MONTHS,
): CashLevel {
  if (cash < 0) return 'negative'
  if (cash < mulInt(monthlyFixedCosts, lowBelowMonths)) return 'low'
  return 'healthy'
}
