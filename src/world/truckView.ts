import type { ProductId, RestockRule } from '../content/schema.ts'
import { toCalendar } from '../engine/clock.ts'
import { onHand } from '../engine/inventory.ts'
import type { GameState } from '../engine/types.ts'

/** The business name on the truck's sign, until the player picks their own. */
export const BUSINESS_NAME = "Le P'tit Camion"

/** What the truck shows on the day the top bar names. */
export interface TruckView {
  /** Whether the truck opens on day `game.day`. */
  readonly open: boolean
  /** The croissants on the rack: what the truck opens with that morning. */
  readonly croissants: number
  /** The name written on the sign. */
  readonly businessName: string
}

/** Reads what the truck shows from the game. */
export function truckView(game: GameState): TruckView {
  return {
    open: opensToday(game),
    croissants: openingStock(game, 'croissant'),
    businessName: BUSINESS_NAME,
  }
}

/**
 * Whether the truck opens on day `game.day`, the day `tick()` plays next, as
 * `playDay` decides it: with the decisions of that day, not those waiting
 * for the next morning.
 */
export function opensToday(game: GameState): boolean {
  return game.decisions.daysOpen.includes(toCalendar(game.day).weekday)
}

/**
 * The units of `product` the truck holds when it opens on day `game.day`:
 * those on hand plus the morning restock its rule calls for. On a closed
 * day, only those on hand. Croissants keep for one day, so between two days
 * none are on hand; this is what the rack shows.
 */
export function openingStock(game: GameState, product: ProductId): number {
  const units = onHand(game.inventory, product)
  if (!opensToday(game)) return units
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
