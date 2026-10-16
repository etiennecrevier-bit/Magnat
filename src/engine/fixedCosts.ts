import type {
  BakeryContent,
  DifficultyContent,
  DifficultyId,
  FoodTruckContent,
} from '../content/schema.ts'
import { loanSchedule } from '../finance/loan.ts'
import { BAKERY, bakeryMonthlyCosts, closedBakery } from './bakery.ts'
import { endOfMonth, monthsSinceStart, toCalendar } from './calendar.ts'
import { DIFFICULTIES, FOOD_TRUCK } from './day.ts'
import { add, type Cents } from './money.ts'
import type { BakeryState, Day } from './types.ts'

// What the 1st of each month takes whatever the truck sells: the cash gauge
// reads the encaisse against it, and so does the event cards' draw.

/**
 * The cash the next 1st of the month takes, seen on the morning of `day`
 * (that very day, if it is a 1st), in a game of `difficulty` whose truck
 * came on `firstDay`, day 0 but in a Défi: the permit, parking and
 * commissary and the insurance, which every truck pays, then the truck's
 * own charge, the lease or that month's loan payment. A loan has no payment
 * the month it is taken, nor after the last one. Then what `bakery`, the
 * bakery as of the last close, takes that 1st at the difficulty's prices,
 * when it still holds its premises then (see `bakeryMonthlyCosts`). The
 * truck's depreciation, and the oven's, take no cash.
 */
export function monthlyFixedCosts(
  day: Day,
  difficulty: DifficultyId,
  firstDay: Day = 0,
  content: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
  bakery: BakeryState = closedBakery(),
  bakeryContent: BakeryContent = BAKERY,
): Cents {
  const first = toCalendar(day).dayOfMonth === 1 ? day : endOfMonth(day) + 1
  return add(
    truckCosts(day, difficulty, firstDay, content, difficulties),
    bakeryMonthlyCosts(
      bakery,
      first,
      difficulties.bakery[difficulty],
      bakeryContent,
    ),
  )
}

function truckCosts(
  day: Day,
  difficulty: DifficultyId,
  firstDay: Day,
  content: FoodTruckContent,
  difficulties: DifficultyContent,
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
