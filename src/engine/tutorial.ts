import {
  loadTutorialContent,
  type EventContent,
  type TutorialContent,
  type TutorialStep,
} from '../content/schema.ts'
import { PRODUCTS } from './inventory.ts'
import type { Decisions, GameState, TutorialState } from './types.ts'

// The tutorial (#236): seven protected, scripted days with Réal, then the
// same game, unprotected. The engine keeps the steps in order and refuses
// to play a day whose steps are not done, so the UI can never run the days
// ahead of the player; what a step says and where it points are the UI's.

/**
 * The tutorial of `src/content/tutorial.json`, checked against the event
 * cards it loads on its own.
 */
export const TUTORIAL: TutorialContent = loadTutorialContent()

/** What the UI may say of the last day, whatever the player changed. */
export interface TutorialFacts {
  /** Customers asked for croissants after they had sold out. */
  readonly croissantShortage: boolean
  /** Customers found the café too expensive. */
  readonly cafeTooExpensive: boolean
}

/**
 * The tutorial a game starts with: on its first step, from day 0 to the
 * morning after its last day, neither done nor skipped.
 */
export function openingTutorial(
  tutorial: TutorialContent = TUTORIAL,
): TutorialState {
  return {
    step: tutorial.steps[0]?.id ?? null,
    startedDay: 0,
    endsDay: tutorial.days,
    done: false,
    skipped: false,
  }
}

/**
 * `decisions` with the tutorial's laid over them: the prices and restock
 * rules of the products it names, and the weekdays open, ascending.
 */
export function tutorialDecisions(
  decisions: Decisions,
  tutorial: TutorialContent = TUTORIAL,
): Decisions {
  const { pricesCents, restock, daysOpen } = tutorial.decisions
  return {
    ...decisions,
    prices: Object.fromEntries(
      PRODUCTS.map((product) => [
        product,
        pricesCents?.[product] ?? decisions.prices[product],
      ]),
    ) as Decisions['prices'],
    restock: Object.fromEntries(
      PRODUCTS.map((product) => [
        product,
        restock?.[product] ?? decisions.restock[product],
      ]),
    ) as Decisions['restock'],
    daysOpen:
      daysOpen === undefined
        ? decisions.daysOpen
        : [...new Set(daysOpen)].sort((a, b) => a - b),
  }
}

/** Whether `state`'s game is protected: its tutorial is not done. */
export function isProtected({
  tutorial,
}: Pick<GameState, 'tutorial'>): boolean {
  return tutorial !== undefined && !tutorial.done
}

/**
 * The tutorial's day `state.day` is, from 1 on the day it started; null in
 * a game without one.
 */
export function tutorialDay({
  day,
  tutorial,
}: Pick<GameState, 'day' | 'tutorial'>): number | null {
  return tutorial === undefined ? null : day - tutorial.startedDay + 1
}

/**
 * The step of `tutorial` with the id `id`. Throws a RangeError when it has
 * none.
 */
export function tutorialStep(
  id: string,
  tutorial: TutorialContent = TUTORIAL,
): TutorialStep {
  const step = tutorial.steps.find((candidate) => candidate.id === id)
  if (step === undefined) {
    throw new RangeError(`Unknown tutorial step: ${id}`)
  }
  return step
}

/**
 * The step the player is asked to do on `state`'s morning: the current
 * step, once its day has come, while the game is protected; null
 * otherwise, and once no step is left.
 */
export function tutorialStepOf(
  state: Pick<GameState, 'day' | 'tutorial'>,
  tutorial: TutorialContent = TUTORIAL,
): TutorialStep | null {
  const { tutorial: progress } = state
  if (progress === undefined || progress.done || progress.step === null) {
    return null
  }
  const step = tutorialStep(progress.step, tutorial)
  return step.day <= (tutorialDay(state) ?? 0) ? step : null
}

/**
 * `state` with its tutorial's step `id` done, and the next step of
 * `tutorial` current, or none after the last. Returns a new state; never
 * mutates `state`. Throws a RangeError unless the game is protected and
 * `id` is the step the player is asked to do that day (see
 * `tutorialStepOf`).
 */
export function completeStep(
  state: GameState,
  id: string,
  tutorial: TutorialContent = TUTORIAL,
): GameState {
  const { tutorial: progress } = state
  if (progress === undefined || progress.done) {
    throw new RangeError(`Invalid tutorial step ${id}: no tutorial under way`)
  }
  const due = tutorialStepOf(state, tutorial)
  if (due?.id !== id) {
    throw new RangeError(
      `Invalid tutorial step ${id}: the step due on day ${state.day} is ${due?.id ?? 'none'}`,
    )
  }
  const index = tutorial.steps.indexOf(due)
  return {
    ...state,
    tutorial: { ...progress, step: tutorial.steps[index + 1]?.id ?? null },
  }
}

/**
 * `state` with its tutorial over at once, skipped: no step left and the
 * game no longer protected. Returns a new state; never mutates `state`.
 * Throws a RangeError when the game has no tutorial, or it is done.
 */
export function skipTutorial(state: GameState): GameState {
  const { tutorial: progress } = state
  if (progress === undefined || progress.done) {
    throw new RangeError('No tutorial under way to skip')
  }
  return {
    ...state,
    tutorial: { ...progress, step: null, done: true, skipped: true },
  }
}

/**
 * Throws an Error naming the step while the game is protected and a step
 * due on `state.day`, or before, is not done: the day cannot be played.
 */
export function checkTutorialDay(
  state: Pick<GameState, 'day' | 'tutorial'>,
  tutorial: TutorialContent = TUTORIAL,
): void {
  const step = tutorialStepOf(state, tutorial)
  if (step === null) return
  throw new Error(
    `Day ${state.day} cannot be played: the tutorial's step ${step.id} is not done`,
  )
}

/**
 * The morning of `state.day` with the tutorial done once the protection
 * ends, on `endsDay` or later; `state` itself otherwise. Nothing else
 * changes.
 */
export function endOfProtection(state: GameState): GameState {
  const { tutorial: progress } = state
  if (progress === undefined || progress.done || state.day < progress.endsDay) {
    return state
  }
  return { ...state, tutorial: { ...progress, done: true } }
}

/**
 * The morning of `state.day` with the card `tutorial` brings on that
 * tutorial day waiting, as if drawn that morning, while the game is
 * protected and `events` holds it; `state` itself otherwise.
 */
export function withScriptedEvent(
  state: GameState,
  events: EventContent,
  tutorial: TutorialContent = TUTORIAL,
): GameState {
  if (!isProtected(state) || state.events.pending !== null) return state
  const today = tutorialDay(state)
  const scripted = tutorial.scriptedEvents.find(({ day }) => day === today)
  if (
    scripted === undefined ||
    !events.events.some(({ id }) => id === scripted.event)
  ) {
    return state
  }
  return {
    ...state,
    events: {
      ...state.events,
      pending: { event: scripted.event, followUp: false },
      lastDrawnDay: state.day,
    },
  }
}

/**
 * What the last day played showed: a croissant shortage, when customers
 * asked for croissants after they sold out, and customers who found the
 * café too expensive. Both false before the first day is played.
 */
export function tutorialFacts({
  lastDay,
}: Pick<GameState, 'lastDay'>): TutorialFacts {
  return {
    croissantShortage: (lastDay?.lostSales.croissant ?? 0) > 0,
    cafeTooExpensive: (lastDay?.pricedOut.cafe ?? 0) > 0,
  }
}
