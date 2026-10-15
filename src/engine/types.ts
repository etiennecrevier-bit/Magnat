// Frozen at the end of phase 1. Changing this file needs a dedicated card.
// The contract the engine, the books, the UI and the tools share; see
// docs/architecture.md for how the game uses it.

import type {
  Avatar,
  DifficultyId,
  ProductId,
  RestockRule,
  SegmentId,
} from '../content/schema.ts'
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
  /** Each customer segment's visits, counted by how they ended. */
  readonly segments: Readonly<Record<SegmentId, SegmentSummary>>
  /** Every walk-in's visit, in arrival order. */
  readonly visits: readonly Visit[]
  /** Visits that left the line without being served. */
  readonly leftLine: number
  /**
   * The average wait, in whole seconds, of the customers who reached the
   * counter; 0 when nobody did.
   */
  readonly averageWaitSeconds: number
  /**
   * The longest wait, in whole seconds, of a customer who reached the
   * counter; 0 when nobody did.
   */
  readonly longestWaitSeconds: number
}

/** One customer segment's visits on a business day. */
export interface SegmentSummary {
  /** Walk-ins of this segment. */
  readonly visits: number
  /** Visits that bought at least one unit. */
  readonly buyers: number
  /** Visits that bought nothing because a price was above what they pay. */
  readonly tooExpensive: number
  /** Visits that bought nothing because what they wanted had sold out. */
  readonly soldOut: number
}

/** One walk-in customer at the truck. */
export interface Visit {
  /** When they arrived, in minutes from midnight: 450 is 7 h 30. */
  readonly arrivalMinute: number
  /** The customer segment they belong to. */
  readonly segment: SegmentId
  /** Units they bought: 0 or 1 of each product. */
  readonly bought: PerProduct
  /** How the visit ended. */
  readonly outcome: VisitOutcome
  /**
   * When they reached the counter, in minutes from midnight; null if they
   * never lined up. Service may run past closing time.
   */
  readonly servedMinute: number | null
  /**
   * When they left the line without being served, in minutes from midnight;
   * null unless the visit ended in `leftLine`.
   */
  readonly leftMinute: number | null
}

/**
 * How a visit ended: `bought` if they bought anything. Otherwise `leftLine`
 * if they wanted something but left the line before being served, then
 * `soldOut` if something they wanted had sold out, then `tooExpensive` if a
 * price above their reference kept them from buying, and `browsed` if
 * neither.
 */
export type VisitOutcome =
  'bought' | 'tooExpensive' | 'soldOut' | 'leftLine' | 'browsed'

/**
 * How the player runs the truck. `applyDecision()` in decisions.ts changes
 * it and holds every field to the limits in the content.
 */
export interface Decisions {
  /** What one unit of each product sells for. */
  readonly prices: Readonly<Record<ProductId, Cents>>
  /**
   * How each product is restocked each morning the truck opens. A product
   * keeps the kind of rule it starts the game with.
   */
  readonly restock: Readonly<Record<ProductId, RestockRule>>
  /**
   * The ISO weekdays the truck opens, 1 = Monday to 7 = Sunday: ascending,
   * with no repeats and at least one.
   */
  readonly daysOpen: readonly number[]
  /** What the owner pays themself each week. */
  readonly ownerWeeklyPay: Cents
  /** What the truck spends on marketing each day. */
  readonly marketingDaily: Cents
}

/** Who the player is, as they set it up when the game started. */
export interface Profile {
  /** The business's name: on the truck's sign and in the top bar. */
  readonly businessName: string
  /** The owner's avatar. */
  readonly avatar: Avatar
  /** How the game started: the cash in the bank and how the truck came. */
  readonly difficulty: DifficultyId
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
  /**
   * What marketing spent on each of the last business days played, oldest
   * first, 0 on a day the truck was closed: the content's `awarenessDays`
   * of them, or every day played until there are that many. Awareness, and
   * the extra walk-ins it brings, follows it.
   */
  readonly marketingHistory: readonly Cents[]
  /** How the player runs the truck on business day `day`. */
  readonly decisions: Decisions
  /**
   * What the player decided since day `day` began, waiting for the next
   * morning: `tick()` plays `day` with `decisions`, then makes these the next
   * day's. Null when nothing is waiting.
   */
  readonly pendingDecisions: Decisions | null
  /** Who the player is; it never changes once the game has started. */
  readonly profile: Profile
}
