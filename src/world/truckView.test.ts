import { describe, expect, it } from 'vitest'
import type { ProductId } from '../content/schema.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { PRODUCTS, onHand } from '../engine/inventory.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import { openingStock, opensToday, rackFill, truckView } from './truckView.ts'

const SEED = 42

/** Day 0, a Monday: the truck starts the game closed on Mondays. */
const monday = createInitialState(SEED)
/** Day 1, the first Tuesday, before it is played. */
const tuesday = tick(monday)

/** `state` with only `quantity` units of `product` on hand. */
function holding(
  state: GameState,
  product: ProductId,
  quantity: number,
): GameState {
  return {
    ...state,
    inventory: [
      { product, quantity, unitCost: cents(40), boughtOnDay: state.day },
    ],
  }
}

function decide(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((next, change) => applyDecision(next, change), state)
}

describe('rackFill (the croissant stock shown on the rack)', () => {
  it.each([
    [0, 0],
    [1, 0.25],
    [25, 0.25],
    [26, 0.5],
    [50, 0.5],
    [51, 0.75],
    [70, 0.75],
    [75, 0.75],
    [76, 1],
    [100, 1],
    [250, 1],
  ])('shows %i croissants out of 100 as %f of the rack', (units, fill) => {
    expect(rackFill(units, 100, 4)).toBe(fill)
  })

  it('shows a one-shelf rack as empty or full', () => {
    expect(rackFill(0, 100, 1)).toBe(0)
    expect(rackFill(1, 100, 1)).toBe(1)
    expect(rackFill(100, 100, 1)).toBe(1)
  })

  it('never goes below empty', () => {
    expect(rackFill(-5, 100, 4)).toBe(0)
  })
})

describe('truckView', () => {
  it('shows the truck closed with an empty rack on the first Monday', () => {
    expect(truckView(monday)).toEqual({
      open: false,
      croissants: 0,
      businessName: "Le P'tit Camion",
    })
  })

  it("writes the player's business name on the sign", () => {
    const game = createInitialState(SEED, FOOD_TRUCK, {
      businessName: 'Chez Mimi',
      avatar: 'homme',
      difficulty: 'facile',
    })
    expect(truckView(game).businessName).toBe('Chez Mimi')
    expect(truckView(tick(game)).businessName).toBe('Chez Mimi')
  })

  it('opens on Tuesday with the starting order of croissants', () => {
    expect(truckView(tuesday)).toEqual({
      open: true,
      croissants: 70,
      businessName: "Le P'tit Camion",
    })
    expect(rackFill(truckView(tuesday).croissants, 100, 4)).toBe(0.75)
  })
})

describe('opensToday', () => {
  it('follows the weekdays the decisions of the day open', () => {
    expect(opensToday(monday)).toBe(false)
    expect(opensToday(tuesday)).toBe(true)
  })

  it('ignores a change of days waiting for the next morning', () => {
    const everyDay = decide(monday, {
      kind: 'daysOpen',
      weekdays: [1, 2, 3, 4, 5, 6, 7],
    })
    expect(opensToday(everyDay)).toBe(false)

    let nextMonday = everyDay
    for (let day = 0; day < 7; day += 1) nextMonday = tick(nextMonday)
    expect(opensToday(nextMonday)).toBe(true)
  })
})

describe('openingStock', () => {
  // The starting rules: café tops up to 300 below 100, croissants buy 70.
  it.each([
    [0, 300],
    [99, 300],
    [100, 100],
    [101, 101],
  ])('tops café up from %i on hand to %i', (units, opening) => {
    expect(openingStock(holding(tuesday, 'cafe', units), 'cafe')).toBe(opening)
  })

  it('adds a daily order to what is on hand', () => {
    expect(openingStock(holding(tuesday, 'croissant', 5), 'croissant')).toBe(75)
  })

  it('counts only what is on hand on a closed day', () => {
    expect(openingStock(holding(monday, 'cafe', 99), 'cafe')).toBe(99)
    expect(openingStock(monday, 'croissant')).toBe(0)
  })

  it('restocks with the rules of the day, not those waiting for the next morning', () => {
    const changed = decide(tuesday, {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: 20 },
    })
    expect(openingStock(changed, 'croissant')).toBe(70)
    expect(openingStock(tick(changed), 'croissant')).toBe(20)
  })

  // The world repeats the engine's morning restock, which it may not call;
  // this holds the two together. Whatever the truck opens with is sold,
  // spoiled at the close or still on hand after it.
  describe('agrees with the engine', () => {
    const changes: Record<number, DecisionChange[]> = {
      10: [
        {
          kind: 'restock',
          product: 'croissant',
          rule: { kind: 'buyDaily', quantity: 120 },
        },
      ],
      30: [
        {
          kind: 'restock',
          product: 'cafe',
          rule: { kind: 'topUp', whenBelow: 280, upTo: 290 },
        },
        {
          kind: 'restock',
          product: 'chocolat',
          rule: { kind: 'topUp', whenBelow: 0, upTo: 0 },
        },
      ],
      50: [{ kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] }],
      70: [
        {
          kind: 'restock',
          product: 'croissant',
          rule: { kind: 'buyDaily', quantity: 0 },
        },
      ],
    }

    it('on every product of every day for 120 days, as the player changes the rules', () => {
      let state = monday
      for (let day = 0; day < 120; day += 1) {
        state = decide(state, ...(changes[day] ?? []))
        const next = tick(state)
        const played = next.lastDay!
        for (const product of PRODUCTS) {
          const atClose =
            played.sold[product] +
            played.spoiled[product] +
            onHand(next.inventory, product)
          expect(openingStock(state, product), `day ${day}, ${product}`).toBe(
            atClose,
          )
        }
        expect(played.visits.length > 0, `day ${day} open`).toBe(
          opensToday(state),
        )
        state = next
      }
    })
  })
})
