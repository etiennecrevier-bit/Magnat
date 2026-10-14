import {
  loadCustomerContent,
  loadFoodTruckContent,
  type CustomerContent,
  type FoodTruckContent,
  type ProductId,
  type RestockRule,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  emptyJournal,
  postEntry,
  type Journal,
  type JournalLine,
} from '../finance/journal.ts'
import {
  dayTypeOf,
  perSegment,
  serveWalkIns,
  type Served,
} from './customers.ts'
import {
  PRODUCTS,
  onHand,
  perProduct,
  removeExpired,
  takeFifo,
} from './inventory.ts'
import { add, cents, mulInt, type Cents } from './money.ts'
import type { Day, Decisions, GameState, Lot, PerProduct } from './types.ts'

/** The shipped food truck content, validated once when the engine loads. */
export const FOOD_TRUCK: FoodTruckContent = loadFoodTruckContent()

/** The shipped customer segments, validated once when the engine loads. */
export const CUSTOMERS: CustomerContent = loadCustomerContent()

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'
const SHARE_CAPITAL: AccountCode = '3000'
const SALES: AccountCode = '4000'
const COST_OF_GOODS_SOLD: AccountCode = '5000'
const INVENTORY_LOSSES: AccountCode = '5100'
const RENT_AND_PERMIT: AccountCode = '6100'
const FUEL_AND_MAINTENANCE: AccountCode = '6200'

// Memos the player reads in the journal.
const MEMO = {
  capital: 'Mise de fonds',
  purchases: 'Achat de marchandises',
  sales: 'Ventes au comptant',
  costOfSales: 'Coût des marchandises vendues',
  fixedCosts: 'Loyer, permis, carburant et entretien',
  spoilage: 'Marchandises périmées',
} as const

const ZERO = cents(0)

/** The books a game opens with: the owner's capital, paid in on day 0. */
export function openingJournal(
  content: FoodTruckContent = FOOD_TRUCK,
): Journal {
  const capital = content.startingCapitalCents
  return post(emptyJournal(), 0, MEMO.capital, [
    debit(CASH, capital),
    credit(SHARE_CAPITAL, capital),
  ])
}

/** What one unit of `product` sells for on day `state.day`. */
export function currentPrice(state: GameState, product: ProductId): Cents {
  return state.decisions.prices[product]
}

/**
 * Plays business day `state.day`, which falls on ISO `weekday` (1 = Monday),
 * with `state.decisions`. On a day the truck opens: the morning restock,
 * then the walk-in customers buying from the stock on hand as they arrive.
 * On a day it is closed, nobody comes and nothing is bought, so the
 * generator does not move. Every day: the fixed costs, and the spoilage at
 * the close. Every entry is dated `state.day`. Returns a new state on the
 * same day with the books, the stock, the generator and `lastDay` brought up
 * to the close; never mutates `state`. Cash may go negative.
 */
export function playDay(
  state: GameState,
  weekday: number,
  content: FoodTruckContent = FOOD_TRUCK,
  customers: CustomerContent = CUSTOMERS,
): GameState {
  const { day, decisions } = state
  let journal = state.journal
  let lots = state.inventory
  let served = closed(state.rngState)
  let revenue = ZERO

  if (decisions.daysOpen.includes(weekday)) {
    const restocked = restock(lots, day, decisions.restock, content)
    journal = post(journal, day, MEMO.purchases, [
      debit(INVENTORY, restocked.cost),
      credit(CASH, restocked.cost),
    ])

    const price = (product: ProductId) => currentPrice(state, product)
    served = serveWalkIns(
      state.rngState,
      content.walkIns,
      dayTypeOf(weekday),
      customers,
      price,
      perProduct((product) => onHand(restocked.lots, product)),
    )

    // The sale and its cost are separate entries, so each cash entry's other
    // lines stay on one row of the état des flux de trésorerie.
    const sales = sell(restocked.lots, served.sold, price)
    journal = post(journal, day, MEMO.sales, [
      debit(CASH, sales.revenue),
      credit(SALES, sales.revenue),
    ])
    journal = post(journal, day, MEMO.costOfSales, [
      debit(COST_OF_GOODS_SOLD, sales.cost),
      credit(INVENTORY, sales.cost),
    ])
    lots = sales.lots
    revenue = sales.revenue
  }

  const { rentAndPermit, fuelAndMaintenance } = content.dailyFixedCostsCents
  journal = post(journal, day, MEMO.fixedCosts, [
    debit(RENT_AND_PERMIT, rentAndPermit),
    debit(FUEL_AND_MAINTENANCE, fuelAndMaintenance),
    credit(CASH, add(rentAndPermit, fuelAndMaintenance)),
  ])

  const expired = removeExpired(
    lots,
    day,
    perProduct((product) => content.products[product].shelfLifeDays),
  )
  journal = post(journal, day, MEMO.spoilage, [
    debit(INVENTORY_LOSSES, expired.cost),
    credit(INVENTORY, expired.cost),
  ])

  return {
    ...state,
    rngState: served.rngState,
    journal,
    inventory: expired.lots,
    lastDay: {
      day,
      sold: served.sold,
      revenue,
      lostSales: served.lost,
      spoiled: expired.spoiled,
      segments: served.segments,
      visits: served.visits,
    },
  }
}

/** A closed day's walk-ins: nobody, with no draw from `rngState`. */
function closed(rngState: number): Served {
  const none = perProduct(() => 0)
  return {
    visits: [],
    segments: perSegment(() => ({
      visits: 0,
      buyers: 0,
      tooExpensive: 0,
      soldOut: 0,
    })),
    sold: none,
    lost: none,
    rngState,
  }
}

/**
 * Buys each product its restock rule calls for, at today's unit cost, as a
 * new lot after the others.
 */
function restock(
  lots: readonly Lot[],
  day: Day,
  rules: Decisions['restock'],
  content: FoodTruckContent,
): { lots: readonly Lot[]; cost: Cents } {
  const bought: Lot[] = []
  let cost = ZERO
  for (const product of PRODUCTS) {
    const quantity = orderSize(rules[product], onHand(lots, product))
    if (quantity === 0) continue
    const unitCost = content.products[product].unitCostCents
    bought.push({ product, quantity, unitCost, boughtOnDay: day })
    cost = add(cost, mulInt(unitCost, quantity))
  }
  return { lots: [...lots, ...bought], cost }
}

function orderSize(rule: RestockRule, onHandNow: number): number {
  switch (rule.kind) {
    case 'buyDaily':
      return rule.quantity
    case 'topUp':
      return onHandNow < rule.whenBelow ? rule.upTo - onHandNow : 0
  }
}

interface Sales {
  lots: readonly Lot[]
  revenue: Cents
  /** What the units sold cost, first in, first out. */
  cost: Cents
}

/**
 * Takes the units customers bought out of the stock, oldest lot first, and
 * prices them. Customers buy one at a time as they arrive, but taking a
 * product's day total at once takes the same units from the same lots.
 */
function sell(
  lots: readonly Lot[],
  sold: PerProduct,
  price: (product: ProductId) => Cents,
): Sales {
  let left = lots
  let revenue = ZERO
  let cost = ZERO
  for (const product of PRODUCTS) {
    const taken = takeFifo(left, product, sold[product])
    left = taken.lots
    revenue = add(revenue, mulInt(price(product), taken.taken))
    cost = add(cost, taken.cost)
  }
  return { lots: left, revenue, cost }
}

/**
 * Posts an entry made of the lines with an amount; the journal takes no
 * zero line, so an entry with none is not posted at all.
 */
function post(
  journal: Journal,
  day: Day,
  memo: string,
  lines: readonly JournalLine[],
): Journal {
  const moved = lines.filter(({ debit, credit }) => debit > 0 || credit > 0)
  return moved.length === 0
    ? journal
    : postEntry(journal, { day, memo, lines: moved })
}

function debit(account: AccountCode, amount: Cents): JournalLine {
  return { account, debit: amount, credit: ZERO }
}

function credit(account: AccountCode, amount: Cents): JournalLine {
  return { account, debit: ZERO, credit: amount }
}
