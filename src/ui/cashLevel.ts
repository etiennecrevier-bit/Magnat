import cashGauge from '../content/cashGauge.json'
import { FOOD_TRUCK } from '../engine/day.ts'
import { add, mulInt, type Cents } from '../engine/money.ts'

/** How the cash gauge reads the encaisse. */
export type CashLevel = 'healthy' | 'low' | 'negative'

/** What the truck pays every day, whether it sells or not. */
export const DAILY_FIXED_COSTS: Cents = add(
  FOOD_TRUCK.dailyFixedCostsCents.rentAndPermit,
  FOOD_TRUCK.dailyFixedCostsCents.fuelAndMaintenance,
)

/** Cash reads low below this many days of fixed costs. */
export const LOW_BELOW_DAYS = cashGauge.lowBelowDaysOfFixedCosts

/**
 * Negative below zero, low below `lowBelowDays` days of fixed costs, healthy
 * from there up.
 */
export function cashLevel(
  cash: Cents,
  dailyFixedCosts: Cents = DAILY_FIXED_COSTS,
  lowBelowDays: number = LOW_BELOW_DAYS,
): CashLevel {
  if (cash < 0) return 'negative'
  if (cash < mulInt(dailyFixedCosts, lowBelowDays)) return 'low'
  return 'healthy'
}
