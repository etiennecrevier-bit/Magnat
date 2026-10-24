import { toCalendar } from '../../engine/calendar.ts'
import { tick } from '../../engine/clock.ts'
import { applyDecision, type DecisionChange } from '../../engine/decisions.ts'
import type { Cents } from '../../engine/money.ts'
import { askingWage } from '../../engine/staff.ts'
import { FIRST_TRUCK, newTruck, truckDecisionsOf } from '../../engine/trucks.ts'
import type { Day, Decisions, GameState, TruckId } from '../../engine/types.ts'

// Two-truck games for the UI's tests (#265): the second truck put in a game
// as buying « Deuxième camion » does, without its price, so a test needs no
// cash nor the rungs before it.

/** The second truck's id and district. */
export const SECOND = 'vieuxMontreal' satisfies TruckId

/** `decisions` running the second truck as the first one runs. */
function withSecondDecisions(decisions: Decisions): Decisions {
  return {
    ...decisions,
    trucks: {
      ...decisions.trucks,
      [SECOND]: truckDecisionsOf(decisions, FIRST_TRUCK),
    },
  }
}

/**
 * `state` with Vieux-Montréal's truck bought on its morning, run as the
 * first one is, then each of `changes` made.
 */
export function withSecondTruck(
  state: GameState,
  ...changes: readonly DecisionChange[]
): GameState {
  const bought: GameState = {
    ...state,
    trucks: [
      ...(state.trucks ?? []),
      newTruck(state.seed, { id: SECOND, district: SECOND }, state.day),
    ],
    decisions: withSecondDecisions(state.decisions),
    pendingDecisions:
      state.pendingDecisions === null
        ? null
        : withSecondDecisions(state.pendingDecisions),
  }
  return decided(bought, ...changes)
}

/** `state` with each of `changes` made, in order. */
export function decided(
  state: GameState,
  ...changes: readonly DecisionChange[]
): GameState {
  return changes.reduce((game, change) => applyDecision(game, change), state)
}

/** Hiring `candidate` « Au camion » at `hourlyWage`, what they ask by default. */
export function hiring(
  candidate: 'kevin' | 'amelie',
  hourlyWage: Cents = askingWage(candidate, 'camion'),
): DecisionChange {
  return { kind: 'hire', role: 'camion', candidate, hourlyWage }
}

/** `state` played to the morning of `day`. */
export function playedTo(state: GameState, day: Day): GameState {
  let game = state
  while (game.day < day) game = tick(game)
  return game
}

/**
 * The game day of `dayOfMonth` `month` (1 = January) in game year `year`:
 * year 1 starts on May 1st, day 0.
 */
export function dateDay(year: number, month: number, dayOfMonth: number): Day {
  for (let day = 0; ; day += 1) {
    const date = toCalendar(day)
    if (
      date.year === year &&
      date.month === month &&
      date.dayOfMonth === dayOfMonth
    ) {
      return day
    }
    if (date.year > year) throw new RangeError('No such date')
  }
}
