import cashGauge from '../content/cashGauge.json'
import type { DifficultyId } from '../content/schema.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../engine/day.ts'
import { truckReplacedOn } from '../engine/dream.ts'
import { monthlyFixedCosts } from '../engine/fixedCosts.ts'
import { mulInt, type Cents } from '../engine/money.ts'
import type { BakeryState, Day, DreamState, Truck } from '../engine/types.ts'

// The engine reads the fixed costs too, for the event cards' draw (#137).
export { monthlyFixedCosts }

/** What `nextFixedCosts` reads of a game. */
export interface FixedCostsGame {
  readonly day: Day
  readonly difficulty: DifficultyId
  /** The day the truck came: day 0, but in a Défi its first day. */
  readonly firstDay: Day
  readonly bakery: BakeryState
  readonly dream: DreamState
  /** The trucks after the first (#259); none by default. */
  readonly trucks?: readonly Pick<Truck, 'id' | 'district' | 'boughtOnDay'>[]
}

/**
 * What the next 1st of the month takes from the encaisse, seen on the
 * morning of `day` (see `monthlyFixedCosts`), each other truck's insurance
 * and the permit due then included, a yearly one in full: what the cash
 * chip reads the encaisse against, and « À surveiller » shows.
 */
export function nextFixedCosts({
  day,
  difficulty,
  firstDay,
  bakery,
  dream,
  trucks = [],
}: FixedCostsGame): Cents {
  return monthlyFixedCosts(
    day,
    difficulty,
    firstDay,
    FOOD_TRUCK,
    DIFFICULTIES,
    bakery,
    undefined,
    truckReplacedOn(dream),
    undefined,
    trucks,
  )
}

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
