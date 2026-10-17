import {
  loadPlacesContent,
  placeIdSchema,
  type DreamContent,
  type EventContent,
  type FinancingContent,
  type FoodTruckContent,
  type Place,
  type PlaceId,
  type PlacesContent,
} from '../content/schema.ts'
import { EVENTS, FOOD_TRUCK } from './day.ts'
import { DREAM, travelTimeFactor } from './dream.ts'
import { FINANCING, appointmentLoan, lendingRefusal } from './financing.ts'
import { SECONDS_PER_MINUTE, type Away } from './service.ts'
import type { DreamState, GameState, TownState } from './types.ts'

// « Aller à… » (#164): the owner goes to the Caisse, the mill, the permits
// office or the fournil. A trip is a decision for the day under way: the
// owner leaves the truck at the content's minute and comes back once they
// walked there, stayed and walked back, or is away the whole day. Without
// an employee at the truck, it serves nobody meanwhile. Nothing here draws
// from the generator.

/**
 * The shipped places, validated once against the shipped truck's hours
 * when the engine loads.
 */
export const PLACES: PlacesContent = loadPlacesContent()

/** The town of a game that has made no trip. */
export function noTrips(): TownState {
  return { trip: null, discount: 0 }
}

/** Whether `value` is the id of a place. */
export function isPlaceId(value: unknown): value is PlaceId {
  return placeIdSchema.safeParse(value).success
}

/**
 * The place `id` of `content`. Throws a RangeError for an id that is no
 * place.
 */
export function placeOf(id: PlaceId, content: PlacesContent = PLACES): Place {
  const place = content.places.find((candidate) => candidate.id === id)
  if (place === undefined) throw new RangeError(`Unknown place: ${String(id)}`)
  return place
}

/** How long a trip takes the owner. */
export type TripTime =
  | { readonly wholeDay: true }
  | {
      readonly wholeDay: false
      /** The minutes of each walk, there and back. */
      readonly legMinutes: number
      /** The minutes the owner stays there. */
      readonly visitMinutes: number
      /** The minute of the day the owner leaves the truck. */
      readonly leavesAtMinute: number
      /** The minute of the day they are back at it. */
      readonly backAtMinute: number
    }

/**
 * How long a trip to `id` of `content` takes an owner with the rungs of
 * `dream` bought: the whole day, or, from `leavesAtMinute`, a walk there,
 * the visit and a walk back, each walk its minutes × the best vehicle's
 * factor (see `travelTimeFactor`), rounded to the minute.
 */
export function tripTime(
  id: PlaceId,
  dream: DreamState,
  content: PlacesContent = PLACES,
  dreamContent: DreamContent = DREAM,
): TripTime {
  const place = placeOf(id, content)
  if ('wholeDay' in place) return { wholeDay: true }
  const legMinutes = Math.round(
    place.walkMinutes * travelTimeFactor(dream, dreamContent),
  )
  const { leavesAtMinute } = content
  const { visitMinutes } = place
  return {
    wholeDay: false,
    legMinutes,
    visitMinutes,
    leavesAtMinute,
    backAtMinute: leavesAtMinute + 2 * legMinutes + visitMinutes,
  }
}

/**
 * When the owner is away from the counter on business day `state.day`, in
 * seconds of the day: the window of the day's trip (see `tripTime`); null
 * with no trip, or one that takes the whole day, which `ownerAway` says.
 */
export function awayFromCounter(
  state: Pick<GameState, 'town' | 'dream'>,
  content: PlacesContent = PLACES,
  dreamContent: DreamContent = DREAM,
): Away | null {
  const { trip } = state.town
  if (trip === null) return null
  const time = tripTime(trip, state.dream, content, dreamContent)
  if (time.wholeDay) return null
  return {
    from: time.leavesAtMinute * SECONDS_PER_MINUTE,
    to: time.backAtMinute * SECONDS_PER_MINUTE,
  }
}

/**
 * Why the owner cannot go to `id` on the morning of `state.day`, or null
 * when they can: `defi` in a Défi, `ended` once the game has ended,
 * `played` once the day is played, and, for a place whose effect is the
 * lender's appointment, why she would not lend the next morning, on the
 * terms of `events`' card, as the books stand now (see `lendingRefusal`):
 * `came`, `mayNotLend` or `noNeed`, which `events` without her card gives
 * too.
 */
export type TripRefusal =
  'defi' | 'ended' | 'played' | 'came' | 'mayNotLend' | 'noNeed'

/** See `TripRefusal`. Throws a RangeError for an id that is no place. */
export function tripRefusal(
  state: GameState,
  id: PlaceId,
  content: PlacesContent = PLACES,
  events: EventContent = EVENTS,
  financing: FinancingContent = FINANCING,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
): TripRefusal | null {
  const place = placeOf(id, content)
  if (state.challenge !== null) return 'defi'
  if (state.ended !== null) return 'ended'
  if (state.lastDay?.day === state.day) return 'played'
  if (place.effect.kind === 'loanAppointment') {
    const terms = appointmentLoan(events, financing)
    if (terms === null) return 'noNeed'
    const tomorrow = { ...state, day: state.day + 1 }
    return lendingRefusal(tomorrow, terms, foodTruck, financing)
  }
  return null
}

/**
 * The morning of `state.day` with the owner going to `id`, or staying at
 * the truck when it is null, in place of any trip chosen before that
 * morning. A place that takes the whole day sends the owner away all day
 * (see `ownerAway`); leaving it for another, or for none, brings them
 * back. Throws a RangeError naming the reason when the owner cannot go
 * there (see `tripRefusal`), or cannot stay when the day is played, the
 * game ended, or in a Défi. Returns a new state; never mutates `state`.
 */
export function goTo(
  state: GameState,
  id: PlaceId | null,
  content: PlacesContent = PLACES,
  events: EventContent = EVENTS,
  financing: FinancingContent = FINANCING,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
): GameState {
  if (id !== null && !isPlaceId(id)) {
    throw new RangeError(`Invalid decision: unknown place ${String(id)}`)
  }
  const refusal =
    id === null
      ? stayRefusal(state)
      : tripRefusal(state, id, content, events, financing, foodTruck)
  if (refusal !== null) {
    throw new RangeError(
      `Invalid decision: cannot go to ${String(id)}: ${refusal}`,
    )
  }
  const { trip } = state.town
  const wasAllDay = trip !== null && takesTheDay(trip, content)
  const allDay = id !== null && takesTheDay(id, content)
  return {
    ...state,
    town: { ...state.town, trip: id },
    ownerAway: allDay || (state.ownerAway && !wasAllDay),
  }
}

/**
 * Why the owner cannot drop the day's trip: in a Défi, once the game ended
 * or once the day is played (see `TripRefusal`).
 */
function stayRefusal(state: GameState): TripRefusal | null {
  if (state.challenge !== null) return 'defi'
  if (state.ended !== null) return 'ended'
  if (state.lastDay?.day === state.day) return 'played'
  return null
}

/** Whether the place `id` of `content` takes the whole day. */
export function takesTheDay(
  id: PlaceId,
  content: PlacesContent = PLACES,
): boolean {
  return 'wholeDay' in placeOf(id, content)
}

/**
 * Whether the day's trip brings the lender's appointment card the next
 * morning: its place's effect is `loanAppointment`.
 */
export function loanAppointment(
  state: Pick<GameState, 'town'>,
  content: PlacesContent = PLACES,
): boolean {
  const { trip } = state.town
  return (
    trip !== null && placeOf(trip, content).effect.kind === 'loanAppointment'
  )
}

/**
 * The share off the next restock at the close of a day whose trip was
 * `trip`, with `discount` waiting that morning, `used` when the day's
 * restock bought anything with it: the share of a place whose effect is a
 * discount, which never stacks on one waiting, or else the one waiting,
 * unless used, or 0.
 */
export function discountAtClose(
  trip: PlaceId | null,
  discount: number,
  used: boolean,
  content: PlacesContent = PLACES,
): number {
  const effect = trip === null ? null : placeOf(trip, content).effect
  if (effect?.kind === 'discount') return effect.share
  return used ? 0 : discount
}
