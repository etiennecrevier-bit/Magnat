import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  loadFoodTruckContent,
  type FoodTruckContent,
  type ProductId,
  type RestockRule,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, trialBalance, type JournalEntry } from '../finance/journal.ts'
import { createInitialState, tick } from './clock.ts'
import { FOOD_TRUCK, openingJournal } from './day.ts'
import { PRODUCTS, inventoryValue, onHand } from './inventory.ts'
import { cents } from './money.ts'
import type { Day, GameState } from './types.ts'

const CASH: AccountCode = '1000'
const INVENTORY: AccountCode = '1200'

const MEMO = {
  capital: 'Mise de fonds',
  purchases: 'Achat de marchandises',
  sales: 'Ventes au comptant',
  costOfSales: 'Coût des marchandises vendues',
  fixedCosts: 'Loyer, permis, carburant et entretien',
  spoilage: 'Marchandises périmées',
}

// Content variants: each change returns new content, and `variant` validates
// the result like the shipped file.
type Change = (content: FoodTruckContent) => FoodTruckContent

function variant(...changes: Change[]): FoodTruckContent {
  return loadFoodTruckContent(
    changes.reduce((content, change) => change(content), FOOD_TRUCK),
  )
}

/** Exactly this many customers each weekday and each weekend day. */
function customers(weekday: number, weekend = weekday): Change {
  return (content) => ({
    ...content,
    walkIns: {
      weekdayCustomers: weekday,
      weekendCustomers: weekend,
      noiseStdDevRatio: 0,
    },
  })
}

function buying(probability: Partial<Record<ProductId, number>>): Change {
  return (content) => ({
    ...content,
    purchaseProbability: { ...content.purchaseProbability, ...probability },
  })
}

function restocking(rules: Partial<Record<ProductId, RestockRule>>): Change {
  return (content) => ({
    ...content,
    restockPolicy: { ...content.restockPolicy, ...rules },
  })
}

function unitCost(product: ProductId, unitCostCents: number): Change {
  return (content) => ({
    ...content,
    products: {
      ...content.products,
      [product]: {
        ...content.products[product],
        unitCostCents: cents(unitCostCents),
      },
    },
  })
}

function fixedCosts(rentAndPermit: number, fuelAndMaintenance: number): Change {
  return (content) => ({
    ...content,
    dailyFixedCostsCents: {
      rentAndPermit: cents(rentAndPermit),
      fuelAndMaintenance: cents(fuelAndMaintenance),
    },
  })
}

function capital(startingCapitalCents: number): Change {
  return (content) => ({
    ...content,
    startingCapitalCents: cents(startingCapitalCents),
  })
}

function buyDaily(quantity: number): RestockRule {
  return { kind: 'buyDaily', quantity }
}

function topUp(whenBelow: number, upTo: number): RestockRule {
  return { kind: 'topUp', whenBelow, upTo }
}

const NO_RESTOCK = restocking({ cafe: buyDaily(0), croissant: buyDaily(0) })

/** The state after each of `days` ticks, in order. */
function play(
  days: number,
  content: FoodTruckContent = FOOD_TRUCK,
  start: GameState = createInitialState(42, content),
): GameState[] {
  const states: GameState[] = []
  let state = start
  for (let i = 0; i < days; i += 1) {
    state = tick(state, content)
    states.push(state)
  }
  return states
}

/** The state after `days` ticks. */
function after(
  days: number,
  content: FoodTruckContent = FOOD_TRUCK,
  start: GameState = createInitialState(42, content),
): GameState {
  const state = play(days, content, start).at(-1)
  if (state === undefined) throw new Error('no day played')
  return state
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

/**
 * Checks the state a tick returned: the day it played is the day before, no
 * entry is dated after it, every lot holds a positive whole number of
 * units, the Stocks account carries the lots' cost and the books balance.
 */
function expectConsistent(state: GameState, content: FoodTruckContent): void {
  const { lastDay } = state
  if (lastDay === null) throw new Error('no day played')
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
      total + lastDay.sold[product] * content.products[product].basePriceCents,
    0,
  )
  expect(lastDay.revenue).toBe(revenue)

  expect(balance(state.journal, INVENTORY, { toDay: lastDay.day })).toBe(
    inventoryValue(state.inventory),
  )
  const { totalDebit, totalCredit } = trialBalance(state.journal, lastDay.day)
  expect(totalDebit).toBe(totalCredit)
}

describe('the opening books', () => {
  it('hold the starting capital, paid in on day 0', () => {
    const { journal } = createInitialState(42)
    expect(journal).toEqual(openingJournal(FOOD_TRUCK))
    expect(journal.entries).toEqual([
      transfer(0, MEMO.capital, CASH, '3000', FOOD_TRUCK.startingCapitalCents),
    ])
  })

  it('are empty when there is no starting capital', () => {
    expect(openingJournal(variant(capital(0))).entries).toEqual([])
  })
})

describe('tick', () => {
  it('plays day 0 first, posting the day in order', () => {
    const content = variant(
      customers(10),
      buying({ cafe: 1, croissant: 0 }),
      restocking({ cafe: buyDaily(30), croissant: buyDaily(7) }),
      unitCost('cafe', 40),
      unitCost('croissant', 90),
      fixedCosts(4500, 2000),
    )
    const start = createInitialState(42, content)
    const state = tick(start, content)
    const { basePriceCents } = content.products.cafe

    expect(state.day).toBe(1)
    expect(state.journal.entries).toEqual([
      ...start.journal.entries,
      transfer(0, MEMO.purchases, INVENTORY, CASH, 30 * 40 + 7 * 90),
      transfer(0, MEMO.sales, CASH, '4000', 10 * basePriceCents),
      transfer(0, MEMO.costOfSales, '5000', INVENTORY, 10 * 40),
      {
        day: 0,
        memo: MEMO.fixedCosts,
        lines: [
          { account: '6100', debit: 4500, credit: 0 },
          { account: '6200', debit: 2000, credit: 0 },
          { account: CASH, debit: 0, credit: 6500 },
        ],
      },
      transfer(0, MEMO.spoilage, '5100', INVENTORY, 7 * 90),
    ])
    expect(state.inventory).toEqual([
      { product: 'cafe', quantity: 20, unitCost: 40, boughtOnDay: 0 },
    ])
    expect(state.lastDay).toEqual({
      day: 0,
      sold: { cafe: 10, croissant: 0 },
      revenue: 10 * basePriceCents,
      lostSales: { cafe: 0, croissant: 0 },
      spoiled: { cafe: 0, croissant: 7 },
    })
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
  it('plays the same 30 days from the same seed', () => {
    const first = play(30)
    const second = play(30)
    expect(second).toEqual(first)
    expect(second.at(-1)?.journal.entries).toEqual(
      first.at(-1)?.journal.entries,
    )
  })

  it('plays different days from another seed', () => {
    const seed42 = after(30)
    const seed43 = after(30, FOOD_TRUCK, createInitialState(43))
    expect(seed43.journal.entries).not.toEqual(seed42.journal.entries)
  })
})

describe('the books and the stock', () => {
  it.each([1, 42, 2026])(
    'agree every day for a year from seed %i, with stock never negative',
    (seed) => {
      for (const state of play(365, FOOD_TRUCK, createInitialState(seed))) {
        expectConsistent(state, FOOD_TRUCK)
      }
    },
  )
})

describe('walk-in demand', () => {
  it('brings weekday traffic Monday to Friday and weekend traffic after', () => {
    const content = variant(
      customers(120, 80),
      buying({ cafe: 1, croissant: 0 }),
      restocking({ cafe: buyDaily(200) }),
    )
    // Day 0 is a Monday.
    const asked = play(7, content).map(({ lastDay }) =>
      lastDay === null ? 0 : lastDay.sold.cafe + lastDay.lostSales.cafe,
    )
    expect(asked).toEqual([120, 120, 120, 120, 120, 80, 80])
  })

  it('sells what is in stock and counts the rest as lost sales', () => {
    const content = variant(
      customers(50),
      buying({ cafe: 1, croissant: 1 }),
      restocking({ cafe: buyDaily(30), croissant: buyDaily(10) }),
      unitCost('cafe', 40),
      unitCost('croissant', 90),
    )
    const state = after(1, content)
    const price = (product: ProductId) =>
      content.products[product].basePriceCents
    const revenue = 30 * price('cafe') + 10 * price('croissant')

    expect(state.lastDay).toEqual({
      day: 0,
      sold: { cafe: 30, croissant: 10 },
      revenue,
      lostSales: { cafe: 20, croissant: 40 },
      spoiled: { cafe: 0, croissant: 0 },
    })
    expect(state.inventory).toEqual([])
    expect(entry(state, 0, MEMO.sales)).toEqual(
      transfer(0, MEMO.sales, CASH, '4000', revenue),
    )
    expect(entry(state, 0, MEMO.costOfSales)).toEqual(
      transfer(0, MEMO.costOfSales, '5000', INVENTORY, 30 * 40 + 10 * 90),
    )
  })
})

describe('restocking', () => {
  it('tops up only once stock falls below the threshold', () => {
    const base = [
      restocking({ cafe: topUp(10, 25), croissant: buyDaily(0) }),
      buying({ cafe: 1, croissant: 0 }),
      unitCost('cafe', 40),
    ]
    // Day 0 buys 25 and sells 15; day 1 opens with exactly 10 and sells 1;
    // day 2 opens with 9, below 10, so it buys back up to 25.
    let state = createInitialState(42, variant(...base))
    state = tick(state, variant(...base, customers(15)))
    expect(entry(state, 0, MEMO.purchases)).toEqual(
      transfer(0, MEMO.purchases, INVENTORY, CASH, 25 * 40),
    )
    state = tick(state, variant(...base, customers(1)))
    expect(entriesOn(state, 1).map(({ memo }) => memo)).not.toContain(
      MEMO.purchases,
    )
    expect(onHand(state.inventory, 'cafe')).toBe(9)
    state = tick(state, variant(...base, customers(0)))
    expect(entry(state, 2, MEMO.purchases)).toEqual(
      transfer(2, MEMO.purchases, INVENTORY, CASH, 16 * 40),
    )
    expect(onHand(state.inventory, 'cafe')).toBe(25)
  })

  it('costs sales first in, first out across lots bought at other prices', () => {
    // Coffee bought at 10 ¢, then at 20 ¢, is sold once it costs 40 ¢ to buy.
    const quiet = [NO_RESTOCK, buying({ cafe: 1, croissant: 0 })]
    let state = createInitialState(42, variant(...quiet))
    state = tick(
      state,
      variant(
        ...quiet,
        customers(0),
        unitCost('cafe', 10),
        restocking({ cafe: buyDaily(3) }),
      ),
    )
    state = tick(
      state,
      variant(
        ...quiet,
        customers(0),
        unitCost('cafe', 20),
        restocking({ cafe: buyDaily(5) }),
      ),
    )
    state = tick(state, variant(...quiet, customers(5), unitCost('cafe', 40)))

    expect(entry(state, 2, MEMO.costOfSales)).toEqual(
      transfer(2, MEMO.costOfSales, '5000', INVENTORY, 3 * 10 + 2 * 20),
    )
    expect(state.inventory).toEqual([
      { product: 'cafe', quantity: 3, unitCost: 20, boughtOnDay: 1 },
    ])
    expect(balance(state.journal, INVENTORY, { toDay: 2 })).toBe(3 * 20)
  })
})

describe('fixed costs', () => {
  it('are paid every day, weekends included', () => {
    const { rentAndPermit, fuelAndMaintenance } =
      FOOD_TRUCK.dailyFixedCostsCents
    const last = after(7)
    for (let day = 0; day < 7; day += 1) {
      expect(entry(last, day, MEMO.fixedCosts).lines).toEqual([
        { account: '6100', debit: rentAndPermit, credit: 0 },
        { account: '6200', debit: fuelAndMaintenance, credit: 0 },
        { account: CASH, debit: 0, credit: rentAndPermit + fuelAndMaintenance },
      ])
    }
  })

  it('leave out a cost of zero', () => {
    const content = variant(fixedCosts(0, 2000))
    const state = after(1, content)
    expect(entry(state, 0, MEMO.fixedCosts).lines).toEqual([
      { account: '6200', debit: 2000, credit: 0 },
      { account: CASH, debit: 0, credit: 2000 },
    ])
  })
})

describe('spoilage', () => {
  it('writes overstocked croissants off the same evening', () => {
    const content = variant(
      restocking({ croissant: buyDaily(70) }),
      unitCost('croissant', 90),
    )
    let spoiledAtAll = 0
    for (const state of play(30, content)) {
      const { lastDay } = state
      if (lastDay === null) throw new Error('no day played')
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
    expect(state.lastDay?.spoiled).toEqual({ cafe: 0, croissant: 70 })
    expect(entry(state, 0, MEMO.spoilage)).toEqual(
      transfer(0, MEMO.spoilage, '5100', INVENTORY, 70 * 90),
    )
  })

  it('spares coffee within its first 90 days', () => {
    for (const { lastDay } of play(90)) {
      expect(lastDay?.spoiled.cafe).toBe(0)
    }
  })

  it('writes off unsold coffee at the close of its 90th day', () => {
    const content = variant(
      buying({ cafe: 0 }),
      restocking({ cafe: topUp(100, 300), croissant: buyDaily(0) }),
      unitCost('cafe', 40),
    )
    const states = play(91, content)
    states.slice(0, 89).forEach(({ lastDay, inventory }) => {
      expect(lastDay?.spoiled.cafe).toBe(0)
      expect(onHand(inventory, 'cafe')).toBe(300)
    })
    const [day89, day90] = states.slice(89)
    if (day89 === undefined || day90 === undefined) throw new Error('no day')
    expect(day89.lastDay?.spoiled.cafe).toBe(300)
    expect(day89.inventory).toEqual([])
    expect(entry(day89, 89, MEMO.spoilage)).toEqual(
      transfer(89, MEMO.spoilage, '5100', INVENTORY, 300 * 40),
    )
    expect(entry(day90, 90, MEMO.purchases)).toEqual(
      transfer(90, MEMO.purchases, INVENTORY, CASH, 300 * 40),
    )
  })
})

describe('cash', () => {
  it('may go negative', () => {
    const content = variant(capital(0), customers(0))
    const state = after(1, content)
    const purchases = entry(state, 0, MEMO.purchases).lines[0]?.debit ?? 0
    const { rentAndPermit, fuelAndMaintenance } = content.dailyFixedCostsCents
    expect(balance(state.journal, CASH, { toDay: 0 })).toBe(
      -(purchases + rentAndPermit + fuelAndMaintenance),
    )
    expect(() => play(30, content)).not.toThrow()
  })

  it('moves not at all on a day with nothing to record', () => {
    // Customers come, but with no stock nothing sells, and nothing is owed.
    const content = variant(
      capital(0),
      NO_RESTOCK,
      fixedCosts(0, 0),
      customers(10),
      buying({ cafe: 1, croissant: 1 }),
    )
    const state = after(1, content)
    expect(state.journal.entries).toEqual([])
    expect(state.lastDay).toEqual({
      day: 0,
      sold: { cafe: 0, croissant: 0 },
      revenue: 0,
      lostSales: { cafe: 10, croissant: 10 },
      spoiled: { cafe: 0, croissant: 0 },
    })
  })
})

describe('day properties', () => {
  const rule = fc.oneof(
    fc.integer({ min: 0, max: 150 }).map(buyDaily),
    fc
      .tuple(fc.integer({ min: 0, max: 300 }), fc.integer({ min: 0, max: 300 }))
      .map(([a, b]) => topUp(Math.min(a, b), Math.max(a, b))),
  )
  const probability = fc.double({ min: 0, max: 1, noNaN: true })
  const scenario = fc.record({
    seed: fc.integer({ min: 0, max: 2 ** 32 - 1 }),
    weekday: fc.integer({ min: 0, max: 200 }),
    weekend: fc.integer({ min: 0, max: 200 }),
    noise: fc.double({ min: 0, max: 0.5, noNaN: true }),
    cafe: probability,
    croissant: probability,
    cafeRule: rule,
    croissantRule: rule,
    cafeShelfLife: fc.integer({ min: 1, max: 10 }),
    croissantShelfLife: fc.integer({ min: 1, max: 10 }),
  })

  it('keep the stock whole and the books in step with it', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const content = variant(
          (c) => ({
            ...c,
            walkIns: {
              weekdayCustomers: s.weekday,
              weekendCustomers: s.weekend,
              noiseStdDevRatio: s.noise,
            },
            products: {
              cafe: { ...c.products.cafe, shelfLifeDays: s.cafeShelfLife },
              croissant: {
                ...c.products.croissant,
                shelfLifeDays: s.croissantShelfLife,
              },
            },
          }),
          buying({ cafe: s.cafe, croissant: s.croissant }),
          restocking({ cafe: s.cafeRule, croissant: s.croissantRule }),
        )
        const start = createInitialState(s.seed, content)
        for (const state of play(40, content, start)) {
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
