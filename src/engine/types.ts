// Frozen at the end of phase 1. Changing this file needs a dedicated card.
// The contract the engine, the books, the UI and the tools share; see
// docs/architecture.md for how the game uses it.

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
  /** What each unit cost when the lot was bought. */
  readonly unitCost: Cents
  /** The day the lot was bought; its shelf life counts from this day. */
  readonly boughtOnDay: Day
}

/** What happened on one business day, as of its close. */
export interface DaySummary {
  /** The business day this sums up. */
  readonly day: Day
  /** Units sold to customers. */
  readonly sold: PerProduct
  /** What customers paid for the units sold. */
  readonly revenue: Cents
  /** Units customers asked for after the product had sold out. */
  readonly lostSales: PerProduct
  /** Units written off at the close because their shelf life was over. */
  readonly spoiled: PerProduct
}

/**
 * The whole game. `createInitialState()` and `tick()` return it at the start
 * of business day `day`; `playDay()` returns it at the close of `day`, before
 * `tick()` moves on. Every function that takes one returns a new one and
 * never mutates it.
 */
export interface GameState {
  /** The business day `tick()` plays next. */
  readonly day: Day
  /** The seed the game started from, kept so the game can be replayed. */
  readonly seed: number
  /** The seeded generator's state (see rng.ts); a save restores it as is. */
  readonly rngState: number
  /** The books: every money event of the game, as balanced entries. */
  readonly journal: Journal
  /** Stock on hand, oldest lot first. The Stocks account carries its cost. */
  readonly inventory: readonly Lot[]
  /**
   * The last business day played: the day before `day`, or `day` itself in
   * what `playDay()` returns. Null until the first day is played.
   */
  readonly lastDay: DaySummary | null
}
