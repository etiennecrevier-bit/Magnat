import {
  segmentIdSchema,
  type CustomerContent,
  type DayTypeId,
  type ProductId,
  type Segment,
  type SegmentId,
  type WalkIns,
} from '../content/schema.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import type { Cents } from './money.ts'
import { next, normal } from './rng.ts'
import type {
  PerProduct,
  SegmentSummary,
  Visit,
  VisitOutcome,
} from './types.ts'

// Walk-in customers: how many come, when, from which segment, and what each
// one buys at today's prices.

/** Every customer segment, in the order the game walks through them. */
export const SEGMENTS: readonly SegmentId[] = segmentIdSchema.options

// ISO 8601 weekdays run from 1 = Monday to 7 = Sunday; a calendar fact.
const FIRST_WEEKEND_DAY = 6

/** Builds a record holding `value` of each segment. */
export function perSegment<T>(
  value: (segment: SegmentId) => T,
): Record<SegmentId, T> {
  return Object.fromEntries(SEGMENTS.map((id) => [id, value(id)])) as Record<
    SegmentId,
    T
  >
}

/** The crowd an ISO `weekday` (1 = Monday) brings. */
export function dayTypeOf(weekday: number): DayTypeId {
  return weekday >= FIRST_WEEKEND_DAY ? 'finDeSemaine' : 'semaine'
}

/**
 * The chance that a customer of `segment` buys one unit of `product` at
 * `price`, on a day whose crowd gives the product this `appeal`:
 *
 *     p = clamp(base × appeal × f(r) × d(r), 0, 1),  r = price ÷ reference
 *     f(r) = 2 / (1 + e^(s(r − 1)))
 *     d(r) = min(1, σ(k(r − t)) / σ(k(1 − t))),  σ(x) = 1 / (1 + e^(−x))
 *
 * `base`, `reference` and the sensitivity `s` are the segment's for the
 * product. f is a logistic curve: exactly 1 at the reference price, falling
 * smoothly as the price rises, the faster the higher s, and never above 2
 * however low the price. d is 1 unless the segment has `tooCheap` (t is its
 * `belowRatio`, k its `steepness`): then d is still 1 at or above the
 * reference, and falls towards 0 as the price drops past t × reference.
 */
export function purchaseProbability(
  segment: Segment,
  product: ProductId,
  appeal: number,
  price: Cents,
): number {
  const {
    referencePriceCents,
    purchaseProbability: base,
    sensitivity,
  } = segment.products[product]
  const r = price / referencePriceCents
  const f = 2 / (1 + Math.exp(sensitivity * (r - 1)))
  const { tooCheap } = segment
  const d =
    tooCheap === undefined
      ? 1
      : Math.min(
          1,
          sigmoid(tooCheap.steepness * (r - tooCheap.belowRatio)) /
            sigmoid(tooCheap.steepness * (1 - tooCheap.belowRatio)),
        )
  return Math.min(1, Math.max(0, base * appeal * f * d))
}

/** One day of walk-ins and what they bought. */
export interface Served {
  /** Every visit, in arrival order. */
  readonly visits: readonly Visit[]
  /** Each segment's visits, counted by how they ended. */
  readonly segments: Readonly<Record<SegmentId, SegmentSummary>>
  /** Units bought: never more than were available. */
  readonly sold: PerProduct
  /** Units customers wanted after the product had sold out. */
  readonly lost: PerProduct
  /** The generator state after the day's draws. */
  readonly rngState: number
}

/**
 * Serves one day's walk-ins, with the `dayType`'s crowd and `available`
 * units of each product on hand. The draws always come in this order and
 * number, whatever the prices and the stock, so the same generator state
 * brings the same customers at every price:
 *
 * 1. `normal()` draws twice for the day's noise, with a mean of 1 and a
 *    standard deviation of `noiseStdDevRatio`. The day's customers are the
 *    day type's `customers` × noise, rounded and never below zero.
 * 2. Each customer draws once for their arrival minute (a slot by its
 *    `arrivalWeights`, then the minute within it from where the draw fell),
 *    then once for their segment (by its share).
 * 3. Customers line up by arrival minute; those arriving the same minute
 *    keep the order they were drawn in.
 * 4. In that order, each customer draws once per product, in `PRODUCTS`
 *    order, and wants one unit when the draw is below
 *    `purchaseProbability()`. They buy it if a unit is left; otherwise it is
 *    a lost sale, so a stockout hits the customers who come later. One who
 *    does not want it, at a price above their reference, but whose draw is
 *    below what they would buy at the reference, found it too expensive.
 *
 * Never mutates its arguments.
 */
export function serveWalkIns(
  rngState: number,
  walkIns: WalkIns,
  dayType: DayTypeId,
  customers: CustomerContent,
  price: (product: ProductId) => Cents,
  available: PerProduct,
): Served {
  const crowd = walkIns.dayTypes[dayType]
  const odds = dayOdds(customers, crowd.productAppeal, price)
  const pickSlot = picker(crowd.arrivalWeights)
  const pickSegment = picker(SEGMENTS.map((id) => crowd.segmentShares[id]))
  const { opensAtMinute, arrivalSlotMinutes } = walkIns

  const [noise, afterNoise] = normal(rngState, 1, walkIns.noiseStdDevRatio)
  const count = Math.max(0, Math.round(crowd.customers * noise))

  let state = afterNoise
  const arrivals: { arrivalMinute: number; segment: SegmentId }[] = []
  for (let customer = 0; customer < count; customer += 1) {
    const [when, afterWhen] = next(state)
    const [who, afterWho] = next(afterWhen)
    state = afterWho
    const [slot, within] = pickSlot(when)
    const minute = Math.min(
      arrivalSlotMinutes - 1,
      Math.floor(within * arrivalSlotMinutes),
    )
    arrivals.push({
      arrivalMinute: opensAtMinute + slot * arrivalSlotMinutes + minute,
      segment: SEGMENTS[pickSegment(who)[0]] as SegmentId,
    })
  }
  // Array.prototype.sort is stable, so ties keep the order they were drawn.
  arrivals.sort((a, b) => a.arrivalMinute - b.arrivalMinute)

  const left: Record<ProductId, number> = { ...available }
  const lost = perProduct(() => 0) as Record<ProductId, number>
  const tally = perSegment<Record<keyof SegmentSummary, number>>(() => ({
    visits: 0,
    buyers: 0,
    tooExpensive: 0,
    soldOut: 0,
  }))
  const visits: Visit[] = []
  for (const { arrivalMinute, segment } of arrivals) {
    const bought = {} as Record<ProductId, number>
    let boughtAny = false
    let soldOut = false
    let tooExpensive = false
    for (const { product, wants, wouldAtReference } of odds[segment]) {
      const [draw, after] = next(state)
      state = after
      bought[product] = 0
      if (draw < wants) {
        if (left[product] > 0) {
          left[product] -= 1
          bought[product] = 1
          boughtAny = true
        } else {
          lost[product] += 1
          soldOut = true
        }
      } else if (draw < wouldAtReference) {
        tooExpensive = true
      }
    }
    const outcome: VisitOutcome = boughtAny
      ? 'bought'
      : soldOut
        ? 'soldOut'
        : tooExpensive
          ? 'tooExpensive'
          : 'browsed'
    visits.push({ arrivalMinute, segment, bought, outcome })

    const counts = tally[segment]
    counts.visits += 1
    if (outcome === 'bought') counts.buyers += 1
    if (outcome === 'soldOut') counts.soldOut += 1
    if (outcome === 'tooExpensive') counts.tooExpensive += 1
  }

  return {
    visits,
    segments: tally,
    sold: perProduct((product) => available[product] - left[product]),
    lost,
    rngState: state,
  }
}

interface Odds {
  product: ProductId
  /** The chance they want one at today's price. */
  wants: number
  /**
   * The chance they would want one at their reference price, when today's
   * price is above it; 0 otherwise.
   */
  wouldAtReference: number
}

/** Each segment's odds for every product, in `PRODUCTS` order. */
function dayOdds(
  customers: CustomerContent,
  appeal: Readonly<Record<ProductId, number>>,
  price: (product: ProductId) => Cents,
): Record<SegmentId, readonly Odds[]> {
  return perSegment((id) => {
    const segment = customers.segments[id]
    return PRODUCTS.map((product) => {
      const today = price(product)
      const reference = segment.products[product].referencePriceCents
      return {
        product,
        wants: purchaseProbability(segment, product, appeal[product], today),
        wouldAtReference:
          today > reference
            ? purchaseProbability(segment, product, appeal[product], reference)
            : 0,
      }
    })
  })
}

/**
 * Picks an index from one draw in [0, 1), each with a chance proportional
 * to its weight, never one whose weight is 0. Also returns where in the
 * picked weight the draw fell, in [0, 1). The weights must not all be 0.
 */
function picker(
  weights: readonly number[],
): (draw: number) => [index: number, within: number] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const last = weights.findLastIndex((weight) => weight > 0)
  return (draw) => {
    let target = draw * total
    for (let index = 0; index < last; index += 1) {
      const weight = weights[index] ?? 0
      if (weight > 0 && target < weight) return [index, target / weight]
      target -= weight
    }
    // Rounding may leave the target a hair past the last weight.
    const weight = weights[last] ?? 0
    return [last, Math.min(target / weight, 1 - Number.EPSILON)]
  }
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x))
}
