import {
  loadGrocerContent,
  type BakeryContent,
  type BakeryPrices,
  type FoodTruckContent,
  type GrocerContent,
  type GrocerId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { postEntry } from '../finance/journal.ts'
import { creditSale } from '../finance/receivables.ts'
import { BAKED, BAKERY_MEMO } from './bakery.ts'
import { toCalendar } from './calendar.ts'
import { insertByDay } from './effects.ts'
import { add, cents, mulInt, mulRatio } from './money.ts'
import { credit, debit, post } from './posting.ts'
import type {
  Contract,
  ContractsState,
  Day,
  Delivery,
  GameState,
  Receivable,
} from './types.ts'

// The grocers' weekly croissant contracts (#156). An event card offers one;
// once signed, it delivers each delivery weekday after, open or closed, for
// as many weeks as the grocer's contract runs. Each delivery is its own
// batch, made at the bakery or bought that morning, and leaves the stock at
// once, so the truck's lots never mix with it. The grocer pays for it on
// credit, days later. Nothing here draws from the generator.

/**
 * The shipped grocers, validated once when the engine loads against the
 * event cards, which it loads on its own.
 */
export const GROCERS: GrocerContent = loadGrocerContent()

const CASH: AccountCode = '1000'
const STOCKS: AccountCode = '1200'
const COST_OF_GOODS_SOLD: AccountCode = '5000'

// Memos the player reads in the journal: those of the truck's purchases and
// of an order sold out of stock.
const MEMO = {
  purchases: 'Achat de marchandises',
  costOfSales: 'Coût des marchandises vendues',
} as const

/** No contract, no delivery and nobody away, as a game starts. */
export function noContracts(): ContractsState {
  return { running: [], deliveries: [], away: {} }
}

/**
 * Whether `grocer` may offer a contract on `day`: none of theirs runs, fewer
 * than `maxContracts` run, and they are not away that day.
 */
export function mayOffer(
  contracts: ContractsState,
  day: Day,
  grocer: GrocerId,
  grocers: GrocerContent = GROCERS,
): boolean {
  const { running, away } = contracts
  const back = away[grocer]
  return canSign(running, grocer, grocers) && (back === undefined || day > back)
}

/**
 * `contracts` with one more signed on `day` with `grocer`, after the others,
 * for the grocer's `weeks`, at their price times `priceFactor`, to the cent
 * and never below one. Signing changes nothing while one of theirs runs or
 * `maxContracts` do, which the cards' `grocer` condition rules out.
 */
export function startContract(
  contracts: ContractsState,
  day: Day,
  grocer: GrocerId,
  priceFactor = 1,
  grocers: GrocerContent = GROCERS,
): ContractsState {
  if (!canSign(contracts.running, grocer, grocers)) return contracts
  const { weeks, unitPriceCents } = grocers.grocers[grocer]
  const price = mulRatio(unitPriceCents, priceFactor)
  const contract: Contract = {
    grocer,
    startDay: day,
    weeksLeft: weeks,
    unitPrice: price > 0 ? price : cents(1),
  }
  return { ...contracts, running: [...contracts.running, contract] }
}

/**
 * `contracts` with `grocer` away from `day` for `days` days, that day
 * included: they offer nothing until then, nor until any later day they
 * were already away to.
 */
export function grocerAway(
  contracts: ContractsState,
  day: Day,
  grocer: GrocerId,
  days: number,
): ContractsState {
  const until = day + days - 1
  const back = contracts.away[grocer]
  if (back !== undefined && back >= until) return contracts
  return { ...contracts, away: { ...contracts.away, [grocer]: until } }
}

/** What the morning's deliveries did. */
export interface Delivered {
  /**
   * The state with the deliveries' entries, the grocers' receivables, the
   * contracts and the renewals queued.
   */
  readonly state: GameState
  /** The deliveries, in the order the contracts were signed. */
  readonly deliveries: readonly Delivery[]
  /** The croissants the bakery made for them. */
  readonly baked: number
}

/**
 * The morning's deliveries on `state.day`, open or closed: none but on the
 * `deliveryWeekday`, when each contract signed before that day delivers the
 * grocer's `unitsPerWeek` croissants, in the order signed. When `bakes`, the
 * bakery runs and makes the croissants, it makes those of the deliveries
 * first, within its `capacityPerDay`, those of the grocers who pay a premium
 * first, then in the order signed, at the ingredients' cost of `prices`; the
 * others are bought at `foodTruck`'s cost. Each delivery posts, dated that
 * day:
 * 1. « Ingrédients du fournil », Dr 1200 Stocks / Cr 1000 Encaisse, for the
 *    croissants made, and « Achat de marchandises », the same, for those
 *    bought;
 * 2. « Coût des marchandises vendues », Dr 5000 / Cr 1200, for the whole
 *    batch, which never joins the truck's lots;
 * 3. « Vente à crédit · <grocer> », Dr 1100 Comptes clients / Cr 4000
 *    Ventes, for the croissants at the contract's price, plus the grocer's
 *    `artisanalPremiumCents` for each made, and a receivable from the
 *    grocer, by name, due `paymentDays` later.
 *
 * Each delivery takes a week off its contract, and the last one ends it,
 * the grocer's `renewalEvent` coming as a follow-up the next morning.
 * Returns the new state, the deliveries and the croissants made; never
 * mutates `state`.
 */
export function deliverContracts(
  state: GameState,
  bakes: boolean,
  prices: BakeryPrices,
  foodTruck: FoodTruckContent,
  bakery: BakeryContent,
  grocers: GrocerContent = GROCERS,
): Delivered {
  const { day, contracts } = state
  const due = contracts.running.filter(({ startDay }) => startDay < day)
  if (toCalendar(day).weekday !== grocers.deliveryWeekday || due.length === 0) {
    return { state, deliveries: [], baked: 0 }
  }

  // The premium first; `toSorted` keeps the order signed among equals.
  const premiumOf = ({ grocer }: Contract) =>
    grocers.grocers[grocer].artisanalPremiumCents
  let capacity = bakes ? bakery.capacityPerDay : 0
  const bakedFor = new Map<GrocerId, number>()
  for (const contract of due.toSorted((a, b) => premiumOf(b) - premiumOf(a))) {
    const made = Math.min(
      grocers.grocers[contract.grocer].unitsPerWeek,
      capacity,
    )
    bakedFor.set(contract.grocer, made)
    capacity -= made
  }

  let { journal, receivables } = state
  let { followUps } = state.events
  const running: Contract[] = []
  const deliveries: Delivery[] = []
  for (const contract of contracts.running) {
    if (!due.includes(contract)) {
      running.push(contract)
      continue
    }
    const grocer = grocers.grocers[contract.grocer]
    const units = grocer.unitsPerWeek
    const baked = bakedFor.get(contract.grocer) ?? 0
    const madeCost = mulInt(prices.ingredientCostCents, baked)
    const boughtCost = mulInt(
      foodTruck.products[BAKED].unitCostCents,
      units - baked,
    )
    journal = post(journal, day, BAKERY_MEMO.ingredients, [
      debit(STOCKS, madeCost),
      credit(CASH, madeCost),
    ])
    journal = post(journal, day, MEMO.purchases, [
      debit(STOCKS, boughtCost),
      credit(CASH, boughtCost),
    ])
    const cost = add(madeCost, boughtCost)
    journal = post(journal, day, MEMO.costOfSales, [
      debit(COST_OF_GOODS_SOLD, cost),
      credit(STOCKS, cost),
    ])
    const amount = add(
      mulInt(contract.unitPrice, units),
      mulInt(grocer.artisanalPremiumCents, baked),
    )
    journal = postEntry(journal, creditSale(day, grocer.name, amount))
    const dueDay = day + grocer.paymentDays
    receivables = byDueDay(receivables, {
      client: grocer.name,
      amount,
      soldOnDay: day,
      dueDay,
    })
    deliveries.push({
      day,
      grocer: contract.grocer,
      units,
      baked,
      amount,
      dueDay,
    })
    if (contract.weeksLeft > 1) {
      running.push({ ...contract, weeksLeft: contract.weeksLeft - 1 })
    } else {
      followUps = insertByDay(followUps, {
        day: day + 1,
        event: grocer.renewalEvent,
      })
    }
  }

  return {
    state: {
      ...state,
      journal,
      receivables,
      contracts: {
        ...contracts,
        running,
        deliveries: [...contracts.deliveries, ...deliveries],
      },
      events: { ...state.events, followUps },
    },
    deliveries,
    baked: deliveries.reduce((made, { baked }) => made + baked, 0),
  }
}

/** Whether a contract with `grocer` may start alongside `running`. */
function canSign(
  running: readonly Contract[],
  grocer: GrocerId,
  grocers: GrocerContent,
): boolean {
  return (
    running.length < grocers.maxContracts &&
    !running.some((contract) => contract.grocer === grocer)
  )
}

/**
 * `receivables`, kept by due day, with `receivable` after those due the
 * same day or before.
 */
function byDueDay(
  receivables: readonly Receivable[],
  receivable: Receivable,
): Receivable[] {
  const at = receivables.findIndex(({ dueDay }) => dueDay > receivable.dueDay)
  return at === -1
    ? [...receivables, receivable]
    : [...receivables.slice(0, at), receivable, ...receivables.slice(at)]
}
