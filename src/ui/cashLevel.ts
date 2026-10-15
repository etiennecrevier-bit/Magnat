import cashGauge from '../content/cashGauge.json'
import { FOOD_TRUCK } from '../engine/day.ts'
import { add, mulInt, type Cents } from '../engine/money.ts'

/** How the cash gauge reads the encaisse. */
export type CashLevel = 'healthy' | 'low' | 'negative'

/** What every truck pays each month, whether it sells or not. */
export const MONTHLY_FIXED_COSTS: Cents = add(
  FOOD_TRUCK.monthlyCostsCents.permitParkingAndCommissary,
  FOOD_TRUCK.monthlyCostsCents.insurance,
)

/** Cash reads low below this many months of fixed costs. */
export const LOW_BELOW_MONTHS = cashGauge.lowBelowMonthsOfFixedCosts

/**
 * Negative below zero, low below `lowBelowMonths` months of fixed costs,
 * healthy from there up.
 */
export function cashLevel(
  cash: Cents,
  monthlyFixedCosts: Cents = MONTHLY_FIXED_COSTS,
  lowBelowMonths: number = LOW_BELOW_MONTHS,
): CashLevel {
  if (cash < 0) return 'negative'
  if (cash < mulInt(monthlyFixedCosts, lowBelowMonths)) return 'low'
  return 'healthy'
}
