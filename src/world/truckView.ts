import type { Shows } from '../content/assets.ts'
import type {
  EventEffect,
  ProductId,
  RestockRule,
  StreetModifierKind,
} from '../content/schema.ts'
import { toCalendar } from '../engine/clock.ts'
import { onHand } from '../engine/inventory.ts'
import { MODIFIER_KINDS, inEffect, streetOn } from '../engine/street.ts'
import type { EventRecord, GameState, StreetModifier } from '../engine/types.ts'

/** What the truck shows on the day the top bar names. */
export interface TruckView {
  /** Whether the truck opens on day `game.day`. */
  readonly open: boolean
  /** The croissants on the rack: what the truck opens with that morning. */
  readonly croissants: number
  /** The name written on the sign: the business's, from the profile. */
  readonly businessName: string
  /** The changes to the street in effect on day `game.day`. */
  readonly modifiers: readonly ChosenModifier[]
}

/** A change to the street, with the choice of its card that made it. */
export interface ChosenModifier extends StreetModifier {
  /** The choice's id; none for a change a Défi forces. */
  readonly choice?: string
}

/** Reads what the truck shows from the game. */
export function truckView(game: GameState): TruckView {
  return {
    open: opensToday(game),
    croissants: openingStock(game, 'croissant'),
    businessName: game.profile.businessName,
    modifiers: chosenModifiers(game),
  }
}

/**
 * Whether the truck opens on day `game.day`, the day `tick()` plays next, as
 * `playDay` decides it: with the decisions of that day, not those waiting
 * for the next morning, and unless a change to the street closes it.
 */
export function opensToday(game: GameState): boolean {
  return (
    game.decisions.daysOpen.includes(toCalendar(game.day).weekday) &&
    !streetOn(modifiersToday(game), game.day).closed
  )
}

/**
 * The changes to the street in effect on day `game.day`, in the order the
 * engine keeps them, as `playDay` sums them up in `lastDay.modifiers`: those
 * the choices made already, then those a choice queued for that day or
 * before, which start that morning. The same rule as the engine's start of
 * the day, which the world may not call; truckView.test.ts checks the two
 * agree.
 */
export function modifiersToday(game: GameState): StreetModifier[] {
  const { day, events } = game
  const starting = events.delayed.flatMap(({ day: due, event, effect }) => {
    if (due > day || !changesStreet(effect)) return []
    const { days, ...change } = effect
    return [{ event, change, fromDay: day, lastDay: day + days - 1 }]
  })
  return inEffect([...events.modifiers, ...starting], day)
}

/**
 * The changes to the street in effect on day `game.day`, as
 * `modifiersToday` gives them, each with the choice that made it: the last
 * one of its card on its first day or before, as the history keeps them.
 * A change a Défi forces has none.
 */
export function chosenModifiers(game: GameState): ChosenModifier[] {
  const { history } = game.events
  return modifiersToday(game).map((modifier) => ({
    ...modifier,
    choice: choiceOf(history, modifier),
  }))
}

function choiceOf(
  history: readonly EventRecord[],
  { event, fromDay }: StreetModifier,
): string | undefined {
  return history.findLast(
    (record) => record.event === event && record.day <= fromDay,
  )?.choice
}

/** An effect that changes the street for a while. */
type StreetEffect = Extract<EventEffect, { kind: StreetModifierKind }>

function changesStreet(effect: EventEffect): effect is StreetEffect {
  return (MODIFIER_KINDS as readonly string[]).includes(effect.kind)
}

/**
 * Whether a piece that `shows` so shows in `view`: on open or closed days,
 * while any change to the street from the event card it names is in
 * effect, but for those its `except` choices made, or while the product it
 * names cannot be sold.
 */
export function showsOn(
  shows: Shows,
  view: Pick<TruckView, 'open' | 'modifiers'>,
): boolean {
  if (shows === 'open') return view.open
  if (shows === 'closed') return !view.open
  if ('event' in shows) {
    return view.modifiers.some(
      ({ event, choice }) =>
        event === shows.event &&
        (choice === undefined || !shows.except?.includes(choice)),
    )
  }
  return view.modifiers.some(
    ({ change }) =>
      change.kind === 'unavailable' && change.product === shows.unavailable,
  )
}

/**
 * The units of `product` the truck holds when it opens on day `game.day`:
 * those on hand plus the morning restock its rule calls for. On a closed
 * day, or while the street leaves the product unsold, only those on hand.
 * Croissants keep for one day, so between two days none are on hand; this
 * is what the rack shows.
 */
export function openingStock(game: GameState, product: ProductId): number {
  const units = onHand(game.inventory, product)
  const street = streetOn(modifiersToday(game), game.day)
  if (!opensToday(game) || street.unavailable[product]) return units
  return units + restockUnits(game.decisions.restock[product], units)
}

/**
 * The units a morning restock buys. The same rule as the engine's, which
 * the world may not call; truckView.test.ts checks the two agree.
 */
function restockUnits(rule: RestockRule, onHandNow: number): number {
  switch (rule.kind) {
    case 'buyDaily':
      return rule.quantity
    case 'topUp':
      return onHandNow < rule.whenBelow ? rule.upTo - onHandNow : 0
  }
}

/**
 * The share of the rack to show for `units`, from 0 to 1, in whole shelves
 * out of `steps`: `capacity` units fill it. Any unit shows a shelf, so the
 * rack only looks empty once it is.
 */
export function rackFill(
  units: number,
  capacity: number,
  steps: number,
): number {
  if (units <= 0) return 0
  return Math.ceil((Math.min(units, capacity) * steps) / capacity) / steps
}
