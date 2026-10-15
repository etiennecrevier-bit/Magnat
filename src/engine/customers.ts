import {
  segmentIdSchema,
  type CustomerContent,
  type DayTypeId,
  type ProductId,
  type Segment,
  type SegmentId,
  type Service,
  type WalkIns,
} from '../content/schema.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import type { Cents } from './money.ts'
import { next, normal } from './rng.ts'
import {
  SECONDS_PER_MINUTE,
  openLine,
  patienceSeconds,
  type Server,
} from './service.ts'
import type {
  PerProduct,
  SegmentSummary,
  Visit,
  VisitOutcome,
} from './types.ts'

// Walk-in customers: how many come, when, from which segment, what each one
// wants at today's prices, and what they buy if they wait in line for it.

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
  /** The generator state after the day's draws. */
  readonly rngState: number
}

/** Who serves the walk-ins, and how long serving takes. */
export interface Counter {
  readonly service: Service
  readonly servers: readonly Server[]
}

/**
 * Walk-ins who come on top of the day type's crowd, such as those marketing
 * brings. They come and behave like that crowd, but for who they are.
 */
export interface ExtraCrowd {
  /** How many come, before the day's noise; not always a whole number. */
  readonly customers: number
  /** Each segment's share of them, summing to 1. */
  readonly segmentShares: Readonly<Record<SegmentId, number>>
}

/**
 * Serves one day's walk-ins, with the `dayType`'s crowd and the `extra`
 * crowd on top, if any, `available` units of each product on hand and
 * `counter` serving them. The draws always come in this order and number,
 * whatever the prices, the stock and the counter, so the same generator
 * state brings the same customers at every price, and a bigger crowd, base
 * or extra, brings the same customers first, then more:
 *
 * 1. `normal()` draws twice for the day's noise, with a mean of 1 and a
 *    standard deviation of `noiseStdDevRatio`. The day's base customers are
 *    the day type's `customers` × noise, and its extra customers the extra
 *    crowd's `customers` × the same noise, each rounded and never below
 *    zero.
 * 2. Each base customer, one after the other, draws once for their arrival
 *    minute (a slot by its `arrivalWeights`, then the minute within it from
 *    where the draw fell), once for their segment (by the day type's
 *    share), then once per product, in `PRODUCTS` order. They want one unit
 *    when the draw is below `purchaseProbability()`. One who does not want
 *    it, at a price above their reference, but whose draw is below what
 *    they would buy at the reference, found it too expensive.
 * 3. Then each extra customer draws the same way, but for their segment by
 *    the extra crowd's share. So the extra crowd leaves the base customers'
 *    draws as they would be without it.
 *
 * Then customers line up by arrival minute; those arriving the same minute
 * keep the order they were drawn in, base customers first, and arrive at
 * the start of the minute. Both crowds share one line and one stock.
 * One who wants nothing walks on. One who wants something looks at the line
 * (`openLine()` in service.ts) and leaves it, buying nothing, if more than
 * `maxAheadInLine` customers are still waiting or the wait is longer than
 * their `patienceSeconds()`. Otherwise they join it and order what they
 * want, which takes the time of every unit ordered. When they reach the
 * counter, they buy each unit they want that is left; one sold out is a
 * lost sale, so a stockout hits the customers served later.
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
  counter: Counter,
  extra: ExtraCrowd | null = null,
): Served {
  const crowd = walkIns.dayTypes[dayType]
  const draws: Draws = {
    walkIns,
    pickSlot: picker(crowd.arrivalWeights),
    odds: dayOdds(customers, crowd.productAppeal, price),
  }

  const [noise, afterNoise] = normal(rngState, 1, walkIns.noiseStdDevRatio)
  const headcount = (expected: number) =>
    Math.max(0, Math.round(expected * noise))

  const base = drawArrivals(
    afterNoise,
    headcount(crowd.customers),
    crowd.segmentShares,
    draws,
  )
  const more =
    extra === null
      ? { arrivals: [], rngState: base.rngState }
      : drawArrivals(
          base.rngState,
          headcount(extra.customers),
          extra.segmentShares,
          draws,
        )
  // Array.prototype.sort is stable, so ties keep the order they were drawn.
  const arrivals = [...base.arrivals, ...more.arrivals].sort(
    (a, b) => a.arrivalMinute - b.arrivalMinute,
  )

  const { service } = counter
  const line = openLine(counter.servers, service)
  const patience = perSegment((id) =>
    patienceSeconds(customers.segments[id], crowd),
  )
  const left: Record<ProductId, number> = { ...available }
  const lost = perProduct(() => 0) as Record<ProductId, number>
  const tally = perSegment<Record<keyof SegmentSummary, number>>(() => ({
    visits: 0,
    buyers: 0,
    tooExpensive: 0,
    soldOut: 0,
  }))
  const visits: Visit[] = []
  let leftLine = 0
  let reachedCounter = 0
  let totalWait = 0
  let longestWait = 0
  for (const { arrivalMinute, segment, wanted, tooExpensive } of arrivals) {
    const bought = perProduct(() => 0) as Record<ProductId, number>
    let outcome: VisitOutcome = tooExpensive ? 'tooExpensive' : 'browsed'
    let servedMinute: number | null = null
    let leftMinute: number | null = null
    if (wanted.length > 0) {
      const second = arrivalMinute * SECONDS_PER_MINUTE
      const { wait, waiting } = line.ahead(second)
      if (waiting > service.maxAheadInLine || wait > patience[segment]) {
        outcome = 'leftLine'
        leftMinute = arrivalMinute
        leftLine += 1
      } else {
        const start = line.join(second, wanted.length)
        servedMinute = Math.floor(start / SECONDS_PER_MINUTE)
        reachedCounter += 1
        totalWait += start - second
        longestWait = Math.max(longestWait, start - second)
        // Customers reach the counter in the order they join the line, so
        // they take the stock in that order too.
        outcome = 'soldOut'
        for (const product of wanted) {
          if (left[product] > 0) {
            left[product] -= 1
            bought[product] = 1
            outcome = 'bought'
          } else {
            lost[product] += 1
          }
        }
      }
    }
    visits.push({
      arrivalMinute,
      segment,
      bought,
      outcome,
      servedMinute,
      leftMinute,
    })

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
    leftLine,
    averageWaitSeconds:
      reachedCounter === 0 ? 0 : Math.round(totalWait / reachedCounter),
    longestWaitSeconds: Math.round(longestWait),
    rngState: more.rngState,
  }
}

/** What every customer of the day draws with. */
interface Draws {
  walkIns: WalkIns
  /** Picks the arrival slot, by the day type's `arrivalWeights`. */
  pickSlot: (draw: number) => [index: number, within: number]
  odds: Record<SegmentId, readonly Odds[]>
}

/**
 * Draws `count` customers from `rngState`, one after the other, each from a
 * segment picked by `segmentShares` (see `serveWalkIns`).
 */
function drawArrivals(
  rngState: number,
  count: number,
  segmentShares: Readonly<Record<SegmentId, number>>,
  { walkIns, pickSlot, odds }: Draws,
): { arrivals: Arrival[]; rngState: number } {
  const { opensAtMinute, arrivalSlotMinutes } = walkIns
  const pickSegment = picker(SEGMENTS.map((id) => segmentShares[id]))
  let state = rngState
  const arrivals: Arrival[] = []
  for (let customer = 0; customer < count; customer += 1) {
    const [when, afterWhen] = next(state)
    const [who, afterWho] = next(afterWhen)
    state = afterWho
    const [slot, within] = pickSlot(when)
    const minute = Math.min(
      arrivalSlotMinutes - 1,
      Math.floor(within * arrivalSlotMinutes),
    )
    const segment = SEGMENTS[pickSegment(who)[0]] as SegmentId
    const wanted: ProductId[] = []
    let tooExpensive = false
    for (const { product, wants, wouldAtReference } of odds[segment]) {
      const [draw, after] = next(state)
      state = after
      if (draw < wants) wanted.push(product)
      else if (draw < wouldAtReference) tooExpensive = true
    }
    arrivals.push({
      arrivalMinute: opensAtMinute + slot * arrivalSlotMinutes + minute,
      segment,
      wanted,
      tooExpensive,
    })
  }
  return { arrivals, rngState: state }
}

/** A customer as they arrive, before the line. */
interface Arrival {
  arrivalMinute: number
  segment: SegmentId
  /** The products they want one unit of, in `PRODUCTS` order. */
  wanted: ProductId[]
  /** Whether a price above their reference kept them from wanting one. */
  tooExpensive: boolean
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
