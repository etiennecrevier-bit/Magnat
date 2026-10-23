import type { StaffContent } from '../content/schema.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import type { Cents } from '../engine/money.ts'
import { STAFF } from '../engine/staff.ts'
import type { DaySummary, Employee, PerProduct } from '../engine/types.ts'

/**
 * The three numbers of a day that « Hier » shows, and the cash chip's
 * tooltip on a phone too, so both always agree.
 */
export interface TodayNumbers {
  /** « Chiffre d'affaires ». */
  readonly revenue: Cents
  /**
   * « Clients servis »: the visits that reached the counter, as the engine
   * counts them for the week's days and the Défis.
   */
  readonly customersServed: number
  /** « Ventes perdues »: the units no one could buy, every product together. */
  readonly lostSales: number
}

/** The three numbers of `day`, the last day played. */
export function todayNumbers(day: DaySummary): TodayNumbers {
  return {
    revenue: day.revenue,
    customersServed: day.visits.filter(
      ({ servedMinute }) => servedMinute !== null,
    ).length,
    lostSales: totalUnits(day.lostSales),
  }
}

/** The units of `units`, every product together. */
export function totalUnits(units: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + units[product], 0)
}

/**
 * « Sans Kevin, le camion aurait été fermé »: on a day the owner was away
 * all day and the truck still opened, the first names of the employees of
 * `staff` at the truck who came, as a plain fact (#283); null on any other
 * day.
 */
export function truckWithout(
  day: DaySummary,
  staff: readonly Employee[],
  content: StaffContent = STAFF,
): string | null {
  if (day.ownerAway !== true || day.visits.length === 0) return null
  const names = (day.work ?? []).flatMap(({ who }) => {
    const employee = staff.find(({ candidate }) => candidate === who)
    if (employee?.role !== 'camion') return []
    const [first = ''] = content.candidates[employee.candidate].name.split(' ')
    return [first]
  })
  if (names.length === 0) return null
  const last = names.pop()
  const listed = names.length === 0 ? last : `${names.join(', ')} et ${last}`
  return `Sans ${listed}, le camion aurait été fermé`
}
