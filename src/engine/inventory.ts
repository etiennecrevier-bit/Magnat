import { productIdSchema, type ProductId } from '../content/schema.ts'
import { add, cents, mulInt, type Cents } from './money.ts'
import type { Day, Lot, PerProduct } from './types.ts'

// Stock on hand as lots, kept oldest first. Every function here returns new
// lists and never mutates the lots it is given.

/** Every product, in the order the game walks through them. */
export const PRODUCTS: readonly ProductId[] = productIdSchema.options

/** Builds a `PerProduct` by asking `count` for each product. */
export function perProduct(count: (product: ProductId) => number): PerProduct {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, count(product)]),
  ) as Record<ProductId, number>
}

/** Units of `product` on hand, across every lot. */
export function onHand(lots: readonly Lot[], product: ProductId): number {
  return lots.reduce(
    (total, lot) => (lot.product === product ? total + lot.quantity : total),
    0,
  )
}

/** What the lots cost: the balance the Stocks account carries. */
export function inventoryValue(lots: readonly Lot[]): Cents {
  return lots.reduce(
    (total, { quantity, unitCost }) => add(total, mulInt(unitCost, quantity)),
    cents(0),
  )
}

export interface Taken {
  /** The lots left, still oldest first and with no empty lot. */
  lots: readonly Lot[]
  /** Units taken: all those asked for, or every unit on hand if fewer. */
  taken: number
  /** What the units taken cost, each at its own lot's unit cost. */
  cost: Cents
}

/**
 * Takes up to `quantity` units of `product`, oldest lot first (FIFO). Lots of
 * other products are left as they are. Throws a RangeError unless `quantity`
 * is a non-negative safe integer.
 */
export function takeFifo(
  lots: readonly Lot[],
  product: ProductId,
  quantity: number,
): Taken {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError(`Invalid quantity: ${quantity}`)
  }
  let wanted = quantity
  let cost = cents(0)
  const left: Lot[] = []
  for (const lot of lots) {
    const units = lot.product === product ? Math.min(wanted, lot.quantity) : 0
    wanted -= units
    cost = add(cost, mulInt(lot.unitCost, units))
    if (units < lot.quantity) {
      left.push(units === 0 ? lot : { ...lot, quantity: lot.quantity - units })
    }
  }
  return { lots: left, taken: quantity - wanted, cost }
}

export interface Expired {
  /** The lots still sellable tomorrow. */
  lots: readonly Lot[]
  /** Units written off, per product. */
  spoiled: PerProduct
  /** What the units written off cost. */
  cost: Cents
}

/**
 * Removes the lots whose shelf life ends with `day`, or earlier. A product
 * sells for `shelfLifeDays` days counting the day it was bought, so a lot
 * bought on day B goes at the close of day B + shelfLifeDays − 1.
 */
export function removeExpired(
  lots: readonly Lot[],
  day: Day,
  shelfLifeDays: PerProduct,
): Expired {
  const left: Lot[] = []
  const spoiled = new Map<ProductId, number>()
  let cost = cents(0)
  for (const lot of lots) {
    const daysOnShelf = day - lot.boughtOnDay + 1
    if (daysOnShelf < shelfLifeDays[lot.product]) {
      left.push(lot)
    } else {
      spoiled.set(lot.product, (spoiled.get(lot.product) ?? 0) + lot.quantity)
      cost = add(cost, mulInt(lot.unitCost, lot.quantity))
    }
  }
  return {
    lots: left,
    spoiled: perProduct((product) => spoiled.get(product) ?? 0),
    cost,
  }
}
