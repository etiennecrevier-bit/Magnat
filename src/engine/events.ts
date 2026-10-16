import {
  loadEventContent,
  type DefiContent,
  type EventCard,
  type EventConditions,
  type EventContent,
  type FoodTruckContent,
  type RestockRule,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { toCalendar } from './calendar.ts'
import { allowedChoices } from './challenge.ts'
import { DEFIS, EVENTS, FOOD_TRUCK } from './day.ts'
import { applyEffect, insertByDay, untimed, whenDue } from './effects.ts'
import { next } from './rng.ts'
import type { Day, EventRecord, EventsState, GameState } from './types.ts'

// The event cards: a morning may bring a dilemma, which waits for the
// player's choice before the day can be played. Drawing an event, and
// whatever a choice leaves to chance, uses the seeded generator.

const CASH: AccountCode = '1000'

/**
 * No event at all: what `tick()` plays with unless it is given the content,
 * so that a game, a test or a tool turns events on by choice.
 */
export const NO_EVENTS: EventContent = loadEventContent({
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 0 },
  events: [],
})

/** The events of a game that has had none yet. */
export function noEvents(): EventsState {
  return {
    pending: null,
    delayed: [],
    followUps: [],
    history: [],
    lastDrawnDay: null,
    headlines: [],
    modifiers: [],
  }
}

/**
 * The morning of `state.day`'s event, if any, waiting in `events.pending`.
 * One morning brings one event at most: nothing changes while one waits, or
 * once one was chosen that morning. Otherwise, in this order:
 * 1. The first queued follow-up due that day or before whose event is in
 *    `content` comes up, with no draw. It ignores the conditions, the first
 *    day and the gap, and leaves `lastDrawnDay` as it is; any other one due
 *    waits for a later morning.
 * 2. Otherwise nothing comes before `pacing.firstDay`, nor less than
 *    `pacing.minDaysBetween` days after `lastDrawnDay`.
 * 3. Otherwise the events that may come are those with a weight above 0,
 *    not `followUpOnly`, whose conditions all hold that morning (see
 *    `conditionsHold`). With none, nothing is drawn.
 * 4. Otherwise one draw against `pacing.dailyChance`, then one draw to pick
 *    among them by weight, and the event picked comes up with
 *    `lastDrawnDay` set to the day. A chance of 1, or a single event to
 *    pick, takes no draw.
 * Returns a new state; never mutates `state`.
 */
export function drawEvent(state: GameState, content: EventContent): GameState {
  const { day, events } = state
  if (events.pending !== null || events.history.at(-1)?.day === day) {
    return state
  }

  const known = new Set(content.events.map(({ id }) => id))
  const due = events.followUps.findIndex(
    (followUp) => followUp.day <= day && known.has(followUp.event),
  )
  const followUp = events.followUps[due]
  if (followUp !== undefined) {
    return {
      ...state,
      events: {
        ...events,
        pending: { event: followUp.event, followUp: true },
        followUps: events.followUps.filter((_, index) => index !== due),
      },
    }
  }

  const { firstDay, minDaysBetween, dailyChance } = content.pacing
  if (day < firstDay || dailyChance === 0) return state
  if (
    events.lastDrawnDay !== null &&
    day - events.lastDrawnDay < minDaysBetween
  ) {
    return state
  }
  const seen = lastSeen(events.history)
  const eligible = content.events.filter(
    (event) =>
      event.weight > 0 &&
      event.conditions?.followUpOnly !== true &&
      conditionsHold(event, state, seen),
  )
  if (eligible.length === 0) return state

  let { rngState } = state
  if (dailyChance < 1) {
    const [value, after] = next(rngState)
    rngState = after
    if (value >= dailyChance) return { ...state, rngState }
  }
  let [picked] = eligible
  if (eligible.length > 1) {
    const [value, after] = next(rngState)
    rngState = after
    picked = byWeight(eligible, value)
  }
  if (picked === undefined) return state
  return {
    ...state,
    rngState,
    events: {
      ...events,
      pending: { event: picked.id, followUp: false },
      lastDrawnDay: day,
    },
  }
}

/**
 * Whether every condition `event` sets holds on the morning of `state.day`,
 * with `seen` as the last day each event came up: the day is no earlier than
 * `fromDay`; the game's difficulty, the month, the date (month and day of
 * the month) and the weekday are among those listed; the owner's energy is
 * below `energyBelow`; the product of `productOnMenu` has a restock rule
 * that buys some; the event never came up, for `oncePerGame`, or came up at
 * least `cooldownDays` days ago; and Encaisse is above `cashAboveCents` and
 * below `cashBelowCents`, read from the books only when every other
 * condition holds. `followUpOnly` is `drawEvent`'s, not checked here.
 */
export function conditionsHold(
  { id, conditions = {} }: EventCard,
  state: GameState,
  seen: ReadonlyMap<string, Day>,
): boolean {
  const { day } = state
  const {
    fromDay,
    difficulties,
    months,
    date,
    weekdays,
    energyBelow,
    productOnMenu,
    oncePerGame,
    cooldownDays,
    cashAboveCents,
    cashBelowCents,
  }: EventConditions = conditions
  if (fromDay !== undefined && day < fromDay) return false
  if (
    difficulties !== undefined &&
    !difficulties.includes(state.profile.difficulty)
  ) {
    return false
  }
  const today = toCalendar(day)
  if (months !== undefined && !months.includes(today.month)) return false
  if (
    date !== undefined &&
    (date.month !== today.month || date.dayOfMonth !== today.dayOfMonth)
  ) {
    return false
  }
  if (weekdays !== undefined && !weekdays.includes(today.weekday)) return false
  if (energyBelow !== undefined && !(state.energy < energyBelow)) return false
  if (
    productOnMenu !== undefined &&
    !onMenu(state.decisions.restock[productOnMenu])
  ) {
    return false
  }
  const last = seen.get(id)
  if (oncePerGame === true && last !== undefined) return false
  if (
    cooldownDays !== undefined &&
    last !== undefined &&
    day - last < cooldownDays
  ) {
    return false
  }
  if (cashAboveCents === undefined && cashBelowCents === undefined) return true
  const cash = balance(state.journal, CASH, { toDay: day })
  return (
    (cashAboveCents === undefined || cash > cashAboveCents) &&
    (cashBelowCents === undefined || cash < cashBelowCents)
  )
}

/**
 * Plays the player's choice `choiceId` on the event waiting: one draw picks
 * the outcome by its chance, unless the choice has a single outcome; the
 * outcome's effects then run in order, those that start now applied at
 * once (see `applyEffect`, with `foodTruck`'s unit costs) and the others
 * queued for their day (see `whenDue`). The event goes into the history
 * and no longer waits. Returns a new state; never mutates `state`. Throws
 * an Error when no event waits, and a RangeError when `content` does not
 * hold the event, the event has no such choice, or the game's Défi, one of
 * `defis`, forces the event that morning without allowing the choice (see
 * `allowedChoices`).
 */
export function resolveEvent(
  state: GameState,
  choiceId: string,
  content: EventContent = EVENTS,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
  defis: DefiContent = DEFIS,
): GameState {
  const { pending } = state.events
  if (pending === null) {
    throw new Error(`No event is waiting on day ${state.day}`)
  }
  const event = content.events.find(({ id }) => id === pending.event)
  if (event === undefined) {
    throw new RangeError(`Unknown event: ${pending.event}`)
  }
  const choice = event.choices.find(({ id }) => id === choiceId)
  if (choice === undefined) {
    throw new RangeError(`The event ${event.id} has no choice ${choiceId}`)
  }
  const allowed = allowedChoices(state, defis)
  if (allowed !== null && !allowed.includes(choice.id)) {
    throw new RangeError(
      `The Défi ${state.challenge?.id} does not allow the choice ${choice.id} of ${event.id}`,
    )
  }

  let { rngState } = state
  let index = 0
  if (choice.outcomes.length > 1) {
    const [value, after] = next(rngState)
    rngState = after
    index = byChance(choice.outcomes, value)
  }
  const record: EventRecord = {
    day: state.day,
    event: event.id,
    followUp: pending.followUp,
    choice: choice.id,
    outcome: index,
  }
  let resolved: GameState = {
    ...state,
    rngState,
    events: {
      ...state.events,
      pending: null,
      history: [...state.events.history, record],
    },
  }
  for (const timed of choice.outcomes[index]?.effects ?? []) {
    const day = whenDue(timed, state.day)
    const effect = untimed(timed)
    resolved =
      day === state.day
        ? applyEffect(resolved, effect, foodTruck, event.id)
        : {
            ...resolved,
            events: {
              ...resolved.events,
              delayed: insertByDay(resolved.events.delayed, {
                day,
                event: event.id,
                effect,
              }),
            },
          }
  }
  return resolved
}

/** The last day each event came up, by its id. */
function lastSeen(history: readonly EventRecord[]): Map<string, Day> {
  const seen = new Map<string, Day>()
  for (const { event, day } of history) seen.set(event, day)
  return seen
}

/** Whether a restock rule buys some of its product. */
function onMenu(rule: RestockRule): boolean {
  return rule.kind === 'buyDaily' ? rule.quantity > 0 : rule.upTo > 0
}

/** The event `value`, in [0, 1), falls on when each takes its weight. */
function byWeight(events: readonly EventCard[], value: number): EventCard {
  const total = events.reduce((sum, { weight }) => sum + weight, 0)
  const target = value * total
  let reached = 0
  for (const event of events) {
    reached += event.weight
    if (target < reached) return event
  }
  // Only when the weights' float sum falls short of `total` at the end.
  return events[events.length - 1] as EventCard
}

/** The index of the outcome `value`, in [0, 1), falls on by chance. */
function byChance(
  outcomes: readonly { readonly chance: number }[],
  value: number,
): number {
  let reached = 0
  for (const [index, { chance }] of outcomes.entries()) {
    reached += chance
    if (value < reached) return index
  }
  // Chances sum to 1 only to within a rounding error.
  return outcomes.length - 1
}
