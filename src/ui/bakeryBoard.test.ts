import { describe, expect, it } from 'vitest'
import { BAKERY } from '../engine/bakery.ts'
import { endOfMonth } from '../engine/calendar.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import { DIFFICULTIES } from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { NO_EVENTS } from '../engine/events.ts'
import type { Day, GameState } from '../engine/types.ts'
import { entriesOf } from '../finance/journal.ts'
import { accepts, bakeryBoard } from './bakeryBoard.ts'
import { createGameStore } from './store.ts'

const START = createInitialState(42)
const PRICES = DIFFICULTIES.bakery[START.profile.difficulty]
const RENT = PRICES.monthlyRentCents
const LEASE = BAKERY.oven.monthlyLeaseCents

/** `state` with `changes` made, in order. */
function decided(state: GameState, ...changes: DecisionChange[]): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

function playedTo(state: GameState, day: Day): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/** The memos and amounts of the entries dated `day`. */
function entriesOn(game: GameState, day: Day) {
  return entriesOf(game.journal)
    .filter((entry) => entry.day === day)
    .map(({ memo, lines }) => ({
      memo,
      amount: lines.reduce((total, { debit }) => total + debit, 0),
    }))
}

describe('bakeryBoard', () => {
  it('shows a closed bakery, both openings, the costs and the unit costs side by side', () => {
    expect(bakeryBoard(START)).toEqual({
      today: { kind: 'closed' },
      tomorrow: null,
      planned: false,
      closingLastDay: null,
      options: [
        { oven: 'louer', allowed: true, fixedCosts: RENT + LEASE },
        { oven: 'acheter', allowed: true, fixedCosts: RENT },
      ],
      fixedCosts: null,
      movingCost: BAKERY.movingCostCents,
      monthlyRent: RENT,
      monthlyLease: LEASE,
      ovenPrice: BAKERY.oven.priceCents,
      ownsOven: false,
      capacity: 300,
      boughtUnitCost: 110,
      madeUnitCost: 55,
      source: 'acheter',
      bake: { kind: 'buyDaily', quantity: 70 },
      boughtAnyway: false,
    })
  })

  it('shows an opening planned for tomorrow, which closing cancels', () => {
    const board = bakeryBoard(
      decided(START, { kind: 'openBakery', oven: 'louer' }),
    )
    expect(board).toMatchObject({
      today: { kind: 'closed' },
      tomorrow: { kind: 'open', since: 1, oven: 'louer' },
      planned: true,
      closingLastDay: null,
      options: [],
      fixedCosts: RENT + LEASE,
    })
  })

  it('shows a bakery open, and the notice closing it gives', () => {
    const open = playedTo(
      decided(START, { kind: 'openBakery', oven: 'louer' }),
      3,
    )
    expect(bakeryBoard(open)).toMatchObject({
      today: { kind: 'open', since: 1, oven: 'louer' },
      tomorrow: null,
      planned: true,
      closingLastDay: endOfMonth(4, 1),
      fixedCosts: RENT + LEASE,
    })

    const closing = decided(open, { kind: 'closeBakery' })
    expect(bakeryBoard(closing)).toMatchObject({
      today: { kind: 'open', since: 1, oven: 'louer' },
      tomorrow: { kind: 'notice', lastDay: endOfMonth(4, 1), oven: 'louer' },
      planned: false,
      // Only the oven it has takes the notice back.
      options: [
        { oven: 'louer', allowed: true, fixedCosts: RENT + LEASE },
        { oven: 'acheter', allowed: false, fixedCosts: null },
      ],
    })
    expect(bakeryBoard(tick(closing))).toMatchObject({
      today: { kind: 'notice', lastDay: endOfMonth(4, 1), oven: 'louer' },
      tomorrow: null,
    })
  })

  it('leases no oven once the business owns one', () => {
    let game = playedTo(
      decided(START, { kind: 'openBakery', oven: 'acheter' }),
      3,
    )
    game = playedTo(
      decided(game, { kind: 'closeBakery' }),
      endOfMonth(3, 1) + 2,
    )
    expect(bakeryBoard(game)).toMatchObject({
      today: { kind: 'closed' },
      ownsOven: true,
      options: [
        { oven: 'louer', allowed: false, fixedCosts: null },
        { oven: 'acheter', allowed: true, fixedCosts: RENT },
      ],
    })
  })

  it('says the croissants are bought when they should be made but no bakery runs', () => {
    const made = decided(START, {
      kind: 'croissantSource',
      source: 'fabriquer',
    })
    expect(bakeryBoard(made).boughtAnyway).toBe(true)
    expect(
      bakeryBoard(decided(made, { kind: 'openBakery', oven: 'louer' }))
        .boughtAnyway,
    ).toBe(false)
  })

  it('shows the latest source and bake rule', () => {
    const board = bakeryBoard(
      decided(
        START,
        { kind: 'croissantSource', source: 'fabriquer' },
        { kind: 'bake', rule: { kind: 'buyDaily', quantity: 120 } },
      ),
    )
    expect(board.source).toBe('fabriquer')
    expect(board.bake).toEqual({ kind: 'buyDaily', quantity: 120 })
  })
})

describe('accepts', () => {
  it('says whether the engine takes a change, keeping nothing', () => {
    expect(accepts(START, { kind: 'openBakery', oven: 'louer' })).toBe(true)
    expect(accepts(START, { kind: 'closeBakery' })).toBe(false)
    expect(START.pendingDecisions).toBeNull()
  })
})

describe('the bakery through the store', () => {
  it('opens with a leased oven the next morning, paying the move, the rent and the lease', () => {
    const store = createGameStore(START, NO_EVENTS)
    store.getState().decide({ kind: 'openBakery', oven: 'louer' })
    store.getState().advance(2)
    const { game } = store.getState()
    expect(game.bakery).toMatchObject({ openedOnDay: 1, oven: 'louer' })
    expect(entriesOn(game, 1).slice(0, 3)).toEqual([
      { memo: 'Déménagement du fournil', amount: BAKERY.movingCostCents },
      { memo: 'Loyer du fournil', amount: RENT },
      { memo: 'Location du four', amount: LEASE },
    ])
  })

  it('opens with an oven bought, then closes on notice', () => {
    const store = createGameStore(START, NO_EVENTS)
    store.getState().decide({ kind: 'openBakery', oven: 'acheter' })
    store.getState().advance(2)
    expect(entriesOn(store.getState().game, 1).slice(0, 2)).toEqual([
      { memo: 'Déménagement du fournil', amount: BAKERY.movingCostCents },
      { memo: 'Achat du four', amount: BAKERY.oven.priceCents },
    ])
    // Day 2: the notice starts the next morning, when day 3 is played.
    store.getState().decide({ kind: 'closeBakery' })
    store.getState().advance(2)
    expect(store.getState().game.bakery).toMatchObject({
      oven: 'acheter',
      closesAfterDay: endOfMonth(3, 1),
      ovenBoughtOnDay: 1,
    })
  })

  it('makes the croissants of the bake rule once they come from the bakery', () => {
    const store = createGameStore(START, NO_EVENTS)
    const { decide } = store.getState()
    decide({ kind: 'openBakery', oven: 'louer' })
    decide({ kind: 'croissantSource', source: 'fabriquer' })
    decide({ kind: 'bake', rule: { kind: 'buyDaily', quantity: 50 } })
    // Day 1, a Tuesday, the truck open.
    store.getState().advance(2)
    expect(entriesOn(store.getState().game, 1)).toContainEqual({
      memo: 'Ingrédients du fournil',
      amount: 50 * PRICES.ingredientCostCents,
    })
    expect(bakeryBoard(store.getState().game).bake).toEqual({
      kind: 'buyDaily',
      quantity: 50,
    })
  })

  it('lets the bake rule go no higher than the capacity', () => {
    const store = createGameStore(START, NO_EVENTS)
    expect(() =>
      store.getState().decide({
        kind: 'bake',
        rule: { kind: 'buyDaily', quantity: BAKERY.capacityPerDay + 1 },
      }),
    ).toThrow(RangeError)
    expect(store.getState().game.pendingDecisions).toBeNull()
  })
})
