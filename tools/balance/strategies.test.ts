import { describe, expect, it } from 'vitest'
import { createInitialState } from '../../src/engine/clock.ts'
import { FOOD_TRUCK } from '../../src/engine/day.ts'
import { applyDecision } from '../../src/engine/decisions.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents } from '../../src/engine/money.ts'
import {
  changedPrice,
  formatPriceChange,
  PRICE_CHANGES,
  STRATEGIES,
  strategyChanges,
  WEEKDAYS,
  type Strategy,
} from './strategies.ts'

// The grid of strategies and the decisions each one makes.

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}

describe('STRATEGIES', () => {
  it("holds every combination of the grid once, prices first, the owner's pay last", () => {
    expect(STRATEGIES).toHaveLength(4 * 3 * 3 * 3 * 3)
    const keys = STRATEGIES.map((strategy) => JSON.stringify(strategy))
    expect(new Set(keys).size).toBe(STRATEGIES.length)
    expect(STRATEGIES[0]).toEqual({
      priceChange: -20,
      croissantsPerDay: 40,
      marketingDaily: 0,
      daysOpen: 5,
      ownerWeeklyPay: 40_000,
    })
    expect(STRATEGIES[1]).toMatchObject({ daysOpen: 5, ownerWeeklyPay: 70_000 })
    expect(STRATEGIES[3]).toMatchObject({ daysOpen: 6, ownerWeeklyPay: 40_000 })
    expect(STRATEGIES.at(-1)).toEqual({
      priceChange: 40,
      croissantsPerDay: 110,
      marketingDaily: 8000,
      daysOpen: 7,
      ownerWeeklyPay: 100_000,
    })
  })

  it('tries the marketing budgets of $0, $30 and $80 a day', () => {
    expect([
      ...new Set(STRATEGIES.map(({ marketingDaily }) => marketingDaily)),
    ]).toEqual([0, 3000, 8000])
  })

  it("tries 5, 6 and 7 days open and the owner's pay of $400, $700 and $1,000 a week", () => {
    expect([...new Set(STRATEGIES.map(({ daysOpen }) => daysOpen))]).toEqual([
      5, 6, 7,
    ])
    expect([
      ...new Set(STRATEGIES.map(({ ownerWeeklyPay }) => ownerWeeklyPay)),
    ]).toEqual([40_000, 70_000, 100_000])
  })
})

describe('WEEKDAYS', () => {
  it('nests the schedules: 6 days closes on Monday, 5 on Sunday too', () => {
    expect(WEEKDAYS).toEqual({
      5: [2, 3, 4, 5, 6],
      6: [2, 3, 4, 5, 6, 7],
      7: [1, 2, 3, 4, 5, 6, 7],
    })
  })

  it('opens 6 days as the content starts', () => {
    expect(WEEKDAYS[6]).toEqual(FOOD_TRUCK.startingDecisions.daysOpen)
  })
})

describe('changedPrice', () => {
  it.each([
    [-20, [260, 280, 300]],
    [0, [325, 350, 375]],
    [20, [390, 420, 450]],
    [40, [455, 490, 525]],
  ])('moves the starting prices by %i%', (priceChange, prices) => {
    expect(
      PRODUCTS.map((product) => changedPrice(priceChange, product)),
    ).toEqual(prices)
  })

  it('rounds half up to a whole step', () => {
    // 325 × 1.1 = 357.5 → 360; 350 × 1.01 = 353.5 → 355; 375 × 0.99 =
    // 371.25 → 370.
    expect(changedPrice(10, 'cafe')).toBe(360)
    expect(changedPrice(1, 'chocolat')).toBe(355)
    expect(changedPrice(-1, 'croissant')).toBe(370)
  })

  it('stays on the step for every price of the grid', () => {
    const { step } = FOOD_TRUCK.decisionLimits.priceCents
    for (const priceChange of PRICE_CHANGES) {
      for (const product of PRODUCTS) {
        expect(changedPrice(priceChange, product) % step).toBe(0)
      }
    }
  })
})

describe('strategyChanges', () => {
  it("sets the prices, the croissants, the marketing, the days open and the owner's pay", () => {
    expect(
      strategyChanges({
        priceChange: 40,
        croissantsPerDay: 110,
        marketingDaily: cents(3000),
        daysOpen: 7,
        ownerWeeklyPay: cents(40_000),
      }),
    ).toEqual([
      { kind: 'price', product: 'cafe', price: 455 },
      { kind: 'price', product: 'chocolat', price: 490 },
      { kind: 'price', product: 'croissant', price: 525 },
      {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 110 },
      },
      { kind: 'marketingDaily', budget: 3000 },
      { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] },
      { kind: 'ownerWeeklyPay', pay: 40_000 },
    ])
  })

  it.each([
    [5, [2, 3, 4, 5, 6]],
    [6, [2, 3, 4, 5, 6, 7]],
  ] as const)('opens %i days on %j', (daysOpen, weekdays) => {
    expect(strategyChanges({ ...BASE, daysOpen })).toContainEqual({
      kind: 'daysOpen',
      weekdays,
    })
  })

  it('makes only changes the engine accepts, leaving the rest as it starts', () => {
    const start = createInitialState(1)
    for (const strategy of STRATEGIES) {
      const { pendingDecisions } = strategyChanges(strategy).reduce(
        (state, change) => applyDecision(state, change),
        start,
      )
      expect(pendingDecisions).toMatchObject({
        restock: {
          cafe: start.decisions.restock.cafe,
          chocolat: start.decisions.restock.chocolat,
        },
        ownerWeeklyPay: strategy.ownerWeeklyPay,
      })
    }
  })

  it('leaves the starting decisions as they are for the base strategy', () => {
    const start = createInitialState(1)
    const { pendingDecisions } = strategyChanges(BASE).reduce(
      (state, change) => applyDecision(state, change),
      start,
    )
    expect(pendingDecisions).toEqual(start.decisions)
  })
})

describe('formatPriceChange', () => {
  it.each([
    [-20, '-20%'],
    [0, 'base'],
    [20, '+20%'],
    [40, '+40%'],
  ])('writes %i as %s', (priceChange, text) => {
    expect(formatPriceChange(priceChange)).toBe(text)
  })
})
