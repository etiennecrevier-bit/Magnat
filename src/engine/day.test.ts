import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  loadCustomerContent,
  loadDifficultyContent,
  loadFoodTruckContent,
  type CustomerContent,
  type Difficulty,
  type DifficultyContent,
  type DifficultyId,
  type DayType,
  type DayTypeId,
  type FoodTruckContent,
  type ProductId,
  type RestockRule,
  type Segment,
  type SegmentId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, trialBalance, type JournalEntry } from '../finance/journal.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import { SEGMENTS, dayTypeOf, perSegment } from './customers.ts'
import { CUSTOMERS, DIFFICULTIES, FOOD_TRUCK, currentPrice } from './day.ts'
import { applyDecision } from './decisions.ts'
import { PRODUCTS, inventoryValue, onHand, perProduct } from './inventory.ts'
import { cents, mulRatio } from './money.ts'
import { defaultProfile } from './profile.ts'
import type { Day, DaySummary, GameState, PerProduct } from './types.ts'

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'

const MEMO = {
  permit: 'Permis, stationnement et cuisine',
  insurance: 'Assurances',
  depreciation: 'Amortissement du camion',
  purchases: 'Achat de marchandises',
  sales: 'Ventes au comptant',
  costOfSales: 'Coût des marchandises vendues',
  packaging: 'Emballages',
  cardFees: 'Frais de cartes',
  fuel: 'Carburant et entretien',
  spoilage: 'Marchandises périmées',
}

/**
 * What a day is played with: the truck's numbers, its customers and the
 * ways to start a game.
 */
interface Content {
  truck: FoodTruckContent
  customers: CustomerContent
  difficulties: DifficultyContent
}

const SHIPPED: Content = {
  truck: FOOD_TRUCK,
  customers: CUSTOMERS,
  difficulties: DIFFICULTIES,
}

function byProduct<T>(value: (product: ProductId) => T): Record<ProductId, T> {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, value(product)]),
  ) as Record<ProductId, T>
}

/** A crowd spread evenly over the opening hours, with every product liked. */
function evenCrowd(customers: number): DayType {
  const { semaine } = FOOD_TRUCK.walkIns.dayTypes
  return {
    name: 'Test',
    customers,
    segmentShares: { aubaine: 0.2, habitue: 0.5, chic: 0.3 },
    productAppeal: byProduct(() => 1),
    patienceMultiplier: 1,
    arrivalWeights: semaine.arrivalWeights.map(() => 1),
  }
}

/** What one unit of each product sells for when a game starts. */
const STARTING_PRICES = FOOD_TRUCK.startingDecisions.pricesCents

/** Every ISO weekday, Monday to Sunday. */
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]

/**
 * The baseline the day tests change: the truck opens every day, 120 customers
 * come on weekdays and 80 on weekends, with the same tastes, and every
 * segment's reference price is the starting price. So each customer wants a
 * product with exactly its purchase probability, whatever the segment (see
 * `buying`).
 */
const FLAT: Content = {
  truck: loadFoodTruckContent({
    ...FOOD_TRUCK,
    walkIns: {
      ...FOOD_TRUCK.walkIns,
      dayTypes: { semaine: evenCrowd(120), finDeSemaine: evenCrowd(80) },
    },
    startingDecisions: { ...FOOD_TRUCK.startingDecisions, daysOpen: EVERY_DAY },
  }),
  customers: loadCustomerContent({
    segments: perSegment((id) => ({
      name: CUSTOMERS.segments[id].name,
      products: byProduct((product) => ({
        referencePriceCents: STARTING_PRICES[product],
        purchaseProbability: { cafe: 0.8, chocolat: 0.3, croissant: 0.5 }[
          product
        ],
        sensitivity: 4,
      })),
    })),
  }),
  difficulties: DIFFICULTIES,
}

// Content variants: each change returns new content, and `variant` validates
// the result like the shipped files.
type Change = (content: Content) => Content

/** The flat baseline with `changes` made. */
function variant(...changes: Change[]): Content {
  return validated(changes.reduce((content, change) => change(content), FLAT))
}

/** The shipped content with `changes` made. */
function shipped(...changes: Change[]): Content {
  return validated(
    changes.reduce((content, change) => change(content), SHIPPED),
  )
}

function validated({ truck, customers, difficulties }: Content): Content {
  return {
    truck: loadFoodTruckContent(truck),
    customers: loadCustomerContent(customers),
    difficulties: loadDifficultyContent(difficulties),
  }
}

function truck(change: (truck: FoodTruckContent) => FoodTruckContent): Change {
  return (content) => ({ ...content, truck: change(content.truck) })
}

/** Exactly this many customers each weekday and each weekend day. */
function crowd(weekday: number, weekend = weekday): Change {
  return truck((t) => ({
    ...t,
    walkIns: {
      ...t.walkIns,
      noiseStdDevRatio: 0,
      dayTypes: {
        semaine: { ...t.walkIns.dayTypes.semaine, customers: weekday },
        finDeSemaine: {
          ...t.walkIns.dayTypes.finDeSemaine,
          customers: weekend,
        },
      },
    },
  }))
}

type Odds = Segment['products'][ProductId]

/** Changes every segment's odds for every product. */
function everySegment(
  change: (odds: Odds, product: ProductId) => Odds,
): Change {
  return (content) => ({
    ...content,
    customers: {
      ...content.customers,
      segments: perSegment((id) => {
        const segment = content.customers.segments[id]
        return {
          ...segment,
          products: byProduct((product) =>
            change(segment.products[product], product),
          ),
        }
      }),
    },
  })
}

/** Every segment's chance of buying each product at its reference price. */
function buying(probability: Partial<Record<ProductId, number>>): Change {
  return everySegment((odds, product) => ({
    ...odds,
    purchaseProbability: probability[product] ?? odds.purchaseProbability,
  }))
}

type StartingDecisions = FoodTruckContent['startingDecisions']

/** Changes the decisions a game starts with. */
function deciding(change: Partial<StartingDecisions>): Change {
  return truck((t) => ({
    ...t,
    startingDecisions: { ...t.startingDecisions, ...change },
  }))
}

function restocking(rules: Partial<Record<ProductId, RestockRule>>): Change {
  return truck((t) => ({
    ...t,
    startingDecisions: {
      ...t.startingDecisions,
      restock: { ...t.startingDecisions.restock, ...rules },
    },
  }))
}

function product(
  id: ProductId,
  change: Partial<FoodTruckContent['products'][ProductId]>,
): Change {
  return truck((t) => ({
    ...t,
    products: { ...t.products, [id]: { ...t.products[id], ...change } },
  }))
}

function unitCost(id: ProductId, unitCostCents: number): Change {
  return product(id, { unitCostCents: cents(unitCostCents) })
}

function pricing(id: ProductId, price: number): Change {
  return truck((t) => ({
    ...t,
    startingDecisions: {
      ...t.startingDecisions,
      pricesCents: { ...t.startingDecisions.pricesCents, [id]: cents(price) },
    },
  }))
}

function packaging(id: ProductId, packagingCents: number): Change {
  return product(id, { packagingCents: cents(packagingCents) })
}

function monthlyCosts(permit: number, insurance: number): Change {
  return truck((t) => ({
    ...t,
    monthlyCostsCents: {
      permitParkingAndCommissary: cents(permit),
      insurance: cents(insurance),
    },
  }))
}

function fuel(perOpenDay: number): Change {
  return truck((t) => ({
    ...t,
    fuelAndMaintenancePerOpenDayCents: cents(perOpenDay),
  }))
}

function cards(share: number, feeRate: number): Change {
  return truck((t) => ({ ...t, cardPayments: { share, feeRate } }))
}

/** The truck's price and the months it is depreciated over. */
function truckWorth(priceCents: number, usefulLifeMonths: number): Change {
  return truck((t) => ({
    ...t,
    truck: { priceCents: cents(priceCents), usefulLifeMonths },
  }))
}

/** Changes how a game of difficulty `id` starts. */
function difficulty(id: DifficultyId, change: Partial<Difficulty>): Change {
  return (content) => ({
    ...content,
    difficulties: {
      ...content.difficulties,
      difficulties: {
        ...content.difficulties.difficulties,
        [id]: { ...content.difficulties.difficulties[id], ...change },
      },
    },
  })
}

function buyDaily(quantity: number): RestockRule {
  return { kind: 'buyDaily', quantity }
}

function topUp(whenBelow: number, upTo: number): RestockRule {
  return { kind: 'topUp', whenBelow, upTo }
}

const NO_RESTOCK = restocking(byProduct(() => buyDaily(0)))

/** Day 0 of a game, by default at the default difficulty, Moyen. */
function start(
  content: Content = SHIPPED,
  seed = 42,
  level: DifficultyId = defaultProfile().difficulty,
): GameState {
  return createInitialState(
    seed,
    content.truck,
    { ...defaultProfile(), difficulty: level },
    content.difficulties,
  )
}

/** One tick with this content. */
function step(state: GameState, content: Content): GameState {
  return tick(state, content.truck, content.customers, content.difficulties)
}

/** The state after each of `days` ticks, in order. */
function play(
  days: number,
  content: Content = SHIPPED,
  from: GameState = start(content),
): GameState[] {
  const states: GameState[] = []
  let state = from
  for (let i = 0; i < days; i += 1) {
    state = step(state, content)
    states.push(state)
  }
  return states
}

/** The state after `days` ticks. */
function after(
  days: number,
  content: Content = SHIPPED,
  from: GameState = start(content),
): GameState {
  const state = play(days, content, from).at(-1)
  if (state === undefined) throw new Error('no day played')
  return state
}

function summary(state: GameState): DaySummary {
  if (state.lastDay === null) throw new Error('no day played')
  return state.lastDay
}

function entriesOn(state: GameState, day: Day): JournalEntry[] {
  return state.journal.entries.filter((entry) => entry.day === day)
}

/** The entry with this memo on `day`; fails unless there is exactly one. */
function entry(state: GameState, day: Day, memo: string): JournalEntry {
  const found = entriesOn(state, day).filter((e) => e.memo === memo)
  expect(found).toHaveLength(1)
  return found[0] as JournalEntry
}

/** A two-line entry moving `amount` from `credited` to `debited`. */
function transfer(
  day: Day,
  memo: string,
  debited: AccountCode,
  credited: AccountCode,
  amount: number,
): JournalEntry {
  return {
    day,
    memo,
    lines: [
      { account: debited, debit: cents(amount), credit: cents(0) },
      { account: credited, debit: cents(0), credit: cents(amount) },
    ],
  }
}

function arrivals(state: GameState) {
  return summary(state).visits.map(({ arrivalMinute, segment }) => ({
    arrivalMinute,
    segment,
  }))
}

function units(count: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + count[product], 0)
}

/**
 * Checks the state a tick returned: the day it played is the day before, no
 * entry is dated after it, every lot holds a positive whole number of
 * units, the Stocks account carries the lots' cost and the books balance.
 * The visits come in arrival order within opening hours, each buying at most
 * one unit of each product, and add up to the units sold and to the segments'
 * counts; the revenue is the units sold at `currentPrice`, so the run must
 * not change the prices.
 */
function expectConsistent(state: GameState, content: Content): void {
  const lastDay = summary(state)
  expect(lastDay.day).toBe(state.day - 1)
  expect(state.journal.entries.at(-1)?.day ?? 0).toBeLessThanOrEqual(
    lastDay.day,
  )

  for (const lot of state.inventory) {
    expect(Number.isSafeInteger(lot.quantity)).toBe(true)
    expect(lot.quantity).toBeGreaterThan(0)
  }
  for (const product of PRODUCTS) {
    for (const count of [lastDay.sold, lastDay.lostSales, lastDay.spoiled]) {
      expect(count[product]).toBeGreaterThanOrEqual(0)
    }
  }

  const revenue = PRODUCTS.reduce(
    (total, product) =>
      total + lastDay.sold[product] * currentPrice(state, product),
    0,
  )
  expect(lastDay.revenue).toBe(revenue)

  const { opensAtMinute, closesAtMinute } = content.truck.walkIns
  const minutes = lastDay.visits.map(({ arrivalMinute }) => arrivalMinute)
  expect(minutes).toEqual([...minutes].sort((a, b) => a - b))
  expect(
    minutes.every(
      (minute) => minute >= opensAtMinute && minute < closesAtMinute,
    ),
  ).toBe(true)
  expect(
    lastDay.visits.every(
      ({ bought, outcome }) =>
        PRODUCTS.every((id) => bought[id] === 0 || bought[id] === 1) &&
        (outcome === 'bought') === units(bought) > 0,
    ),
  ).toBe(true)
  expect(
    perProduct((product) =>
      lastDay.visits.reduce((total, { bought }) => total + bought[product], 0),
    ),
  ).toEqual(lastDay.sold)
  const count = (id: SegmentId, outcome?: string) =>
    lastDay.visits.filter(
      (visit) =>
        visit.segment === id &&
        (outcome === undefined || visit.outcome === outcome),
    ).length
  expect(lastDay.segments).toEqual(
    perSegment((id) => ({
      visits: count(id),
      buyers: count(id, 'bought'),
      tooExpensive: count(id, 'tooExpensive'),
      soldOut: count(id, 'soldOut'),
    })),
  )

  expect(balance(state.journal, INVENTORY, { toDay: lastDay.day })).toBe(
    inventoryValue(state.inventory),
  )
  const { totalDebit, totalCredit } = trialBalance(state.journal, lastDay.day)
  expect(totalDebit).toBe(totalCredit)
}

describe('currentPrice', () => {
  it("is each product's price in the decisions", () => {
    for (const product of PRODUCTS) {
      expect(currentPrice(start(), product)).toBe(STARTING_PRICES[product])
    }
    const dearer = start(variant(pricing('chocolat', 425)))
    expect(currentPrice(dearer, 'chocolat')).toBe(425)
  })
})

describe('tick', () => {
  it('plays day 0 first, posting the day in order', () => {
    const content = variant(
      crowd(10),
      buying({ cafe: 1, chocolat: 1, croissant: 0 }),
      restocking({
        cafe: buyDaily(30),
        chocolat: buyDaily(12),
        croissant: buyDaily(7),
      }),
      unitCost('cafe', 40),
      unitCost('chocolat', 55),
      unitCost('croissant', 90),
      packaging('cafe', 20),
      packaging('chocolat', 15),
      packaging('croissant', 5),
      monthlyCosts(150_000, 25_000),
      fuel(2_000),
      cards(0.85, 0.025),
      truckWorth(12_000_000, 120),
    )
    const from = start(content)
    const state = step(from, content)
    const price = (id: ProductId) => currentPrice(from, id)
    const revenue = 10 * price('cafe') + 10 * price('chocolat')
    const cardFees = mulRatio(mulRatio(cents(revenue), 0.85), 0.025)

    expect(state.day).toBe(1)
    // Day 0 is Monday, May 1st: the month's charges come first. Moyen's truck
    // depreciates from its first month; its loan is first paid in June.
    expect(state.journal.entries).toEqual([
      ...from.journal.entries,
      transfer(0, MEMO.permit, '6100', CASH, 150_000),
      transfer(0, MEMO.insurance, '6150', CASH, 25_000),
      transfer(0, MEMO.depreciation, '6400', '1510', 100_000),
      transfer(0, MEMO.purchases, INVENTORY, CASH, 30 * 40 + 12 * 55 + 7 * 90),
      transfer(0, MEMO.sales, CASH, '4000', revenue),
      transfer(0, MEMO.costOfSales, '5000', INVENTORY, 10 * 40 + 10 * 55),
      transfer(0, MEMO.packaging, '5200', CASH, 10 * 20 + 10 * 15),
      transfer(0, MEMO.cardFees, '6500', CASH, cardFees),
      transfer(0, MEMO.fuel, '6200', CASH, 2_000),
      transfer(0, MEMO.spoilage, '5100', INVENTORY, 7 * 90),
    ])
    expect(cardFees).toBeGreaterThan(0)
    expect(state.inventory).toEqual([
      { product: 'cafe', quantity: 20, unitCost: 40, boughtOnDay: 0 },
      { product: 'chocolat', quantity: 2, unitCost: 55, boughtOnDay: 0 },
    ])
    const { segments, visits, ...rest } = summary(state)
    expect(rest).toEqual({
      day: 0,
      sold: { cafe: 10, chocolat: 10, croissant: 0 },
      revenue,
      lostSales: { cafe: 0, chocolat: 0, croissant: 0 },
      spoiled: { cafe: 0, chocolat: 0, croissant: 7 },
    })
    expect(visits).toHaveLength(10)
    for (const visit of visits) {
      expect(visit).toMatchObject({
        bought: { cafe: 1, chocolat: 1, croissant: 0 },
        outcome: 'bought',
      })
    }
    expect(SEGMENTS.reduce((n, id) => n + segments[id].buyers, 0)).toBe(10)
  })

  it('does not mutate its input', () => {
    const state = after(3)
    expect(state.inventory.length).toBeGreaterThan(0)
    const copy = structuredClone(state)
    deepFreeze(state)
    const next = tick(state)
    expect(state).toEqual(copy)
    expect(next.day).toBe(state.day + 1)
  })
})

describe('determinism', () => {
  it('plays the same 30 days, journal and visits, from the same seed', () => {
    const first = play(30)
    const second = play(30)
    expect(second).toEqual(first)
    expect(second.at(-1)?.journal.entries).toEqual(
      first.at(-1)?.journal.entries,
    )
    expect(second.map(summary).map(({ visits }) => visits)).toEqual(
      first.map(summary).map(({ visits }) => visits),
    )
  })

  it('plays different days from another seed', () => {
    const seed42 = after(30)
    const seed43 = after(30, SHIPPED, start(SHIPPED, 43))
    expect(seed43.journal.entries).not.toEqual(seed42.journal.entries)
  })

  it('brings the same customers whatever the prices', () => {
    const dearer = shipped(
      ...PRODUCTS.map((id) => pricing(id, STARTING_PRICES[id] + 100)),
    )
    const base = play(30)
    const other = play(30, dearer)
    expect(other.map(arrivals)).toEqual(base.map(arrivals))
    expect(other.map(({ rngState }) => rngState)).toEqual(
      base.map(({ rngState }) => rngState),
    )
    expect(other.map((state) => summary(state).sold)).not.toEqual(
      base.map((state) => summary(state).sold),
    )
  })
})

describe('the books and the stock', () => {
  it.each([1, 42, 2026])(
    'agree every day for a year from seed %i, with stock never negative',
    (seed) => {
      for (const state of play(365, SHIPPED, start(SHIPPED, seed))) {
        expectConsistent(state, SHIPPED)
      }
    },
  )
})

describe('walk-in demand', () => {
  it('brings weekday traffic Monday to Friday and weekend traffic after', () => {
    const content = variant(
      crowd(120, 80),
      buying({ cafe: 1, chocolat: 0, croissant: 0 }),
      restocking({ cafe: buyDaily(200) }),
    )
    // Day 0 is a Monday.
    const days = play(7, content).map(summary)
    expect(days.map(({ visits }) => visits.length)).toEqual([
      120, 120, 120, 120, 120, 80, 80,
    ])
    expect(days.map(({ sold }) => sold.cafe)).toEqual([
      120, 120, 120, 120, 120, 80, 80,
    ])
  })

  it('counts one visit per walk-in, every one in a segment', () => {
    const content = variant(crowd(37, 23))
    for (const state of play(14, content)) {
      const { visits, segments } = summary(state)
      const weekday = toCalendar(summary(state).day).weekday
      const walkIns = dayTypeOf(weekday) === 'semaine' ? 37 : 23
      expect(visits).toHaveLength(walkIns)
      expect(SEGMENTS.reduce((n, id) => n + segments[id].visits, 0)).toBe(
        walkIns,
      )
      expectConsistent(state, content)
    }
  })

  it('sells what is in stock and counts the rest as lost sales', () => {
    const content = variant(
      crowd(50),
      buying({ cafe: 1, chocolat: 1, croissant: 1 }),
      restocking({
        cafe: buyDaily(30),
        chocolat: buyDaily(20),
        croissant: buyDaily(10),
      }),
      unitCost('cafe', 40),
      unitCost('chocolat', 55),
      unitCost('croissant', 90),
    )
    const state = after(1, content)
    const price = (id: ProductId) => currentPrice(start(content), id)
    const revenue =
      30 * price('cafe') + 20 * price('chocolat') + 10 * price('croissant')

    expect(summary(state)).toMatchObject({
      day: 0,
      sold: { cafe: 30, chocolat: 20, croissant: 10 },
      revenue,
      lostSales: { cafe: 20, chocolat: 30, croissant: 40 },
      spoiled: { cafe: 0, chocolat: 0, croissant: 0 },
    })
    expect(state.inventory).toEqual([])
    expect(entry(state, 0, MEMO.sales)).toEqual(
      transfer(0, MEMO.sales, CASH, '4000', revenue),
    )
    expect(entry(state, 0, MEMO.costOfSales)).toEqual(
      transfer(
        0,
        MEMO.costOfSales,
        '5000',
        INVENTORY,
        30 * 40 + 20 * 55 + 10 * 90,
      ),
    )
  })

  it('serves customers as they arrive, so a stockout hits the later ones', () => {
    const content = variant(
      crowd(30),
      buying({ cafe: 0, chocolat: 0, croissant: 1 }),
      restocking({ croissant: buyDaily(10) }),
    )
    const { visits, lostSales, segments } = summary(after(1, content))
    expect(visits.map(({ outcome }) => outcome)).toEqual([
      ...Array.from({ length: 10 }, () => 'bought'),
      ...Array.from({ length: 20 }, () => 'soldOut'),
    ])
    expect(lostSales.croissant).toBe(20)
    expect(SEGMENTS.reduce((n, id) => n + segments[id].soldOut, 0)).toBe(20)
  })

  it('counts customers a price above their reference kept away', () => {
    // They would buy everything at their reference: a fifth of today's price.
    const content = variant(
      crowd(25),
      buying({ cafe: 1, chocolat: 1, croissant: 1 }),
      everySegment((odds, id) => ({
        ...odds,
        referencePriceCents: cents(Math.round(STARTING_PRICES[id] / 5)),
        sensitivity: 50,
      })),
    )
    const { visits, segments, sold } = summary(after(1, content))
    expect(units(sold)).toBe(0)
    expect(visits.every(({ outcome }) => outcome === 'tooExpensive')).toBe(true)
    expect(SEGMENTS.reduce((n, id) => n + segments[id].tooExpensive, 0)).toBe(
      25,
    )
  })

  it('counts customers who want nothing at their reference as browsing', () => {
    const content = variant(
      crowd(25),
      buying({ cafe: 0, chocolat: 0, croissant: 0 }),
    )
    const { visits, segments } = summary(after(1, content))
    expect(visits.every(({ outcome }) => outcome === 'browsed')).toBe(true)
    for (const id of SEGMENTS) {
      expect(segments[id]).toMatchObject({
        buyers: 0,
        tooExpensive: 0,
        soldOut: 0,
      })
    }
  })
})

describe('prices and crowds over a year', () => {
  // The shipped segments, crowds and days open from seed 42, with so much
  // stock that no sale is ever lost.
  const AMPLE = restocking(byProduct(() => buyDaily(500)))
  const STEP_CENTS = 30
  const PRICES = 6
  const { step } = FOOD_TRUCK.decisionLimits.priceCents

  /** The price habitués find fair for `id`: where the price steps start. */
  function fairPrice(id: ProductId): number {
    return CUSTOMERS.segments.habitue.products[id].referencePriceCents
  }

  /** `price` rounded to a price the player may set. */
  function settable(price: number): number {
    return Math.round(price / step) * step
  }

  interface Year {
    /** Units each segment bought of each product. */
    bought: Record<SegmentId, PerProduct>
    lostSales: number
    /** Visits and units bought, by type of day. */
    crowds: Record<DayTypeId, { visits: number; bought: PerProduct }>
  }

  const years = new Map<string, Year>()

  /** A year of play, with `id` at `price` when given; played once. */
  function yearAt(id?: ProductId, price?: number): Year {
    const key = `${id}@${price}`
    const known = years.get(key)
    if (known !== undefined) return known

    const changes = id === undefined ? [] : [pricing(id, price ?? 0)]
    const content = shipped(AMPLE, ...changes)
    const bought = perSegment(() => byProduct(() => 0))
    const crowds = {
      semaine: { visits: 0, bought: byProduct(() => 0) },
      finDeSemaine: { visits: 0, bought: byProduct(() => 0) },
    }
    let lostSales = 0
    for (const state of play(365, content)) {
      const lastDay = summary(state)
      lostSales += units(lastDay.lostSales)
      expect(lastDay.revenue).toBe(
        PRODUCTS.reduce(
          (total, product) =>
            total + lastDay.sold[product] * currentPrice(state, product),
          0,
        ),
      )
      const day = crowds[dayTypeOf(toCalendar(lastDay.day).weekday)]
      day.visits += lastDay.visits.length
      for (const visit of lastDay.visits) {
        for (const product of PRODUCTS) {
          bought[visit.segment][product] += visit.bought[product]
          day.bought[product] += visit.bought[product]
        }
      }
    }
    const year = { bought, lostSales, crowds }
    years.set(key, year)
    return year
  }

  it.each(PRODUCTS)(
    'sells less %s to every segment at each higher price',
    (id) => {
      const played = Array.from({ length: PRICES }, (_, n) =>
        yearAt(id, settable(fairPrice(id) + n * STEP_CENTS)),
      )
      expect(played.map(({ lostSales }) => lostSales)).toEqual(
        played.map(() => 0),
      )
      for (const segment of SEGMENTS) {
        const sold = played.map(({ bought }) => bought[segment][id])
        expect(sold[PRICES - 1]).toBeGreaterThan(0)
        for (let n = 1; n < PRICES; n += 1) {
          expect(sold[n], `${segment} at step ${n}`).toBeLessThan(
            sold[n - 1] ?? 0,
          )
        }
      }
    },
  )

  it.each(PRODUCTS)(
    'loses more bargain hunters than chic customers when %s costs a fifth more',
    (id) => {
      const fair = fairPrice(id)
      const before = yearAt(id, settable(fair)).bought
      const dearer = yearAt(id, settable(fair * 1.2)).bought
      const drop = (segment: SegmentId) =>
        1 - dearer[segment][id] / before[segment][id]
      expect(drop('aubaine')).toBeGreaterThan(drop('chic'))
      expect(drop('chic')).toBeGreaterThan(0)
    },
  )

  it('sells more hot chocolate per visit on weekends, more coffee on weekdays', () => {
    const { semaine, finDeSemaine } = yearAt().crowds
    const perVisit = (
      day: { visits: number; bought: PerProduct },
      id: ProductId,
    ) => day.bought[id] / day.visits
    expect(perVisit(finDeSemaine, 'chocolat')).toBeGreaterThanOrEqual(
      1.5 * perVisit(semaine, 'chocolat'),
    )
    expect(perVisit(semaine, 'cafe')).toBeGreaterThanOrEqual(
      1.5 * perVisit(finDeSemaine, 'cafe'),
    )
  })
})

describe('restocking', () => {
  it.each(['cafe', 'chocolat'] as const)(
    'tops %s up only once stock falls below the threshold',
    (id) => {
      const base = [
        NO_RESTOCK,
        restocking({ [id]: topUp(10, 25) }),
        buying({ cafe: 0, chocolat: 0, croissant: 0, [id]: 1 }),
        unitCost(id, 40),
      ]
      // Day 0 buys 25 and sells 15; day 1 opens with exactly 10 and sells 1;
      // day 2 opens with 9, below 10, so it buys back up to 25.
      let state = start(variant(...base))
      state = step(state, variant(...base, crowd(15)))
      expect(entry(state, 0, MEMO.purchases)).toEqual(
        transfer(0, MEMO.purchases, INVENTORY, CASH, 25 * 40),
      )
      state = step(state, variant(...base, crowd(1)))
      expect(entriesOn(state, 1).map(({ memo }) => memo)).not.toContain(
        MEMO.purchases,
      )
      expect(onHand(state.inventory, id)).toBe(9)
      state = step(state, variant(...base, crowd(0)))
      expect(entry(state, 2, MEMO.purchases)).toEqual(
        transfer(2, MEMO.purchases, INVENTORY, CASH, 16 * 40),
      )
      expect(onHand(state.inventory, id)).toBe(25)
    },
  )

  it.each(['cafe', 'chocolat'] as const)(
    'costs %s sales first in, first out across lots bought at other prices',
    (id) => {
      // Bought at 10 ¢, then at 20 ¢, and sold once it costs 40 ¢ to buy. Each
      // order is decided the day before it is placed.
      const quiet = [
        NO_RESTOCK,
        restocking({ [id]: buyDaily(3) }),
        buying({ cafe: 0, chocolat: 0, croissant: 0, [id]: 1 }),
      ]
      const order = (state: GameState, quantity: number) =>
        applyDecision(state, {
          kind: 'restock',
          product: id,
          rule: buyDaily(quantity),
        })
      let state = start(variant(...quiet))
      state = order(state, 5)
      state = step(state, variant(...quiet, crowd(0), unitCost(id, 10)))
      state = order(state, 0)
      state = step(state, variant(...quiet, crowd(0), unitCost(id, 20)))
      state = step(state, variant(...quiet, crowd(5), unitCost(id, 40)))

      expect(entry(state, 2, MEMO.costOfSales)).toEqual(
        transfer(2, MEMO.costOfSales, '5000', INVENTORY, 3 * 10 + 2 * 20),
      )
      expect(state.inventory).toEqual([
        { product: id, quantity: 3, unitCost: 20, boughtOnDay: 1 },
      ])
      expect(balance(state.journal, INVENTORY, { toDay: 2 })).toBe(3 * 20)
    },
  )
})

describe('spoilage', () => {
  it('writes overstocked croissants off the same evening', () => {
    const content = variant(
      restocking({ croissant: buyDaily(70) }),
      unitCost('croissant', 90),
    )
    let spoiledAtAll = 0
    for (const state of play(30, content)) {
      const lastDay = summary(state)
      expect(lastDay.spoiled.croissant).toBe(70 - lastDay.sold.croissant)
      expect(onHand(state.inventory, 'croissant')).toBe(0)
      const spoilage = entriesOn(state, lastDay.day).find(
        ({ memo }) => memo === MEMO.spoilage,
      )
      expect(spoilage?.lines[0]?.debit ?? 0).toBe(
        lastDay.spoiled.croissant * 90,
      )
      spoiledAtAll += lastDay.spoiled.croissant
    }
    expect(spoiledAtAll).toBeGreaterThan(0)
  })

  it('writes off a whole day of croissants nobody buys', () => {
    const content = variant(
      buying({ croissant: 0 }),
      restocking({ croissant: buyDaily(70) }),
      unitCost('croissant', 90),
    )
    const state = after(1, content)
    expect(state.lastDay?.spoiled).toEqual({
      cafe: 0,
      chocolat: 0,
      croissant: 70,
    })
    expect(entry(state, 0, MEMO.spoilage)).toEqual(
      transfer(0, MEMO.spoilage, '5100', INVENTORY, 70 * 90),
    )
  })

  it('spares coffee and hot chocolate within their first 90 days', () => {
    for (const { lastDay } of play(90)) {
      expect(lastDay?.spoiled.cafe).toBe(0)
      expect(lastDay?.spoiled.chocolat).toBe(0)
    }
  })

  it.each(['cafe', 'chocolat'] as const)(
    'writes off unsold %s at the close of its 90th day',
    (id) => {
      const content = variant(
        NO_RESTOCK,
        buying({ [id]: 0 }),
        restocking({ [id]: topUp(100, 300) }),
        unitCost(id, 40),
      )
      const states = play(91, content)
      states.slice(0, 89).forEach(({ lastDay, inventory }) => {
        expect(lastDay?.spoiled[id]).toBe(0)
        expect(onHand(inventory, id)).toBe(300)
      })
      const [day89, day90] = states.slice(89)
      if (day89 === undefined || day90 === undefined) throw new Error('no day')
      expect(day89.lastDay?.spoiled[id]).toBe(300)
      expect(day89.inventory).toEqual([])
      expect(entry(day89, 89, MEMO.spoilage)).toEqual(
        transfer(89, MEMO.spoilage, '5100', INVENTORY, 300 * 40),
      )
      expect(entry(day90, 90, MEMO.purchases)).toEqual(
        transfer(90, MEMO.purchases, INVENTORY, CASH, 300 * 40),
      )
    },
  )
})

describe('cash', () => {
  it('may go negative', () => {
    // Difficile with no cash at all, paying the month and a day's fuel.
    const content = variant(
      difficulty('difficile', {
        startingCashCents: cents(0),
        truck: { kind: 'lease', monthlyLeaseCents: cents(180_000) },
      }),
      monthlyCosts(150_000, 25_000),
      fuel(2_000),
      crowd(0),
    )
    const from = start(content, 42, 'difficile')
    expect(from.journal.entries).toEqual([])
    const state = after(1, content, from)
    const purchases = entry(state, 0, MEMO.purchases).lines[0]?.debit ?? 0
    expect(purchases).toBeGreaterThan(0)
    expect(balance(state.journal, CASH, { toDay: 0 })).toBe(
      -(150_000 + 25_000 + 180_000 + purchases + 2_000),
    )
    expect(() => play(30, content, from)).not.toThrow()
  })

  it('moves not at all on a day with nothing to record', () => {
    // Customers come, but with no stock nothing sells, and nothing is owed:
    // no cash paid in, no month to pay, no fuel, and day 0 is no payday.
    const content = variant(
      difficulty('difficile', {
        startingCashCents: cents(0),
        truck: { kind: 'lease', monthlyLeaseCents: cents(0) },
      }),
      monthlyCosts(0, 0),
      fuel(0),
      NO_RESTOCK,
      crowd(10),
      buying({ cafe: 1, chocolat: 1, croissant: 1 }),
    )
    const state = after(1, content, start(content, 42, 'difficile'))
    expect(state.journal.entries).toEqual([])
    const { visits, segments, ...rest } = summary(state)
    expect(rest).toEqual({
      day: 0,
      sold: { cafe: 0, chocolat: 0, croissant: 0 },
      revenue: 0,
      lostSales: { cafe: 10, chocolat: 10, croissant: 10 },
      spoiled: { cafe: 0, chocolat: 0, croissant: 0 },
    })
    expect(visits.map(({ outcome }) => outcome)).toEqual(
      Array.from({ length: 10 }, () => 'soldOut'),
    )
    expect(SEGMENTS.reduce((n, id) => n + segments[id].soldOut, 0)).toBe(10)
  })
})

describe('day properties', () => {
  const rule = fc.oneof(
    fc.integer({ min: 0, max: 150 }).map(buyDaily),
    fc
      .tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }))
      .map(([a, b]) => topUp(Math.min(a, b), Math.max(a, b))),
  )
  const { min, max, step } = FOOD_TRUCK.decisionLimits.priceCents
  const price = fc
    .integer({ min: Math.ceil(min / step), max: Math.floor(max / step) })
    .map((n) => n * step)
  const probability = fc.double({ min: 0, max: 1, noNaN: true })
  const perId = <T>(arbitrary: fc.Arbitrary<T>) =>
    fc.record(byProduct(() => arbitrary))
  const scenario = fc.record({
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    weekday: fc.integer({ min: 0, max: 200 }),
    weekend: fc.integer({ min: 0, max: 200 }),
    noise: fc.double({ min: 0, max: 0.5, noNaN: true }),
    buying: perId(probability),
    price: perId(price),
    rules: perId(rule),
    shelfLife: perId(fc.integer({ min: 1, max: 10 })),
    daysOpen: fc.subarray(EVERY_DAY, { minLength: 1 }),
  })

  it('keep the stock whole and the books in step with it', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const content = shipped(
          crowd(s.weekday, s.weekend),
          truck((t) => ({
            ...t,
            walkIns: { ...t.walkIns, noiseStdDevRatio: s.noise },
          })),
          ...PRODUCTS.map((id) =>
            product(id, { shelfLifeDays: s.shelfLife[id] }),
          ),
          ...PRODUCTS.map((id) => pricing(id, s.price[id])),
          buying(s.buying),
          restocking(s.rules),
          deciding({ daysOpen: s.daysOpen }),
        )
        for (const state of play(40, content, start(content, s.seed))) {
          expectConsistent(state, content)
        }
      }),
      { numRuns: 25 },
    )
  })
})

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  for (const inner of Object.values(value)) deepFreeze(inner)
  Object.freeze(value)
}
