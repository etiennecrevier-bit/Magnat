import { PRODUCTS } from '../engine/inventory.ts'
import type { Cents } from '../engine/money.ts'
import type { DaySummary, PerProduct } from '../engine/types.ts'

/**
 * The three numbers of a day that the folded strip shows, and the
 * Aujourd'hui panel too, so both always agree.
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
