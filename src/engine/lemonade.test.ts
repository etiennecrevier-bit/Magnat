import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import { loadDreamContent, type DreamContent } from '../content/schema.ts'
import { entriesOf } from '../finance/journal.ts'
import { BAKERY } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import { applyDecision, type DecisionChange } from './decisions.ts'
import { NO_EVENTS, resolveEvent } from './events.ts'
import { FINANCING } from './financing.ts'
import { onHand } from './inventory.ts'
import { PERCENTILES } from './percentiles.ts'
import { PLACES } from './places.ts'
import { STAFF } from './staff.ts'
import { streetOn } from './street.ts'
import type { GameState } from './types.ts'

// Lemonade (#261): sold from June 1st to September 15th, restocked by its
// rule, keeping one day. Out of season nobody buys it or wants it, and its
// rule buys nothing.

const SEED = 42
// Day 0 is Monday, May 1st, so these are days of year 1.
const MAY_31 = 30
const JUNE_1 = 31
const SEPTEMBER_15 = 137
const SEPTEMBER_16 = 138
const SECOND = 'vieuxMontreal'
const { unitCostCents } = FOOD_TRUCK.products.limonade

/** « Le rêve » with « Deuxième camion » first and cheap, as in trucks.test. */
const DREAM: DreamContent = loadDreamContent({
  ...dreamJson,
  company: [
    { ...dreamJson.company[2], priceCents: 500_000 },
    dreamJson.company[0],
    dreamJson.company[1],
  ],
})

function decide(state: GameState, change: DecisionChange): GameState {
  return applyDecision(
    state,
    change,
    FOOD_TRUCK,
    DEFIS,
    BAKERY,
    STAFF,
    DREAM,
    DIFFICULTIES,
    PLACES,
  )
}

/** A rule buying `glasses` of lemonade a day, at the truck `truck`. */
function ordering(glasses: number, truck?: typeof SECOND): DecisionChange {
  return {
    kind: 'restock',
    product: 'limonade',
    rule: { kind: 'buyDaily', quantity: glasses },
    ...(truck === undefined ? {} : { truck }),
  }
}

/** `state` played with no event, each close kept, up to the close of `day`. */
function closes(state: GameState, day: number): GameState[] {
  const played: GameState[] = []
  let game = state
  while (game.day <= day) {
    game = tick(
      game,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
      DEFIS,
      PERCENTILES,
      BAKERY,
      GROCERS,
      STAFF,
      FINANCING,
      DREAM,
      PLACES,
    )
    played.push(game)
  }
  return played
}

/** The close of `day`, played from `state`. */
function closeOf(state: GameState, day: number): GameState {
  const close = closes(state, day).at(-1)
  if (close === undefined) throw new Error(`Day ${day} is over already`)
  return close
}

/** The amounts of the entries of `memo` on `day`. */
function amounts(state: GameState, day: number, memo: string): number[] {
  return entriesOf(state.journal)
    .filter((entry) => entry.day === day && entry.memo === memo)
    .map(({ lines }) => lines[0]?.debit ?? 0)
}

const START = createInitialState(SEED)
const ORDERED = decide(START, ordering(30))

describe('lemonade out of its season', () => {
  it('is neither bought, sold, wanted nor priced out in May, whatever its rule', () => {
    const ordered = closes(ORDERED, MAY_31)
    const none = closes(START, MAY_31)
    for (const [index, close] of ordered.entries()) {
      const day = close.lastDay
      expect(day?.sold.limonade).toBe(0)
      expect(day?.lostSales.limonade).toBe(0)
      expect(day?.pricedOut.limonade).toBe(0)
      expect(day?.spoiled.limonade).toBe(0)
      expect(onHand(close.inventory, 'limonade')).toBe(0)
      // Its rule changes nothing: the same customers, books and stock.
      const without = none[index]
      expect(close.rngState).toBe(without?.rngState)
      expect(close.lastDay).toEqual(without?.lastDay)
      expect(entriesOf(close.journal)).toEqual(entriesOf(without!.journal))
    }
    expect(ordered.at(-1)?.lastDay?.visits.length).toBeGreaterThan(0)
  })

  it('buys none from September 16th, and leaves nothing of the 15th', () => {
    const played = closes(closeOf(ORDERED, JUNE_1 + 100), SEPTEMBER_16)
    const fifteenth = played.find(({ day }) => day === SEPTEMBER_15)
    const sixteenth = played.at(-1)
    expect(fifteenth?.lastDay?.sold.limonade).toBeGreaterThan(0)
    // What was left of the 15th's 30 glasses spoiled at its close.
    expect(fifteenth?.lastDay?.spoiled.limonade).toBeGreaterThan(0)
    expect(onHand(fifteenth!.inventory, 'limonade')).toBe(0)
    expect(sixteenth?.lastDay?.visits.length).toBeGreaterThan(0)
    for (const product of [
      'sold',
      'lostSales',
      'pricedOut',
      'spoiled',
    ] as const) {
      expect(sixteenth?.lastDay?.[product].limonade).toBe(0)
    }
    expect(
      sixteenth?.lastDay?.visits.every(({ bought }) => bought.limonade === 0),
    ).toBe(true)
  })
})

describe('lemonade in its season', () => {
  it('is bought and sold on the Plateau from June 1st, what is left written off that night', () => {
    const ordered = closeOf(ORDERED, JUNE_1)
    const none = closeOf(START, JUNE_1)
    const day = ordered.lastDay
    const sold = day?.sold.limonade ?? 0
    const spoiled = day?.spoiled.limonade ?? 0
    expect(sold).toBeGreaterThan(0)
    expect(spoiled).toBeGreaterThan(0)
    expect(sold + spoiled).toBeLessThanOrEqual(30)
    expect(onHand(ordered.inventory, 'limonade')).toBe(0)
    // The same customers come: those who want some find some.
    expect(ordered.rngState).toBe(none.rngState)
    expect(none.lastDay?.lostSales.limonade).toBeGreaterThan(0)
    expect(day?.lostSales.limonade).toBe(0)
    // Its 30 glasses on top of the other purchases, its leftovers on top of
    // the others' spoilage.
    const purchases = 'Achat de marchandises'
    const spoilage = 'Marchandises périmées'
    expect(amounts(ordered, JUNE_1, purchases)).toEqual(
      amounts(none, JUNE_1, purchases).map((n) => n + 30 * unitCostCents),
    )
    expect(amounts(ordered, JUNE_1, spoilage)).toEqual(
      amounts(none, JUNE_1, spoilage).map((n) => n + spoiled * unitCostCents),
    )
  })

  it('is bought and sold by a truck in Vieux-Montréal, its leftovers written off there', () => {
    const owner = [
      { kind: 'buy', rung: 'deuxiemeCamion' },
      { kind: 'ownerAt', truck: SECOND },
      { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7], truck: SECOND },
      ordering(80, SECOND),
    ] as const satisfies readonly DecisionChange[]
    const game = owner.reduce(decide, START)
    const played = closes(game, JUNE_1)
    const truckDay = (state: GameState | undefined) => state?.trucks?.[0]
    const may = truckDay(played.at(-2))
    const june = truckDay(played.at(-1))
    expect(may?.lastDay?.open).toBe(true)
    expect(may?.lastDay?.sold.limonade).toBe(0)
    expect(june?.lastDay?.open).toBe(true)
    expect(june?.lastDay?.sold.limonade).toBeGreaterThan(0)
    expect(june?.lastDay?.spoiled.limonade).toBeGreaterThanOrEqual(0)
    expect(
      (june?.lastDay?.sold.limonade ?? 0) +
        (june?.lastDay?.spoiled.limonade ?? 0),
    ).toBeLessThanOrEqual(80)
    expect(onHand(june?.inventory ?? [], 'limonade')).toBe(0)
    const spoiled = entriesOf(played.at(-1)!.journal).filter(
      ({ day, memo, lines }) =>
        day === JUNE_1 &&
        memo === 'Marchandises périmées' &&
        lines.some(({ truck }) => truck === SECOND),
    )
    expect(spoiled).toHaveLength(1)
  })

  it('sells more on « La canicule », whatever the owner chooses', () => {
    const june1 = closeOf(decide(START, ordering(500)), MAY_31)
    const heat = (choice: string) =>
      resolveEvent(
        {
          ...june1,
          events: {
            ...june1.events,
            pending: { event: 'canicule', followUp: false },
          },
        },
        choice,
        EVENTS,
      )
    const normal = closeOf(june1, JUNE_1).lastDay?.sold.limonade ?? 0
    expect(normal).toBeGreaterThan(0)
    for (const choice of ['glace', 'habitude']) {
      const hot = heat(choice)
      const street = streetOn(hot.events.modifiers, JUNE_1)
      // 1.5, scaled by the difficulty's effects.
      expect(street.appeal.limonade, choice).toBeGreaterThanOrEqual(1.5)
      expect(streetOn(hot.events.modifiers, JUNE_1 + 5).appeal.limonade).toBe(1)
      const sold = closeOf(hot, JUNE_1).lastDay?.sold.limonade ?? 0
      expect(sold, choice).toBeGreaterThan(normal)
    }
  })
})
