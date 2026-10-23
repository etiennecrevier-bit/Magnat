import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  loadCustomerContent,
  loadDifficultyContent,
  loadEnergyContent,
  loadFoodTruckContent,
  loadPersonalContent,
  type CustomerContent,
  type Difficulty,
  type DifficultyContent,
  type DifficultyId,
  type DayType,
  type DayTypeId,
  type EnergyContent,
  type FinancingContent,
  type FoodTruckContent,
  type PersonalContent,
  type ProductId,
  type RestockRule,
  type Segment,
  type SegmentId,
  type Service,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  balance,
  entriesOf,
  trialBalance,
  type JournalEntry,
} from '../finance/journal.ts'
import {
  cashFlowStatement,
  incomeStatement,
  type StatementLine,
} from '../finance/statements.ts'
import { BAKERY } from './bakery.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import { GROCERS } from './contracts.ts'
import { SEGMENTS, dayTypeOf, perSegment, serveWalkIns } from './customers.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  currentPrice,
  playDay,
} from './day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from './decisions.ts'
import { applyEffect } from './effects.ts'
import { FULL_ENERGY, effectsOf, fatigueOf } from './energy.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING, chargesOn, isFinancingMemo } from './financing.ts'
import { PRODUCTS, inventoryValue, onHand, perProduct } from './inventory.ts'
import { cents, mulRatio, type Cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { LABELS } from './personal.ts'
import { defaultProfile } from './profile.ts'
import { servers } from './service.ts'
import { STAFF } from './staff.ts'
import type { EventEffect } from '../content/schema.ts'
import type {
  Day,
  DaySummary,
  GameState,
  PerProduct,
  StreetModifier,
} from './types.ts'

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'

const MEMO = {
  permit: 'Permis, stationnement et cuisine',
  insurance: 'Assurances',
  depreciation: 'Amortissement du camion',
  purchases: 'Achat de marchandises',
  sales: 'Ventes au comptant',
  costOfSales: 'Coût des marchandises vendues',
  botched: 'Produits ratés',
  packaging: 'Emballages',
  cardFees: 'Frais de cartes',
  fuel: 'Carburant et entretien',
  marketing: 'Marketing',
  spoilage: 'Marchandises périmées',
}

/**
 * What a day is played with: the truck's numbers, its customers, the ways
 * to start a game and what tires the owner.
 */
interface Content {
  truck: FoodTruckContent
  customers: CustomerContent
  difficulties: DifficultyContent
  energy: EnergyContent
  /** The financing's rules, the shipped ones when not given. */
  financing?: FinancingContent
}

const SHIPPED: Content = {
  truck: FOOD_TRUCK,
  customers: CUSTOMERS,
  difficulties: DIFFICULTIES,
  energy: ENERGY,
}

/** An owner nothing tires, so every day plays as rested. */
const TIRELESS = loadEnergyContent({
  ...ENERGY,
  openDayCost: 0,
  costPerCustomerServed: 0,
  debtStress: 0,
})

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

/** Service at the counter that takes no time, so no one leaves the line. */
const INSTANT_SERVICE: FoodTruckContent['service'] = {
  ...FOOD_TRUCK.service,
  baseSeconds: 0,
  perItemSeconds: 0,
}

/**
 * The baseline the day tests change: the truck opens every day, 120 customers
 * come on weekdays and 80 on weekends, with the same tastes, and every
 * segment's reference price is the starting price. So each customer wants a
 * product with exactly its purchase probability, whatever the segment (see
 * `buying`). Service takes no time, so everyone who wants something reaches
 * the counter; the line's tests bring the shipped service back. The owner
 * never tires; the energy's tests bring the shipped energy back.
 */
const FLAT: Content = {
  truck: loadFoodTruckContent({
    ...FOOD_TRUCK,
    walkIns: {
      ...FOOD_TRUCK.walkIns,
      dayTypes: { semaine: evenCrowd(120), finDeSemaine: evenCrowd(80) },
    },
    service: INSTANT_SERVICE,
    startingDecisions: { ...FOOD_TRUCK.startingDecisions, daysOpen: EVERY_DAY },
  }),
  customers: loadCustomerContent({
    segments: perSegment((id) => ({
      name: CUSTOMERS.segments[id].name,
      patienceMinutes: CUSTOMERS.segments[id].patienceMinutes,
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
  energy: TIRELESS,
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

function validated({
  truck,
  customers,
  difficulties,
  energy,
}: Content): Content {
  return {
    truck: loadFoodTruckContent(truck),
    customers: loadCustomerContent(customers),
    difficulties: loadDifficultyContent(difficulties),
    energy: loadEnergyContent(energy),
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

/** Changes what tires the owner and what fatigue does. */
function tiring(change: Partial<EnergyContent>): Change {
  return (content) => ({
    ...content,
    energy: { ...content.energy, ...change },
  })
}

/** Changes how long serving a customer takes at the counter. */
function serving(change: Partial<Service>): Change {
  return truck((t) => ({ ...t, service: { ...t.service, ...change } }))
}

/** Every product at `prices`, from the start of the game. */
function priced(prices: Record<ProductId, number>): Change {
  return deciding({ pricesCents: byProduct((id) => cents(prices[id])) })
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
  return tick(
    state,
    content.truck,
    content.customers,
    content.difficulties,
    PERSONAL,
    content.energy,
    NO_EVENTS,
    DEFIS,
    PERCENTILES,
    BAKERY,
    GROCERS,
    STAFF,
    content.financing ?? FINANCING,
  )
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
 * not change the prices. Those who left the line bought nothing and add up
 * to `leftLine`; the others reached the counter, in arrival order and no
 * sooner than they came, unless they wanted nothing. The visits' botched
 * units add up to the day's, and the owner's energy is within 0 to 100,
 * the night after the close giving some back.
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

  let lastServed = 0
  for (const visit of lastDay.visits) {
    const { arrivalMinute, outcome, servedMinute, leftMinute } = visit
    expect(leftMinute).toBe(outcome === 'leftLine' ? arrivalMinute : null)
    if (outcome === 'bought' || outcome === 'soldOut') {
      expect(servedMinute).toBeGreaterThanOrEqual(
        Math.max(arrivalMinute, lastServed),
      )
      lastServed = servedMinute ?? 0
    } else {
      expect(servedMinute).toBeNull()
    }
  }
  expect(lastDay.leftLine).toBe(
    lastDay.visits.filter(({ outcome }) => outcome === 'leftLine').length,
  )
  expect(lastDay.longestWaitSeconds).toBeGreaterThanOrEqual(
    lastDay.averageWaitSeconds,
  )
  expect(lastDay.averageWaitSeconds).toBeGreaterThanOrEqual(0)

  expect(
    lastDay.visits.reduce((total, { botched }) => total + botched, 0),
  ).toBe(lastDay.botched)
  expect(lastDay.energy).toBeGreaterThanOrEqual(0)
  expect(state.energy).toBeGreaterThanOrEqual(lastDay.energy)
  expect(state.energy).toBeLessThanOrEqual(FULL_ENERGY)

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
      pricedOut: { cafe: 0, chocolat: 0, croissant: 0 },
      spoiled: { cafe: 0, chocolat: 0, croissant: 7 },
      leftLine: 0,
      averageWaitSeconds: 0,
      longestWaitSeconds: 0,
      energy: FULL_ENERGY,
      botched: 0,
      modifiers: [],
      deliveries: [],
      missed: [],
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

describe('the line', () => {
  const LOW_PRICES = { cafe: 200, chocolat: 250, croissant: 250 }

  it('serves the day with servers(state) at the shipped service times', () => {
    // Day 1 is a Tuesday: the truck opens with nothing on hand and buys its
    // starting stock in the morning.
    const content = shipped(priced(LOW_PRICES))
    const from = after(1, content)
    expect(from.inventory).toEqual([])
    const lastDay = summary(step(from, content))
    const expected = serveWalkIns(
      from.rngState,
      FOOD_TRUCK.walkIns,
      'semaine',
      CUSTOMERS,
      (id) => currentPrice(from, id),
      { cafe: 300, chocolat: 150, croissant: 70 },
      {
        service: FOOD_TRUCK.service,
        servers: servers(from, ENERGY),
      },
    )
    expect(lastDay.visits).toEqual(expected.visits)
    expect(lastDay).toMatchObject({
      leftLine: expected.leftLine,
      averageWaitSeconds: expected.averageWaitSeconds,
      longestWaitSeconds: expected.longestWaitSeconds,
    })
    expect(lastDay.longestWaitSeconds).toBeGreaterThan(0)
  })

  it('records who left the line and the waits, with the books in step', () => {
    // Twice as slow as shipped: the morning rush leaves the line.
    const content = shipped(
      priced(LOW_PRICES),
      serving({ baseSeconds: 80, perItemSeconds: 30 }),
    )
    let leftLine = 0
    for (const state of play(14, content)) {
      expectConsistent(state, content)
      leftLine += summary(state).leftLine
    }
    expect(leftLine).toBeGreaterThan(0)
  })

  it('records no line on a closed day', () => {
    // Day 0 is a Monday, when the shipped truck is closed.
    expect(summary(after(1))).toMatchObject({
      visits: [],
      leftLine: 0,
      averageWaitSeconds: 0,
      longestWaitSeconds: 0,
    })
  })
})

describe('marketing', () => {
  const MARKETING: AccountCode = '6300'
  const { awarenessDays, extraCustomersPerSqrtCent: k } = FOOD_TRUCK.marketing

  /** A budget of `budget` a day from the start of the game. */
  function budget(amount: number): Change {
    return deciding({ marketingDailyCents: cents(amount) })
  }

  /** `days` days of `amount` spent, as the marketing history. */
  function spent(amount: number, days = awarenessDays): Cents[] {
    return Array.from({ length: days }, () => cents(amount))
  }

  /** Visits on the day `state` plays, after `history` of marketing. */
  function visitsAfter(
    state: GameState,
    history: readonly Cents[],
    content: Content = SHIPPED,
  ): number {
    const played = playDay(
      { ...state, marketingHistory: history },
      content.truck,
      content.customers,
      content.difficulties,
      PERSONAL,
      content.energy,
    )
    return summary(played).visits.length
  }

  function row(lines: readonly StatementLine[], label: string): number {
    const found = lines.filter((line) => line.label === label)
    expect(found).toHaveLength(1)
    return found[0]?.amount ?? 0
  }

  it('spends the budget each open day, after the fuel', () => {
    const content = variant(crowd(10), budget(2_500))
    const state = after(3, content)
    for (const day of [0, 1, 2]) {
      expect(entry(state, day, MEMO.marketing)).toEqual(
        transfer(day, MEMO.marketing, MARKETING, CASH, 2_500),
      )
      const memos = entriesOn(state, day).map(({ memo }) => memo)
      expect(memos.indexOf(MEMO.marketing)).toBe(memos.indexOf(MEMO.fuel) + 1)
    }
    expect(balance(state.journal, MARKETING, { toDay: 2 })).toBe(7_500)
  })

  it('spends nothing on a closed day, and nothing with a budget of 0', () => {
    // Day 0 is a Monday, when the shipped truck is closed.
    const content = shipped(budget(2_500))
    const state = after(2, content)
    expect(entriesOn(state, 0).map(({ memo }) => memo)).not.toContain(
      MEMO.marketing,
    )
    expect(entry(state, 1, MEMO.marketing)).toEqual(
      transfer(1, MEMO.marketing, MARKETING, CASH, 2_500),
    )
    const none = after(30)
    expect(balance(none.journal, MARKETING, { toDay: 29 })).toBe(0)
    expect(none.journal.entries.map(({ memo }) => memo)).not.toContain(
      MEMO.marketing,
    )
  })

  it("remembers each day's spend, 0 when closed, for the last awarenessDays", () => {
    const content = shipped(budget(2_500))
    const histories = play(10, content).map(
      ({ marketingHistory }) => marketingHistory,
    )
    // Days 0 and 7 are Mondays.
    expect(histories[0]).toEqual([0])
    expect(histories[1]).toEqual([0, 2_500])
    expect(histories[6]).toEqual([0, ...spent(2_500, 6)])
    expect(histories[7]).toEqual([...spent(2_500, 6), 0])
    expect(histories[9]).toEqual([...spent(2_500, 4), 0, 2_500, 2_500])
    expect(playDay(start(content)).marketingHistory).toEqual([0])
  })

  it('brings fewer than double the extra walk-ins for double the budget', () => {
    // The same mornings, after a week at no budget, at B and at 2B. The base
    // customers draw first and the same, so the visits beyond them are
    // marketing's.
    const B = 3_000
    let once = 0
    let twice = 0
    for (let seed = 1; seed <= 40; seed += 1) {
      // Day 1 is a Tuesday, when the shipped truck opens.
      const morning = after(1, SHIPPED, start(SHIPPED, seed))
      const base = visitsAfter(morning, spent(0))
      const extraOnce = visitsAfter(morning, spent(B)) - base
      const extraTwice = visitsAfter(morning, spent(2 * B)) - base
      expect(extraOnce).toBeGreaterThan(0)
      expect(extraTwice).toBeGreaterThan(extraOnce)
      expect(extraTwice).toBeLessThan(2 * extraOnce)
      once += extraOnce
      twice += extraTwice
    }
    expect(twice / once).toBeCloseTo(Math.SQRT2, 1)
  })

  it('raises traffic over a week once started, and lowers it over a week once stopped', () => {
    // No noise and open every day: each day's walk-ins are 100 plus
    // marketing's, k × √awareness, rounded.
    const B = 7_000
    const content = variant(crowd(100), budget(B))
    const expected = (daysSpent: number) =>
      Math.round(k * Math.sqrt((B * daysSpent) / awarenessDays))
    const extra = (state: GameState) => summary(state).visits.length - 100

    const started = play(10, content)
    // Today's spend counts from tomorrow: day 0 brings no one more.
    expect(started.map(extra)).toEqual(
      [0, 1, 2, 3, 4, 5, 6, 7, 7, 7].map(expected),
    )
    const rising = started.slice(0, awarenessDays + 1).map(extra)
    rising.forEach((count, i) => {
      if (i > 0) expect(count).toBeGreaterThan(rising[i - 1] ?? 0)
    })

    // Stopped on day 10, so from day 11, the next morning.
    const stopping = applyDecision(started.at(-1) as GameState, {
      kind: 'marketingDaily',
      budget: cents(0),
    })
    const stopped = play(10, content, stopping)
    expect(stopped.map(extra)).toEqual(
      [7, 7, 6, 5, 4, 3, 2, 1, 0, 0].map(expected),
    )
    expect(expected(1)).toBeGreaterThan(0)
  })

  it('brings mostly chic walk-ins, by the marketing segment shares', () => {
    // No crowd of its own: every visit is marketing's.
    const { max } = FOOD_TRUCK.decisionLimits.marketingDailyCents
    const days = play(70, variant(crowd(0), budget(max))).map(summary)
    const visits = days.flatMap((day) => day.visits)
    expect(visits.length).toBeGreaterThan(2_000)
    const { segmentShares } = FOOD_TRUCK.marketing
    for (const id of SEGMENTS) {
      const share =
        visits.filter(({ segment }) => segment === id).length / visits.length
      expect(share).toBeCloseTo(segmentShares[id], 1)
    }
  })

  it("shows the spend as Marketing on the état des résultats and in Activités d'exploitation", () => {
    // On day 0, the first day spent, the spend brings no one yet, so the
    // books differ from a game without marketing by the spend alone.
    const B = 2_500
    const marketed = after(1, variant(budget(B)))
    const plain = after(1, FLAT)
    const income = (state: GameState) => incomeStatement(state.journal, 0, 0)
    const cash = (state: GameState) => cashFlowStatement(state.journal, 0, 0)

    expect(row(income(marketed).expenses.lines, 'Marketing')).toBe(B)
    expect(row(income(plain).expenses.lines, 'Marketing')).toBe(0)
    expect(income(marketed).netIncome.amount).toBe(
      income(plain).netIncome.amount - B,
    )
    expect(row(cash(marketed).operating.lines, 'Autres charges')).toBe(
      row(cash(plain).operating.lines, 'Autres charges') - B,
    )
    expect(cash(marketed).operating.total.amount).toBe(
      cash(plain).operating.total.amount - B,
    )

    // Four weeks of the shipped truck: six open days a week.
    const month = after(28, shipped(budget(B)))
    expect(
      row(incomeStatement(month.journal, 0, 27).expenses.lines, 'Marketing'),
    ).toBe(24 * B)
  })

  it('plays the same game from the same seed and the same budget', () => {
    const content = shipped(budget(5_000))
    const first = play(30, content)
    expect(play(30, content)).toEqual(first)
    expect(first.at(-1)?.journal.entries).not.toEqual(after(30).journal.entries)
  })
})

describe("the owner's personal account", () => {
  const OWNER_PAY = 'Paie du propriétaire'
  const YEAR = 365

  /**
   * The state after `days` ticks of `content`, with `personal` as the
   * owner's living costs.
   */
  function lived(
    days: number,
    personal: PersonalContent = PERSONAL,
    content: Content = SHIPPED,
    from: GameState = start(content),
  ): GameState {
    let state = from
    for (let i = 0; i < days; i += 1) {
      state = tick(
        state,
        content.truck,
        content.customers,
        content.difficulties,
        personal,
        content.energy,
      )
    }
    return state
  }

  /** Everything of the game but the owner's own money. */
  function business(state: GameState) {
    const { journal, rngState, inventory, lastDay, marketingHistory } = state
    return {
      entries: entriesOf(journal),
      rngState,
      inventory,
      lastDay,
      marketingHistory,
    }
  }

  /** The shipped content, with the owner paid `pay` a week from day 0. */
  function paying(pay: number): Content {
    return shipped(deciding({ ownerWeeklyPayCents: cents(pay) }))
  }

  const FREE = loadPersonalContent({ rentCents: 0, weeklyExpensesCents: 0 })
  const CRUSHING = loadPersonalContent({
    rentCents: 100_000_000,
    weeklyExpensesCents: 10_000_000,
  })

  // Debt reaches the business only by the stress that tires the owner (see
  // the tests below), so these leave it out.
  const UNSTRESSED = tiring({ debtStress: 0 })

  it("posts nothing in the company's books, whatever the living costs", () => {
    const content = shipped(UNSTRESSED)
    const shippedCosts = lived(400, PERSONAL, content)
    const free = lived(400, FREE, content)
    const crushing = lived(400, CRUSHING, content)
    expect(free.personal.cash).toBeGreaterThan(shippedCosts.personal.cash)
    expect(crushing.personal.cash).toBeLessThan(-1_000_000_000)
    expect(crushing.personal.unpaidRents.length).toBeGreaterThan(0)
    expect(business(free)).toEqual(business(shippedCosts))
    expect(business(crushing)).toEqual(business(shippedCosts))
  })

  it("posts nothing in the company's books, whatever the savings", () => {
    const shippedSavings = lived(400, PERSONAL, shipped(UNSTRESSED))
    const broke = lived(
      400,
      PERSONAL,
      shipped(
        UNSTRESSED,
        difficulty('moyen', { startingPersonalCashCents: cents(0) }),
      ),
    )
    const rich = lived(
      400,
      PERSONAL,
      shipped(
        UNSTRESSED,
        difficulty('moyen', { startingPersonalCashCents: cents(100_000_000) }),
      ),
    )
    const { startingPersonalCashCents } = DIFFICULTIES.difficulties.moyen
    expect(rich.personal.cash - shippedSavings.personal.cash).toBe(
      100_000_000 - startingPersonalCashCents,
    )
    expect(broke.personal.cash).toBeLessThan(shippedSavings.personal.cash)
    expect(business(broke)).toEqual(business(shippedSavings))
    expect(business(rich)).toEqual(business(shippedSavings))
  })

  it('stresses the owner each payday in debt, and on no other day', () => {
    // Day 4 is the first Friday, payday. CRUSHING's rent leaves the owner
    // in debt from day 0; FREE never does.
    const thursday = (personal: PersonalContent) =>
      summary(lived(4, personal)).energy
    const friday = (personal: PersonalContent) =>
      summary(lived(5, personal)).energy
    expect(lived(1, CRUSHING).personal.cash).toBeLessThan(0)
    expect(thursday(CRUSHING)).toBe(thursday(FREE))
    expect(friday(FREE) - friday(CRUSHING)).toBeCloseTo(ENERGY.debtStress, 9)
    expect(friday(PERSONAL)).toBe(friday(FREE))
  })

  it('tires an owner in debt sooner, so they serve slower and botch units sooner', () => {
    const everyDay = shipped(deciding({ daysOpen: EVERY_DAY }))
    /** The first day played by a worn-out owner, and the one botching. */
    function firstTired(personal: PersonalContent) {
      let state = start(everyDay)
      let slower: number | null = null
      for (let day = 0; day < 42; day += 1) {
        if (slower === null && (servers(state, ENERGY)[0]?.speed ?? 1) < 1) {
          slower = day
        }
        state = tick(
          state,
          everyDay.truck,
          everyDay.customers,
          everyDay.difficulties,
          personal,
          everyDay.energy,
        )
        if (summary(state).botched > 0) {
          return { slower, botched: day, state }
        }
      }
      throw new Error('The owner never botched a unit')
    }
    const free = firstTired(FREE)
    const inDebt = firstTired(CRUSHING)
    expect(inDebt.slower).not.toBeNull()
    expect(inDebt.slower).toBeLessThan(free.slower ?? 0)
    expect(inDebt.botched).toBeLessThan(free.botched)
    // Until the stress tired them, the two businesses ran the same.
    const before = (state: GameState) =>
      entriesOf(state.journal).filter(({ day }) => day < (inDebt.slower ?? 0))
    expect(before(inDebt.state).length).toBeGreaterThan(0)
    expect(before(inDebt.state)).toEqual(before(free.state))
  })

  it('charges the rent of May on day 0, open or closed', () => {
    const { startingPersonalCashCents } = DIFFICULTIES.difficulties.moyen
    expect(playDay(start()).personal).toEqual({
      cash: startingPersonalCashCents - PERSONAL.rentCents,
      movements: [{ day: 0, label: LABELS.rent, amount: -PERSONAL.rentCents }],
      unpaidRents: startingPersonalCashCents < PERSONAL.rentCents ? [0] : [],
    })
  })

  it('leaves the rent unpaid within the first year at 400 $ a week in Moyen', () => {
    const year = play(YEAR, paying(40_000))
    const { unpaidRents } = (year.at(-1) as GameState).personal
    expect(unpaidRents.length).toBeGreaterThan(0)
    for (const day of unpaidRents) {
      expect(day).toBeLessThan(YEAR)
      expect(toCalendar(day).dayOfMonth).toBe(1)
    }
    expect(year.some((state) => state.personal.cash < 0)).toBe(true)
  })

  it('pays every rent of the first year at 700 $ a week in Moyen, and saves', () => {
    const year = play(YEAR, paying(70_000))
    for (const state of year) {
      expect(state.personal.cash).toBeGreaterThanOrEqual(0)
      expect(state.personal.unpaidRents).toEqual([])
    }
    const { startingPersonalCashCents } = DIFFICULTIES.difficulties.moyen
    expect((year.at(-1) as GameState).personal.cash).toBeGreaterThan(
      startingPersonalCashCents,
    )
  })

  it('brings in each « Salaire » the day the business pays the owner, for the same amount', () => {
    const lowered = applyDecision(lived(100), {
      kind: 'ownerWeeklyPay',
      pay: cents(40_000),
    })
    const state = lived(100, PERSONAL, SHIPPED, lowered)
    const salaries = state.personal.movements
      .filter(({ label }) => label === LABELS.salary)
      .map(({ day, amount }) => ({ day, amount }))
    const paid = entriesOf(state.journal)
      .filter(({ memo }) => memo === OWNER_PAY)
      .map(({ day, lines }) => ({ day, amount: lines[0]?.debit }))
    expect(salaries).toEqual(paid)
    expect(new Set(salaries.map(({ amount }) => amount))).toEqual(
      new Set([FOOD_TRUCK.startingDecisions.ownerWeeklyPayCents, 40_000]),
    )
  })

  it('lives the same year from the same seed', () => {
    const first = lived(YEAR, PERSONAL, paying(40_000))
    expect(lived(YEAR, PERSONAL, paying(40_000)).personal).toEqual(
      first.personal,
    )
  })
})

describe("the owner's energy", () => {
  const LOSSES: AccountCode = '5100'

  /** The shipped truck, open on `weekdays`. */
  function openOn(weekdays: number[]): Content {
    return shipped(deciding({ daysOpen: weekdays }))
  }

  it('ends 8 weeks lower open 7 days a week than 6, and higher open 5', () => {
    // 56 days from a Monday: each game ends after Sunday, which all three
    // open, so none has just rested to full.
    const five = after(56, openOn([3, 4, 5, 6, 7])).energy
    const six = after(56, openOn([2, 3, 4, 5, 6, 7])).energy
    const seven = after(56, openOn(EVERY_DAY)).energy
    expect(seven).toBeLessThan(six)
    expect(five).toBeGreaterThan(six)
    expect(fatigueOf(six, ENERGY)).toBe('rested')
    expect(fatigueOf(seven, ENERGY)).toBe('exhausted')
  })

  it('records the energy at the close, before the night', () => {
    for (const state of play(14, openOn(EVERY_DAY))) {
      expect(state.energy).toBe(
        Math.min(FULL_ENERGY, summary(state).energy + ENERGY.nightRecovery),
      )
    }
    const closed = playDay(after(3, openOn(EVERY_DAY)))
    expect(closed.energy).toBe(summary(closed).energy)
  })

  it('slows service and botches units below each threshold, then not after days off', () => {
    const everyDay = openOn(EVERY_DAY)
    const days = play(42, everyDay)
    const mornings = [start(everyDay), ...days.slice(0, -1)]
    const seen = {
      rested: { days: 0, botched: 0, waited: 0, restedWait: 0 },
      tired: { days: 0, botched: 0, waited: 0, restedWait: 0 },
      exhausted: { days: 0, botched: 0, waited: 0, restedWait: 0 },
    }
    days.forEach((state, day) => {
      const morning = mornings[day] as GameState
      const fatigue = fatigueOf(morning.energy, ENERGY)
      const speed =
        fatigue === 'rested' ? 1 : 1 / (1 + ENERGY[fatigue].serviceTimeIncrease)
      const { botchedShare } = effectsOf(morning.energy, ENERGY)
      expect(servers(morning, ENERGY)).toEqual([
        { speed, owner: true, botchedShare },
      ])
      // The same day played by a rested owner: the same customers.
      const rested = summary(
        playDay(
          { ...morning, energy: FULL_ENERGY },
          everyDay.truck,
          everyDay.customers,
          everyDay.difficulties,
          PERSONAL,
          everyDay.energy,
        ),
      )
      const lastDay = summary(state)
      expect(arrivals(state)).toEqual(
        rested.visits.map(({ arrivalMinute, segment }) => ({
          arrivalMinute,
          segment,
        })),
      )
      expect(rested.botched).toBe(0)
      expect(lastDay.averageWaitSeconds).toBeGreaterThanOrEqual(
        rested.averageWaitSeconds,
      )
      seen[fatigue].days += 1
      seen[fatigue].botched += lastDay.botched
      seen[fatigue].waited += lastDay.averageWaitSeconds
      seen[fatigue].restedWait += rested.averageWaitSeconds
    })
    expect(seen.rested.botched).toBe(0)
    expect(seen.rested.waited).toBe(seen.rested.restedWait)
    for (const fatigue of ['tired', 'exhausted'] as const) {
      expect(seen[fatigue].days).toBeGreaterThan(0)
      expect(seen[fatigue].botched).toBeGreaterThan(0)
      expect(seen[fatigue].waited).toBeGreaterThan(seen[fatigue].restedWait)
    }

    // Day 42 is a Monday. Open Sundays only from day 43: five days off.
    const drained = days.at(-1) as GameState
    expect(fatigueOf(drained.energy, ENERGY)).toBe('exhausted')
    const sundays = applyDecision(drained, { kind: 'daysOpen', weekdays: [7] })
    const week = play(7, everyDay, sundays)
    const sunday = week[5] as GameState
    expect(toCalendar(sunday.day).weekday).toBe(7)
    expect(sunday.energy).toBe(FULL_ENERGY)
    expect(servers(sunday, ENERGY)).toEqual([
      { speed: 1, owner: true, botchedShare: 0 },
    ])
    const played = summary(week[6] as GameState)
    expect(played.visits.length).toBeGreaterThan(0)
    expect(played.botched).toBe(0)
  })

  it('writes botched units off at their own lots’ cost, in the order the counter took them', () => {
    // Two cafés at 40 ¢ on hand, then three more bought at 90 ¢. Three
    // customers want one café each from a tired owner who botches every 2nd
    // unit made: sold at 40 ¢, botched at 40 ¢ and made again at 90 ¢, then
    // sold at 90 ¢. Costing the sales first would give 170 ¢ and 90 ¢.
    const quiet = [
      NO_RESTOCK,
      restocking({ cafe: buyDaily(2) }),
      buying({ cafe: 1, chocolat: 0, croissant: 0 }),
      tiring({ tired: { ...ENERGY.tired, botchedShare: 0.5 } }),
    ]
    // Each order is decided the day before it is placed.
    let state = applyDecision(start(variant(...quiet)), {
      kind: 'restock',
      product: 'cafe',
      rule: buyDaily(3),
    })
    state = step(state, variant(...quiet, crowd(0), unitCost('cafe', 40)))
    const tired = { ...state, energy: ENERGY.tired.below - 1 }
    const content = variant(...quiet, crowd(3), unitCost('cafe', 90))
    state = step(tired, content)

    expect(summary(state)).toMatchObject({
      sold: { cafe: 3, chocolat: 0, croissant: 0 },
      lostSales: { cafe: 0, chocolat: 0, croissant: 0 },
      botched: 1,
    })
    expect(summary(state).visits.map(({ botched }) => botched)).toEqual([
      0, 1, 0,
    ])
    expect(entry(state, 1, MEMO.costOfSales)).toEqual(
      transfer(1, MEMO.costOfSales, '5000', INVENTORY, 40 + 90 + 90),
    )
    expect(entry(state, 1, MEMO.botched)).toEqual(
      transfer(1, MEMO.botched, LOSSES, INVENTORY, 40),
    )
    // Only the units sold go out in a cup.
    expect(entry(state, 1, MEMO.packaging)).toEqual(
      transfer(
        1,
        MEMO.packaging,
        '5200',
        CASH,
        3 * content.truck.products.cafe.packagingCents,
      ),
    )
    expect(state.inventory).toEqual([
      { product: 'cafe', quantity: 1, unitCost: 90, boughtOnDay: 1 },
    ])
    const memos = entriesOn(state, 1).map(({ memo }) => memo)
    expect(memos.indexOf(MEMO.botched)).toBe(
      memos.indexOf(MEMO.costOfSales) + 1,
    )
    expect(memos.indexOf(MEMO.packaging)).toBe(memos.indexOf(MEMO.botched) + 1)
  })

  it('keeps the books in step with the stock every day of 10 weeks open every day', () => {
    const everyDay = openOn(EVERY_DAY)
    let botched = 0
    for (const state of play(70, everyDay)) {
      expectConsistent(state, everyDay)
      const lastDay = summary(state)
      const writeOffs = entriesOn(state, lastDay.day).filter(
        ({ memo }) => memo === MEMO.botched,
      )
      expect(writeOffs).toHaveLength(lastDay.botched > 0 ? 1 : 0)
      for (const { lines } of writeOffs) {
        expect(lines.map(({ account }) => account)).toEqual([LOSSES, INVENTORY])
      }
      botched += lastDay.botched
    }
    expect(botched).toBeGreaterThan(0)
  })

  it('plays a rested 6-day week exactly as an owner nothing tires', () => {
    const tireless = shipped(tiring(TIRELESS))
    const tired = play(56, SHIPPED)
    const fresh = play(56, tireless)
    expect(tired.map(({ journal }) => entriesOf(journal))).toEqual(
      fresh.map(({ journal }) => entriesOf(journal)),
    )
    expect(tired.map(({ rngState }) => rngState)).toEqual(
      fresh.map(({ rngState }) => rngState),
    )
    expect(tired.at(-1)?.energy).toBeLessThan(FULL_ENERGY)
  })
})

describe('prices and crowds over a year', () => {
  // The shipped segments, crowds and days open from seed 42, with so much
  // stock that no sale is ever lost. Its cost takes the encaisse far below
  // zero, so no bankruptcy ends the year (#160).
  const AMPLE = restocking(byProduct(() => buyDaily(500)))
  const NO_BANKRUPTCY: FinancingContent = {
    ...FINANCING,
    bankruptcy: { ...FINANCING.bankruptcy, months: Number.MAX_SAFE_INTEGER },
  }
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
    const content = {
      ...shipped(AMPLE, ...changes),
      financing: NO_BANKRUPTCY,
    }
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
      pricedOut: { cafe: 0, chocolat: 0, croissant: 0 },
      spoiled: { cafe: 0, chocolat: 0, croissant: 0 },
      leftLine: 0,
      averageWaitSeconds: 0,
      longestWaitSeconds: 0,
      energy: FULL_ENERGY,
      botched: 0,
      modifiers: [],
      deliveries: [],
      missed: [],
    })
    expect(visits.map(({ outcome }) => outcome)).toEqual(
      Array.from({ length: 10 }, () => 'soldOut'),
    )
    expect(SEGMENTS.reduce((n, id) => n + segments[id].soldOut, 0)).toBe(10)
  })
})

describe('changes to the street', () => {
  /** Plays the day of `state` with `content`, to its close. */
  function close(state: GameState, content: Content): GameState {
    return playDay(
      state,
      content.truck,
      content.customers,
      content.difficulties,
      PERSONAL,
      content.energy,
    )
  }

  /** `state` with `effect` of `event` applied on its morning. */
  function changed(
    state: GameState,
    effect: EventEffect,
    event: string,
    content: Content,
  ): GameState {
    return applyEffect(state, effect, content.truck, event)
  }

  const events = (state: GameState) =>
    summary(state).modifiers.map(({ event }) => event)

  it('cuts the walk-ins of construction on its 15 days only, from the same seed', () => {
    // Open every day, so every day has walk-ins to cut.
    const content = shipped(deciding({ daysOpen: EVERY_DAY }))
    const morning = after(10, content)
    const days = 30
    const usual = play(days, content, morning)
    const works = play(
      days,
      content,
      changed(
        morning,
        { kind: 'walkIns', factor: 0.65, days: 15 },
        'chantier',
        content,
      ),
    )
    usual.forEach((state, index) => {
      const was = summary(state)
      const now = summary(works[index] as GameState)
      expect(now.day).toBe(10 + index)
      if (now.day <= 24) {
        expect(now.visits.length).toBeLessThan(was.visits.length)
        for (const id of SEGMENTS) {
          expect(now.segments[id].visits).toBe(
            Math.round(was.segments[id].visits * 0.65),
          )
        }
        expect(events(works[index] as GameState)).toEqual(['chantier'])
      } else {
        expect(
          now.visits.map(({ arrivalMinute, segment }) => [
            arrivalMinute,
            segment,
          ]),
        ).toEqual(
          was.visits.map(({ arrivalMinute, segment }) => [
            arrivalMinute,
            segment,
          ]),
        )
        expect(now.modifiers).toEqual([])
      }
      // The cut never moves the generator.
      expect(works[index]?.rngState).toBe(state.rngState)
    })
    expect(works.at(-1)?.events.modifiers).toEqual([])
  })

  it('sells no café while it is unavailable: who wanted one found it sold out, and none is bought', () => {
    // Café topped up to 500 each morning, so some is on hand and some bought.
    const content = variant(restocking({ cafe: topUp(500, 500) }))
    const morning = after(5, content)
    const day = morning.day
    const usual = close(morning, content)
    const broken = close(
      changed(
        morning,
        { kind: 'unavailable', product: 'cafe', days: 1 },
        'machine',
        content,
      ),
      content,
    )
    const was = summary(usual)
    const now = summary(broken)
    expect(was.sold.cafe).toBeGreaterThan(0)
    expect(now.sold.cafe).toBe(0)
    expect(now.lostSales.cafe).toBe(was.sold.cafe + was.lostSales.cafe)
    expect(now.sold.chocolat).toBe(was.sold.chocolat)
    expect(now.sold.croissant).toBe(was.sold.croissant)
    // The same customers, wanting the same things.
    expect(now.visits).toHaveLength(was.visits.length)
    let onlyCafe = 0
    now.visits.forEach((visit, index) => {
      const before = was.visits[index]
      expect(visit.bought).toEqual({ ...before?.bought, cafe: 0 })
      if (
        before?.bought.cafe === 1 &&
        before.bought.chocolat + before.bought.croissant === 0
      ) {
        onlyCafe += 1
        expect(visit.outcome).toBe('soldOut')
      }
    })
    expect(onlyCafe).toBeGreaterThan(0)
    const soldOut = (summed: DaySummary) =>
      SEGMENTS.reduce((total, id) => total + summed.segments[id].soldOut, 0)
    expect(soldOut(now)).toBe(soldOut(was) + onlyCafe)
    // None bought, and the café on hand stays on hand.
    const boughtToday = (state: GameState) =>
      state.inventory.filter(
        ({ product, boughtOnDay }) => product === 'cafe' && boughtOnDay === day,
      )
    expect(boughtToday(usual)).not.toEqual([])
    expect(boughtToday(broken)).toEqual([])
    expect(onHand(broken.inventory, 'cafe')).toBe(
      onHand(morning.inventory, 'cafe'),
    )
    expect(onHand(morning.inventory, 'cafe')).toBeGreaterThan(0)
    const purchase = (state: GameState) =>
      entry(state, day, MEMO.purchases).lines[0]?.debit ?? 0
    const cafeBought = boughtToday(usual).reduce(
      (total, { quantity, unitCost }) => total + quantity * unitCost,
      0,
    )
    expect(purchase(broken)).toBe(purchase(usual) - cafeBought)
  })

  it('closes the truck: no sale, no fuel, no marketing, the energy back, the month and the pay still due', () => {
    const content = shipped(deciding({ marketingDailyCents: cents(2_000) }))
    // Day 123, Friday, September 1st: payday and the month's charges.
    expect(toCalendar(123)).toMatchObject({ weekday: 5, dayOfMonth: 1 })
    const morning = after(123, content)
    expect(morning.day).toBe(123)
    expect(morning.energy).toBeLessThan(FULL_ENERGY)
    const flooded = changed(
      morning,
      { kind: 'closed', days: 1 },
      'inondation',
      content,
    )
    const shut = close(flooded, content)
    // As if Friday were not a day open.
    const dayOff = close(
      {
        ...morning,
        decisions: { ...morning.decisions, daysOpen: [2, 3, 4, 6, 7] },
      },
      content,
    )
    const memos = entriesOn(shut, 123).map(({ memo }) => memo)
    for (const memo of [
      MEMO.sales,
      MEMO.fuel,
      MEMO.purchases,
      MEMO.marketing,
    ]) {
      expect(memos).not.toContain(memo)
    }
    expect(memos).toEqual(
      expect.arrayContaining([
        MEMO.permit,
        MEMO.insurance,
        MEMO.depreciation,
        'Paie du propriétaire',
      ]),
    )
    expect(entriesOn(shut, 123)).toEqual(entriesOn(dayOff, 123))
    expect(summary(shut)).toEqual({
      ...summary(dayOff),
      modifiers: [
        {
          event: 'inondation',
          change: { kind: 'closed' },
          fromDay: 123,
          lastDay: 123,
        },
      ],
    })
    expect(summary(shut).visits).toEqual([])
    expect(shut.energy).toBe(dayOff.energy)
    expect(shut.energy).toBeGreaterThan(morning.energy)
    expect(shut.marketingHistory.at(-1)).toBe(0)
    expect(shut.rngState).toBe(morning.rngState)
    expect(shut.events.modifiers).toEqual([])
    // Saturday opens as the days open say.
    const saturday = close(step(flooded, content), content)
    expect(summary(saturday).visits.length).toBeGreaterThan(0)
    expect(summary(saturday).modifiers).toEqual([])
  })

  it('closes the truck for a day of work: no sale, and the energy of an open day with nobody served', () => {
    const content = shipped()
    const { openDayCost, closedDayRecovery } = content.energy
    // Day 122, a Thursday, the truck open; day 126, a Monday, closed.
    expect(toCalendar(122).weekday).toBe(4)
    expect(toCalendar(126).weekday).toBe(1)
    const thursday = after(122, content)
    const monday = after(4, content, thursday)
    expect([thursday.day, monday.day]).toEqual([122, 126])
    for (const morning of [thursday, monday]) {
      const shut = (effect: EventEffect) =>
        close(changed(morning, effect, 'grosseCommande', content), content)
      const working = shut({ kind: 'closed', days: 1, work: true })
      const resting = shut({ kind: 'closed', days: 1 })
      expect(summary(working).visits).toEqual([])
      expect(entriesOn(working, morning.day)).toEqual(
        entriesOn(resting, morning.day),
      )
      expect(working.energy).toBe(morning.energy - openDayCost)
      expect(resting.energy).toBe(
        Math.min(FULL_ENERGY, morning.energy + closedDayRecovery),
      )
    }
  })

  it('multiplies the changes of a day: ×0.5 and ×2 play the very day without them', () => {
    const content = variant()
    const morning = after(3, content)
    const both = changed(
      changed(
        morning,
        { kind: 'walkIns', factor: 0.5, days: 2 },
        'chantier',
        content,
      ),
      { kind: 'walkIns', factor: 2, days: 2 },
      'festival',
      content,
    )
    const usual = play(3, content, morning)
    const changedDays = play(3, content, both)
    usual.forEach((state, index) => {
      const now = changedDays[index] as GameState
      expect({ ...summary(now), modifiers: [] }).toEqual(summary(state))
      expect(now.journal.entries).toEqual(state.journal.entries)
    })
    expect(changedDays.map(events)).toEqual([
      ['chantier', 'festival'],
      ['chantier', 'festival'],
      [],
    ])
  })

  it('lists the changes in effect each day with their events, and drops each at the close of its last day', () => {
    const content = variant()
    const morning = [
      { kind: 'appeal', product: 'chocolat', factor: 0.3, days: 1 },
      { kind: 'walkIns', factor: 1.5, segment: 'chic', days: 3 },
      { kind: 'willingness', factor: 1.1, days: 10 },
    ].reduce(
      (state, effect, index) =>
        changed(
          state,
          effect as EventEffect,
          ['canicule', 'festival', 'demenagement'][index] ?? '',
          content,
        ),
      after(3, content),
    )
    const closes = [morning, ...play(3, content, morning)].map((state) =>
      close(state, content),
    )
    expect(closes.map(events)).toEqual([
      ['canicule', 'festival', 'demenagement'],
      ['festival', 'demenagement'],
      ['festival', 'demenagement'],
      ['demenagement'],
    ])
    const kept = (state: GameState) =>
      state.events.modifiers.map(({ event }) => event)
    expect(closes.map(kept)).toEqual([
      ['festival', 'demenagement'],
      ['festival', 'demenagement'],
      ['demenagement'],
      ['demenagement'],
    ])
    const willing: StreetModifier = {
      event: 'demenagement',
      change: { kind: 'willingness', factor: 1.1 },
      fromDay: 3,
      lastDay: 12,
    }
    expect(closes[3]?.events.modifiers).toEqual([willing])
    expect(summary(closes[3] as GameState).modifiers).toEqual([willing])
  })

  it('cuts the chocolat a heat wave makes less appealing, that day only', () => {
    const content = variant()
    const morning = after(3, content)
    const hot = close(
      changed(
        morning,
        { kind: 'appeal', product: 'chocolat', factor: 0.3, days: 1 },
        'canicule',
        content,
      ),
      content,
    )
    const usual = close(morning, content)
    expect(summary(hot).sold.chocolat).toBeLessThan(
      summary(usual).sold.chocolat,
    )
    expect(summary(hot).sold.cafe).toBe(summary(usual).sold.cafe)
    expect(arrivals(hot)).toEqual(arrivals(usual))
    expect(hot.rngState).toBe(usual.rngState)
  })
})

describe('the staff', () => {
  const BAKING: readonly DecisionChange[] = [
    { kind: 'openBakery', oven: 'louer' },
    { kind: 'croissantSource', source: 'fabriquer' },
  ]
  const AT_TRUCK: DecisionChange = {
    kind: 'hire',
    role: 'camion',
    candidate: 'amelie',
  }
  const BAKER: DecisionChange = {
    kind: 'hire',
    role: 'boulanger',
    candidate: 'sophie',
  }

  /** A shipped game of seed 42 with `changes` in effect from day 0. */
  function staffed(...changes: readonly DecisionChange[]): GameState {
    const state = changes.reduce(
      (next, change) => applyDecision(next, change),
      createInitialState(42),
    )
    return {
      ...state,
      decisions: latestDecisions(state),
      pendingDecisions: null,
    }
  }

  /** Day 1, a Tuesday, open, played from `state`'s day 0, the owner away. */
  function tuesdayAway(state: GameState, energy?: number): GameState {
    const morning = tick(state)
    return playDay({
      ...morning,
      ownerAway: true,
      energy: energy ?? morning.energy,
    })
  }

  it('sells with an employee at the truck while the owner is away all day, and their energy holds', () => {
    const game = staffed(AT_TRUCK)
    const morning = tick(game)
    const close = tuesdayAway(game, 10)
    const day = summary(close)
    expect(day.revenue).toBeGreaterThan(0)
    expect(day.visits.length).toBeGreaterThan(0)
    // An employee never tires, so they botch no more, however tired the
    // owner: their own share, by their minutie.
    expect(day.botched).toBe(summary(tuesdayAway(game, 100)).botched)
    expect(close.energy).toBe(10)
    expect(day.energy).toBe(10)
    // The owner there, they serve too, and tire.
    expect(playDay(morning).energy).toBeLessThan(morning.energy)
  })

  it('keeps the truck closed while the owner is away with nobody at the truck', () => {
    const game = staffed()
    const morning = tick(game)
    const close = tuesdayAway(game)
    const day = summary(close)
    expect(day.visits).toEqual([])
    expect(day.revenue).toBe(0)
    expect(close.rngState).toBe(morning.rngState)
    expect(close.energy).toBe(morning.energy)
    expect(entriesOn(close, 1).map(({ memo }) => memo)).toEqual([])
    expect(close.weekSoFar.days.at(-1)).toMatchObject({ day: 1, open: false })
  })

  it('posts the training, the wages each Friday after the owner pay, then the notice, the books balanced every day', () => {
    const weekly = 1750 * 35
    let state = staffed(AT_TRUCK)
    for (let day = 0; day < 25; day += 1) {
      if (day === 10) {
        state = applyDecision(state, { kind: 'fire', candidate: 'amelie' })
      }
      state = tick(state)
      const { totalDebit, totalCredit } = trialBalance(state.journal, day)
      expect(totalDebit, `day ${day}`).toBe(totalCredit)
    }
    const staffEntries = entriesOf(state.journal).filter(({ memo }) =>
      memo.includes(' · '),
    )
    expect(
      staffEntries.map(({ day, memo, lines }) => [
        day,
        memo,
        lines[0]?.account,
        lines[0]?.debit,
        lines[1]?.account,
        lines[1]?.credit,
      ]),
    ).toEqual([
      [0, 'Formation · Amélie Gagnon', '6000', weekly, CASH, weekly],
      [4, 'Salaire · Amélie Gagnon', '6000', weekly, CASH, weekly],
      [11, 'Préavis · Amélie Gagnon', '6000', 2 * weekly, CASH, 2 * weekly],
    ])
    const friday = entriesOn(state, 4).map(({ memo }) => memo)
    expect(friday.indexOf('Salaire · Amélie Gagnon')).toBe(
      friday.indexOf('Paie du propriétaire') + 1,
    )
    // Fired on day 10, gone from day 11: no wage on Friday 11 or after.
    expect(toCalendar(11).weekday).toBe(5)
    expect(state.staff).toEqual([])
  })

  it('bakes for the truck with a baker, at no energy to the owner', () => {
    const withBaker = tick(staffed(...BAKING, BAKER))
    const without = tick(staffed(...BAKING))
    expect(withBaker.energy).toBe(without.energy)
    const baked = playDay(withBaker)
    const alone = playDay(without)
    expect(baked.lastDay?.sold.croissant).toBeGreaterThan(0)
    expect(baked.lastDay?.sold).toEqual(alone.lastDay?.sold)
    expect(baked.energy - alone.energy).toBeCloseTo(BAKERY.bakingEnergyCost, 10)
  })

  it('makes no croissant, and buys none, when the bakery runs but nobody bakes', () => {
    const close = tuesdayAway(staffed(...BAKING, AT_TRUCK))
    const day = summary(close)
    expect(day.revenue).toBeGreaterThan(0)
    expect(day.sold.croissant).toBe(0)
    expect(day.lostSales.croissant).toBeGreaterThan(0)
    expect(
      close.inventory.filter(
        ({ product, boughtOnDay }) =>
          product === 'croissant' && boughtOnDay === 1,
      ),
    ).toEqual([])
    expect(
      entriesOn(close, 1)
        .map(({ memo }) => memo)
        .filter((memo) => memo === 'Ingrédients du fournil'),
    ).toEqual([])
    // With a baker, the owner away, the truck has its croissants.
    const baked = summary(tuesdayAway(staffed(...BAKING, AT_TRUCK, BAKER)))
    expect(baked.sold.croissant).toBeGreaterThan(0)
  })
})

describe('the financing (#159)', () => {
  const LENDER = 'Caisse populaire Saint-Prudent'
  // The morning of October 1st, day 153, at Moyen, with 5 000 $ lent and
  // shares sold on day 100.
  const morning = after(153)
  const financed: GameState = {
    ...morning,
    financing: {
      ...morning.financing,
      loans: [
        {
          day: 100,
          lender: LENDER,
          principal: cents(500_000),
          annualRateBasisPoints: 1800,
          termMonths: 12,
          fee: cents(10_000),
        },
      ],
      shareSales: [
        {
          day: 100,
          investor: 'Duvent Capital',
          amount: cents(2_000_000),
          share: 0.2,
        },
      ],
    },
  }
  const financingOn = (state: GameState, day: Day) =>
    entriesOn(state, day).filter(({ memo }) => isFinancingMemo(memo))

  it("pays the emergency loans, then the dividends, on the 1st, right after the month's charges", () => {
    expect(toCalendar(153)).toMatchObject({ month: 10, dayOfMonth: 1 })
    const closed = playDay(financed)
    const due = chargesOn(closed.journal, financed.financing, 153)
    expect(due.map(({ memo }) => memo)).toEqual([
      `Intérêts · ${LENDER}`,
      `Remboursement · ${LENDER}`,
      'Dividende · Duvent Capital',
    ])
    const memos = entriesOn(closed, 153).map(({ memo }) => memo)
    const from = memos.indexOf('Amortissement du camion') + 1
    expect(memos.slice(from, from + due.length)).toEqual(
      due.map(({ memo }) => memo),
    )
    expect(financingOn(closed, 153)).toEqual(due)
  })

  it('pays nothing on another day, nor without any financing', () => {
    expect(financingOn(playDay({ ...financed, day: 154 }), 154)).toEqual([])
    expect(financingOn(playDay(morning), 153)).toEqual([])
  })

  it('keeps the first close below zero while the closes stay below, and forgets it at one above', () => {
    expect(playDay(morning).financing.belowZeroSince).toBeNull()
    const cash = balance(morning.journal, CASH, { toDay: 153 })
    const billed = applyEffect(
      morning,
      {
        kind: 'charge',
        amountCents: cents(cash + 500_000),
        description: 'Facture',
      },
      FOOD_TRUCK,
      'test',
    )
    const broke = playDay(billed)
    expect(broke.financing.belowZeroSince).toBe(153)
    const still = playDay({ ...broke, day: 154 })
    expect(still.financing.belowZeroSince).toBe(153)
    const saved = applyEffect(
      { ...still, day: 155 },
      {
        kind: 'cashSale',
        amountCents: cents(1_000_000),
        description: 'Vente',
      },
      FOOD_TRUCK,
      'test',
    )
    expect(playDay(saved).financing.belowZeroSince).toBeNull()
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
