import type {
  BakeryContent,
  DifficultyContent,
  DifficultyId,
  DistrictContent,
  FoodTruckContent,
} from '../content/schema.ts'
import { loanSchedule } from '../finance/loan.ts'
import { BAKERY, bakeryMonthlyCosts, closedBakery } from './bakery.ts'
import { endOfMonth, monthsSinceStart, toCalendar } from './calendar.ts'
import { DIFFICULTIES, FOOD_TRUCK } from './day.ts'
import { DISTRICTS, cashOut, permitOn, truckChargesOn } from './districts.ts'
import { add, sum, type Cents } from './money.ts'
import { FIRST_DISTRICT } from './trucks.ts'
import type { BakeryState, Day, Truck } from './types.ts'

// What the 1st of each month takes whatever the truck sells: the cash gauge
// reads the encaisse against it, and so does the event cards' draw.

/**
 * The cash the next 1st of the month takes, seen on the morning of `day`
 * (that very day, if it is a 1st), in a game of `difficulty` whose truck
 * came on `firstDay`, day 0 but in a Défi: the first truck's permit, its
 * district's that 1st in `districts` (see `permitOn`), and its insurance,
 * then its own charge, the lease or that month's loan payment. A loan has
 * no payment the month it is taken, nor after the last one, and a truck
 * replaced on `truckReplacedOn`, a rung of « Le rêve », no lease from then
 * on. Then what `bakery`, the bakery as of the last close, takes that 1st at the difficulty's prices,
 * when it still holds its premises then (see `bakeryMonthlyCosts`). Then
 * what each of `trucks`, those after the first, owes that 1st (#260): its
 * district's permit due then, a yearly one on the 1st of its month, and its
 * insurance (see `truckChargesOn`). The trucks' depreciation, and the
 * oven's, take no cash.
 */
export function monthlyFixedCosts(
  day: Day,
  difficulty: DifficultyId,
  firstDay: Day = 0,
  content: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
  bakery: BakeryState = closedBakery(),
  bakeryContent: BakeryContent = BAKERY,
  truckReplacedOn: Day | null = null,
  districts: DistrictContent = DISTRICTS,
  trucks: readonly Pick<Truck, 'id' | 'district' | 'boughtOnDay'>[] = [],
): Cents {
  const first = toCalendar(day).dayOfMonth === 1 ? day : endOfMonth(day) + 1
  const leased = truckReplacedOn === null || truckReplacedOn > first
  return sum([
    permitOn(FIRST_DISTRICT, first, difficulty, difficulties, districts),
    truckCosts(day, difficulty, firstDay, content, difficulties, leased),
    bakeryMonthlyCosts(
      bakery,
      first,
      difficulties.bakery[difficulty],
      bakeryContent,
    ),
    cashOut(
      truckChargesOn(
        trucks,
        first,
        difficulty,
        content,
        difficulties,
        districts,
      ),
    ),
  ])
}

function truckCosts(
  day: Day,
  difficulty: DifficultyId,
  firstDay: Day,
  content: FoodTruckContent,
  difficulties: DifficultyContent,
  leased: boolean,
): Cents {
  const everyTruck = content.monthlyCostsCents.insurance
  const { truck } = difficulties.difficulties[difficulty]
  switch (truck.kind) {
    case 'owned':
      return everyTruck
    case 'lease':
      return leased ? add(everyTruck, truck.monthlyLeaseCents) : everyTruck
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
