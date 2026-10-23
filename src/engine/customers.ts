import {
  segmentIdSchema,
  type CustomerContent,
  type DayType,
  type DayTypeId,
  type ProductId,
  type Segment,
  type SegmentId,
  type Service,
  type DistrictWalkIns,
} from '../content/schema.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import { add, cents, mulInt, mulRatio, type Cents } from './money.ts'
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

// Not a tunable: a reference price stays a price, so the ratio of a price
// to it stays finite.
const LOWEST_REFERENCE_CENTS = 1

/** Builds a record holding `value` of each segment. */
export function perSegment<T>(
  value: (segment: SegmentId) => T,
): Record<SegmentId, T> {
  return Object.fromEntries(SEGMENTS.map((id) => [id, value(id)])) as Record<
    SegmentId,
    T
  >
}

/** What `visit` paid: each unit it bought at the day's `price`. */
export function visitSales(
  { bought }: Visit,
  price: (product: ProductId) => Cents,
): Cents {
  return PRODUCTS.reduce(
    (total, product) => add(total, mulInt(price(product), bought[product])),
    cents(0),
  )
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
  /** Units bought: with those botched, never more than were available. */
  readonly sold: PerProduct
  /** Units customers wanted after the product had sold out. */
  readonly lost: PerProduct
  /**
   * Customers who found each product too expensive: they would have wanted
   * one at their reference price, but not at the day's, above it.
   */
  readonly pricedOut: PerProduct
  /** Units botched at the counter and thrown out. */
  readonly botched: PerProduct
  /**
   * Each product's units taken from the stock, sold or botched, in the order
   * they were taken, so the books can cost them first in, first out.
   */
  readonly withdrawals: Readonly<Record<ProductId, readonly Withdrawal[]>>
  /** Visits that left the line without being served. */
  readonly leftLine: number
  /** Visits the owner served, of those that reached the counter. */
  readonly servedByOwner: number
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

/**
 * Units of one product taken from the stock one after the other, all sold
 * or all botched.
 */
export interface Withdrawal {
  readonly units: number
  readonly botched: boolean
}

/** No unit of any product taken from the stock yet. */
export function noWithdrawals(): Record<ProductId, Withdrawal[]> {
  const none = (): Withdrawal[] => []
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, none()]),
  ) as Record<ProductId, Withdrawal[]>
}

/**
 * Who serves the walk-ins and how long serving takes; each server botches
 * their own `botchedShare` of the units they make.
 */
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
  /**
   * Whether marketing brought them (#284): their visits say so (see
   * `Visit.fromMarketing`). Tagging them draws nothing.
   */
  readonly fromMarketing?: boolean
}

/**
 * How the street changes a day's walk-ins: what multiplies each segment's
 * walk-ins, each product's appeal and each segment's reference prices.
 */
export interface CrowdChanges {
  readonly walkIns: Readonly<Record<SegmentId, number>>
  readonly appeal: Readonly<Record<ProductId, number>>
  readonly willingness: Readonly<Record<SegmentId, number>>
}

/** No change to the street: every factor 1. */
export const NO_CHANGES: CrowdChanges = {
  walkIns: perSegment(() => 1),
  appeal: perProduct(() => 1),
  willingness: perSegment(() => 1),
}

/**
 * Serves one day's walk-ins, with the `dayType`'s crowd and the `extra`
 * crowd on top, if any, as the street's `changes` leave them, `available`
 * units of each product on hand and `counter` serving them. The draws
 * always come in this order and number, whatever the prices, the stock, the
 * counter and the street's appeal and willingness, so the same generator
 * state brings the same customers at every price, and a bigger crowd, base,
 * extra or the street's, brings the same customers first, then more:
 *
 * 1. `normal()` draws twice for the day's noise, with a mean of 1 and a
 *    standard deviation of `noiseStdDevRatio`. The day's base customers are
 *    the day type's `customers` × noise, its extra customers the extra
 *    crowd's `customers` × the same noise, and the street's the street
 *    crowd's × the same noise, each rounded and never below zero.
 * 2. Each base customer, one after the other, draws once for their arrival
 *    minute, once for their segment (by the day type's share), then once
 *    per product, in `PRODUCTS` order. Their arrival draw picks a slot by
 *    their segment's own `arrivalWeights`, or the day type's when it has
 *    none, then the minute within it from where the draw fell. They want one unit
 *    when the draw is below `purchaseProbability()`, with the day type's
 *    appeal for the product × the street's, and their segment's reference
 *    price × the street's willingness for it, rounded to the cent. One who
 *    does not want it, at a price above their reference, but whose draw is
 *    below what they would buy at the reference, found it too expensive:
 *    the day's `pricedOut` counts them by product, those who find the
 *    truck closed aside.
 * 3. Then each extra customer draws the same way, but for their segment by
 *    the extra crowd's share. So the extra crowd leaves the base customers'
 *    draws as they would be without it.
 * 4. Then, when the street multiplies a segment's walk-ins by more than 1,
 *    the street crowd draws the same way: for each such segment, its
 *    factor − 1 times the customers of that segment the day type's crowd
 *    and the extra crowd bring, before the noise, with each segment's share
 *    of it. With none, it draws nothing.
 *
 * The base and extra customers of a segment whose walk-ins the street
 * multiplies by less than 1 are drawn all the same, but the k-th of them,
 * counted from 1 in draw order, comes only when round(k × factor) goes up
 * at it: a fixed quota rather than a draw, so round(n × factor) of n come.
 * The others never come, and the draws of the days after are those they
 * would be without the cut. A factor of exactly 1 changes nothing.
 *
 * Then customers line up by arrival minute; those arriving the same minute
 * keep the order they were drawn in, base customers first, then extra,
 * then the street's, and arrive at the start of the minute. Every crowd
 * shares one line and one stock. One who arrives while every server is
 * away (see `openLine()`), such as the owner on a trip with nobody else at
 * the truck, finds it closed: they never come, with no visit and no count
 * of their segment, though they were drawn all the same, so the draws stay
 * those of a day without the trip.
 * One who wants nothing walks on. One who wants something looks at the line
 * (`openLine()` in service.ts) and leaves it, buying nothing, if more than
 * `maxAheadInLine` customers are still waiting or the wait is longer than
 * their `patienceSeconds()`. Otherwise they join it and order what they
 * want, which takes the time of every unit ordered. When they reach the
 * counter, they buy each unit they want that is left; one sold out is a
 * lost sale, so a stockout hits the customers served later.
 *
 * Each unit a server makes for a customer they serve, counted from 1 in the
 * order they make them that day, remakes aside, is botched when
 * ⌊n × their `botchedShare`⌋ goes up at it: a fixed quota rather than a
 * draw, so at 0.02 every 50th unit. A botched unit leaves the stock and is
 * thrown out, then the next unit left is made in its place; with none
 * left, the customer loses it as a lost sale. Making it again takes no
 * time, so the line never depends on the stock, the fatigue or the
 * minutie.
 *
 * Never mutates its arguments.
 */
export function serveWalkIns(
  rngState: number,
  walkIns: DistrictWalkIns,
  dayType: DayTypeId,
  customers: CustomerContent,
  price: (product: ProductId) => Cents,
  available: PerProduct,
  counter: Counter,
  extra: ExtraCrowd | null = null,
  changes: CrowdChanges = NO_CHANGES,
): Served {
  const crowd = walkIns.dayTypes[dayType]
  const dayPicker = picker(crowd.arrivalWeights)
  const draws: Draws = {
    walkIns,
    pickSlot: perSegment((id) => {
      const own = customers.segments[id].arrivalWeights
      return own === undefined ? dayPicker : picker(own)
    }),
    odds: dayOdds(customers, crowd.productAppeal, price, changes),
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
          extra.fromMarketing === true,
        )
  const street = streetCrowd(crowd, extra, changes.walkIns)
  const surge =
    street === null
      ? { arrivals: [], rngState: more.rngState }
      : drawArrivals(
          more.rngState,
          headcount(street.customers),
          street.segmentShares,
          draws,
        )
  // Array.prototype.sort is stable, so ties keep the order they were drawn.
  const arrivals = [
    ...thinned([...base.arrivals, ...more.arrivals], changes.walkIns),
    ...surge.arrivals,
  ].sort((a, b) => a.arrivalMinute - b.arrivalMinute)

  const { service } = counter
  const line = openLine(counter.servers, service)
  const patience = perSegment((id) =>
    patienceSeconds(customers.segments[id], crowd),
  )
  const left: Record<ProductId, number> = { ...available }
  const sold = perProduct(() => 0) as Record<ProductId, number>
  const lost = perProduct(() => 0) as Record<ProductId, number>
  const pricedOut = perProduct(() => 0) as Record<ProductId, number>
  const botched = perProduct(() => 0) as Record<ProductId, number>
  const withdrawals = noWithdrawals()
  /** Takes one unit of `product` from the stock, sold or botched. */
  const take = (product: ProductId, asBotched: boolean) => {
    left[product] -= 1
    const runs = withdrawals[product]
    const last = runs.at(-1)
    if (last?.botched === asBotched) {
      runs[runs.length - 1] = { units: last.units + 1, botched: asBotched }
    } else {
      runs.push({ units: 1, botched: asBotched })
    }
  }
  /** The units each server made, remakes aside. */
  const made = new Map<Server, number>()
  const tally = perSegment<Record<keyof SegmentSummary, number>>(() => ({
    visits: 0,
    buyers: 0,
    tooExpensive: 0,
    soldOut: 0,
  }))
  const visits: Visit[] = []
  let leftLine = 0
  let servedByOwner = 0
  let reachedCounter = 0
  let totalWait = 0
  let longestWait = 0
  for (const arrival of arrivals) {
    const { arrivalMinute, segment, wanted, tooDear } = arrival
    // Nobody at the counter: they find the truck closed and never stop.
    if (!line.isOpen(arrivalMinute * SECONDS_PER_MINUTE)) continue
    for (const product of tooDear) pricedOut[product] += 1
    const tooExpensive = tooDear.length > 0
    const bought = perProduct(() => 0) as Record<ProductId, number>
    let outcome: VisitOutcome = tooExpensive ? 'tooExpensive' : 'browsed'
    let servedMinute: number | null = null
    let leftMinute: number | null = null
    let servedBy: Server['who'] = undefined
    let thrownOut = 0
    if (wanted.length > 0) {
      const second = arrivalMinute * SECONDS_PER_MINUTE
      const { wait, waiting } = line.ahead(second)
      if (waiting > service.maxAheadInLine || wait > patience[segment]) {
        outcome = 'leftLine'
        leftMinute = arrivalMinute
        leftLine += 1
      } else {
        const { start, server } = line.join(second, wanted.length)
        servedMinute = Math.floor(start / SECONDS_PER_MINUTE)
        servedBy = server.who
        reachedCounter += 1
        if (server.owner) servedByOwner += 1
        totalWait += start - second
        longestWait = Math.max(longestWait, start - second)
        // Customers reach the counter in the order they join the line, so
        // they take the stock in that order too.
        outcome = 'soldOut'
        for (const product of wanted) {
          if (left[product] === 0) {
            lost[product] += 1
            continue
          }
          const n = (made.get(server) ?? 0) + 1
          made.set(server, n)
          const { botchedShare } = server
          if (
            Math.floor(n * botchedShare) > Math.floor((n - 1) * botchedShare)
          ) {
            take(product, true)
            botched[product] += 1
            thrownOut += 1
            if (left[product] === 0) {
              lost[product] += 1
              continue
            }
          }
          take(product, false)
          sold[product] += 1
          bought[product] = 1
          outcome = 'bought'
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
      botched: thrownOut,
      ...(servedBy === undefined ? {} : { servedBy }),
      ...(arrival.fromMarketing === true ? { fromMarketing: true } : {}),
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
    sold,
    lost,
    pricedOut,
    botched,
    withdrawals,
    leftLine,
    servedByOwner,
    averageWaitSeconds:
      reachedCounter === 0 ? 0 : Math.round(totalWait / reachedCounter),
    longestWaitSeconds: Math.round(longestWait),
    rngState: surge.rngState,
  }
}

/**
 * The walk-ins the street brings on top of `crowd` and `extra`: for each
 * segment whose walk-ins `factors` multiply by more than 1, its factor − 1
 * times the customers of that segment both crowds bring, before the noise,
 * and each segment's share of them. Null when none is above 1.
 */
function streetCrowd(
  crowd: DayType,
  extra: ExtraCrowd | null,
  factors: Readonly<Record<SegmentId, number>>,
): ExtraCrowd | null {
  const more = perSegment((id) => {
    const expected =
      crowd.customers * crowd.segmentShares[id] +
      (extra === null ? 0 : extra.customers * extra.segmentShares[id])
    return Math.max(0, factors[id] - 1) * expected
  })
  const customers = SEGMENTS.reduce((total, id) => total + more[id], 0)
  if (customers === 0) return null
  return {
    customers,
    segmentShares: perSegment((id) => more[id] / customers),
  }
}

/**
 * `arrivals` without those the street keeps away: of each segment whose
 * walk-ins `factors` multiply by less than 1, the k-th arrival, counted
 * from 1 in the order of `arrivals`, stays only when round(k × factor) goes
 * up at it.
 */
function thinned(
  arrivals: readonly Arrival[],
  factors: Readonly<Record<SegmentId, number>>,
): Arrival[] {
  const seen = perSegment(() => 0)
  return arrivals.filter(({ segment }) => {
    const factor = factors[segment]
    if (factor >= 1) return true
    seen[segment] += 1
    const k = seen[segment]
    return Math.round(k * factor) > Math.round((k - 1) * factor)
  })
}

/** What every customer of the day draws with. */
interface Draws {
  walkIns: DistrictWalkIns
  /**
   * Picks each segment's arrival slot, by its own `arrivalWeights` or else
   * the day type's.
   */
  pickSlot: Record<SegmentId, (draw: number) => [index: number, within: number]>
  odds: Record<SegmentId, readonly Odds[]>
}

/**
 * Draws `count` customers from `rngState`, one after the other, each from a
 * segment picked by `segmentShares` (see `serveWalkIns`), each tagged as
 * marketing's with `fromMarketing`, which draws nothing more.
 */
function drawArrivals(
  rngState: number,
  count: number,
  segmentShares: Readonly<Record<SegmentId, number>>,
  { walkIns, pickSlot, odds }: Draws,
  fromMarketing = false,
): { arrivals: Arrival[]; rngState: number } {
  const { opensAtMinute, arrivalSlotMinutes } = walkIns
  const pickSegment = picker(SEGMENTS.map((id) => segmentShares[id]))
  let state = rngState
  const arrivals: Arrival[] = []
  for (let customer = 0; customer < count; customer += 1) {
    const [when, afterWhen] = next(state)
    const [who, afterWho] = next(afterWhen)
    state = afterWho
    const segment = SEGMENTS[pickSegment(who)[0]] as SegmentId
    const [slot, within] = pickSlot[segment](when)
    const minute = Math.min(
      arrivalSlotMinutes - 1,
      Math.floor(within * arrivalSlotMinutes),
    )
    const wanted: ProductId[] = []
    const tooDear: ProductId[] = []
    for (const { product, wants, wouldAtReference } of odds[segment]) {
      const [draw, after] = next(state)
      state = after
      if (draw < wants) wanted.push(product)
      else if (draw < wouldAtReference) tooDear.push(product)
    }
    arrivals.push({
      arrivalMinute: opensAtMinute + slot * arrivalSlotMinutes + minute,
      segment,
      wanted,
      tooDear,
      ...(fromMarketing ? { fromMarketing: true } : {}),
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
  /**
   * The products a price above their reference kept them from wanting, in
   * `PRODUCTS` order.
   */
  tooDear: ProductId[]
  /** Whether marketing brought them; absent otherwise. */
  fromMarketing?: true
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

/**
 * Each segment's odds for every product, in `PRODUCTS` order, with the
 * street's `changes` to the appeal and to what each segment will pay.
 */
function dayOdds(
  customers: CustomerContent,
  appeal: Readonly<Record<ProductId, number>>,
  price: (product: ProductId) => Cents,
  changes: CrowdChanges,
): Record<SegmentId, readonly Odds[]> {
  return perSegment((id) => {
    const segment = willing(customers.segments[id], changes.willingness[id])
    return PRODUCTS.map((product) => {
      const today = price(product)
      const reference = segment.products[product].referencePriceCents
      const wanted = appeal[product] * changes.appeal[product]
      return {
        product,
        wants: purchaseProbability(segment, product, wanted, today),
        wouldAtReference:
          today > reference
            ? purchaseProbability(segment, product, wanted, reference)
            : 0,
      }
    })
  })
}

/**
 * `segment` with its reference prices × `factor`, each rounded to the cent
 * half away from zero and never below 1 cent; `segment` itself at 1.
 */
function willing(segment: Segment, factor: number): Segment {
  if (factor === 1) return segment
  const products = Object.fromEntries(
    PRODUCTS.map((product) => {
      const odds = segment.products[product]
      const reference = mulRatio(odds.referencePriceCents, factor)
      return [
        product,
        {
          ...odds,
          referencePriceCents: cents(
            Math.max(LOWEST_REFERENCE_CENTS, reference),
          ),
        },
      ]
    }),
  ) as Segment['products']
  return { ...segment, products }
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
