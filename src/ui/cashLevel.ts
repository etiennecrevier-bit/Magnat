import cashGauge from '../content/cashGauge.json'
import type {
  DifficultyContent,
  DifficultyId,
  FoodTruckContent,
} from '../content/schema.ts'
import { monthsSinceStart, toCalendar } from '../engine/calendar.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../engine/day.ts'
import { add, mulInt, type Cents } from '../engine/money.ts'
import type { Day } from '../engine/types.ts'
import { loanSchedule } from '../finance/loan.ts'

/** How the cash gauge reads the encaisse. */
export type CashLevel = 'healthy' | 'low' | 'negative'

/** Cash reads low below this many months of fixed costs. */
export const LOW_BELOW_MONTHS = cashGauge.lowBelowMonthsOfFixedCosts

/**
 * The cash the next 1st of the month takes, seen on the morning of `day`
 * (that very day, if it is a 1st), in a game of `difficulty` whose truck
 * came on `firstDay`, day 0 but in a Défi: the permit, parking and
 * commissary and the insurance, which every truck pays, then the truck's
 * own charge, the lease or that month's loan payment. A loan has no payment
 * the month it is taken, nor after the last one. The truck's depreciation
 * takes no cash.
 */
export function monthlyFixedCosts(
  day: Day,
  difficulty: DifficultyId,
  firstDay: Day = 0,
  content: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
): Cents {
  const { permitParkingAndCommissary, insurance } = content.monthlyCostsCents
  const everyTruck = add(permitParkingAndCommissary, insurance)
  const { truck } = difficulties.difficulties[difficulty]
  switch (truck.kind) {
    case 'owned':
      return everyTruck
    case 'lease':
      return add(everyTruck, truck.monthlyLeaseCents)
    case 'loan': {
      const months = monthsSinceStart(day) - monthsSinceStart(firstDay)
      const month = toCalendar(day).dayOfMonth === 1 ? months : months + 1
      const { payments } = loanSchedule(
        truck.loanCents,
        truck.annualRateBasisPoints,
        truck.termMonths,
      )
      const payment = payments[month - 1]
      return payment === undefined
        ? everyTruck
        : add(everyTruck, payment.payment)
    }
  }
}

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
