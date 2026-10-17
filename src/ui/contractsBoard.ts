import type { GrocerContent, GrocerId } from '../content/schema.ts'
import { mondayOf } from '../engine/calendar.ts'
import { GROCERS } from '../engine/contracts.ts'
import { sum, type Cents } from '../engine/money.ts'
import type { Contract, Day, GameState } from '../engine/types.ts'

// What the « Contrats » screen shows of the grocers' contracts (#163): the
// engine keeps them (src/engine/contracts.ts); this only reads them.

// Days per game week, a calendar fact.
const DAYS_PER_WEEK = 7

/** This week's delivery to a grocer, as of the morning of the game's day. */
export type WeekDelivery =
  /** Made on `day`: `units` croissants for `amount`. */
  | {
      readonly kind: 'delivered'
      readonly day: Day
      readonly units: number
      readonly amount: Cents
    }
  /** Nobody could make it on `day`. */
  | { readonly kind: 'missed'; readonly day: Day }
  /** Due on `day`, this morning or later this week. */
  | { readonly kind: 'due'; readonly day: Day }
  /** None this week: the contract was signed too late; the first is `day`. */
  | { readonly kind: 'first'; readonly day: Day }

/** A grocer's contract as it runs. */
export interface ContractLine {
  readonly unitsPerWeek: number
  /** What the grocer pays for each croissant, as agreed. */
  readonly unitPrice: Cents
  /** What they pay more for each croissant the bakery made; 0 for none. */
  readonly premium: Cents
  /** The deliveries left, the next one included. */
  readonly weeksLeft: number
  /** The deliveries it missed. */
  readonly strikes: number
  /** The missed deliveries that end it. */
  readonly maxStrikes: number
  readonly week: WeekDelivery
}

/** What a grocer still owes for one delivery. */
export interface Owed {
  readonly amount: Cents
  /** The day they pay it, at the start of the day. */
  readonly dueDay: Day
}

/** A grocer with a contract that runs, or who still owes the business. */
export interface GrocerLine {
  readonly grocer: GrocerId
  /** The business, as the journal names it. */
  readonly name: string
  /** Who runs it. */
  readonly owner: string
  /** Their contract; null once it has ended. */
  readonly contract: ContractLine | null
  /** What they owe, by due day. */
  readonly owed: readonly Owed[]
  /** What they owe in all. */
  readonly owedTotal: Cents
}

/** The « Contrats » screen. */
export interface ContractsBoard {
  /** In the content's order. */
  readonly grocers: readonly GrocerLine[]
  /** What the grocers owe in all. */
  readonly owedTotal: Cents
}

/**
 * The grocers of `game` with a contract that runs or money owed, in the
 * order of `grocers`, each with this week's delivery, as of the morning of
 * `game.day`, and what they owe, matched to them by name as the journal
 * names them.
 */
export function contractsBoard(
  game: Pick<GameState, 'day' | 'contracts' | 'receivables'>,
  grocers: GrocerContent = GROCERS,
): ContractsBoard {
  const lines: GrocerLine[] = []
  for (const [id, grocer] of Object.entries(grocers.grocers)) {
    const key = id as GrocerId
    const owed = game.receivables
      .filter(({ client }) => client === grocer.name)
      .map(({ amount, dueDay }) => ({ amount, dueDay }))
    const contract = game.contracts.running.find(
      (running) => running.grocer === key,
    )
    if (contract === undefined && owed.length === 0) continue
    lines.push({
      grocer: key,
      name: grocer.name,
      owner: grocer.owner,
      contract:
        contract === undefined
          ? null
          : {
              unitsPerWeek: grocer.unitsPerWeek,
              unitPrice: contract.unitPrice,
              premium: grocer.artisanalPremiumCents,
              weeksLeft: contract.weeksLeft,
              strikes: contract.strikes,
              maxStrikes: grocers.maxStrikes,
              week: weekDelivery(game, contract, grocers),
            },
      owed,
      owedTotal: sum(owed.map(({ amount }) => amount)),
    })
  }
  return {
    grocers: lines,
    owedTotal: sum(lines.map(({ owedTotal }) => owedTotal)),
  }
}

/**
 * This week's delivery of `contract`: made or missed on the delivery
 * weekday, as the engine recorded it; still due when that day is this
 * morning or later and the contract was signed before it; otherwise the
 * first one comes the week after, as a contract delivers only after the day
 * it was signed.
 */
function weekDelivery(
  { day, contracts }: Pick<GameState, 'day' | 'contracts'>,
  contract: Contract,
  grocers: GrocerContent,
): WeekDelivery {
  const deliveryDay = mondayOf(day) + grocers.deliveryWeekday - 1
  const isThis = (other: { day: Day; grocer: GrocerId }) =>
    other.day === deliveryDay && other.grocer === contract.grocer
  const made = contracts.deliveries.find(isThis)
  if (made !== undefined) {
    return {
      kind: 'delivered',
      day: deliveryDay,
      units: made.units,
      amount: made.amount,
    }
  }
  if (contracts.missed.some(isThis)) return { kind: 'missed', day: deliveryDay }
  if (deliveryDay >= day && contract.startDay < deliveryDay) {
    return { kind: 'due', day: deliveryDay }
  }
  return { kind: 'first', day: deliveryDay + DAYS_PER_WEEK }
}
