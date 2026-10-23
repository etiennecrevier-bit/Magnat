// Frozen at the end of phase 1. Changing this file needs a dedicated card.
// The contract the engine, the books, the UI and the tools share; see
// docs/architecture.md for how the game uses it.

import type {
  Avatar,
  CandidateId,
  CroissantSource,
  DifficultyId,
  DistrictId,
  EventEffect,
  GrocerId,
  Medal,
  OvenTerms,
  PlaceId,
  PostcardId,
  ProductId,
  RestockRule,
  RungId,
  SegmentId,
  StaffRoleId,
  StreetChange,
  WinterStorage,
} from '../content/schema.ts'
import type { Journal } from '../finance/journal.ts'
import type { Cents } from './money.ts'

/** Game day index; day 0 is the first day of the game. */
export type Day = number

/**
 * A truck, by its id (#259): `plateau` for the first, the one its rung of «
 * Le rêve » names for each truck bought after it.
 */
export type TruckId = string

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
  /**
   * Customers who would have wanted one unit at their reference price but
   * not at the day's, above it: each product's « trop cher ». A visit may
   * count for several products, and still buy another.
   */
  readonly pricedOut: PerProduct
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
  /**
   * The changes to the street in effect that day, in the order they were
   * made, each with the event that made it.
   */
  readonly modifiers: readonly StreetModifier[]
  /** The croissants delivered to the grocers that morning, in order. */
  readonly deliveries: readonly Delivery[]
  /** The deliveries nobody could make that morning, in order. */
  readonly missed: readonly MissedDelivery[]
  /**
   * The employees absent that day whose role had work (#255), in the order
   * of the staff; absent when there was none.
   */
  readonly absent?: readonly CandidateId[]
  /**
   * The employees who quit that morning, underpaid (#255), in the order of
   * the staff; absent when none did.
   */
  readonly quits?: readonly CandidateId[]
  /**
   * What each person did that day (#283): the owner unless away all day,
   * then each employee who came, in the order of the staff. Absent from a
   * day a save from before it played.
   */
  readonly work?: readonly PersonDay[]
  /** Set when the owner was away all day (#283); absent otherwise. */
  readonly ownerAway?: true
}

/**
 * A truck bought after the first (#259). Its decisions are in
 * `Decisions.trucks`.
 */
export interface Truck {
  readonly id: TruckId
  /** Where it works. */
  readonly district: DistrictId
  /** The morning its rung was bought. */
  readonly boughtOnDay: Day
  /**
   * Its own seeded generator's state (see rng.ts), which its walk-ins draw
   * from, so the first truck's stream never moves for it.
   */
  readonly rngState: number
  /** Its stock on hand, oldest lot first. */
  readonly inventory: readonly Lot[]
  /** Its last business day played; null until it has one. */
  readonly lastDay: TruckDay | null
}

/** What happened at one truck on a business day, as of its close (#259). */
export type TruckDay = Pick<
  DaySummary,
  | 'day'
  | 'sold'
  | 'revenue'
  | 'lostSales'
  | 'pricedOut'
  | 'spoiled'
  | 'segments'
  | 'visits'
  | 'leftLine'
  | 'averageWaitSeconds'
  | 'longestWaitSeconds'
  | 'botched'
> & {
  /** Whether it opened. */
  readonly open: boolean
}

/** Who did some work: the owner, or an employee by their candidate id. */
export type Worker = 'owner' | CandidateId

/**
 * What one person did on a business day (#283), by the job they did: the
 * walk-ins they served at the counter, the deliveries they made, the
 * croissants they baked. Zeros for a job they did not do.
 */
export interface PersonDay {
  readonly who: Worker
  /** Customers they served at the counter. */
  readonly customers: number
  /** What those customers paid. */
  readonly sales: Cents
  /** Deliveries they made to the grocers. */
  readonly deliveries: number
  /** What those deliveries invoiced. */
  readonly invoiced: Cents
  /** Croissants they made at the bakery. */
  readonly baked: number
  /**
   * What making them cost in ingredients, those thrown away and made again
   * included.
   */
  readonly bakedCost: Cents
  /** What buying as many for the truck would have cost that day. */
  readonly boughtCost: Cents
}

/** What `GameState.workDays` keeps of a business day (#283). */
export interface WorkDay {
  readonly day: Day
  /** What each person did (see `DaySummary.work`). */
  readonly people: readonly PersonDay[]
  /** Whether the owner was away all day. */
  readonly ownerAway: boolean
  /** The employees absent that day whose role had work. */
  readonly absent: readonly CandidateId[]
}

/** What `GameState.marketingDays` keeps of a business day (#284). */
export interface MarketingDay {
  readonly day: Day
  /** What the marketing budget spent; 0 on a day the truck was closed. */
  readonly spent: Cents
  /** The walk-ins marketing brought, whatever their visit came to. */
  readonly customers: number
  /** What those walk-ins paid. */
  readonly sales: Cents
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
   * if a unit was left; 0 when the owner is rested or an employee served
   * them.
   */
  readonly botched: number
  /**
   * Who served them at the counter (#283); absent when they never reached
   * it, or on a day a save from before it played.
   */
  readonly servedBy?: Worker
  /** Set when marketing brought them (#284); absent otherwise. */
  readonly fromMarketing?: true
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
  /**
   * The bakery the player wants running, and how its oven comes; null when
   * they want none. The morning it takes effect opens the bakery, or starts
   * its notice.
   */
  readonly bakery: BakeryPlan | null
  /**
   * Where the croissants come from: bought, or made at the bakery while it
   * runs. Bought when it does not.
   */
  readonly croissantSource: CroissantSource
  /**
   * How many croissants the bakery makes each morning the truck opens,
   * when they are made there; either kind of rule, within its capacity.
   */
  readonly bake: RestockRule
  /**
   * The employees the player wants, in the order they were hired. The
   * morning it takes effect hires those not on staff and lets go those no
   * longer in it.
   */
  readonly staff: readonly Hire[]
  /**
   * The truck the owner works at (#259), kept until changed; absent for the
   * first truck. They are at one truck at most.
   */
  readonly ownerAt?: TruckId
  /**
   * How each truck after the first runs (#259), by its id; absent while
   * there is none. The first truck's are `prices`, `restock` and `daysOpen`
   * above.
   */
  readonly trucks?: Readonly<Record<TruckId, TruckDecisions>>
  /**
   * « Remiser pour l'hiver » (#260): the dates the first truck is stored
   * each year, kept until changed; absent while it is never stored. A
   * stored truck sells nothing and needs nobody, but its charges keep
   * running.
   */
  readonly storage?: WinterStorage
}

/**
 * How one truck runs: its prices, its restock rules, its days open and the
 * dates it is stored, if any.
 */
export type TruckDecisions = Pick<
  Decisions,
  'prices' | 'restock' | 'daysOpen' | 'storage'
>

/** Someone the player hires, or wants to. */
export interface Hire {
  /** Who, by their id in the content. */
  readonly candidate: CandidateId
  /** What they do. */
  readonly role: StaffRoleId
  /** What they earn an hour. */
  readonly hourlyWage: Cents
  /**
   * The truck an employee « Au camion » works at (#259); absent for the
   * first truck, and for every other role.
   */
  readonly truck?: TruckId
}

/** An employee on staff. */
export interface Employee extends Hire {
  /** The morning they started. */
  readonly hiredOnDay: Day
  /**
   * The first morning of the run they have been paid below the wage they
   * ask (#255), up to now; absent when they are paid at least that.
   */
  readonly underpaidSince?: Day
}

/** The bakery the player wants running. */
export interface BakeryPlan {
  /** How its oven comes: leased by the month, or bought once. */
  readonly oven: OvenTerms
}

/**
 * The bakery, le fournil, as of the last close. It runs from the day it
 * opens to the last day of its notice, if the player closes it.
 */
export interface BakeryState {
  /** The day it opened; null while it does not run. */
  readonly openedOnDay: Day | null
  /** How its oven came; null exactly when `openedOnDay` is. */
  readonly oven: OvenTerms | null
  /**
   * The last day it keeps its premises once the player closed it: the
   * last day of a month. Null while it runs with no notice, or does not.
   */
  readonly closesAfterDay: Day | null
  /**
   * The day the business bought its oven, which the books carry from then
   * on, the bakery closed or not; null while it owns none.
   */
  readonly ovenBoughtOnDay: Day | null
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
  /**
   * What marketing spent and brought on each of the last 28 business days
   * played (#284), oldest first; absent in a save from before it.
   */
  readonly marketingDays?: readonly MarketingDay[]
  /**
   * What each person did on each of the last 7 business days played
   * (#283), oldest first; absent in a save from before it.
   */
  readonly workDays?: readonly WorkDay[]
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
  /**
   * The trucks bought after the first (#259), in the order they were;
   * absent while there is none. The first truck, the Plateau's, is the
   * game's own `rngState`, `inventory`, `lastDay` and decisions.
   */
  readonly trucks?: readonly Truck[]
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
  /** The days of the week under way played so far. */
  readonly weekSoFar: WeekSoFar
  /** The last week whose Sunday was played; null until one is. */
  readonly lastWeek: WeekReport | null
  /**
   * The last 52 weeks whose Sunday was played, oldest first; the last one is
   * `lastWeek`.
   */
  readonly weekHistory: readonly WeekRecord[]
  /** The Défi the game plays; null in a game that is not one. */
  readonly challenge: ChallengeState | null
  /** The bakery, as of the last close. */
  readonly bakery: BakeryState
  /** The grocers' weekly croissant contracts. */
  readonly contracts: ContractsState
  /**
   * The employees on staff, as of the last close, in the order they were
   * hired.
   */
  readonly staff: readonly Employee[]
  /**
   * Whether the owner is away all of business day `day`: they neither serve,
   * deliver nor bake, and their energy holds but for a trip's. A trip to a
   * place that takes the whole day sets it. `tick()` clears it for the next
   * morning.
   */
  readonly ownerAway: boolean
  /**
   * The emergency loans and the shares sold, and since when Encaisse has
   * closed below zero.
   */
  readonly financing: FinancingState
  /**
   * How and when the game ended; null while it goes on. `playDay()` sets it
   * at the close that ends it, and no day is played after (#160). A Défi
   * never ends this way: its own `status` says when it is over.
   */
  readonly ended: GameEnd | null
  /**
   * « Le rêve »: the rungs of the two ladders the player bought, and the
   * day the owner became « Magnat ». Empty in a Défi.
   */
  readonly dream: DreamState
  /** The owner's trips in town (#164), and what they still give. */
  readonly town: TownState
  /**
   * The tutorial (#236), in a game that started with one; absent in any
   * other, a Défi included.
   */
  readonly tutorial?: TutorialState
  /**
   * The postcards Réal sent from Florida (#239), in the order they came,
   * each once a game. The UI sends them and keeps them here, a memory of
   * what the player saw that no rule reads; absent until the first, and
   * in a Défi, which gets none.
   */
  readonly postcardsShown?: readonly PostcardId[]
}

/**
 * The tutorial's progress (#236). While it is not done, the game is
 * protected: no event drawn, no financing card, no letter and no
 * bankruptcy, and `tick()` refuses a day whose steps are not all done.
 */
export interface TutorialState {
  /** The step the player is asked to do next; null once none is left. */
  readonly step: string | null
  /** The game day the tutorial's day 1 is played. */
  readonly startedDay: Day
  /** The morning the protection ends: the tutorial's day after its last. */
  readonly endsDay: Day
  /** Whether the tutorial is over, finished or skipped. */
  readonly done: boolean
  /** Whether the player skipped it. */
  readonly skipped: boolean
}

/** The owner's trips in town (#164). */
export interface TownState {
  /**
   * The place the owner goes to on business day `day`, by its id in the
   * content; null when they stay at the truck. `tick()` clears it for the
   * next morning.
   */
  readonly trip: PlaceId | null
  /**
   * The share a trip to the mill takes off the unit cost of the next
   * restock that buys anything, above 0 and below 1; 0 when none waits.
   */
  readonly discount: number
}

/** What the player climbed of « Le rêve » (#162). */
export interface DreamState {
  /** Every rung bought, oldest first; each rung once. */
  readonly bought: readonly BoughtRung[]
  /**
   * The close at which the owner's net worth first reached the last title,
   * « Magnat »; null until it does. The celebration shows the morning after.
   */
  readonly magnatOn: Day | null
}

/** A rung of « Le rêve » the player bought. */
export interface BoughtRung {
  /** Which, by its id in the content. */
  readonly rung: RungId
  /** The morning it was bought, before that day was played. */
  readonly day: Day
  /**
   * What it cost: its price, and, for the truck that replaces the old one,
   * the old one's book value on top, which the books carry and depreciate.
   */
  readonly cost: Cents
}

/** The end of a game. */
export interface GameEnd {
  /** Why it ended. */
  readonly reason: GameEndReason
  /** The last day played, whose close ended it. */
  readonly day: Day
}

/**
 * Why a game ended: `bankruptcy`, Encaisse below zero at every close of
 * the content's whole calendar months in a row.
 */
export type GameEndReason = 'bankruptcy'

/** The ways out of a negative encaisse a game took (#159). */
export interface FinancingState {
  /** Every emergency loan taken, oldest first, paid back or not. */
  readonly loans: readonly EmergencyLoan[]
  /** Every round of shares sold, oldest first; a sale is for good. */
  readonly shareSales: readonly ShareSale[]
  /**
   * The first of the closes in a row, the last one included, at which
   * Encaisse was below zero; null when it was not at the last close, or
   * before the first.
   */
  readonly belowZeroSince: Day | null
  /**
   * The last morning the lender of the emergency loan came, to lend or to
   * refuse; null until she does. She comes once a game year at most.
   */
  readonly lastLoanRequestDay: Day | null
}

/** An emergency loan, on the terms it was taken on. */
export interface EmergencyLoan {
  /** The morning it was taken; the first payment is on the next 1st. */
  readonly day: Day
  /** Who lent it, as the journal names them. */
  readonly lender: string
  /** What was lent; above zero. */
  readonly principal: Cents
  /** The yearly rate, in basis points: 1800 for 18 %. */
  readonly annualRateBasisPoints: number
  /** The monthly payments, one each 1st from the month after the loan. */
  readonly termMonths: number
  /** What the lender charged up front, the « Frais de dossier ». */
  readonly fee: Cents
}

/** A round of shares sold, on the terms it was sold on. */
export interface ShareSale {
  /** The morning it was sold. */
  readonly day: Day
  /** Who bought it, as the journal names them. */
  readonly investor: string
  /** What they paid; above zero. */
  readonly amount: Cents
  /**
   * The share of the business sold, above 0 and below 1: the investor's
   * share of the profit of each quarter from then on.
   */
  readonly share: number
}

/** The grocers' contracts of a game. */
export interface ContractsState {
  /** The contracts that run, in the order they were signed. */
  readonly running: readonly Contract[]
  /** Every delivery made, oldest first. */
  readonly deliveries: readonly Delivery[]
  /** Every delivery nobody could make, oldest first. */
  readonly missed: readonly MissedDelivery[]
  /**
   * The grocers who walked away, each with the last day they offer
   * nothing.
   */
  readonly away: Readonly<Partial<Record<GrocerId, Day>>>
}

/** A grocer's weekly croissant contract, as it runs. */
export interface Contract {
  /** The grocer, by their id in the content. */
  readonly grocer: GrocerId
  /**
   * The day it was signed; it delivers on each delivery weekday after it.
   */
  readonly startDay: Day
  /** The deliveries left, the next one included; always above zero. */
  readonly weeksLeft: number
  /**
   * What the grocer pays for each croissant, as agreed, before the premium
   * for those the bakery made.
   */
  readonly unitPrice: Cents
  /** The deliveries it missed; always below the content's `maxStrikes`. */
  readonly strikes: number
}

/** A week's delivery to a grocer that nobody could make. */
export interface MissedDelivery {
  /** The morning it was due. */
  readonly day: Day
  /** The grocer, by their id in the content. */
  readonly grocer: GrocerId
}

/** One week's croissants delivered to a grocer, sold on credit. */
export interface Delivery {
  /** The morning of the delivery. */
  readonly day: Day
  /** The grocer, by their id in the content. */
  readonly grocer: GrocerId
  /** Croissants delivered. */
  readonly units: number
  /** Of those, the croissants the bakery made; the others were bought. */
  readonly baked: number
  /** What the grocer owes for them; above zero. */
  readonly amount: Cents
  /** The day the grocer pays, at the start of the day. */
  readonly dueDay: Day
}

/**
 * A Défi under way or over: a short game from a Défi of the content, with
 * one goal and a medal.
 */
export interface ChallengeState {
  /** The Défi's id in the content. */
  readonly id: string
  /** The Défi's first business day. */
  readonly startDay: Day
  /** Where the Défi stands, as of the last close. */
  readonly progress: ChallengeProgress
  /**
   * The owner's lowest energy since the last close, that close's included,
   * or since the Défi's first morning: after each effect of a choice made
   * since and of the start of the day, so a dip a later effect makes up
   * still counts. The next close adds it to `progress.lowestEnergy`.
   */
  readonly lowestEnergySinceClose: number
  /** Under way, won or lost. */
  readonly status: ChallengeStatus
  /** The medal won; null unless the Défi is won. */
  readonly medal: Medal | null
}

/**
 * A Défi « en cours » (`enCours`), « réussi » (`reussi`) with a medal, or
 * « échoué » (`echoue`): a condition broke, or the last day ended short of
 * bronze.
 */
export type ChallengeStatus = 'enCours' | 'reussi' | 'echoue'

/** What the days of a Défi played so far add up to. */
export interface ChallengeProgress {
  /** The Défi's days played. */
  readonly daysPlayed: number
  /** Ventes over those days, as the état des résultats has them. */
  readonly sales: Cents
  /** Bénéfice net over those days; negative for a loss. */
  readonly netIncome: Cents
  /**
   * The lowest Encaisse since the books opened: after any entry, not only
   * at a close.
   */
  readonly lowestCash: Cents
  /** Visits that reached the counter. */
  readonly customersServed: number
  /** Units sold to customers at the counter. */
  readonly unitsSold: number
  /** Units written off at the close because their shelf life was over. */
  readonly unitsSpoiled: number
  /**
   * The owner's lowest energy since the Défi began, up to the last close:
   * on its first morning, after each effect of a choice or of the start of
   * a day, and at each close (see `ChallengeState.lowestEnergySinceClose`).
   */
  readonly lowestEnergy: number
}

/** One business day of a week, as of its close. */
export interface WeekDay {
  /** The business day. */
  readonly day: Day
  /** Whether the truck opened. */
  readonly open: boolean
  /** Ventes posted that day, paid in cash or on credit. */
  readonly sales: Cents
  /**
   * Cash received from customers that day: cash sales, those of the events
   * included, and what customers who pay later paid.
   */
  readonly cashReceived: Cents
  /** Encaisse at the close; may be negative. */
  readonly cashAtClose: Cents
  /** Visits that reached the counter. */
  readonly customersServed: number
  /** Units written off at the close because their shelf life was over. */
  readonly spoiled: PerProduct
  /** What those units cost. */
  readonly spoiledCost: Cents
  /** Visits that left the line without being served. */
  readonly lostToLine: number
  /** Visits that bought nothing because a price was above what they pay. */
  readonly lostToPrices: number
  /** Visits that bought nothing because what they wanted had sold out. */
  readonly lostToStockouts: number
}

/** The week under way, Monday to Sunday, as its days are played. */
export interface WeekSoFar {
  /**
   * Encaisse when the week started: at the close of the Sunday before, or,
   * for a partial week, before its first day.
   */
  readonly cashAtStart: Cents
  /**
   * Whether the week started without the close of the Sunday before: the
   * first week of a game, or the one under way when an older save loaded.
   */
  readonly partial: boolean
  /** The days played so far, in order; never a Sunday. */
  readonly days: readonly WeekDay[]
  /**
   * The changes to the street in effect on any of those days, in the order
   * they were made.
   */
  readonly modifiers: readonly StreetModifier[]
}

/** A week whose Sunday was played, Monday to Sunday. */
export interface WeekReport {
  /** The week's Monday. */
  readonly firstDay: Day
  /** Whether the week started without the close of the Sunday before. */
  readonly partial: boolean
  /**
   * The days played, in order, up to the Sunday: all 7 unless the week is
   * partial and started after its Monday.
   */
  readonly days: readonly WeekDay[]
  /** Ventes over those days, as the état des résultats has them. */
  readonly sales: Cents
  /** Bénéfice net over those days; negative for a loss. */
  readonly netIncome: Cents
  /** Encaisse when the week started, as `WeekSoFar` has it. */
  readonly cashAtStart: Cents
  /** Encaisse at the close of the Sunday. */
  readonly cashAtEnd: Cents
  /** The lowest Encaisse at the close of any of the days. */
  readonly lowestCash: Cents
  /** Units written off over the week. */
  readonly spoiled: PerProduct
  /** What those units cost. */
  readonly spoiledCost: Cents
  /** Visits that left the line without being served, over the week. */
  readonly lostToLine: number
  /** Visits that bought nothing because a price was too high. */
  readonly lostToPrices: number
  /** Visits that bought nothing because what they wanted had sold out. */
  readonly lostToStockouts: number
  /** The owner's energy at the close of the Sunday, before the night. */
  readonly energy: number
  /**
   * The days in a row the truck opened, up to the Sunday, the weeks before
   * included.
   */
  readonly daysOpenInARow: number
  /** What customers still owed at the close of the Sunday. */
  readonly receivables: readonly Receivable[]
  /** The days of the week the owner's rent went unpaid. */
  readonly unpaidRents: readonly Day[]
  /** The events that came up during the week, and the choices made. */
  readonly events: readonly EventRecord[]
  /**
   * The changes to the street in effect on any day of the week, in the
   * order they were made.
   */
  readonly modifiers: readonly StreetModifier[]
  /**
   * The highest ventes of any earlier week of the game, kept even once that
   * week has left `weekHistory`; null when no earlier week was reported.
   */
  readonly previousBest: Cents | null
  /**
   * What the marketing budget spent over the week and what it brought
   * (#284), when it spent anything; absent otherwise.
   */
  readonly marketing?: MarketingWeek
}

/** What the marketing budget spent and brought over some days (#284). */
export interface MarketingWeek {
  readonly spent: Cents
  /** The walk-ins it brought. */
  readonly customers: number
  /** What those walk-ins paid. */
  readonly sales: Cents
}

/** What `weekHistory` keeps of a week. */
export interface WeekRecord {
  /** The week's Monday. */
  readonly firstDay: Day
  /** Ventes over the week. */
  readonly sales: Cents
  /** Bénéfice net over the week; negative for a loss. */
  readonly netIncome: Cents
  /** Encaisse at the close of the Sunday. */
  readonly cashAtEnd: Cents
  /**
   * The owner's net worth at the close of the Sunday (see `netWorth`); null
   * for a week a save from before version 17 reported.
   */
  readonly netWorth: Cents | null
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
  /**
   * The changes to the street the choices made, in the order they were
   * made, each dropped at the close of its last day.
   */
  readonly modifiers: readonly StreetModifier[]
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

/**
 * A change to the street an event's choice made, in effect from `fromDay`
 * to `lastDay`, both included.
 */
export interface StreetModifier {
  /** The id of the event whose choice made it. */
  readonly event: string
  /** What it changes. */
  readonly change: StreetChange
  /** The day it was made, its first day in effect. */
  readonly fromDay: Day
  /** Its last day in effect: `fromDay` + its days − 1. */
  readonly lastDay: Day
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
