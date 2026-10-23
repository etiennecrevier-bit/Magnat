import {
  loadBakeryContent,
  type BakeryContent,
  type BakeryPrices,
  type OvenTerms,
  type ProductId,
  type RestockRule,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import type { Journal } from '../finance/journal.ts'
import { endOfMonth, monthsSinceStart, toCalendar } from './calendar.ts'
import { onHand, orderSize } from './inventory.ts'
import { add, cents, mulInt, type Cents } from './money.ts'
import { credit, debit, depreciate, pay, post } from './posting.ts'
import type { BakeryPlan, BakeryState, Day, Decisions, Lot } from './types.ts'

// The bakery, le fournil, where the croissants can be made rather than
// bought. The player's plan opens it on the morning it takes effect, with
// its oven leased or bought. While it runs, it pays its rent, and its oven's
// lease, on the 1st of each month, and it makes the croissants each morning
// the truck opens, when they come from it. Closing it gives notice: the
// premises, and their rent, stay to the end of the month `noticeMonths`
// after. A bought oven stays on the books, depreciated, whether the bakery
// runs or not. Nothing here draws from the generator.

/** The shipped bakery, validated once when the engine loads. */
export const BAKERY: BakeryContent = loadBakeryContent()

/** The product the bakery makes. */
export const BAKED: ProductId = 'croissant'

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'
const EQUIPMENT: AccountCode = '1500'
const INVENTORY_LOSSES: AccountCode = '5100'
const RENT_AND_PERMIT: AccountCode = '6100'
const BAKERY_LEASE: AccountCode = '6130'
const OTHER_CHARGES: AccountCode = '6900'

/** The memos of the bakery's entries, as the player reads them. */
export const BAKERY_MEMO = {
  moving: 'Déménagement du fournil',
  ovenBought: 'Achat du four',
  rent: 'Loyer du fournil',
  lease: 'Location du four',
  depreciation: 'Amortissement du four',
  ingredients: 'Ingrédients du fournil',
  wasted: 'Croissants ratés au fournil',
} as const

/** A bakery that does not run and owns no oven, as a game starts. */
export function closedBakery(): BakeryState {
  return {
    openedOnDay: null,
    oven: null,
    closesAfterDay: null,
    ovenBoughtOnDay: null,
  }
}

/** Whether the bakery runs, under notice or not, as of its last close. */
export function isBakeryRunning(bakery: BakeryState): boolean {
  return bakery.openedOnDay !== null
}

/**
 * Whether the bakery holds its premises on `day`: it runs with no notice,
 * or with a notice whose last day is not over.
 */
export function holdsPremises(bakery: BakeryState, day: Day): boolean {
  return (
    bakery.openedOnDay !== null &&
    (bakery.closesAfterDay === null || day <= bakery.closesAfterDay)
  )
}

/**
 * Whether the bakery runs on `day` once that morning has put `plan` in
 * effect (see `bakeryMorning`): a plan opens it or keeps it, and with none it
 * runs to the end of its notice.
 */
export function runsOn(
  bakery: BakeryState,
  plan: BakeryPlan | null,
  day: Day,
): boolean {
  return plan !== null || holdsPremises(bakery, day)
}

/**
 * The rule that supplies `product` on `day`, a morning the bakery left as
 * `bakery` and the player runs with `decisions`: the bake rule for the
 * croissants when they come from the bakery and it runs that day (see
 * `runsOn`), the restock rule otherwise.
 */
export function supplyRule(
  bakery: BakeryState,
  decisions: Decisions,
  day: Day,
  product: ProductId,
): RestockRule {
  const baked =
    product === BAKED &&
    decisions.croissantSource === 'fabriquer' &&
    runsOn(bakery, decisions.bakery, day)
  return baked ? decisions.bake : decisions.restock[product]
}

/**
 * The bakery once the morning of `day` has put `plan` in effect, as
 * `bakeryMorning` leaves it, with no entry posted: a notice whose last day
 * is over closes it, keeping the oven it bought; a plan opens a bakery that
 * does not run, on `day`, buying its oven when it buys one and the business
 * owns none yet, or takes a notice back; no plan gives a running bakery its
 * notice, to the end of the month `noticeMonths` after this one. Never
 * mutates `bakery`. Throws an Error if `plan` gives a bakery that holds its
 * premises other oven terms, or leases an oven when the business owns one,
 * which `applyDecision()` never lets happen.
 */
export function morningBakery(
  bakery: BakeryState,
  plan: BakeryPlan | null,
  day: Day,
  content: BakeryContent = BAKERY,
): BakeryState {
  const state =
    bakery.closesAfterDay !== null && day > bakery.closesAfterDay
      ? { ...closedBakery(), ovenBoughtOnDay: bakery.ovenBoughtOnDay }
      : bakery
  if (plan === null) {
    if (state.oven === null || state.closesAfterDay !== null) return state
    return { ...state, closesAfterDay: endOfMonth(day, content.noticeMonths) }
  }
  if (state.oven !== null) {
    if (plan.oven !== state.oven) {
      throw new Error(
        `Day ${day}: the bakery runs with its oven ${state.oven}, not ${plan.oven}`,
      )
    }
    return state.closesAfterDay === null
      ? state
      : { ...state, closesAfterDay: null }
  }
  const { ovenBoughtOnDay } = state
  if (plan.oven === 'louer' && ovenBoughtOnDay !== null) {
    throw new Error(
      `Day ${day}: the bakery cannot lease an oven, the business owns one since day ${ovenBoughtOnDay}`,
    )
  }
  return {
    openedOnDay: day,
    oven: plan.oven,
    closesAfterDay: null,
    ovenBoughtOnDay:
      plan.oven === 'acheter' && ovenBoughtOnDay === null
        ? day
        : ovenBoughtOnDay,
  }
}

/** The books and the bakery after the bakery's part of a morning. */
export interface BakeryMorning {
  readonly journal: Journal
  readonly bakery: BakeryState
}

/**
 * The bakery's part of the start of business day `day`, open or closed, with
 * `plan` the bakery the player wants and `prices` those of the game's
 * difficulty. The bakery ends as `morningBakery` leaves it, and every entry
 * is dated `day`:
 * 1. On the 1st of the month, a bakery that still holds its premises pays
 *    its rent, « Loyer du fournil » (Dr 6100 / Cr 1000), and, with a leased
 *    oven, the lease, « Location du four » (Dr 6130 / Cr 1000). An oven the
 *    business bought is depreciated on each 1st after the day it was
 *    bought, running or not, over `oven.usefulLifeMonths` (see
 *    `depreciate`), as « Amortissement du four ».
 * 2. A bakery the plan opens pays the move, « Déménagement du fournil »
 *    (Dr 6900 / Cr 1000), then, for an oven bought when the business owns
 *    none yet, « Achat du four » (Dr 1500 / Cr 1000), then the month's rent
 *    and lease in full, whatever the day. Giving notice, or taking it back,
 *    costs nothing: the rent stays due on each 1st to the notice's end.
 *
 * Returns the new books and bakery; never mutates its arguments. Throws as
 * `morningBakery` does.
 */
export function bakeryMorning(
  journal: Journal,
  bakery: BakeryState,
  plan: BakeryPlan | null,
  day: Day,
  prices: BakeryPrices,
  content: BakeryContent = BAKERY,
): BakeryMorning {
  const next = morningBakery(bakery, plan, day, content)
  let books = journal
  if (toCalendar(day).dayOfMonth === 1) {
    if (holdsPremises(bakery, day) && bakery.oven !== null) {
      books = premisesCharges(books, day, bakery.oven, prices, content)
    }
    const bought = bakery.ovenBoughtOnDay
    if (bought !== null && day > bought) {
      const month = monthsSinceStart(day) - monthsSinceStart(bought) - 1
      books = depreciate(
        books,
        day,
        month,
        content.oven,
        BAKERY_MEMO.depreciation,
      )
    }
  }
  if (holdsPremises(bakery, day) || next.oven === null) {
    return { journal: books, bakery: next }
  }
  books = pay(
    books,
    day,
    BAKERY_MEMO.moving,
    OTHER_CHARGES,
    content.movingCostCents,
  )
  if (next.ovenBoughtOnDay !== bakery.ovenBoughtOnDay) {
    books = pay(
      books,
      day,
      BAKERY_MEMO.ovenBought,
      EQUIPMENT,
      content.oven.priceCents,
    )
  }
  books = premisesCharges(books, day, next.oven, prices, content)
  return { journal: books, bakery: next }
}

/** The rent, then the lease of a leased oven. */
function premisesCharges(
  journal: Journal,
  day: Day,
  oven: OvenTerms,
  prices: BakeryPrices,
  content: BakeryContent,
): Journal {
  const books = pay(
    journal,
    day,
    BAKERY_MEMO.rent,
    RENT_AND_PERMIT,
    prices.monthlyRentCents,
  )
  return oven === 'louer'
    ? pay(
        books,
        day,
        BAKERY_MEMO.lease,
        BAKERY_LEASE,
        content.oven.monthlyLeaseCents,
      )
    : books
}

/** What the bakery made one morning. */
export interface Baked {
  readonly journal: Journal
  /** The lots, with the croissants made last. */
  readonly lots: readonly Lot[]
  /** Croissants made. */
  readonly quantity: number
}

/**
 * Makes the croissants `rule` calls for, with what is on hand, up to
 * `capacity`, by default the bakery's `capacityPerDay`, as a new lot after
 * the others, each at what its ingredients cost,
 * `prices.ingredientCostCents`: the rent and the oven stay out of the unit
 * cost. Entry « Ingrédients du fournil »: Dr 1200 Stocks / Cr 1000 for what
 * they cost, dated `day`. Makes nothing, and posts nothing, when the rule
 * calls for none.
 */
export function bake(
  journal: Journal,
  lots: readonly Lot[],
  day: Day,
  rule: RestockRule,
  prices: BakeryPrices,
  content: BakeryContent = BAKERY,
  capacity: number = content.capacityPerDay,
): Baked {
  const quantity = Math.min(orderSize(rule, onHand(lots, BAKED)), capacity)
  if (quantity === 0) return { journal, lots, quantity }
  const unitCost = prices.ingredientCostCents
  const cost = mulInt(unitCost, quantity)
  return {
    journal: post(journal, day, BAKERY_MEMO.ingredients, [
      debit(INVENTORY, cost),
      credit(CASH, cost),
    ]),
    lots: [...lots, { product: BAKED, quantity, unitCost, boughtOnDay: day }],
    quantity,
  }
}

/**
 * The cash the bakery takes on `first`, a 1st of the month: its rent and,
 * with a leased oven, the lease, when it still holds its premises that day
 * (see `holdsPremises`); 0 when it does not. Depreciation takes no cash.
 */
export function bakeryMonthlyCosts(
  bakery: BakeryState,
  first: Day,
  prices: BakeryPrices,
  content: BakeryContent = BAKERY,
): Cents {
  if (bakery.oven === null || !holdsPremises(bakery, first)) return cents(0)
  return bakery.oven === 'louer'
    ? add(prices.monthlyRentCents, content.oven.monthlyLeaseCents)
    : prices.monthlyRentCents
}

/**
 * The croissants an employee baker throws away on a morning they made
 * `baked` (#255): ⌊`baked` × `share`⌋, `share` the content's
 * `bakeryWasteShare` × their minutie, each made again at the ingredients'
 * cost of `prices`, so the batch comes out whole and only the cost of the
 * waste shows. Two entries, dated `day`: « Ingrédients du fournil », Dr 1200
 * Stocks / Cr 1000 Encaisse, for the croissants made again, then
 * « Croissants ratés au fournil », Dr 5100 Pertes sur stocks / Cr 1200, for
 * the same amount. Posts nothing when none is thrown away. Also returns how
 * many were.
 */
export function bakeryWaste(
  journal: Journal,
  day: Day,
  baked: number,
  share: number,
  prices: BakeryPrices,
): { journal: Journal; wasted: number } {
  const wasted = Math.floor(baked * share)
  if (wasted === 0) return { journal, wasted }
  const cost = mulInt(prices.ingredientCostCents, wasted)
  const books = post(journal, day, BAKERY_MEMO.ingredients, [
    debit(INVENTORY, cost),
    credit(CASH, cost),
  ])
  return {
    journal: post(books, day, BAKERY_MEMO.wasted, [
      debit(INVENTORY_LOSSES, cost),
      credit(INVENTORY, cost),
    ]),
    wasted,
  }
}
