import {
  loadEventContent,
  type DefiContent,
  type EventCard,
  type EventChoiceRef,
  type EventConditions,
  type EventContent,
  type FoodTruckContent,
  type PercentileContent,
  type RestockRule,
  type Standing,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { toCalendar } from './calendar.ts'
import { allowedChoices } from './challenge.ts'
import { DEFIS, EVENTS, FOOD_TRUCK } from './day.ts'
import { applyEffect, insertByDay, untimed, whenDue } from './effects.ts'
import { PERCENTILES } from './percentiles.ts'
import { next } from './rng.ts'
import { effectsAt } from './scaling.ts'
import { standingOf } from './standing.ts'
import { streetOn } from './street.ts'
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

/** No scaling: how a Défi plays the cards, as they are written. */
const AS_WRITTEN: Pick<EventContent, 'scaling'> = {}

/**
 * How the cards scale in `state`'s game: as `content` sets for its
 * difficulty, but in a Défi, whose medals take the cards as written.
 */
export function scalingOf(
  { challenge }: Pick<GameState, 'challenge'>,
  content: EventContent = EVENTS,
): Pick<EventContent, 'scaling'> {
  return challenge === null ? content : AS_WRITTEN
}

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
 *    `content` and only comes as a follow-up (`followUpOnly`) comes up: the
 *    rest of a story, such as a payment due that morning, keeps its day.
 * 2. Otherwise nothing new comes before `pacing.firstDay`, nor with a
 *    `pacing.dailyChance` of 0. The events that may come are those with a
 *    weight above 0, not `followUpOnly`, whose conditions all hold that
 *    morning (see `conditionsHold`). At a difficulty of `adaptiveDraw`, but
 *    in a Défi, an event's weight is its `weightByStanding` for the
 *    player's standing that morning against `percentiles` (see
 *    `standingOf`), if it sets one.
 * 3. Otherwise an event dated that day that may come comes up, whatever
 *    the gap and with no draw against the chance; one draw picks by weight
 *    among several. `lastDrawnDay` is set to the day.
 * 4. Otherwise the first queued follow-up due that day or before whose
 *    event is in `content` comes up: a card coming back can wait a morning
 *    for a dated one.
 * 5. Otherwise nothing comes less than `pacing.minDaysBetween` days after
 *    `lastDrawnDay`, nor when no event may come. Then one draw against
 *    `pacing.dailyChance`, then one draw to pick by weight, and the event
 *    picked comes up with `lastDrawnDay` set to the day. A chance of 1, or a
 *    single event to pick, takes no draw.
 * A follow-up takes no draw, ignores the conditions, the first day and the
 * gap, and leaves `lastDrawnDay` as it is; any other one due waits for a
 * later morning. Returns a new state; never mutates `state`.
 */
export function drawEvent(
  state: GameState,
  content: EventContent,
  percentiles: PercentileContent = PERCENTILES,
): GameState {
  const { day, events } = state
  if (events.pending !== null || events.history.at(-1)?.day === day) {
    return state
  }

  const cards = new Map(content.events.map((event) => [event.id, event]))
  const story = events.followUps.findIndex(
    ({ day: due, event }) =>
      due <= day && cards.get(event)?.conditions?.followUpOnly === true,
  )
  if (story !== -1) return withFollowUp(state, story)

  const { firstDay, minDaysBetween, dailyChance } = content.pacing
  const drawing = day >= firstDay && dailyChance > 0
  const seen = lastSeen(events.history)
  const weightOf = weighing(state, content, percentiles)
  const mayCome = (event: EventCard) =>
    event.conditions?.followUpOnly !== true &&
    conditionsHold(event, state, seen) &&
    weightOf(event) > 0

  if (drawing) {
    const today = toCalendar(day)
    const dated = content.events.filter(
      (event) =>
        event.conditions?.date?.month === today.month &&
        event.conditions.date.dayOfMonth === today.dayOfMonth &&
        mayCome(event),
    )
    if (dated.length > 0) return picking(state, dated, weightOf, 1)
  }

  const due = events.followUps.findIndex(
    ({ day: from, event }) => from <= day && cards.has(event),
  )
  if (due !== -1) return withFollowUp(state, due)

  if (
    !drawing ||
    (events.lastDrawnDay !== null && day - events.lastDrawnDay < minDaysBetween)
  ) {
    return state
  }
  const eligible = content.events.filter(mayCome)
  if (eligible.length === 0) return state
  return picking(state, eligible, weightOf, dailyChance)
}

/** `state` with its follow-up at `index` waiting, out of the queue. */
function withFollowUp(state: GameState, index: number): GameState {
  const { events } = state
  const followUp = events.followUps[index]
  if (followUp === undefined) return state
  return {
    ...state,
    events: {
      ...events,
      pending: { event: followUp.event, followUp: true },
      followUps: events.followUps.filter((_, at) => at !== index),
    },
  }
}

/**
 * `state` with one of `eligible`, which holds at least one, waiting as drawn
 * that day: one draw against `chance`, unless it is 1, then one draw to
 * pick by weight, unless there is a single event.
 */
function picking(
  state: GameState,
  eligible: readonly EventCard[],
  weightOf: (event: EventCard) => number,
  chance: number,
): GameState {
  let { rngState } = state
  if (chance < 1) {
    const [value, after] = next(rngState)
    rngState = after
    if (value >= chance) return { ...state, rngState }
  }
  let [picked] = eligible
  if (eligible.length > 1) {
    const [value, after] = next(rngState)
    rngState = after
    picked = byWeight(eligible, weightOf, value)
  }
  if (picked === undefined) return state
  return {
    ...state,
    rngState,
    events: {
      ...state.events,
      pending: { event: picked.id, followUp: false },
      lastDrawnDay: state.day,
    },
  }
}

/**
 * Whether every condition `event` sets holds on the morning of `state.day`,
 * with `seen` as the last day each event came up: the day is no earlier than
 * `fromDay`; the game's difficulty, the month, the date (month and day of
 * the month) and the weekday are among those listed; the owner's energy is
 * below `energyBelow`; the product of `productOnMenu` has a restock rule
 * that buys some; the truck opens the next day, or stays closed, as
 * `openTomorrow` says (see `opensOn`); the event never came up, for
 * `oncePerGame`, came up fewer than `maxPerGame` times, or came up at least
 * `cooldownDays` days ago, follow-ups included; the history holds one of the
 * choices `chosen` lists, and none of those `notChosen` lists; and Encaisse
 * is above `cashAboveCents` and below `cashBelowCents`, read from the books
 * only when every other condition holds. `followUpOnly` is `drawEvent`'s,
 * not checked here.
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
    openTomorrow,
    oncePerGame,
    maxPerGame,
    cooldownDays,
    chosen,
    notChosen,
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
  if (openTomorrow !== undefined && opensOn(state, day + 1) !== openTomorrow) {
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
  const { history } = state.events
  if (
    maxPerGame !== undefined &&
    history.filter(({ event }) => event === id).length >= maxPerGame
  ) {
    return false
  }
  if (chosen !== undefined && !madeOneOf(history, chosen)) return false
  if (notChosen !== undefined && madeOneOf(history, notChosen)) return false
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
 * outcome's effects that apply at the game's difficulty then run in order,
 * scaled as the game scales them (see `scalingOf` and `effectsAt`), those
 * that start now applied at once (see `applyEffect`, with `foodTruck`'s
 * unit costs) and the others queued for their day (see `whenDue`), as they
 * will run. The event goes into the history and no longer waits. Returns a new state; never mutates `state`. Throws
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
  const effects = effectsAt(
    choice.outcomes[index]?.effects ?? [],
    state.profile.difficulty,
    scalingOf(state, content),
  )
  for (const timed of effects) {
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

/** Whether `history` records one of the `choices`, each of its event. */
function madeOneOf(
  history: readonly EventRecord[],
  choices: readonly EventChoiceRef[],
): boolean {
  return choices.some(({ event, choice }) =>
    history.some(
      (record) => record.event === event && record.choice === choice,
    ),
  )
}

/** Whether a restock rule buys some of its product. */
function onMenu(rule: RestockRule): boolean {
  return rule.kind === 'buyDaily' ? rule.quantity > 0 : rule.upTo > 0
}

/**
 * Whether the truck opens on `day`, as the morning of `state` sees it: the
 * days open hold its weekday, and no change to the street closes it, among
 * those in effect and those the delayed effects will make.
 */
function opensOn(state: GameState, day: Day): boolean {
  const { daysOpen } = state.decisions
  const { modifiers, delayed } = state.events
  return (
    daysOpen.includes(toCalendar(day).weekday) &&
    !streetOn(modifiers, day).closed &&
    !delayed.some(
      ({ day: from, effect }) =>
        effect.kind === 'closed' && from <= day && day < from + effect.days,
    )
  )
}

/**
 * How much each event weighs in the draw on the morning of `state.day`: its
 * `weight`, or at a difficulty of `content.adaptiveDraw` but in a Défi, its
 * `weightByStanding` for the player's standing against `percentiles`, if it
 * sets one. The standing is read once, and only if an event asks.
 */
function weighing(
  state: GameState,
  { adaptiveDraw }: EventContent,
  percentiles: PercentileContent,
): (event: EventCard) => number {
  if (
    adaptiveDraw === undefined ||
    state.challenge !== null ||
    !adaptiveDraw.difficulties.includes(state.profile.difficulty)
  ) {
    return ({ weight }) => weight
  }
  let standing: Standing | undefined
  return ({ weight, weightByStanding }) => {
    if (weightByStanding === undefined) return weight
    standing ??= standingOf(state, adaptiveDraw, percentiles)
    return weightByStanding[standing] ?? weight
  }
}

/**
 * The event `value`, in [0, 1), falls on when each weighs what `weightOf`
 * gives it.
 */
function byWeight(
  events: readonly EventCard[],
  weightOf: (event: EventCard) => number,
  value: number,
): EventCard {
  const total = events.reduce((sum, event) => sum + weightOf(event), 0)
  const target = value * total
  let reached = 0
  for (const event of events) {
    reached += weightOf(event)
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
