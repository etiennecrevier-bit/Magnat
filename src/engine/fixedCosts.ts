import type {
  DifficultyContent,
  DifficultyId,
  FoodTruckContent,
} from '../content/schema.ts'
import { loanSchedule } from '../finance/loan.ts'
import { monthsSinceStart, toCalendar } from './calendar.ts'
import { DIFFICULTIES, FOOD_TRUCK } from './day.ts'
import { add, type Cents } from './money.ts'
import type { Day } from './types.ts'

// What the 1st of each month takes whatever the truck sells: the cash gauge
// reads the encaisse against it, and so does the event cards' draw.

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
