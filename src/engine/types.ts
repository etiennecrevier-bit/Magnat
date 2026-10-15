// Frozen at the end of phase 1. Changing this file needs a dedicated card.
// The contract the engine, the books, the UI and the tools share; see
// docs/architecture.md for how the game uses it.

import type {
  Avatar,
  DifficultyId,
  EventEffect,
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
  /** The owner's energy at the close, 0 to 100, before the night. */
  readonly energy: number
  /**
   * Units botched at the counter and thrown out, written off as « Produits
   * ratés »: the visits' `botched`, summed.
   */
  readonly botched: number
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
  /**
   * Units of their order the owner botched and threw out, each made again
   * if a unit was left; 0 when the owner is rested.
   */
  readonly botched: number
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

/**
 * The owner's own money, outside the company's books: their pay comes in,
 * their living costs go out, and nothing in it ever posts a journal entry.
 */
export interface PersonalAccount {
  /** What the owner has of their own. May be negative. */
  readonly cash: Cents
  /**
   * Every movement of this calendar month and the 11 before, oldest first,
   * in the order they happened.
   */
  readonly movements: readonly PersonalMovement[]
  /**
   * The days the rent went unpaid (« Loyer impayé »), ascending, over the
   * same months as `movements`.
   */
  readonly unpaidRents: readonly Day[]
}

/** Money coming into or going out of the owner's personal account. */
export interface PersonalMovement {
  /** The day it happened. */
  readonly day: Day
  /** What it was, in French, as the player reads it. */
  readonly label: string
  /** Above zero when money comes in, below zero when it goes out. */
  readonly amount: Cents
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
  /** The owner's own money, outside the company's books. */
  readonly personal: PersonalAccount
  /**
   * The owner's energy, 0 to 100: on the morning of `day`, or at its close
   * in what `playDay()` returns. A tired owner serves slower and botches
   * units.
   */
  readonly energy: number
  /**
   * The event cards: the one waiting for the player's choice, what the
   * choices made still have to do, and what came up and was chosen.
   */
  readonly events: EventsState
  /**
   * What customers who pay later owe the business, by due day, then in the
   * order they were sold. Their amounts add up to Comptes clients (1100).
   */
  readonly receivables: readonly Receivable[]
}

/** The event cards of a game. */
export interface EventsState {
  /**
   * The event waiting for the player on the morning of `day`; null when
   * none is. `tick()` throws while one is.
   */
  readonly pending: PendingEvent | null
  /**
   * Effects of the choices made that start on a later day, by day, then in
   * the order they were queued. Each runs at the start of its day, before
   * the sales.
   */
  readonly delayed: readonly DelayedEffect[]
  /**
   * Events another one brings back on a later morning, by day, then in the
   * order they were queued.
   */
  readonly followUps: readonly FollowUp[]
  /** Every event that came up and what the player chose, oldest first. */
  readonly history: readonly EventRecord[]
  /**
   * The last day an event was drawn, follow-ups aside; null until one is.
   * The gap to the next draw counts from it.
   */
  readonly lastDrawnDay: Day | null
  /** The La Presse-Citron headlines events queued, oldest first. */
  readonly headlines: readonly Headline[]
}

/** The event waiting for the player's choice. */
export interface PendingEvent {
  /** The event's id in the content. */
  readonly event: string
  /** Whether another event brought it, rather than the morning's draw. */
  readonly followUp: boolean
}

/** An effect of a choice that starts on a later day. */
export interface DelayedEffect {
  /** The day it runs, at the start of the day. */
  readonly day: Day
  /** The id of the event whose choice it comes from. */
  readonly event: string
  /** What it does, without the timing the content gave it. */
  readonly effect: EventEffect
}

/** An event another one brings back. */
export interface FollowUp {
  /** The morning it comes up, or the first one after with no other event. */
  readonly day: Day
  /** The event's id in the content. */
  readonly event: string
}

/** An event that came up, and what the player chose. */
export interface EventRecord {
  /** The morning it came up and was chosen. */
  readonly day: Day
  /** The event's id in the content. */
  readonly event: string
  /** Whether another event brought it, rather than the morning's draw. */
  readonly followUp: boolean
  /** The id of the choice made. */
  readonly choice: string
  /** Which of the choice's outcomes came, counting from 0. */
  readonly outcome: number
}

/** A La Presse-Citron headline an event queued. */
export interface Headline {
  /** The day it was queued. */
  readonly day: Day
  /** The headline's id in the content. */
  readonly id: string
}

/** What one customer owes for one sale on credit. */
export interface Receivable {
  /** Who owes it, as the journal names them. */
  readonly client: string
  /** What they owe; above zero. */
  readonly amount: Cents
  /** The day of the sale. */
  readonly soldOnDay: Day
  /** The day it is collected, at the start of the day. */
  readonly dueDay: Day
}
