import { visitSales } from './customers.ts'
import { add, cents, mulInt, type Cents } from './money.ts'
import type { CandidateId, ProductId } from '../content/schema.ts'
import type {
  Day,
  Delivery,
  Employee,
  PersonDay,
  Visit,
  WorkDay,
  Worker,
} from './types.ts'

// What each person did on a business day (#283): the walk-ins they served,
// the deliveries they made, the croissants they baked. It only reads what
// the day already did, so no number of the day changes and nothing is
// drawn.

/**
 * The business days `GameState.workDays` keeps: a week, what « Équipe »
 * shows. A display window, not a tunable.
 */
export const WORK_DAYS_KEPT = 7

/** What a business day did, as `workOf` reads it. */
export interface DayWork {
  /** Whether the owner was away all day. */
  readonly ownerAway: boolean
  /** The employees who came, in the order of the staff. */
  readonly came: readonly Employee[]
  /** Every walk-in's visit (see `Visit.servedBy`). */
  readonly visits: readonly Visit[]
  /** What one unit of each product sold for that day. */
  readonly price: (product: ProductId) => Cents
  /** The croissants delivered to the grocers that morning. */
  readonly deliveries: readonly Delivery[]
  /** Who delivered; null when nobody did. */
  readonly delivers: Worker | null
  /** The croissants the bakery made, for the grocers and the truck. */
  readonly baked: number
  /** Of those, the ones thrown away and made again. */
  readonly wasted: number
  /** Who baked; null when nobody did. */
  readonly bakes: Worker | null
  /** What the ingredients of one croissant cost that day. */
  readonly ingredientCost: Cents
  /** What the truck's restock paid for one croissant that day. */
  readonly boughtCost: Cents
}

/**
 * What each person did on a day (see `DaySummary.work`): the owner unless
 * away, then each employee who came. A person's customers are the visits
 * they served and their sales what those paid, so the people's sales add
 * up to the day's revenue. The one who delivered made every delivery, the
 * one who baked every croissant, their cost being the ingredients of those
 * made and of those thrown away and made again, against what buying as
 * many would have cost.
 */
export function workOf(day: DayWork): PersonDay[] {
  const people: Worker[] = [
    ...(day.ownerAway ? [] : ['owner' as const]),
    ...day.came.map(({ candidate }) => candidate),
  ]
  return people.map((who): PersonDay => {
    const served = day.visits.filter(({ servedBy }) => servedBy === who)
    const delivered = day.delivers === who ? day.deliveries : []
    const baked = day.bakes === who ? day.baked : 0
    const wasted = day.bakes === who ? day.wasted : 0
    return {
      who,
      customers: served.length,
      sales: served.reduce(
        (total, visit) => add(total, visitSales(visit, day.price)),
        cents(0),
      ),
      deliveries: delivered.length,
      invoiced: delivered.reduce(
        (total, { amount }) => add(total, amount),
        cents(0),
      ),
      baked,
      bakedCost: mulInt(day.ingredientCost, baked + wasted),
      boughtCost: mulInt(day.boughtCost, baked),
    }
  })
}

/**
 * `history` with `day` added last, keeping the last `WORK_DAYS_KEPT` days.
 * An older save's missing history starts empty. Never mutates `history`.
 */
export function rememberWork(
  history: readonly WorkDay[] | undefined,
  day: Day,
  people: readonly PersonDay[],
  ownerAway: boolean,
  absent: readonly CandidateId[],
): WorkDay[] {
  return [
    ...(history ?? []),
    { day, people, ownerAway, absent: [...absent] },
  ].slice(-WORK_DAYS_KEPT)
}
