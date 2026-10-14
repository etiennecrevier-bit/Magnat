import type { ProductId } from '../content/schema.ts'
import type { Journal } from '../finance/journal.ts'
import type { Cents } from './money.ts'

/** Game day index; day 0 is the first day of the game. */
export type Day = number

/** A whole number of units for each product, such as the units sold. */
export type PerProduct = Readonly<Record<ProductId, number>>

/** Units of one product bought together, carried at what they cost. */
export interface Lot {
  readonly product: ProductId
  /** Units left in the lot; always above zero. */
  readonly quantity: number
  readonly unitCost: Cents
  readonly boughtOnDay: Day
}

/** What happened on the last business day played. */
export interface DaySummary {
  readonly day: Day
  readonly sold: PerProduct
  readonly revenue: Cents
  /** Units customers asked for after the product had sold out. */
  readonly lostSales: PerProduct
  /** Units written off at the close because their shelf life was over. */
  readonly spoiled: PerProduct
}

export interface GameState {
  /** The business day `tick()` plays next. */
  day: Day
  /** The seed the game started from, kept so the game can be replayed. */
  seed: number
  /** The seeded generator's state (see rng.ts); a save restores it as is. */
  rngState: number
  /** The books: every money event of the game, as balanced entries. */
  journal: Journal
  /** Stock on hand, oldest lot first. The Stocks account carries its cost. */
  inventory: readonly Lot[]
  /** The day before `day`, or null until the first tick. */
  lastDay: DaySummary | null
}
