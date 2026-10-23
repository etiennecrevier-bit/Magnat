import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import { loadDreamContent, type DreamContent } from '../content/schema.ts'
import { salesByTruck } from '../finance/byTruck.ts'
import { balance, entriesOf, type Journal } from '../finance/journal.ts'
import { balanceSheet, incomeStatement } from '../finance/statements.ts'
import { BAKERY } from './bakery.ts'
import { toCalendar } from './calendar.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import { applyDecision, type DecisionChange } from './decisions.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING } from './financing.ts'
import { inventoryValue } from './inventory.ts'
import { PERCENTILES } from './percentiles.ts'
import { PLACES } from './places.ts'
import { STAFF, askingWage } from './staff.ts'
import { FIRST_TRUCK } from './trucks.ts'
import type { GameState, TruckId } from './types.ts'

// The invariants of tests/invariants.test.ts, for a game of two trucks
// (#259): ten years in which the balance sheet balances every day, every
// truck's lots cost what Stocks carries, the sales by truck add up to
// Ventes, and the game replays to the same books.

const SEED = 42
const DAYS = 3650
const SECOND: TruckId = 'vieuxMontreal'

/** « Deuxième camion » for sale first in its ladder, at a price day 0 pays. */
const DREAM: DreamContent = loadDreamContent({
  ...dreamJson,
  company: [
    { ...dreamJson.company[2], comingSoon: undefined, priceCents: 500_000 },
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

/**
 * The second truck bought on day 0, Kevin « Au camion » there, and the
 * owner moving between the two trucks on each 1st, so each opens with and
 * without them. Calls `check` on each close.
 */
function tenYears(check: (state: GameState) => void = () => {}): GameState {
  let state = [
    { kind: 'buy', rung: 'deuxiemeCamion' },
    {
      kind: 'hire',
      role: 'camion',
      candidate: 'kevin',
      hourlyWage: askingWage('kevin', 'camion'),
    },
    { kind: 'assign', candidate: 'kevin', truck: SECOND },
  ].reduce<GameState>(
    (game, change) => decide(game, change as DecisionChange),
    createInitialState(SEED),
  )
  for (let day = 0; day < DAYS; day += 1) {
    const { dayOfMonth, month } = toCalendar(day)
    if (dayOfMonth === 1) {
      state = decide(state, {
        kind: 'ownerAt',
        truck: month % 2 === 0 ? FIRST_TRUCK : SECOND,
      })
    }
    state = tick(
      state,
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
    check(state)
  }
  return state
}

/** The journal's entries as text, to compare two games' books. */
function books(journal: Journal): string {
  return JSON.stringify(entriesOf(journal))
}

describe('ten years of two trucks', () => {
  it('balance every day, sell from both, add up by truck and replay the same', () => {
    const failures: string[] = []
    const opened = new Map<TruckId, number>()
    const game = tenYears((state) => {
      // `tick()` returns the next morning: the day just played is the one
      // before.
      const day = state.day - 1
      const { journal } = state
      const sheet = balanceSheet(journal, day)
      if (
        sheet.assets.total.amount !== sheet.totalLiabilitiesAndEquity.amount
      ) {
        failures.push(`day ${day}: the bilan does not balance`)
      }
      const lots = [
        ...state.inventory,
        ...(state.trucks ?? []).flatMap(({ inventory }) => inventory),
      ]
      if (balance(journal, '1200', { toDay: day }) !== inventoryValue(lots)) {
        failures.push(`day ${day}: Stocks is not every truck's lots`)
      }
      const byTruck = salesByTruck(journal, { fromDay: day, toDay: day })
      const total = [...byTruck.values()].reduce((a, b) => a + b, 0)
      if (total !== incomeStatement(journal, day, day).sales.amount) {
        failures.push(`day ${day}: the sales by truck are not Ventes`)
      }
      for (const truck of byTruck.keys()) {
        if (truck !== null) opened.set(truck, (opened.get(truck) ?? 0) + 1)
      }
    })
    expect(failures).toEqual([])
    expect(game.ended).toBeNull()
    expect(game.day).toBe(DAYS)
    // The first truck sells in the months the owner is there, the second
    // whenever Kevin comes, both closed on Mondays.
    expect(opened.get(FIRST_TRUCK)).toBeGreaterThan(DAYS / 3)
    expect(opened.get(SECOND)).toBeGreaterThan((DAYS * 2) / 3)
    expect(books(tenYears().journal) === books(game.journal)).toBe(true)
  }, 120_000)
})
