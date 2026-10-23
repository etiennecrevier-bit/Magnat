import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  loadCustomerContent,
  loadFoodTruckContent,
  type CustomerContent,
  type DayType,
  type ProductId,
  type Segment,
  type SegmentId,
  type Service,
  type WalkIns,
} from '../content/schema.ts'
import {
  NO_CHANGES,
  SEGMENTS,
  dayTypeOf,
  perSegment,
  purchaseProbability,
  serveWalkIns,
  type Counter,
  type CrowdChanges,
  type ExtraCrowd,
  type Served,
} from './customers.ts'
import { CUSTOMERS, FOOD_TRUCK } from './day.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import { cents, type Cents } from './money.ts'
import { next, seedRng } from './rng.ts'
import type { Server } from './service.ts'
import { streetOn } from './street.ts'
import type { PerProduct, Visit } from './types.ts'

interface Odds {
  base: number
  reference: number
  sensitivity: number
}

interface TooCheap {
  belowRatio: number
  steepness: number
}

function rawSegment(odds: Odds, tooCheap?: TooCheap, patienceMinutes = 5) {
  return {
    name: 'Test',
    patienceMinutes,
    products: Object.fromEntries(
      PRODUCTS.map((product) => [
        product,
        {
          referencePriceCents: odds.reference,
          purchaseProbability: odds.base,
          sensitivity: odds.sensitivity,
        },
      ]),
    ),
    ...(tooCheap === undefined ? {} : { tooCheap }),
  }
}

/** Every segment deciding every product with these odds, validated. */
function everyone(odds: Odds, tooCheap?: TooCheap): CustomerContent {
  const raw = rawSegment(odds, tooCheap)
  return loadCustomerContent({ segments: perSegment(() => raw) })
}

/** A segment deciding every product with these odds, validated. */
function segment(odds: Odds, tooCheap?: TooCheap): Segment {
  return everyone(odds, tooCheap).segments.aubaine
}

/**
 * Every segment wanting one of each product at 3 $, its reference price,
 * and waiting in line up to `patienceMinutes`, validated.
 */
function keen(patienceMinutes: number): CustomerContent {
  const raw = rawSegment(
    { base: 1, reference: 300, sensitivity: 4 },
    undefined,
    patienceMinutes,
  )
  return loadCustomerContent({ segments: perSegment(() => raw) })
}

/**
 * The shipped walk-ins with this weekday crowd, no noise and `customers`
 * walk-ins, validated.
 */
function weekday(customers: number, change: Partial<DayType> = {}): WalkIns {
  const { walkIns } = FOOD_TRUCK
  return loadFoodTruckContent({
    ...FOOD_TRUCK,
    walkIns: {
      ...walkIns,
      noiseStdDevRatio: 0,
      dayTypes: {
        ...walkIns.dayTypes,
        semaine: { ...walkIns.dayTypes.semaine, customers, ...change },
      },
    },
  }).walkIns
}

/** Prices from `set`, and for other products what habitués find fair. */
function prices(set: Partial<Record<ProductId, number>> = {}) {
  return (product: ProductId): Cents =>
    cents(
      set[product] ??
        CUSTOMERS.segments.habitue.products[product].referencePriceCents,
    )
}

function stock(units: number | Partial<Record<ProductId, number>>) {
  return perProduct((product) =>
    typeof units === 'number' ? units : (units[product] ?? 0),
  )
}

const PLENTY = stock(10_000)

/** Each product as appealing as at its reference, whatever the day. */
const EVERY_APPEAL = perProduct(() => 1)

/** A counter that serves everyone the moment they arrive: no one waits. */
const INSTANT: Counter = {
  service: { baseSeconds: 0, perItemSeconds: 0, maxAheadInLine: 0 },
  servers: [{ speed: 1, owner: true, botchedShare: 0 }],
}

/** The shipped service, with the avatar alone at speed 1, rested. */
const SHIPPED_COUNTER: Counter = {
  service: FOOD_TRUCK.service,
  servers: [{ speed: 1, owner: true, botchedShare: 0 }],
}

/** `counter` with the owner botching `botchedShare` of their units. */
function botching(counter: Counter, botchedShare: number): Counter {
  return {
    ...counter,
    servers: counter.servers.map((server) =>
      server.owner ? { ...server, botchedShare } : server,
    ),
  }
}

/**
 * Service times of the tests' own, so the line's arithmetic does not move
 * when the content is tuned: 40 s a customer and 15 s a unit.
 */
const TIMES: Service = {
  baseSeconds: 40,
  perItemSeconds: 15,
  maxAheadInLine: 8,
}

/**
 * A server at each speed, the owner first, then employees: `servers()`'s
 * order. The owner botches `botchedShare` of their units, the employees
 * none.
 */
function crew(speeds: readonly number[], botchedShare = 0): Server[] {
  return speeds.map((speed, index) => ({
    speed,
    owner: index === 0,
    botchedShare: index === 0 ? botchedShare : 0,
  }))
}

/** A counter at `TIMES`, with a server at each speed, rested. */
function timed(speeds = [1]): Counter {
  return { service: TIMES, servers: crew(speeds) }
}

/**
 * The shipped service with `change` made, a server at each speed, and
 * `botchedShare` of the units the owner makes botched.
 */
function counter(
  change: Partial<Service>,
  speeds = [1],
  botchedShare = 0,
): Counter {
  return {
    service: { ...FOOD_TRUCK.service, ...change },
    servers: crew(speeds, botchedShare),
  }
}

function serve(
  walkIns: WalkIns,
  options: {
    seed?: number
    customers?: CustomerContent
    price?: (product: ProductId) => Cents
    available?: PerProduct
    counter?: Counter
    extra?: ExtraCrowd | null
    changes?: Partial<CrowdChanges>
  } = {},
): Served {
  return serveWalkIns(
    seedRng(options.seed ?? 42),
    walkIns,
    'semaine',
    options.customers ?? CUSTOMERS,
    options.price ?? prices(),
    options.available ?? PLENTY,
    options.counter ?? INSTANT,
    options.extra ?? null,
    { ...NO_CHANGES, ...options.changes },
  )
}

/** The generator state after `draws` draws from `state`. */
function advance(state: number, draws: number): number {
  let after = state
  for (let draw = 0; draw < draws; draw += 1) after = next(after)[1]
  return after
}

function arrivals(served: Served) {
  return served.visits.map(({ arrivalMinute, segment }) => ({
    arrivalMinute,
    segment,
  }))
}

describe('dayTypeOf', () => {
  it('brings the office crowd Monday to Friday and families on weekends', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(dayTypeOf)).toEqual([
      'semaine',
      'semaine',
      'semaine',
      'semaine',
      'semaine',
      'finDeSemaine',
      'finDeSemaine',
    ])
  })
})

describe('purchaseProbability', () => {
  it.each(SEGMENTS)('is base × appeal at the reference price for %s', (id) => {
    const shipped = CUSTOMERS.segments[id]
    for (const product of PRODUCTS) {
      const { referencePriceCents, purchaseProbability: base } =
        shipped.products[product]
      for (const appeal of [0, 0.5, 1]) {
        expect(
          purchaseProbability(shipped, product, appeal, referencePriceCents),
        ).toBe(base * appeal)
      }
    }
  })

  it.each(SEGMENTS)('falls strictly as the price rises for %s', (id) => {
    const shipped = CUSTOMERS.segments[id]
    for (const product of PRODUCTS) {
      const { referencePriceCents } = shipped.products[product]
      let before = purchaseProbability(shipped, product, 1, referencePriceCents)
      for (let step = 1; step <= 20; step += 1) {
        const price = cents(Math.round(referencePriceCents * (1 + step / 10)))
        const now = purchaseProbability(shipped, product, 1, price)
        expect(now).toBeLessThan(before)
        before = now
      }
    }
  })

  it('falls faster the higher the sensitivity', () => {
    const calm = segment({ base: 0.8, reference: 300, sensitivity: 2 })
    const touchy = segment({ base: 0.8, reference: 300, sensitivity: 6 })
    expect(purchaseProbability(calm, 'cafe', 1, cents(300))).toBe(0.8)
    expect(purchaseProbability(touchy, 'cafe', 1, cents(300))).toBe(0.8)
    for (const price of [330, 360, 450, 600]) {
      expect(purchaseProbability(touchy, 'cafe', 1, cents(price))).toBeLessThan(
        purchaseProbability(calm, 'cafe', 1, cents(price)),
      )
    }
  })

  const odds = fc.record({
    base: fc.double({ min: 0, max: 1, noNaN: true }),
    reference: fc.integer({ min: 1, max: 100_000 }),
    sensitivity: fc.double({ min: 0, max: 50, noNaN: true }),
  })
  const tooCheap = fc.record({
    belowRatio: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
    steepness: fc.double({ min: 0.01, max: 50, noNaN: true }),
  })
  const appeal = fc.double({ min: 0, max: 10, noNaN: true })
  const price = fc.integer({ min: 0, max: 200_000 })

  it('stays within [0, 1]', () => {
    fc.assert(
      fc.property(
        odds,
        fc.option(tooCheap, { nil: undefined }),
        appeal,
        price,
        (o, t, a, p) => {
          const chance = purchaseProbability(segment(o, t), 'cafe', a, cents(p))
          expect(chance).toBeGreaterThanOrEqual(0)
          expect(chance).toBeLessThanOrEqual(1)
        },
      ),
    )
  })

  it('never falls as the price drops, without tooCheap', () => {
    fc.assert(
      fc.property(odds, appeal, price, price, (o, a, p1, p2) => {
        const s = segment(o)
        const [low, high] = [Math.min(p1, p2), Math.max(p1, p2)]
        expect(
          purchaseProbability(s, 'cafe', a, cents(low)),
        ).toBeGreaterThanOrEqual(purchaseProbability(s, 'cafe', a, cents(high)))
      }),
    )
  })

  it('leaves prices at or above the reference alone with tooCheap', () => {
    fc.assert(
      fc.property(odds, tooCheap, appeal, price, (o, t, a, extra) => {
        const p = cents(o.reference + extra)
        expect(purchaseProbability(segment(o, t), 'cafe', a, p)).toBe(
          purchaseProbability(segment(o), 'cafe', a, p),
        )
      }),
    )
  })

  it('falls far below the reference with tooCheap', () => {
    const odds = { base: 0.5, reference: 400, sensitivity: 1.5 }
    const wary = segment(odds, { belowRatio: 0.4, steepness: 15 })
    const p = (s: Segment, price: number) =>
      purchaseProbability(s, 'cafe', 1, cents(price))

    // Down to 0.7 × reference, a cheaper price still sells more.
    expect(p(wary, 280)).toBeGreaterThan(p(wary, 400))
    // Far below, the price looks too cheap to be good.
    expect(p(wary, 160)).toBeLessThan(p(wary, 280))
    expect(p(wary, 80)).toBeLessThan(p(wary, 160))
    expect(p(wary, 80)).toBeLessThan(0.1 * p(segment(odds), 80))
    expect(p(wary, 0)).toBeLessThan(p(wary, 80))
  })
})

describe('serveWalkIns', () => {
  it('lines the customers up by arrival, within opening hours', () => {
    const { opensAtMinute, closesAtMinute } = FOOD_TRUCK.walkIns
    const served = serve(weekday(500))
    const minutes = served.visits.map(({ arrivalMinute }) => arrivalMinute)
    expect(minutes).toHaveLength(500)
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b))
    for (const minute of minutes) {
      expect(Number.isInteger(minute)).toBe(true)
      expect(minute).toBeGreaterThanOrEqual(opensAtMinute)
      expect(minute).toBeLessThan(closesAtMinute)
    }
  })

  it('brings customers only in slots with a weight', () => {
    const slots = fc
      .array(
        fc.oneof(
          fc.constant(0),
          fc.double({ min: 0.01, max: 10, noNaN: true }),
        ),
        {
          minLength: 1,
          maxLength: 20,
        },
      )
      .filter((weights) => weights.some((weight) => weight > 0))
    const scenario = fc
      .record({
        seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
        slotMinutes: fc.integer({ min: 1, max: 60 }),
        weights: slots,
        opensAt: fc.double({ min: 0, max: 1, noNaN: true }),
      })
      .map((s) => {
        const open = s.weights.length * s.slotMinutes
        const opens = Math.floor(s.opensAt * (1440 - open))
        return { ...s, opens, closes: opens + open }
      })

    fc.assert(
      fc.property(scenario, (s) => {
        const crowd = {
          ...FOOD_TRUCK.walkIns.dayTypes.semaine,
          customers: 200,
          arrivalWeights: s.weights,
        }
        const { walkIns } = loadFoodTruckContent({
          ...FOOD_TRUCK,
          walkIns: {
            noiseStdDevRatio: 0,
            opensAtMinute: s.opens,
            closesAtMinute: s.closes,
            arrivalSlotMinutes: s.slotMinutes,
            dayTypes: { semaine: crowd, finDeSemaine: crowd },
          },
        })
        const served = serve(walkIns, { seed: s.seed })
        expect(served.visits).toHaveLength(200)
        for (const { arrivalMinute } of served.visits) {
          expect(arrivalMinute).toBeGreaterThanOrEqual(s.opens)
          expect(arrivalMinute).toBeLessThan(s.closes)
          const slot = Math.floor((arrivalMinute - s.opens) / s.slotMinutes)
          expect(s.weights[slot]).toBeGreaterThan(0)
        }
      }),
      { numRuns: 50 },
    )
  })

  it('follows the arrival curve', () => {
    // All weekday arrivals in the first and the last half hour, 3 to 1.
    const weights = Array.from({ length: 16 }, () => 0)
    weights[0] = 3
    weights[15] = 1
    const served = serve(weekday(4000, { arrivalWeights: weights }))
    const early = served.visits.filter(
      ({ arrivalMinute }) => arrivalMinute < 450,
    )
    expect(early.length / 4000).toBeCloseTo(0.75, 1)
  })

  it('draws segments by their shares, never one with no share', () => {
    const shares: Record<SegmentId, number> = {
      aubaine: 0.6,
      habitue: 0,
      chic: 0.4,
    }
    const served = serve(weekday(5000, { segmentShares: shares }))
    const drawn = perSegment(
      (id) => served.visits.filter(({ segment }) => segment === id).length,
    )
    expect(drawn.habitue).toBe(0)
    expect(drawn.aubaine / 5000).toBeCloseTo(0.6, 1)
    expect(drawn.chic / 5000).toBeCloseTo(0.4, 1)
  })

  it('accounts for every visit, unit and lost sale', () => {
    const served = serve(weekday(300), {
      available: stock({ cafe: 120, chocolat: 5, croissant: 60 }),
    })
    const { visits, segments, sold, lost } = served
    expect(visits).toHaveLength(300)

    for (const product of PRODUCTS) {
      const bought = visits.filter((visit) => visit.bought[product] === 1)
      expect(
        visits.every((visit) => [0, 1].includes(visit.bought[product])),
      ).toBe(true)
      expect(bought).toHaveLength(sold[product])
    }
    expect(sold).toEqual({ cafe: 120, chocolat: 5, croissant: 60 })
    expect(lost.cafe).toBeGreaterThan(0)

    for (const visit of visits) {
      const units = PRODUCTS.reduce((n, p) => n + visit.bought[p], 0)
      expect(visit.outcome === 'bought').toBe(units > 0)
    }
    const count = (id: SegmentId, outcome?: string) =>
      visits.filter(
        (visit) =>
          visit.segment === id &&
          (outcome === undefined || visit.outcome === outcome),
      ).length
    expect(segments).toEqual(
      perSegment((id) => ({
        visits: count(id),
        buyers: count(id, 'bought'),
        tooExpensive: count(id, 'tooExpensive'),
        soldOut: count(id, 'soldOut'),
      })),
    )
    expect(SEGMENTS.reduce((n, id) => n + segments[id].visits, 0)).toBe(300)
  })

  it('sells to customers in arrival order until the stock runs out', () => {
    const served = serve(weekday(30, { productAppeal: perProduct(() => 1) }), {
      customers: everyone({ base: 1, reference: 300, sensitivity: 4 }),
      price: () => cents(300),
      available: stock({ croissant: 10 }),
    })
    // Everyone wants one of each, and only 10 croissants are on hand.
    expect(served.visits.map(({ bought }) => bought.croissant)).toEqual([
      ...Array.from({ length: 10 }, () => 1),
      ...Array.from({ length: 20 }, () => 0),
    ])
    expect(served.visits.map(({ outcome }) => outcome)).toEqual([
      ...Array.from({ length: 10 }, () => 'bought'),
      ...Array.from({ length: 20 }, () => 'soldOut'),
    ])
    expect(served.lost).toEqual({ cafe: 30, chocolat: 30, croissant: 20 })
  })

  it('counts a customer the price kept away as tooExpensive', () => {
    // At twice the reference, they would buy at the reference but not now.
    const served = serve(weekday(40), {
      customers: everyone({ base: 1, reference: 200, sensitivity: 50 }),
      price: () => cents(400),
    })
    expect(served.sold).toEqual({ cafe: 0, chocolat: 0, croissant: 0 })
    expect(new Set(served.visits.map(({ outcome }) => outcome))).toEqual(
      new Set(['tooExpensive']),
    )
    expect(
      SEGMENTS.reduce((n, id) => n + served.segments[id].tooExpensive, 0),
    ).toBe(40)
  })

  it('counts each product a customer found too expensive in pricedOut (#236)', () => {
    const served = serve(weekday(40, { productAppeal: EVERY_APPEAL }), {
      customers: everyone({ base: 1, reference: 200, sensitivity: 50 }),
      price: () => cents(400),
    })
    expect(served.pricedOut).toEqual({ cafe: 40, chocolat: 40, croissant: 40 })
  })

  it('counts in pricedOut only the products above the reference, a customer who bought another included', () => {
    const served = serve(weekday(40, { productAppeal: EVERY_APPEAL }), {
      customers: everyone({ base: 1, reference: 200, sensitivity: 50 }),
      price: (product) => cents(product === 'cafe' ? 400 : 200),
    })
    expect(served.pricedOut).toEqual({ cafe: 40, chocolat: 0, croissant: 0 })
    expect(served.sold).toEqual({ cafe: 0, chocolat: 40, croissant: 40 })
    expect(
      SEGMENTS.reduce((n, id) => n + served.segments[id].tooExpensive, 0),
    ).toBe(0)
  })

  it('counts at least as many priced out as visits too expensive, with the shipped customers', () => {
    const served = serve(weekday(120), { price: prices({ cafe: 375 }) })
    const visits = SEGMENTS.reduce(
      (n, id) => n + served.segments[id].tooExpensive,
      0,
    )
    const pricedOut = PRODUCTS.reduce(
      (n, product) => n + served.pricedOut[product],
      0,
    )
    expect(visits).toBeGreaterThan(0)
    expect(pricedOut).toBeGreaterThanOrEqual(visits)
    expect(served.pricedOut.cafe).toBeGreaterThan(0)
  })

  it('counts a customer who wants nothing at any price as browsed', () => {
    const served = serve(weekday(40), {
      customers: everyone({ base: 0, reference: 200, sensitivity: 50 }),
      price: () => cents(400),
    })
    expect(new Set(served.visits.map(({ outcome }) => outcome))).toEqual(
      new Set(['browsed']),
    )
  })

  it('counts no price loss at or below the reference', () => {
    // Too cheap is not too expensive: these customers simply browse.
    const wary = everyone(
      { base: 0.5, reference: 400, sensitivity: 1.5 },
      { belowRatio: 0.4, steepness: 15 },
    )
    for (const price of [400, 100]) {
      const served = serve(weekday(200), {
        customers: wary,
        price: () => cents(price),
      })
      const outcomes = new Set(served.visits.map(({ outcome }) => outcome))
      expect(outcomes.has('tooExpensive')).toBe(false)
      expect(outcomes.has('browsed')).toBe(true)
      expect(served.pricedOut).toEqual({ cafe: 0, chocolat: 0, croissant: 0 })
    }
  })

  it('makes the same draws whatever the prices, the stock and the counter', () => {
    const walkIns = weekday(120)
    const base = serve(walkIns)
    const variants = [
      serve(walkIns, { price: prices({ cafe: 900, croissant: 100 }) }),
      serve(walkIns, { available: stock({ chocolat: 3 }) }),
      serve(walkIns, { available: stock(0) }),
      serve(walkIns, {
        price: prices({ chocolat: 50 }),
        available: stock({ cafe: 1 }),
        customers: everyone({ base: 1, reference: 100, sensitivity: 0 }),
      }),
      serve(walkIns, { counter: SHIPPED_COUNTER }),
      serve(walkIns, {
        counter: counter({ baseSeconds: 600, maxAheadInLine: 0 }, [2]),
      }),
      serve(walkIns, { counter: counter({}, [1], 0.5) }),
    ]
    const draws = 2 + 120 * (2 + PRODUCTS.length)
    expect(base.rngState).toBe(advance(seedRng(42), draws))
    for (const other of variants) {
      expect(arrivals(other)).toEqual(arrivals(base))
      expect(other.rngState).toBe(base.rngState)
    }
  })

  it('draws only the noise on a day with no customers', () => {
    const served = serve(weekday(0))
    expect(served.visits).toEqual([])
    expect(served.rngState).toBe(advance(seedRng(42), 2))
  })

  it("leaves other products' sales alone when one price changes", () => {
    const walkIns = weekday(200)
    const base = serve(walkIns)
    const dearer = serve(walkIns, { price: prices({ cafe: 400 }) })
    const others = (served: Served) =>
      served.visits.map(({ bought }) => [bought.chocolat, bought.croissant])
    expect(others(dearer)).toEqual(others(base))
    expect(dearer.sold.cafe).toBeLessThan(base.sold.cafe)
  })

  it('never mutates the stock it is given', () => {
    const available = Object.freeze(stock(5))
    serve(weekday(100), { available })
    expect(available).toEqual(stock(5))
  })
})

describe('botched units', () => {
  /** Everyone wants one of each product at 3 $; `cafe` units are left. */
  function cafeOnly(customers: number, cafe: number, botchedShare: number) {
    return serve(weekday(customers, { productAppeal: perProduct(() => 1) }), {
      customers: everyone({ base: 1, reference: 300, sensitivity: 4 }),
      price: () => cents(300),
      available: stock({ cafe }),
      counter: botching(INSTANT, botchedShare),
    })
  }

  const units = (count: PerProduct) =>
    PRODUCTS.reduce((total, product) => total + count[product], 0)

  it('botches nothing at a share of 0, taking each product in one run', () => {
    const served = serve(weekday(300), {
      available: stock({ cafe: 120, chocolat: 5, croissant: 60 }),
    })
    expect(served.botched).toEqual(stock(0))
    expect(served.visits.every(({ botched }) => botched === 0)).toBe(true)
    expect(served.withdrawals).toEqual({
      cafe: [{ units: 120, botched: false }],
      chocolat: [{ units: 5, botched: false }],
      croissant: [{ units: 60, botched: false }],
    })
  })

  it('takes no unit of a product nobody bought', () => {
    const served = cafeOnly(5, 0, 0.5)
    expect(served.withdrawals).toEqual({
      cafe: [],
      chocolat: [],
      croissant: [],
    })
    expect(served.botched).toEqual(stock(0))
  })

  it('botches every 2nd unit made at 0.5, and makes it again from the stock', () => {
    // Only café is left, so each customer is made one unit: units 2, 4 and 6
    // are botched, each followed by the one made in its place.
    const served = cafeOnly(6, 100, 0.5)
    expect(served.visits.map(({ botched }) => botched)).toEqual([
      0, 1, 0, 1, 0, 1,
    ])
    expect(served.visits.every(({ outcome }) => outcome === 'bought')).toBe(
      true,
    )
    expect(served.sold).toEqual({ cafe: 6, chocolat: 0, croissant: 0 })
    expect(served.botched).toEqual({ cafe: 3, chocolat: 0, croissant: 0 })
    expect(served.lost).toEqual({ cafe: 0, chocolat: 6, croissant: 6 })
    expect(served.withdrawals.cafe).toEqual([
      { units: 1, botched: false },
      { units: 1, botched: true },
      { units: 2, botched: false },
      { units: 1, botched: true },
      { units: 2, botched: false },
      { units: 1, botched: true },
      { units: 1, botched: false },
    ])
  })

  it('loses the sale of a botched unit when none is left to make it again', () => {
    // Two cafés: the first customer gets one, the second's is botched and
    // the last unit with it, and the third finds none.
    const served = cafeOnly(3, 2, 0.5)
    expect(served.visits.map(({ botched }) => botched)).toEqual([0, 1, 0])
    expect(served.visits.map(({ outcome }) => outcome)).toEqual([
      'bought',
      'soldOut',
      'soldOut',
    ])
    expect(served.sold.cafe).toBe(1)
    expect(served.botched.cafe).toBe(1)
    expect(served.lost.cafe).toBe(2)
    expect(served.withdrawals.cafe).toEqual([
      { units: 1, botched: false },
      { units: 1, botched: true },
    ])
  })

  it.each([0.02, 0.05])(
    'botches one unit in %d of those made, by a quota rather than a draw',
    (share) => {
      const served = serve(weekday(300), {
        counter: botching(INSTANT, share),
      })
      const made = units(served.sold)
      expect(made).toBeGreaterThan(200)
      expect(units(served.botched)).toBe(Math.floor(made * share))
      expect(
        served.visits.reduce((total, { botched }) => total + botched, 0),
      ).toBe(units(served.botched))
      for (const product of PRODUCTS) {
        const taken = (botched: boolean) =>
          served.withdrawals[product]
            .filter((run) => run.botched === botched)
            .reduce((total, run) => total + run.units, 0)
        expect(taken(false)).toBe(served.sold[product])
        expect(taken(true)).toBe(served.botched[product])
      }
    },
  )

  it('brings the same customers, line and waits whatever the share', () => {
    const walkIns = weekday(150)
    const rested = serve(walkIns, { counter: SHIPPED_COUNTER })
    for (const share of [0.02, 0.05, 1]) {
      const tired = serve(walkIns, { counter: counter({}, [1], share) })
      expect(units(tired.botched)).toBeGreaterThan(0)
      expect(tired.rngState).toBe(rested.rngState)
      expect(
        tired.visits.map(({ arrivalMinute, servedMinute, leftMinute }) => ({
          arrivalMinute,
          servedMinute,
          leftMinute,
        })),
      ).toEqual(
        rested.visits.map(({ arrivalMinute, servedMinute, leftMinute }) => ({
          arrivalMinute,
          servedMinute,
          leftMinute,
        })),
      )
      expect(tired.averageWaitSeconds).toBe(rested.averageWaitSeconds)
      expect(tired.longestWaitSeconds).toBe(rested.longestWaitSeconds)
    }
  })

  it('takes a unit for each botched one, never more than are on hand', () => {
    // Everyone wants one of each, far more than is on hand.
    const available = stock({ cafe: 40, chocolat: 30, croissant: 20 })
    const served = serve(weekday(200, { productAppeal: perProduct(() => 1) }), {
      customers: everyone({ base: 1, reference: 300, sensitivity: 4 }),
      price: () => cents(300),
      available,
      counter: botching(INSTANT, 0.25),
    })
    for (const product of PRODUCTS) {
      const taken = served.sold[product] + served.botched[product]
      expect(taken).toBe(available[product])
    }
    expect(units(served.lost)).toBeGreaterThan(0)
  })
})

describe('the line', () => {
  /**
   * Walk-ins where all `customers` come in the first minute of the day,
   * 7 h 00, liking every product, with no noise and a patience multiplier
   * of 1, validated.
   */
  function oneMinute(customers: number): WalkIns {
    const crowd = {
      ...FOOD_TRUCK.walkIns.dayTypes.semaine,
      customers,
      productAppeal: perProduct(() => 1),
      patienceMultiplier: 1,
      arrivalWeights: [1],
    }
    return loadFoodTruckContent({
      ...FOOD_TRUCK,
      walkIns: {
        noiseStdDevRatio: 0,
        opensAtMinute: 420,
        closesAtMinute: 421,
        arrivalSlotMinutes: 1,
        dayTypes: { semaine: crowd, finDeSemaine: crowd },
      },
    }).walkIns
  }

  /** 7 h 00, in seconds from midnight. */
  const OPENING = 420 * 60

  /** The minute a customer who waited `seconds` from 7 h 00 is served. */
  const servedAt = (seconds: number) => Math.floor((OPENING + seconds) / 60)

  const outcomes = (served: Served) =>
    served.visits.map(({ outcome }) => outcome)

  const times = <T>(count: number, value: T) =>
    Array.from({ length: count }, () => value)

  it('serves the line in turn and sends away those who find more than 8 waiting', () => {
    // Each customer orders three units: 40 + 3 × 15 = 85 s at the counter.
    const served = serve(oneMinute(12), {
      customers: keen(20),
      price: () => cents(300),
      available: stock({ cafe: 50, chocolat: 50, croissant: 10 }),
      counter: timed(),
    })
    expect(outcomes(served)).toEqual([
      ...times(10, 'bought'),
      ...times(2, 'leftLine'),
    ])
    expect(served.visits.map(({ servedMinute }) => servedMinute)).toEqual([
      ...Array.from({ length: 10 }, (_, turn) => servedAt(85 * turn)),
      null,
      null,
    ])
    expect(served.visits.map(({ leftMinute }) => leftMinute)).toEqual([
      ...times(10, null),
      420,
      420,
    ])
    expect(served.leftLine).toBe(2)
    // Waits of 0, 85, …, 765 s.
    expect(served.averageWaitSeconds).toBe(383)
    expect(served.longestWaitSeconds).toBe(765)
    // Those who left took no croissant and lost no sale.
    expect(served.sold).toEqual({ cafe: 10, chocolat: 10, croissant: 10 })
    expect(served.lost).toEqual({ cafe: 0, chocolat: 0, croissant: 0 })
  })

  it('sends away those whose wait is longer than their patience', () => {
    // Two minutes: the third would wait 170 s, and so would everyone after.
    const served = serve(oneMinute(12), {
      customers: keen(2),
      price: () => cents(300),
      counter: timed(),
    })
    expect(outcomes(served)).toEqual([
      ...times(2, 'bought'),
      ...times(10, 'leftLine'),
    ])
    expect(served.longestWaitSeconds).toBe(85)
  })

  it('keeps a customer whose wait is exactly their patience', () => {
    // 60 s each, whatever they order: waits of 0, 60, 120 and 180 s.
    const served = serve(oneMinute(4), {
      customers: keen(2),
      price: () => cents(300),
      counter: counter({ baseSeconds: 60, perItemSeconds: 0 }),
    })
    expect(outcomes(served)).toEqual([...times(3, 'bought'), 'leftLine'])
    expect(served.longestWaitSeconds).toBe(120)
  })

  it('keeps a customer who finds exactly maxAheadInLine waiting', () => {
    // The first is at the counter, so the others find 0, 1, 2 and 3 waiting.
    const served = serve(oneMinute(5), {
      customers: keen(60),
      price: () => cents(300),
      counter: counter({ maxAheadInLine: 2 }),
    })
    expect(outcomes(served)).toEqual([...times(4, 'bought'), 'leftLine'])
  })

  it('takes the time of a sold-out order, so the next customer waits for it', () => {
    // One croissant: the second customer finds everything sold out.
    const served = serve(oneMinute(3), {
      customers: keen(20),
      price: () => cents(300),
      available: stock({ croissant: 1 }),
      counter: timed(),
    })
    expect(outcomes(served)).toEqual(['bought', 'soldOut', 'soldOut'])
    expect(served.visits.map(({ servedMinute }) => servedMinute)).toEqual([
      servedAt(0),
      servedAt(85),
      servedAt(170),
    ])
    expect(served.longestWaitSeconds).toBe(170)
    expect(served.lost).toEqual({ cafe: 3, chocolat: 3, croissant: 2 })
  })

  it('serves more at once with more servers, and sooner with faster ones', () => {
    const options = {
      customers: keen(20),
      price: () => cents(300),
      counter: timed(),
    }
    const alone = serve(oneMinute(12), options)
    const two = serve(oneMinute(12), { ...options, counter: timed([1, 1]) })
    const fast = serve(oneMinute(12), { ...options, counter: timed([2]) })
    // Two at the counter: the 12th still finds 9 waiting, against the 11th
    // and 12th with one server.
    expect(alone.leftLine).toBe(2)
    expect(two.leftLine).toBe(1)
    expect(two.longestWaitSeconds).toBe(5 * 85)
    expect(fast.leftLine).toBe(alone.leftLine)
    // 765 s ÷ 2, rounded to the second.
    expect(fast.longestWaitSeconds).toBe(383)
  })

  it('brings the same customers first when the crowd grows, wanting the same', () => {
    const small = serve(weekday(120)).visits
    const big = serve(weekday(240)).visits
    // Those who come the same minute keep the order they were drawn in, so
    // the small crowd's visits come in the same order within the big one's.
    let found = 0
    for (const visit of big) {
      if (found < small.length && sameVisit(visit, small[found])) found += 1
    }
    expect(found).toBe(small.length)
  })

  it('accounts for every visit with the shipped line', () => {
    const served = serve(weekday(240), {
      price: prices({ cafe: 200, chocolat: 250, croissant: 250 }),
      counter: SHIPPED_COUNTER,
    })
    const { visits } = served
    const left = visits.filter(({ outcome }) => outcome === 'leftLine')
    expect(left.length).toBeGreaterThan(0)
    expect(served.leftLine).toBe(left.length)
    let lastServed = 0
    for (const visit of visits) {
      const units = PRODUCTS.reduce((n, p) => n + visit.bought[p], 0)
      if (visit.outcome === 'leftLine') {
        expect(units).toBe(0)
        expect(visit.leftMinute).toBe(visit.arrivalMinute)
        expect(visit.servedMinute).toBeNull()
      } else if (visit.servedMinute === null) {
        expect(['tooExpensive', 'browsed']).toContain(visit.outcome)
        expect(visit.leftMinute).toBeNull()
      } else {
        expect(['bought', 'soldOut']).toContain(visit.outcome)
        expect(visit.leftMinute).toBeNull()
        expect(visit.servedMinute).toBeGreaterThanOrEqual(visit.arrivalMinute)
        expect(visit.servedMinute).toBeGreaterThanOrEqual(lastServed)
        lastServed = visit.servedMinute
      }
    }
    expect(served.longestWaitSeconds).toBeGreaterThanOrEqual(
      served.averageWaitSeconds,
    )
    const total = SEGMENTS.reduce((n, id) => n + served.segments[id].visits, 0)
    expect(total).toBe(visits.length)
  })

  it('waits nothing and loses no one on a day with no customers', () => {
    const served = serve(weekday(0), { counter: SHIPPED_COUNTER })
    expect(served).toMatchObject({
      leftLine: 0,
      averageWaitSeconds: 0,
      longestWaitSeconds: 0,
    })
  })
})

describe('an extra crowd', () => {
  // The base crowd is all aubaine and the extra crowd all chic, so each
  // visit tells which crowd it came from. Every product appeals fully.
  const AUBAINE = { aubaine: 1, habitue: 0, chic: 0 }
  const CHIC = { aubaine: 0, habitue: 0, chic: 1 }
  const base = (customers: number) =>
    weekday(customers, {
      segmentShares: AUBAINE,
      productAppeal: { cafe: 1, chocolat: 1, croissant: 1 },
    })
  const chic = (customers: number): ExtraCrowd => ({
    customers,
    segmentShares: CHIC,
  })
  const from = (served: Served, segment: SegmentId) =>
    served.visits.filter((visit) => visit.segment === segment)

  it('of no one changes nothing', () => {
    const walkIns = weekday(120)
    const alone = serve(walkIns, { counter: SHIPPED_COUNTER })
    const none = serve(walkIns, { counter: SHIPPED_COUNTER, extra: chic(0) })
    expect(none).toEqual(alone)
    expect(
      serve(walkIns, { counter: SHIPPED_COUNTER, extra: chic(0.4) }),
    ).toEqual(alone)
  })

  it('comes on top, drawn after the base customers, who draw as without it', () => {
    const alone = serve(base(120))
    const marketed = serve(base(120), { extra: chic(30) })
    // Ample stock and instant service: the base customers fare the same.
    expect(from(marketed, 'aubaine')).toEqual(alone.visits)
    expect(from(marketed, 'chic')).toHaveLength(30)
    expect(from(marketed, 'habitue')).toEqual([])
    expect(marketed.rngState).toBe(
      advance(alone.rngState, 30 * (2 + PRODUCTS.length)),
    )
    // One line, in arrival order.
    const minutes = marketed.visits.map(({ arrivalMinute }) => arrivalMinute)
    expect(minutes).toEqual([...minutes].sort((a, b) => a - b))
  })

  it('draws its segments by its own shares', () => {
    const shares = { aubaine: 0.1, habitue: 0.3, chic: 0.6 }
    const served = serve(weekday(0), {
      extra: { customers: 5000, segmentShares: shares },
    })
    expect(served.visits).toHaveLength(5000)
    for (const id of SEGMENTS) {
      expect(served.segments[id].visits / 5000).toBeCloseTo(shares[id], 1)
    }
  })

  it('rounds its walk-ins after the same noise as the base crowd', () => {
    expect(serve(weekday(0), { extra: chic(12.4) }).visits).toHaveLength(12)
    expect(serve(weekday(0), { extra: chic(12.6) }).visits).toHaveLength(13)
    const noisy = loadFoodTruckContent({
      ...FOOD_TRUCK,
      walkIns: {
        ...weekday(100),
        noiseStdDevRatio: 0.3,
        dayTypes: {
          ...FOOD_TRUCK.walkIns.dayTypes,
          semaine: {
            ...FOOD_TRUCK.walkIns.dayTypes.semaine,
            customers: 100,
            segmentShares: AUBAINE,
          },
        },
      },
    }).walkIns
    for (const seed of [1, 2, 3, 4, 5]) {
      const served = serve(noisy, { seed, extra: chic(100) })
      expect(from(served, 'chic')).toHaveLength(from(served, 'aubaine').length)
      expect(served.visits.length).not.toBe(200)
    }
  })

  it('brings the same extra customers first when it grows', () => {
    const small = from(serve(base(120), { extra: chic(30) }), 'chic')
    const big = serve(base(120), { extra: chic(60) })
    expect(from(big, 'aubaine')).toEqual(serve(base(120)).visits)
    let found = 0
    for (const visit of from(big, 'chic')) {
      if (found < small.length && sameVisit(visit, small[found])) found += 1
    }
    expect(found).toBe(small.length)
  })

  it('shares the stock with the base customers', () => {
    const customers = keen(5)
    const price = prices({ cafe: 300, chocolat: 300, croissant: 300 })
    const available = stock(60)
    const alone = serve(base(50), { customers, price, available })
    const marketed = serve(base(50), {
      customers,
      price,
      available,
      extra: chic(50),
    })
    expect(alone.sold).toEqual(stock(50))
    expect(alone.segments.aubaine.soldOut).toBe(0)
    // 100 customers each want one of each product, and there are 60.
    expect(marketed.sold).toEqual(available)
    expect(marketed.lost).toEqual(stock(40))
    // The base customers who came after the stock ran out found none.
    expect(marketed.segments.aubaine.soldOut).toBeGreaterThan(0)
    expect(marketed.segments.chic.soldOut).toBeGreaterThan(0)
    expect(
      arrivals({ ...marketed, visits: from(marketed, 'aubaine') }),
    ).toEqual(arrivals(alone))
  })

  it('shares the line with the base customers', () => {
    const customers = keen(5)
    const price = prices({ cafe: 300, chocolat: 300, croissant: 300 })
    const slow = counter({ baseSeconds: 120 })
    const alone = serve(base(120), { customers, price, counter: slow })
    const marketed = serve(base(120), {
      customers,
      price,
      counter: slow,
      extra: chic(120),
    })
    expect(marketed.segments.aubaine.visits).toBe(alone.segments.aubaine.visits)
    const leftAubaine = (served: Served) =>
      from(served, 'aubaine').filter(({ outcome }) => outcome === 'leftLine')
        .length
    expect(leftAubaine(marketed)).toBeGreaterThan(leftAubaine(alone))
    expect(marketed.longestWaitSeconds).toBeGreaterThanOrEqual(
      alone.longestWaitSeconds,
    )
    expect(marketed.leftLine).toBe(
      marketed.visits.filter(({ outcome }) => outcome === 'leftLine').length,
    )
  })
})

describe('the street', () => {
  // As for an extra crowd: the base crowd is all aubaine, marketing's all
  // chic, and every product appeals fully.
  const AUBAINE = { aubaine: 1, habitue: 0, chic: 0 }
  const CHIC = { aubaine: 0, habitue: 0, chic: 1 }
  const base = (customers: number) =>
    weekday(customers, {
      segmentShares: AUBAINE,
      productAppeal: { cafe: 1, chocolat: 1, croissant: 1 },
    })
  const marketing = (customers: number): ExtraCrowd => ({
    customers,
    segmentShares: CHIC,
  })
  const walkIns = (factors: Partial<Record<SegmentId, number>>) => ({
    walkIns: { ...NO_CHANGES.walkIns, ...factors },
  })
  const from = (served: Served, segment: SegmentId) =>
    served.visits.filter((visit) => visit.segment === segment)
  /** Whether `all` holds every visit of `some`, in the same order. */
  const holds = (all: readonly Visit[], some: readonly Visit[]) => {
    let found = 0
    for (const visit of all) {
      if (found < some.length && sameVisit(visit, some[found])) found += 1
    }
    return found === some.length
  }

  it('changes nothing with every factor 1', () => {
    const walkIns = weekday(150)
    expect(serve(walkIns, { changes: NO_CHANGES })).toEqual(serve(walkIns))
    expect(
      serve(walkIns, {
        counter: SHIPPED_COUNTER,
        extra: marketing(20),
        changes: NO_CHANGES,
      }),
    ).toEqual(
      serve(walkIns, { counter: SHIPPED_COUNTER, extra: marketing(20) }),
    )
  })

  it.each([0.65, 0.5, 0.1, 0.99])(
    'keeps round(n × %d) of a cut segment, the others as they were, with the same draws',
    (factor) => {
      const shipped = weekday(300)
      const alone = serve(shipped)
      const cut = serve(shipped, { changes: walkIns({ aubaine: factor }) })
      const before = alone.segments.aubaine.visits
      expect(before).toBeGreaterThan(50)
      expect(cut.segments.aubaine.visits).toBe(Math.round(before * factor))
      expect(from(cut, 'habitue')).toEqual(from(alone, 'habitue'))
      expect(from(cut, 'chic')).toEqual(from(alone, 'chic'))
      expect(holds(alone.visits, cut.visits)).toBe(true)
      expect(cut.rngState).toBe(alone.rngState)
    },
  )

  it('keeps every other customer of a segment at 0.5, the first one first', () => {
    const alone = serve(base(9))
    const cut = serve(base(9), { changes: walkIns({ aubaine: 0.5 }) })
    // round(k / 2) goes up at k = 1, 3, 5, 7 and 9.
    expect(cut.visits).toHaveLength(5)
    expect(cut.rngState).toBe(alone.rngState)
  })

  it('cuts the customers marketing brings too, with the same draws', () => {
    const alone = serve(base(100), { extra: marketing(40) })
    const cut = serve(base(100), {
      extra: marketing(40),
      changes: walkIns({ chic: 0.65 }),
    })
    expect(from(cut, 'chic')).toHaveLength(26)
    expect(from(cut, 'aubaine')).toEqual(from(alone, 'aubaine'))
    expect(cut.rngState).toBe(alone.rngState)
  })

  it('brings the same customers first, then more, when it adds walk-ins', () => {
    const alone = serve(base(120))
    const surged = serve(base(120), { changes: walkIns({ aubaine: 1.5 }) })
    expect(surged.visits).toHaveLength(180)
    expect(holds(surged.visits, alone.visits)).toBe(true)
    expect(surged.rngState).toBe(
      advance(alone.rngState, 60 * (2 + PRODUCTS.length)),
    )
    const more = serve(base(120), { changes: walkIns({ aubaine: 1.8 }) })
    expect(more.visits).toHaveLength(216)
    expect(holds(more.visits, surged.visits)).toBe(true)
  })

  it('adds walk-ins of the segments that marketing brings too, after its own', () => {
    const marketed = serve(base(100), { extra: marketing(40) })
    const surged = serve(base(100), {
      extra: marketing(40),
      changes: walkIns({ chic: 1.5 }),
    })
    expect(from(surged, 'aubaine')).toEqual(from(marketed, 'aubaine'))
    expect(from(surged, 'chic')).toHaveLength(60)
    expect(holds(surged.visits, marketed.visits)).toBe(true)
    expect(surged.rngState).toBe(
      advance(marketed.rngState, 20 * (2 + PRODUCTS.length)),
    )
  })

  it('cuts one segment and adds to another on the same day, with marketing', () => {
    const marketed = serve(base(120), { extra: marketing(30) })
    const changed = serve(base(120), {
      extra: marketing(30),
      changes: walkIns({ aubaine: 0.5, chic: 2 }),
    })
    // The cut takes nothing off what the other segment adds.
    expect(from(changed, 'aubaine')).toHaveLength(60)
    expect(from(changed, 'chic')).toHaveLength(60)
    expect(from(changed, 'habitue')).toEqual([])
    expect(changed.rngState).toBe(
      advance(marketed.rngState, 30 * (2 + PRODUCTS.length)),
    )
    // Marketing's own customers come as they would.
    expect(holds(from(changed, 'chic'), from(marketed, 'chic'))).toBe(true)
  })

  it('adds walk-ins after the same noise as the base crowd', () => {
    const noisy = (seed: number, factor: number) =>
      serve(
        loadFoodTruckContent({
          ...FOOD_TRUCK,
          walkIns: {
            ...FOOD_TRUCK.walkIns,
            noiseStdDevRatio: 0.3,
            dayTypes: {
              ...FOOD_TRUCK.walkIns.dayTypes,
              semaine: {
                ...FOOD_TRUCK.walkIns.dayTypes.semaine,
                customers: 100,
                segmentShares: AUBAINE,
              },
            },
          },
        }).walkIns,
        { seed, changes: walkIns({ aubaine: factor }) },
      )
    for (const seed of [1, 2, 3, 4, 5]) {
      expect(noisy(seed, 2).visits).toHaveLength(
        2 * noisy(seed, 1).visits.length,
      )
    }
  })

  it('changes nothing when a cut and an addition multiply to 1', () => {
    const modifier = (factor: number) => ({
      event: 'essai',
      change: { kind: 'walkIns' as const, factor },
      fromDay: 0,
      lastDay: 0,
    })
    const street = streetOn([modifier(0.5), modifier(2)], 0)
    const shipped = weekday(200)
    expect(serve(shipped, { changes: street })).toEqual(serve(shipped))
  })

  it('draws nothing more for a segment that neither crowd brings', () => {
    const alone = serve(base(50))
    const surged = serve(base(50), { changes: walkIns({ habitue: 3 }) })
    expect(surged).toEqual(alone)
  })

  it('takes away the appeal of a product, with the same draws', () => {
    const shipped = weekday(300)
    const alone = serve(shipped)
    const none = serve(shipped, {
      changes: { appeal: { ...NO_CHANGES.appeal, chocolat: 0 } },
    })
    const less = serve(shipped, {
      changes: { appeal: { ...NO_CHANGES.appeal, chocolat: 0.3 } },
    })
    expect(alone.sold.chocolat).toBeGreaterThan(10)
    expect(none.sold.chocolat).toBe(0)
    expect(less.sold.chocolat).toBeGreaterThan(0)
    expect(less.sold.chocolat).toBeLessThan(alone.sold.chocolat)
    for (const served of [none, less]) {
      expect(served.sold.cafe).toBe(alone.sold.cafe)
      expect(served.sold.croissant).toBe(alone.sold.croissant)
      expect(arrivals(served)).toEqual(arrivals(alone))
      expect(served.rngState).toBe(alone.rngState)
    }
  })

  it('raises what customers will pay, so a price above the reference is no longer too expensive', () => {
    // Every segment's reference is 3 $, and the price 3,20 $; ×1.1 makes it
    // 3,30 $.
    const customers = everyone({ base: 0.5, reference: 300, sensitivity: 4 })
    const price = prices({ cafe: 320, chocolat: 320, croissant: 320 })
    const shipped = weekday(300)
    const alone = serve(shipped, { customers, price })
    const willing = serve(shipped, {
      customers,
      price,
      changes: { willingness: perSegment(() => 1.1) },
    })
    const tooExpensive = (served: Served) =>
      SEGMENTS.reduce(
        (total, id) => total + served.segments[id].tooExpensive,
        0,
      )
    expect(tooExpensive(alone)).toBeGreaterThan(0)
    expect(tooExpensive(willing)).toBe(0)
    for (const product of PRODUCTS) {
      expect(willing.sold[product]).toBeGreaterThan(alone.sold[product])
    }
    expect(arrivals(willing)).toEqual(arrivals(alone))
    expect(willing.rngState).toBe(alone.rngState)
  })

  it('raises what one segment will pay, at its new reference to the cent', () => {
    const customers = everyone({ base: 0.5, reference: 300, sensitivity: 4 })
    // 3,30 $ is the chic customers' new reference: they want each product
    // with a chance of one half, and none finds it too expensive.
    const price = prices({ cafe: 330, chocolat: 330, croissant: 330 })
    const shipped = weekday(600, { segmentShares: CHIC })
    const willing = serve(shipped, {
      customers,
      price,
      changes: { willingness: { ...NO_CHANGES.willingness, chic: 1.1 } },
    })
    const fair = serve(shipped, {
      customers,
      price: prices({ cafe: 300, chocolat: 300, croissant: 300 }),
    })
    expect(willing.segments.chic.tooExpensive).toBe(0)
    expect(willing.sold).toEqual(fair.sold)
    const others = serve(weekday(600, { segmentShares: AUBAINE }), {
      customers,
      price,
      changes: { willingness: { ...NO_CHANGES.willingness, chic: 1.1 } },
    })
    expect(others.segments.aubaine.tooExpensive).toBeGreaterThan(0)
  })

  it('holds a reference price to 1 cent at the least', () => {
    const served = serve(weekday(100), {
      changes: { willingness: perSegment(() => 1e-9) },
    })
    expect(served.visits).toHaveLength(100)
    expect(served.sold).toEqual(stock(0))
  })
})

function sameVisit(a: Visit, b: Visit | undefined): boolean {
  return (
    b !== undefined &&
    a.arrivalMinute === b.arrivalMinute &&
    a.segment === b.segment &&
    PRODUCTS.every((product) => a.bought[product] === b.bought[product])
  )
}

// The issue's acceptance criteria, checked with the shipped content on every
// seed of SEEDS. A line customers may leave is not monotone in general: one
// impatient customer with a big order who leaves can let two patient ones
// with small orders stay. So these hold on every seed checked, not on every
// seed there is.
describe('the line, with the shipped content', () => {
  /** Every seed the criteria are checked on; seed 406 is among them. */
  const SEEDS = Array.from({ length: 1000 }, (_, seed) => seed)

  /** The stock a game opens its first day with. */
  const OPENING_STOCK = stock({ cafe: 300, chocolat: 150, croissant: 70 })

  const PRICE_LEVELS = {
    starting: prices(FOOD_TRUCK.startingDecisions.pricesCents),
    low: prices({ cafe: 200, chocolat: 250, croissant: 250 }),
    lowest: prices({ cafe: 100, chocolat: 150, croissant: 150 }),
  }

  /** The price levels where the shipped crowds already form a line. */
  const BUSY_LEVELS = ['starting', 'low'] as const

  const DAY_TYPES = ['semaine', 'finDeSemaine'] as const

  /** The shipped walk-ins, with each day type's customers × `factor`. */
  function crowds(factor: number, walkIns = FOOD_TRUCK.walkIns): WalkIns {
    const { semaine, finDeSemaine } = walkIns.dayTypes
    return loadFoodTruckContent({
      ...FOOD_TRUCK,
      walkIns: {
        ...walkIns,
        dayTypes: {
          semaine: { ...semaine, customers: semaine.customers * factor },
          finDeSemaine: {
            ...finDeSemaine,
            customers: finDeSemaine.customers * factor,
          },
        },
      },
    }).walkIns
  }

  /** Walk-ins where both day types bring `crowd`, with their own patience. */
  function sameCrowd(crowd: DayType): WalkIns {
    const { walkIns } = FOOD_TRUCK
    const { semaine, finDeSemaine } = walkIns.dayTypes
    return loadFoodTruckContent({
      ...FOOD_TRUCK,
      walkIns: {
        ...walkIns,
        dayTypes: {
          semaine: { ...crowd, patienceMultiplier: semaine.patienceMultiplier },
          finDeSemaine: {
            ...crowd,
            patienceMultiplier: finDeSemaine.patienceMultiplier,
          },
        },
      },
    }).walkIns
  }

  /** How many left the line on `seed`. */
  function leftLineOn(
    seed: number,
    walkIns: WalkIns,
    dayType: (typeof DAY_TYPES)[number],
    price: (product: ProductId) => Cents,
    by: Counter = SHIPPED_COUNTER,
  ): number {
    return serveWalkIns(
      seedRng(seed),
      walkIns,
      dayType,
      CUSTOMERS,
      price,
      OPENING_STOCK,
      by,
    ).leftLine
  }

  /** How many left the line on each of SEEDS. */
  function leftLine(
    walkIns: WalkIns,
    dayType: (typeof DAY_TYPES)[number],
    price: (product: ProductId) => Cents,
    by: Counter = SHIPPED_COUNTER,
  ): number[] {
    return SEEDS.map((seed) => leftLineOn(seed, walkIns, dayType, price, by))
  }

  /** The seeds on which `more` is below `fewer`. */
  function below(more: number[], fewer: number[]): number[] {
    return SEEDS.filter((_, index) => (more[index] ?? 0) < (fewer[index] ?? 0))
  }

  const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0)

  it('sends more customers away when the walk-ins double, never fewer', () => {
    for (const dayType of DAY_TYPES) {
      for (const [level, price] of Object.entries(PRICE_LEVELS)) {
        const usual = leftLine(crowds(1), dayType, price)
        const doubled = leftLine(crowds(2), dayType, price)
        expect(below(doubled, usual), `${dayType}, ${level} prices`).toEqual([])
        expect(sum(doubled), `${dayType}, ${level} prices`).toBeGreaterThan(
          sum(usual),
        )
      }
    }
  })

  it('never sends fewer away on seed 406 when the walk-ins double', () => {
    // Before each customer drew their wants with their arrival, the bigger
    // crowd wanted other things and sent 0 away here against 1.
    const price = PRICE_LEVELS.starting
    expect(SEEDS).toContain(406)
    expect(leftLineOn(406, crowds(2), 'semaine', price)).toBeGreaterThanOrEqual(
      leftLineOn(406, crowds(1), 'semaine', price),
    )
  })

  it('sends fewer customers away with faster service', () => {
    const faster: Record<string, Counter> = {
      'a server at speed 2': counter({}, [2]),
      '30 s + 10 s a unit': counter({ baseSeconds: 30, perItemSeconds: 10 }),
    }
    for (const dayType of DAY_TYPES) {
      for (const level of BUSY_LEVELS) {
        const price = PRICE_LEVELS[level]
        const shipped = leftLine(crowds(2), dayType, price)
        for (const [name, by] of Object.entries(faster)) {
          const quick = leftLine(crowds(2), dayType, price, by)
          const scenario = `${dayType}, ${level} prices, ${name}`
          expect(below(shipped, quick), scenario).toEqual([])
          expect(sum(quick), scenario).toBeLessThan(sum(shipped))
        }
      }
    }
  })

  it('sends weekday customers away from a given line more often than weekend ones', () => {
    for (const crowd of DAY_TYPES) {
      const walkIns = sameCrowd(FOOD_TRUCK.walkIns.dayTypes[crowd])
      for (const level of BUSY_LEVELS) {
        const price = PRICE_LEVELS[level]
        const weekday = leftLine(walkIns, 'semaine', price)
        const weekend = leftLine(walkIns, 'finDeSemaine', price)
        const scenario = `the ${crowd} crowd, ${level} prices`
        expect(below(weekday, weekend), scenario).toEqual([])
        expect(sum(weekday), scenario).toBeGreaterThan(sum(weekend))
      }
    }
  })
})

describe('the owner and the employees at the counter', () => {
  /** Everyone wants one of each product at 3 $; only café is on hand. */
  function busy(servers: readonly Server[]) {
    return serve(weekday(400, { productAppeal: perProduct(() => 1) }), {
      customers: everyone({ base: 1, reference: 300, sensitivity: 4 }),
      price: () => cents(300),
      available: stock({ cafe: 10_000 }),
      counter: { service: TIMES, servers },
    })
  }

  const reached = (served: Served) =>
    served.visits.filter(({ servedMinute }) => servedMinute !== null).length

  it('counts every visit the owner alone served as theirs', () => {
    const served = busy(crew([1]))
    expect(reached(served)).toBeGreaterThan(0)
    expect(served.servedByOwner).toBe(reached(served))
  })

  it("counts none as the owner's when an employee serves alone", () => {
    const served = busy([{ speed: 0.85, owner: false, botchedShare: 0 }])
    expect(reached(served)).toBeGreaterThan(0)
    expect(served.servedByOwner).toBe(0)
    expect(served.botched).toEqual(stock(0))
  })

  it('botches the units each server makes by their own quota', () => {
    const owner: Server = { speed: 1, owner: true, botchedShare: 0.5 }
    const employee: Server = { speed: 0.85, owner: false, botchedShare: 0.25 }
    // Each visit served is made one café, each server's botched by their
    // own count of the units they made.
    const both = busy([owner, employee])
    const byEmployee = reached(both) - both.servedByOwner
    expect(both.servedByOwner).toBeGreaterThan(0)
    expect(byEmployee).toBeGreaterThan(0)
    expect(both.botched.cafe).toBe(
      Math.floor(both.servedByOwner * 0.5) + Math.floor(byEmployee * 0.25),
    )
    const careful = busy([owner, { ...employee, botchedShare: 0 }])
    expect(careful.botched.cafe).toBe(Math.floor(careful.servedByOwner * 0.5))
    const alone = busy([employee])
    expect(alone.botched.cafe).toBe(Math.floor(reached(alone) * 0.25))
  })

  it('shortens the waits with a second server, from the same draws', () => {
    const alone = busy(crew([1]))
    const helped = busy(crew([1, 0.85]))
    expect(helped.rngState).toBe(alone.rngState)
    expect(arrivals(helped)).toEqual(arrivals(alone))
    expect(helped.averageWaitSeconds).toBeLessThan(alone.averageWaitSeconds)
    expect(helped.leftLine).toBeLessThan(alone.leftLine)
    expect(reached(helped)).toBeGreaterThan(reached(alone))
  })
})
