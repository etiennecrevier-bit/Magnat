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
  type WalkIns,
} from '../content/schema.ts'
import {
  SEGMENTS,
  dayTypeOf,
  perSegment,
  purchaseProbability,
  serveWalkIns,
  type Served,
} from './customers.ts'
import { CUSTOMERS, FOOD_TRUCK } from './day.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import { cents, type Cents } from './money.ts'
import { next, seedRng } from './rng.ts'
import type { PerProduct } from './types.ts'

interface Odds {
  base: number
  reference: number
  sensitivity: number
}

interface TooCheap {
  belowRatio: number
  steepness: number
}

function rawSegment(odds: Odds, tooCheap?: TooCheap) {
  return {
    name: 'Test',
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

function prices(set: Partial<Record<ProductId, number>> = {}) {
  return (product: ProductId): Cents =>
    cents(set[product] ?? FOOD_TRUCK.products[product].basePriceCents)
}

function stock(units: number | Partial<Record<ProductId, number>>) {
  return perProduct((product) =>
    typeof units === 'number' ? units : (units[product] ?? 0),
  )
}

const PLENTY = stock(10_000)

function serve(
  walkIns: WalkIns,
  options: {
    seed?: number
    customers?: CustomerContent
    price?: (product: ProductId) => Cents
    available?: PerProduct
  } = {},
): Served {
  return serveWalkIns(
    seedRng(options.seed ?? 42),
    walkIns,
    'semaine',
    options.customers ?? CUSTOMERS,
    options.price ?? prices(),
    options.available ?? PLENTY,
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
    }
  })

  it('makes the same draws whatever the prices and the stock', () => {
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
