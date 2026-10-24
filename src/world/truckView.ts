import {
  districtStreetOf,
  type AssetManifest,
  type Shows,
} from '../content/assets.ts'
import type {
  DistrictId,
  EventEffect,
  ProductId,
  RestockRule,
  StreetModifierKind,
} from '../content/schema.ts'
import { onDates } from '../engine/calendar.ts'
import { toCalendar } from '../engine/clock.ts'
import { FOOD_TRUCK } from '../engine/day.ts'
import { DISTRICTS, isStored, reopensOn } from '../engine/districts.ts'
import { PRODUCTS, inSeason, onHand } from '../engine/inventory.ts'
import { crewOf } from '../engine/staff.ts'
import {
  MODIFIER_KINDS,
  inEffect,
  modifiersAt,
  streetOn,
} from '../engine/street.ts'
import {
  FIRST_DISTRICT,
  FIRST_TRUCK,
  hasTruck,
  ownerAtOf,
  truckDecisionsOf,
  truckersAt,
  trucksOf,
} from '../engine/trucks.ts'
import type {
  EventRecord,
  GameState,
  StreetModifier,
  TruckId,
} from '../engine/types.ts'
import { todayWork } from '../ui/staffBoard.ts'
import { ASSETS } from './manifest.ts'

/** The art a street shows, as the time of year it is there (#264). */
export type Season = 'summer' | 'winter'

/** What one truck shows on the day the top bar names. */
export interface TruckView {
  /** The truck, by its id: the first one's for a truck the game lacks. */
  readonly truck: TruckId
  /** Its district, whose street it stands in. */
  readonly district: DistrictId
  /** Whether the truck opens on day `game.day`. */
  readonly open: boolean
  /** The croissants on the rack: what the truck opens with that morning. */
  readonly croissants: number
  /**
   * Whether each product sells that day: in its season (#261), with some
   * to open with (see `openingStock`).
   */
  readonly selling: Readonly<Record<ProductId, boolean>>
  /** Whether each product is in its season that day (#261). */
  readonly inSeason: Readonly<Record<ProductId, boolean>>
  /** The name written on the sign: the business's, from the profile. */
  readonly businessName: string
  /** The changes to the truck's street in effect on day `game.day`. */
  readonly modifiers: readonly ChosenModifier[]
  /** Whether it is stored for the winter that day (#260). */
  readonly stored: boolean
  /** While it is stored, the month it comes back, 1 for January. */
  readonly reopens: number | null
  /** Whether the owner serves at it that day, open or not. */
  readonly ownerHere: boolean
  /** The employees who serve at it that day, open or not. */
  readonly staff: number
  /** Whether its district's rival works that month (#260). */
  readonly rival: boolean
  /** The art its street shows: its winter's, or else its summer's. */
  readonly season: Season
}

/** A change to the street, with the choice of its card that made it. */
export interface ChosenModifier extends StreetModifier {
  /** The choice's id; none for a change a Défi forces. */
  readonly choice?: string
}

/**
 * Reads what the truck `truck` shows from the game, the first truck's when
 * the game has no such truck; its season from the winter of its street in
 * `manifest`.
 */
export function truckView(
  game: GameState,
  truck: TruckId = FIRST_TRUCK,
  manifest: Pick<AssetManifest, 'districtStreets'> = ASSETS,
): TruckView {
  const id = shownId(game, truck)
  const district = districtOf(game, id)
  const crew = crewAt(game, id)
  const open = openOn(game, id, crew)
  const { storage } = truckDecisionsOf(game.decisions, id)
  const stored = isStored(storage, game.day)
  const { month } = toCalendar(game.day)
  const winter = districtStreetOf(manifest, district)?.winter
  return {
    truck: id,
    district,
    open,
    croissants: openingStock(game, 'croissant', id, open),
    selling: perProduct(
      (product) =>
        inSeason(product, game.day, FOOD_TRUCK.products) &&
        openingStock(game, product, id, open) > 0,
    ),
    inSeason: perProduct((product) =>
      inSeason(product, game.day, FOOD_TRUCK.products),
    ),
    businessName: game.profile.businessName,
    modifiers: chosenModifiers(game, district),
    stored,
    reopens: stored ? toCalendar(reopensOn(storage, game.day)).month : null,
    ownerHere: crew.ownerHere,
    staff: crew.staff,
    rival: DISTRICTS.districts[district].rival?.months.includes(month) ?? false,
    season:
      winter !== undefined && onDates(game.day, winter) ? 'winter' : 'summer',
  }
}

function perProduct(
  value: (product: ProductId) => boolean,
): Record<ProductId, boolean> {
  return Object.fromEntries(
    PRODUCTS.map((product) => [product, value(product)]),
  ) as Record<ProductId, boolean>
}

/** `truck` when the game has it, or else the first truck. */
function shownId(game: GameState, truck: TruckId): TruckId {
  return hasTruck(game, truck) ? truck : FIRST_TRUCK
}

/**
 * The district the truck `truck` works in: the first truck's for a truck
 * the game lacks.
 */
export function districtOf(game: GameState, truck: TruckId): DistrictId {
  const found = trucksOf(game).find(({ id }) => id === truck)
  return found?.district ?? FIRST_DISTRICT
}

/** Who serves at a truck on day `game.day`. */
export interface TruckCrew {
  /** Whether the owner does. */
  readonly ownerHere: boolean
  /** How many employees do. */
  readonly staff: number
}

/**
 * Who serves at the truck `truck` on day `game.day`, as `playDay` decides
 * it: the staff of that morning (see `todayWork`), once the underpaid quit
 * and without those absent that day; the owner unless away all day, at the
 * truck they work at. The same rule as the engine's, which the world may
 * not call; truckView.test.ts checks the two agree.
 */
export function crewAt(
  game: GameState,
  truck: TruckId = FIRST_TRUCK,
): TruckCrew {
  const work = todayWork(game)
  const left = work.staff.filter(
    ({ candidate }) => !work.quits.includes(candidate),
  )
  const crew = crewOf(left, work.ownerAway, work.absent)
  return {
    ownerHere: crew.ownerServes && ownerAtOf(game.decisions) === truck,
    staff: truckersAt(crew.truckers, truck).length,
  }
}

/**
 * Whether the truck `truck` opens on day `game.day`, the day `tick()` plays
 * next, as `playDay` decides it: with the decisions of that day, not those
 * waiting for the next morning, on one of its days open, not stored (#260),
 * unless a change to its street closes it, and with someone to serve at it
 * (see `crewAt`).
 */
export function opensToday(
  game: GameState,
  truck: TruckId = FIRST_TRUCK,
): boolean {
  const id = shownId(game, truck)
  return openOn(game, id, crewAt(game, id))
}

function openOn(game: GameState, truck: TruckId, crew: TruckCrew): boolean {
  const own = truckDecisionsOf(game.decisions, truck)
  return (
    own.daysOpen.includes(toCalendar(game.day).weekday) &&
    !isStored(own.storage, game.day) &&
    !streetOn(truckModifiers(game, districtOf(game, truck)), game.day).closed &&
    (crew.ownerHere || crew.staff > 0)
  )
}

/**
 * The employees who serve at the truck `truck` on day `game.day` (#208),
 * open or not: those who came that morning (see `crewAt`).
 */
export function staffAtTruck(
  game: GameState,
  truck: TruckId = FIRST_TRUCK,
): number {
  return crewAt(game, shownId(game, truck)).staff
}

/**
 * The employees the street draws standing on the sidewalk by the truck in
 * `view`: those who serve at it but the one behind the counter, where an
 * employee stands while the owner works at another truck or is away.
 */
export function onSidewalk(
  view: Pick<TruckView, 'ownerHere' | 'staff'>,
): number {
  return view.ownerHere ? view.staff : Math.max(0, view.staff - 1)
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
  const starting = events.delayed.flatMap(
    ({ day: due, event, effect, district }) => {
      if (due > day || !changesStreet(effect)) return []
      const { days, ...change } = effect
      return [
        {
          event,
          change,
          fromDay: day,
          lastDay: day + days - 1,
          ...(district === undefined ? {} : { district }),
        },
      ]
    },
  )
  return inEffect([...events.modifiers, ...starting], day)
}

/**
 * The changes of `modifiersToday` to the street of the truck in `district`,
 * the first truck's by default: none made for another district's truck
 * (#262).
 */
function truckModifiers(
  game: GameState,
  district: DistrictId = FIRST_DISTRICT,
): StreetModifier[] {
  return modifiersAt(modifiersToday(game), district)
}

/**
 * The changes to the street of the truck in `district` in effect on day
 * `game.day`, the first truck's by default, as `modifiersToday` gives them
 * (#262), each with the choice that made it: the last one of its card on
 * its first day or before, as the history keeps them. A change a Défi
 * forces has none.
 */
export function chosenModifiers(
  game: GameState,
  district: DistrictId = FIRST_DISTRICT,
): ChosenModifier[] {
  const { history } = game.events
  return truckModifiers(game, district).map((modifier) => ({
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

/** What a piece's `shows` reads of the truck's day. */
export type ShowsView = Pick<
  TruckView,
  | 'open'
  | 'modifiers'
  | 'selling'
  | 'stored'
  | 'ownerHere'
  | 'inSeason'
  | 'rival'
  | 'season'
>

/**
 * Whether a piece that `shows` so shows in `view`: on open or closed days,
 * on open ones the owner serves at the truck, on those it is stored, while
 * any change to the street from the event card it names is in effect, but
 * for those its `except` choices made, while the product it names cannot
 * be sold, on open days while that product sells (see `TruckView.selling`)
 * and the street leaves it on sale, in the street's season it names, while
 * the product it names is in its season or out of it, or in the months the
 * rival works or the others.
 */
export function showsOn(shows: Shows, view: ShowsView): boolean {
  if (shows === 'open') return view.open
  if (shows === 'closed') return !view.open
  if (shows === 'owner') return view.open && view.ownerHere
  if (shows === 'stored') return view.stored
  if ('event' in shows) {
    return view.modifiers.some(
      ({ event, choice }) =>
        event === shows.event &&
        (choice === undefined || !shows.except?.includes(choice)),
    )
  }
  if ('sells' in shows) {
    return (
      view.open &&
      view.selling[shows.sells] &&
      !unsold(view.modifiers, shows.sells)
    )
  }
  if ('season' in shows) return view.season === shows.season
  if ('inSeason' in shows) return view.inSeason[shows.inSeason]
  if ('outOfSeason' in shows) return !view.inSeason[shows.outOfSeason]
  if ('rival' in shows) return view.rival === shows.rival
  return unsold(view.modifiers, shows.unavailable)
}

/** Whether a change in `modifiers` leaves `product` unsold. */
function unsold(
  modifiers: readonly ChosenModifier[],
  product: ProductId,
): boolean {
  return modifiers.some(
    ({ change }) => change.kind === 'unavailable' && change.product === product,
  )
}

/**
 * The units of `product` the truck `truck` holds when it opens on day
 * `game.day`, the first truck's by default: those on hand plus the morning
 * restock its rule calls for. On a closed day, while the street leaves the
 * product unsold or out of its season (#261), only those on hand.
 * Croissants keep for one day, so between two days none are on hand; this
 * is what the rack shows.
 */
export function openingStock(
  game: GameState,
  product: ProductId,
  truck: TruckId = FIRST_TRUCK,
  open: boolean = opensToday(game, truck),
): number {
  const id = shownId(game, truck)
  const inventory =
    trucksOf(game).find((view) => view.id === id)?.inventory ?? []
  const units = onHand(inventory, product)
  const street = streetOn(truckModifiers(game, districtOf(game, id)), game.day)
  if (
    !open ||
    street.unavailable[product] ||
    !inSeason(product, game.day, FOOD_TRUCK.products)
  ) {
    return units
  }
  const { restock } = truckDecisionsOf(game.decisions, id)
  return units + restockUnits(restock[product], units)
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
