import { describe, expect, it } from 'vitest'
import {
  loadCustomerContent,
  loadFoodTruckContent,
  type CustomerContent,
  type FoodTruckContent,
  type ProductId,
  type RestockRule,
} from '../content/schema.ts'
import type { JournalEntry } from '../finance/journal.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import { perSegment } from './customers.ts'
import { CUSTOMERS, FOOD_TRUCK, currentPrice } from './day.ts'
import {
  applyDecision,
  latestDecisions,
  startingDecisions,
  validateDecisions,
  type DecisionChange,
} from './decisions.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import type { Cents } from './money.ts'
import type {
  Day,
  DaySummary,
  Decisions,
  GameState,
  PerProduct,
} from './types.ts'

const SEED = 42
const STARTING = FOOD_TRUCK.startingDecisions
const LIMITS = FOOD_TRUCK.decisionLimits
const EVERY_DAY = [1, 2, 3, 4, 5, 6, 7]
const NONE = perProduct(() => 0)

const MEMO = {
  purchases: 'Achat de marchandises',
  sales: 'Ventes au comptant',
  costOfSales: 'Coût des marchandises vendues',
  fixedCosts: 'Loyer, permis, carburant et entretien',
  spoilage: 'Marchandises périmées',
}

type StartingDecisions = FoodTruckContent['startingDecisions']

/** The shipped truck with these starting decisions changed, as raw content. */
function truck(
  decisions: Partial<Record<keyof StartingDecisions, unknown>>,
): FoodTruckContent {
  return loadFoodTruckContent({
    ...FOOD_TRUCK,
    startingDecisions: { ...STARTING, ...decisions },
  })
}

/** Day 0 of a shipped game: a Monday, closed under the starting decisions. */
function monday(): GameState {
  return createInitialState(SEED)
}

/** Day 1 of a shipped game: a Tuesday, open. */
function tuesday(): GameState {
  return tick(monday())
}

function summary(state: GameState): DaySummary {
  if (state.lastDay === null) throw new Error('no day played')
  return state.lastDay
}

function memosOn(state: GameState, day: Day): string[] {
  return state.journal.entries
    .filter((entry) => entry.day === day)
    .map(({ memo }) => memo)
}

function entryOn(state: GameState, day: Day, memo: string): JournalEntry {
  const found = state.journal.entries.filter(
    (entry) => entry.day === day && entry.memo === memo,
  )
  expect(found).toHaveLength(1)
  return found[0] as JournalEntry
}

/** What the day's purchases cost; 0 when nothing was bought. */
function purchases(state: GameState, day: Day): number {
  return memosOn(state, day).includes(MEMO.purchases)
    ? (entryOn(state, day, MEMO.purchases).lines[0]?.debit ?? 0)
    : 0
}

function revenueAt(
  sold: PerProduct,
  prices: Readonly<Record<ProductId, number>>,
): number {
  return PRODUCTS.reduce(
    (total, product) => total + sold[product] * prices[product],
    0,
  )
}

/**
 * Checks the day `state` closed was a closed day, played from `before`:
 * nobody came, nothing was bought or sold, the generator did not move, and
 * the fixed costs were still paid.
 */
function expectClosed(state: GameState, before: GameState): void {
  const lastDay = summary(state)
  expect(lastDay.day).toBe(before.day)
  expect(lastDay.visits).toEqual([])
  expect(lastDay.sold).toEqual(NONE)
  expect(lastDay.lostSales).toEqual(NONE)
  expect(lastDay.revenue).toBe(0)
  expect(lastDay.segments).toEqual(
    perSegment(() => ({ visits: 0, buyers: 0, tooExpensive: 0, soldOut: 0 })),
  )
  expect(state.rngState).toBe(before.rngState)
  const memos = memosOn(state, lastDay.day)
  expect(memos).not.toContain(MEMO.purchases)
  expect(memos).not.toContain(MEMO.sales)
  expect(memos).not.toContain(MEMO.costOfSales)
  expect(memos).toContain(MEMO.fixedCosts)
}

function expectOpen(state: GameState): void {
  expect(summary(state).visits.length).toBeGreaterThan(0)
}

/** The quantity of a `buyDaily` rule; fails on any other kind. */
function dailyQuantity(rule: RestockRule): number {
  if (rule.kind !== 'buyDaily') throw new Error(`not buyDaily: ${rule.kind}`)
  return rule.quantity
}

function price(product: ProductId, value: number): DecisionChange {
  return { kind: 'price', product, price: value as Cents }
}

function buyDaily(product: ProductId, quantity: number): DecisionChange {
  return { kind: 'restock', product, rule: { kind: 'buyDaily', quantity } }
}

function topUp(
  product: ProductId,
  whenBelow: number,
  upTo: number,
): DecisionChange {
  return { kind: 'restock', product, rule: { kind: 'topUp', whenBelow, upTo } }
}

function daysOpen(...weekdays: number[]): DecisionChange {
  return { kind: 'daysOpen', weekdays }
}

function ownerWeeklyPay(pay: number): DecisionChange {
  return { kind: 'ownerWeeklyPay', pay: pay as Cents }
}

function marketingDaily(budget: number): DecisionChange {
  return { kind: 'marketingDaily', budget: budget as Cents }
}

/** Expects the change to throw a RangeError whose message names `field`. */
function expectRejected(
  change: DecisionChange,
  field: string,
  state: GameState = monday(),
  content: FoodTruckContent = FOOD_TRUCK,
): void {
  const apply = () => applyDecision(state, change, content)
  expect(apply).toThrow(RangeError)
  expect(apply).toThrow(field)
}

/** The decisions waiting after the change; fails if it was rejected. */
function pendingAfter(
  change: DecisionChange,
  state: GameState = monday(),
  content: FoodTruckContent = FOOD_TRUCK,
): Decisions {
  const next = applyDecision(state, change, content)
  if (next.pendingDecisions === null) throw new Error('nothing pending')
  return next.pendingDecisions
}

describe('the starting decisions', () => {
  it('come from the content, with nothing pending', () => {
    const state = monday()
    expect(state.decisions).toEqual({
      prices: STARTING.pricesCents,
      restock: STARTING.restock,
      daysOpen: STARTING.daysOpen,
      ownerWeeklyPay: STARTING.ownerWeeklyPayCents,
      marketingDaily: STARTING.marketingDailyCents,
    })
    expect(state.decisions).toEqual(startingDecisions())
    expect(state.pendingDecisions).toBeNull()
    expect(latestDecisions(state)).toBe(state.decisions)
  })

  it('order a set number of croissants daily and top drinks up', () => {
    const { restock } = startingDecisions()
    expect(restock.croissant.kind).toBe('buyDaily')
    expect(restock.cafe.kind).toBe('topUp')
    expect(restock.chocolat.kind).toBe('topUp')
  })

  it('keep the weekdays open in ascending order', () => {
    const content = truck({ daysOpen: [7, 2, 5] })
    expect(createInitialState(SEED, content).decisions.daysOpen).toEqual([
      2, 5, 7,
    ])
  })

  it.each([
    ['prices.cafe', { pricesCents: { ...STARTING.pricesCents, cafe: 45 } }],
    ['daysOpen', { daysOpen: [] }],
    ['daysOpen', { daysOpen: [3, 3] }],
    ['ownerWeeklyPay', { ownerWeeklyPayCents: 300_001 }],
  ])(
    'throw when the content starts with %s outside its limits',
    (field, change) => {
      const content = truck(change)
      expect(() => createInitialState(SEED, content)).toThrow(RangeError)
      expect(() => startingDecisions(content)).toThrow(field)
    },
  )
})

describe('applyDecision', () => {
  describe('prices', () => {
    it.each([LIMITS.priceCents.min, 55, 1_000, LIMITS.priceCents.max])(
      'accepts %d cents',
      (value) => {
        expect(pendingAfter(price('cafe', value)).prices.cafe).toBe(value)
      },
    )

    it.each([45, 0, -5, 2_005, 327, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects %d cents',
      (value) => {
        expectRejected(price('cafe', value), 'prices.cafe')
      },
    )

    it('rejects an unknown product', () => {
      expectRejected(price('muffin' as ProductId, 300), 'unknown product')
    })
  })

  describe('restock', () => {
    it.each([0, 1, LIMITS.units.max])('accepts a daily order of %d', (n) => {
      expect(pendingAfter(buyDaily('croissant', n)).restock.croissant).toEqual({
        kind: 'buyDaily',
        quantity: n,
      })
    })

    it.each([-1, 501, 1.5, Number.NaN])('rejects a daily order of %d', (n) => {
      expectRejected(buyDaily('croissant', n), 'restock.croissant.quantity')
    })

    it.each([
      [0, 0],
      [0, 500],
      [40, 120],
      [500, 500],
    ])('accepts topping up when below %d, up to %d', (whenBelow, upTo) => {
      for (const product of ['cafe', 'chocolat'] as const) {
        expect(
          pendingAfter(topUp(product, whenBelow, upTo)).restock[product],
        ).toEqual({ kind: 'topUp', whenBelow, upTo })
      }
    })

    it.each([
      [-1, 10, 'whenBelow'],
      [1.5, 10, 'whenBelow'],
      [Number.NaN, 10, 'whenBelow'],
      [10, 501, 'upTo'],
      [10, 20.5, 'upTo'],
      [10, -1, 'upTo'],
      [501, 501, 'whenBelow'],
      [20, 10, 'whenBelow must not exceed upTo'],
    ])(
      'rejects topping up when below %d, up to %d',
      (whenBelow, upTo, field) => {
        expectRejected(topUp('cafe', whenBelow, upTo), `restock.cafe.${field}`)
      },
    )

    it.each([
      topUp('croissant', 10, 20),
      buyDaily('cafe', 100),
      buyDaily('chocolat', 50),
    ])('keeps the kind of rule a product has: $product', (change) => {
      expectRejected(change, 'must stay a')
    })

    it('rejects an unknown product', () => {
      expectRejected(buyDaily('muffin' as ProductId, 10), 'unknown product')
    })

    it('copies the rule rather than keep the object it was given', () => {
      const rule = { kind: 'buyDaily' as const, quantity: 40 }
      const next = applyDecision(monday(), {
        kind: 'restock',
        product: 'croissant',
        rule,
      })
      rule.quantity = 9_999
      expect(next.pendingDecisions?.restock.croissant).toEqual({
        kind: 'buyDaily',
        quantity: 40,
      })
    })
  })

  describe('days open', () => {
    it.each([[[3]], [EVERY_DAY], [[1, 7]], [[2, 4, 6]]])(
      'accepts %j',
      (weekdays) => {
        expect(pendingAfter(daysOpen(...weekdays)).daysOpen).toEqual(weekdays)
      },
    )

    it('stores the weekdays in ascending order', () => {
      expect(pendingAfter(daysOpen(7, 1)).daysOpen).toEqual([1, 7])
      expect(pendingAfter(daysOpen(6, 2, 4)).daysOpen).toEqual([2, 4, 6])
    })

    it.each([[[]], [[0]], [[8]], [[1, 1]], [[1.5]], [[Number.NaN]], [[-1, 3]]])(
      'rejects %j',
      (weekdays) => {
        expectRejected(daysOpen(...weekdays), 'daysOpen')
      },
    )

    it('copies the weekdays rather than keep the array it was given', () => {
      const weekdays = [2, 3]
      const next = applyDecision(monday(), { kind: 'daysOpen', weekdays })
      weekdays.push(4)
      expect(next.pendingDecisions?.daysOpen).toEqual([2, 3])
    })
  })

  describe("the owner's weekly pay", () => {
    it.each([0, 70_000, LIMITS.ownerWeeklyPayCents.max])(
      'accepts %d cents',
      (pay) => {
        expect(pendingAfter(ownerWeeklyPay(pay)).ownerWeeklyPay).toBe(pay)
      },
    )

    it.each([-1, 300_001, 2.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects %d cents',
      (pay) => {
        expectRejected(ownerWeeklyPay(pay), 'ownerWeeklyPay')
      },
    )
  })

  describe('the daily marketing budget', () => {
    it.each([0, 5_000, LIMITS.marketingDailyCents.max])(
      'accepts %d cents',
      (budget) => {
        expect(pendingAfter(marketingDaily(budget)).marketingDaily).toBe(budget)
      },
    )

    it.each([-1, 20_001, 0.5, Number.NaN, Number.NEGATIVE_INFINITY])(
      'rejects %d cents',
      (budget) => {
        expectRejected(marketingDaily(budget), 'marketingDaily')
      },
    )
  })

  it('rejects an unknown kind of decision', () => {
    const loan = { kind: 'loan', amount: 500 } as unknown as DecisionChange
    expectRejected(loan, 'Unknown decision: loan')
  })

  it('holds the decisions to the limits of the content it is given', () => {
    const content = loadFoodTruckContent({
      ...FOOD_TRUCK,
      startingDecisions: {
        pricesCents: perProduct(() => 200),
        restock: {
          cafe: { kind: 'topUp', whenBelow: 2, upTo: 5 },
          chocolat: { kind: 'topUp', whenBelow: 2, upTo: 5 },
          croissant: { kind: 'buyDaily', quantity: 5 },
        },
        daysOpen: [1, 2, 3],
        ownerWeeklyPayCents: 1_000,
        marketingDailyCents: 0,
      },
      decisionLimits: {
        priceCents: { min: 100, max: 300, step: 25 },
        units: { min: 0, max: 10 },
        ownerWeeklyPayCents: { min: 0, max: 1_000 },
        marketingDailyCents: { min: 0, max: 100 },
        minDaysOpen: 3,
      },
    })
    const state = createInitialState(SEED, content)
    const accepts = (change: DecisionChange) =>
      expect(() => applyDecision(state, change, content)).not.toThrow()

    accepts(price('cafe', 125))
    expectRejected(price('cafe', 110), 'prices.cafe', state, content)
    expectRejected(price('cafe', 325), 'prices.cafe', state, content)
    accepts(buyDaily('croissant', 10))
    expectRejected(buyDaily('croissant', 11), 'quantity', state, content)
    accepts(daysOpen(5, 6, 7))
    expectRejected(daysOpen(6, 7), 'daysOpen', state, content)
    accepts(ownerWeeklyPay(1_000))
    expectRejected(ownerWeeklyPay(1_005), 'ownerWeeklyPay', state, content)
    accepts(marketingDaily(100))
    expectRejected(marketingDaily(105), 'marketingDaily', state, content)
  })

  it('never mutates the state, and leaves the day under way as it was', () => {
    const state = tuesday()
    const copy = structuredClone(state)
    deepFreeze(state)
    const next = applyDecision(state, price('cafe', 500))
    expect(state).toEqual(copy)
    expect(next).not.toBe(state)
    expect(next.decisions).toBe(state.decisions)
    expect(next.pendingDecisions?.prices.cafe).toBe(500)
    expect(currentPrice(next, 'cafe')).toBe(STARTING.pricesCents.cafe)
    expect(() => tick(next)).not.toThrow()
  })

  it('keeps every change made the same day waiting, the latest on top', () => {
    let state = tuesday()
    state = applyDecision(state, price('cafe', 300))
    state = applyDecision(state, ownerWeeklyPay(50_000))
    state = applyDecision(state, price('cafe', 310))
    expect(state.decisions).toEqual(startingDecisions())
    expect(latestDecisions(state)).toBe(state.pendingDecisions)
    expect(state.pendingDecisions).toEqual({
      ...startingDecisions(),
      prices: { ...STARTING.pricesCents, cafe: 310 },
      ownerWeeklyPay: 50_000,
    })
  })

  it('leaves the decisions as they were when a change is rejected', () => {
    const state = applyDecision(tuesday(), price('cafe', 300))
    expect(() => applyDecision(state, price('cafe', 1))).toThrow(RangeError)
    expect(state.pendingDecisions?.prices.cafe).toBe(300)
  })
})

describe('validateDecisions', () => {
  const valid = startingDecisions()

  it('accepts the starting decisions', () => {
    expect(() => validateDecisions(valid, LIMITS)).not.toThrow()
  })

  it.each([
    [
      'prices',
      { ...valid, prices: { cafe: 300, chocolat: 300 } as Decisions['prices'] },
    ],
    [
      'prices',
      {
        ...valid,
        prices: { ...valid.prices, muffin: 300 } as Decisions['prices'],
      },
    ],
    [
      'restock',
      {
        ...valid,
        restock: {
          ...valid.restock,
          croissant: { kind: 'buyWeekly', quantity: 5 },
        } as unknown as Decisions['restock'],
      },
    ],
    ['daysOpen', { ...valid, daysOpen: [3, 2] }],
  ])('rejects decisions a save could hold: %s', (field, decisions) => {
    expect(() => validateDecisions(decisions, LIMITS)).toThrow(RangeError)
    expect(() => validateDecisions(decisions, LIMITS)).toThrow(field)
  })
})

describe('a decision takes effect the next morning', () => {
  it('sells today at the old price and tomorrow at the new one', () => {
    const today = tuesday()
    const changed = applyDecision(today, price('cafe', 500))
    const control = tick(today)

    // Today plays exactly as if nothing had changed.
    const played = tick(changed)
    expect(played.journal).toEqual(control.journal)
    expect(played.lastDay).toEqual(control.lastDay)
    expect(played.rngState).toBe(control.rngState)
    expect(summary(played).revenue).toBe(
      revenueAt(summary(played).sold, today.decisions.prices),
    )

    // The next morning, the new price is in effect and nothing waits.
    expect(played.decisions.prices.cafe).toBe(500)
    expect(played.pendingDecisions).toBeNull()
    const tomorrow = tick(played)
    const { sold, revenue } = summary(tomorrow)
    expect(sold.cafe).toBeGreaterThan(0)
    expect(revenue).toBe(
      revenueAt(sold, { ...STARTING.pricesCents, cafe: 500 }),
    )
    expect(tomorrow.journal).not.toEqual(tick(control).journal)
  })

  it('orders today by the old rule and from tomorrow by the new one', () => {
    const today = tuesday()
    const changed = applyDecision(today, buyDaily('croissant', 20))
    const control = tick(today)

    const played = tick(changed)
    expect(played.journal).toEqual(control.journal)

    const tomorrow = tick(played)
    const fewer = dailyQuantity(STARTING.restock.croissant) - 20
    const { unitCostCents } = FOOD_TRUCK.products.croissant
    expect(purchases(tomorrow, 2)).toBe(
      purchases(tick(control), 2) - fewer * unitCostCents,
    )
    // Croissants keep one day, so the 20 bought are sold or written off.
    const { sold, spoiled } = summary(tomorrow)
    expect(sold.croissant + spoiled.croissant).toBe(20)
  })

  it('keeps a closed day closed when it opens that day, then opens it', () => {
    // On closed Monday, open Mondays and close Tuesdays instead.
    const today = monday()
    const changed = applyDecision(today, daysOpen(1, 3, 4, 5, 6, 7))
    const played = tick(changed)
    expectClosed(played, today)
    expect(played.pendingDecisions).toBeNull()
    expect(played.decisions.daysOpen).toEqual([1, 3, 4, 5, 6, 7])

    // Tuesday now closes, and the next Monday opens.
    let state = played
    const before = state
    state = tick(state)
    expectClosed(state, before)
    for (let day = 2; day <= 7; day += 1) {
      state = tick(state)
      expectOpen(state)
    }
    expect(toCalendar(summary(state).day).weekday).toBe(1)
  })

  it('keeps an open day open when it closes that day', () => {
    // On open Tuesday, close Tuesdays and Wednesdays.
    const today = tuesday()
    const changed = applyDecision(today, daysOpen(4, 5, 6, 7))
    const played = tick(changed)
    expect(played.journal).toEqual(tick(today).journal)
    expectOpen(played)

    const tomorrow = tick(played)
    expectClosed(tomorrow, played)
  })
})

describe('closed days', () => {
  it('bring nobody and buy nothing on Mondays under the starting decisions', () => {
    let state = monday()
    let mondays = 0
    for (let day = 0; day < 28; day += 1) {
      const before = state
      state = tick(state)
      if (toCalendar(day).weekday === 1) {
        expectClosed(state, before)
        mondays += 1
      } else {
        expectOpen(state)
        expect(summary(state).revenue).toBeGreaterThan(0)
      }
    }
    expect(mondays).toBe(4)
  })

  it('still write off the stock whose shelf life ends', () => {
    // Croissants keep two days and nobody buys them, so Sunday's are written
    // off at the close of Monday, when the truck is closed.
    const content = loadFoodTruckContent({
      ...FOOD_TRUCK,
      products: {
        ...FOOD_TRUCK.products,
        croissant: { ...FOOD_TRUCK.products.croissant, shelfLifeDays: 2 },
      },
    })
    const customers = nobodyBuys('croissant')
    let state = createInitialState(SEED, content)
    for (let day = 0; day < 7; day += 1) {
      state = tick(state, content, customers)
    }
    const sunday = state
    state = tick(state, content, customers)

    const ordered = dailyQuantity(STARTING.restock.croissant)
    const { unitCostCents } = content.products.croissant
    expectClosed(state, sunday)
    expect(summary(state).spoiled.croissant).toBe(ordered)
    expect(entryOn(state, 7, MEMO.spoilage).lines[0]?.debit).toBe(
      ordered * unitCostCents,
    )
  })

  it('leave only the one day open to sell when only one is open', () => {
    const content = truck({ daysOpen: [3] })
    let state = createInitialState(SEED, content)
    for (let day = 0; day < 28; day += 1) {
      const before = state
      state = tick(state, content)
      if (toCalendar(day).weekday === 3) {
        expectOpen(state)
        expect(summary(state).revenue).toBeGreaterThan(0)
      } else {
        expectClosed(state, before)
      }
    }
  })
})

describe('determinism with decisions', () => {
  // A scripted player: on each day listed, these changes before the day ends.
  const SCRIPT: readonly { day: Day; change: DecisionChange }[] = [
    { day: 0, change: price('cafe', 300) },
    { day: 3, change: buyDaily('croissant', 40) },
    { day: 5, change: daysOpen(1, 2, 3, 4, 5) },
    { day: 9, change: ownerWeeklyPay(50_000) },
    { day: 9, change: marketingDaily(1_000) },
    { day: 9, change: price('chocolat', 395) },
    { day: 20, change: topUp('cafe', 50, 200) },
    { day: 30, change: daysOpen(2, 4, 6) },
    { day: 41, change: price('croissant', 400) },
    { day: 41, change: topUp('chocolat', 20, 60) },
  ]
  const DAYS = 60

  /** Every state the scripted run reaches, and each day's active prices. */
  function scripted(): { states: GameState[]; prices: Decisions['prices'][] } {
    let state = createInitialState(SEED)
    const states: GameState[] = []
    const prices: Decisions['prices'][] = []
    for (let day = 0; day < DAYS; day += 1) {
      for (const step of SCRIPT.filter((s) => s.day === day)) {
        state = applyDecision(state, step.change)
      }
      prices.push(state.decisions.prices)
      state = tick(state)
      states.push(state)
    }
    return { states, prices }
  }

  it('plays the same days from the same seed and the same decisions', () => {
    const first = scripted()
    const second = scripted()
    expect(second.states).toEqual(first.states)
    expect(second.states.at(-1)?.journal.entries).toEqual(
      first.states.at(-1)?.journal.entries,
    )
  })

  it('sells each day at the prices in effect that morning', () => {
    const { states, prices } = scripted()
    states.forEach((state, day) => {
      expect(summary(state).revenue).toBe(
        revenueAt(summary(state).sold, prices[day] ?? STARTING.pricesCents),
      )
    })
    expect(prices.at(-1)).toEqual({
      cafe: 300,
      chocolat: 395,
      croissant: 400,
    })
  })

  it('plays other days than the game without the decisions', () => {
    const { states } = scripted()
    let unscripted = createInitialState(SEED)
    for (let day = 0; day < DAYS; day += 1) unscripted = tick(unscripted)
    expect(states.at(-1)?.journal.entries).not.toEqual(
      unscripted.journal.entries,
    )
    expect(states.at(-1)?.decisions).toEqual({
      prices: { cafe: 300, chocolat: 395, croissant: 400 },
      restock: {
        cafe: { kind: 'topUp', whenBelow: 50, upTo: 200 },
        chocolat: { kind: 'topUp', whenBelow: 20, upTo: 60 },
        croissant: { kind: 'buyDaily', quantity: 40 },
      },
      daysOpen: [2, 4, 6],
      ownerWeeklyPay: 50_000,
      marketingDaily: 1_000,
    })
  })
})

/** The shipped customers, with nobody wanting `product` at any price. */
function nobodyBuys(product: ProductId): CustomerContent {
  return loadCustomerContent({
    segments: perSegment((id) => {
      const segment = CUSTOMERS.segments[id]
      return {
        ...segment,
        products: {
          ...segment.products,
          [product]: { ...segment.products[product], purchaseProbability: 0 },
        },
      }
    }),
  })
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  for (const inner of Object.values(value)) deepFreeze(inner)
  Object.freeze(value)
}
