import type { CityManifest, CityShows } from '../content/assets.ts'
import type {
  GrocerContent,
  GrocerId,
  PlaceId,
  StaffRoleId,
  WalkIns,
} from '../content/schema.ts'
import { runsOn } from '../engine/bakery.ts'
import { GROCERS } from '../engine/contracts.ts'
import { todaysTrip, tripTime, type TripTime } from '../engine/places.ts'
import type { GameState } from '../engine/types.ts'
import { todayWork } from '../ui/staffBoard.ts'
import { enRouteLine } from '../ui/tripBoard.ts'
import type { Replay } from './replay.ts'

// What the city shows (#165), read from the game without drawing: the day
// in the top bar, `game.day`, as `tick()` will play it, then where everyone
// is at a minute of it. Who works where comes from the same helpers as
// « Qui fait quoi », and the trip's words from the top bar's, so the city
// never tells another story than the panels. Pure, so the rules are tested
// without Pixi.

/** The owner's trip of the day. */
export interface CityTrip {
  readonly place: PlaceId
  /** « En route vers la Caisse », as the top bar says it. */
  readonly label: string
  readonly time: TripTime
}

/** The van's round on a delivery day. */
export interface CityVan {
  /** The grocers it stops at, in the order their contracts were signed. */
  readonly stops: readonly GrocerId[]
  /** Who drives it. */
  readonly driver: 'employee' | 'owner'
}

/** What the city shows on the day `game.day`. */
export interface CityView {
  /** Whether the truck opens: a day open, with someone to serve at it. */
  readonly open: boolean
  /** The employees serving at the truck beside the owner. */
  readonly atTruck: number
  /** The day's trip, chosen or booked by a card; null without one. */
  readonly trip: CityTrip | null
  /** Whether the bakery runs, through its notice too. */
  readonly bakery: boolean
  /** Whether a baker works at the bakery as it runs. */
  readonly baker: boolean
  /** Whether a deliverer works for the business. */
  readonly deliverer: boolean
  /** Where the van parks: at the bakery when it runs, or at the truck. */
  readonly vanAt: 'bakery' | 'truck' | null
  /** Today's deliveries; null on a day without, or when nobody can drive. */
  readonly van: CityVan | null
  /** The grocers whose contract runs. */
  readonly contracts: readonly GrocerId[]
  /** Whether a place opens « Aller à… »: everywhere but in a Défi. */
  readonly trips: boolean
}

/**
 * What the city shows on the morning of `game.day`: the truck opens and the
 * deliveries are due as « Qui fait quoi » says (see `todayWork`), the trip
 * as the top bar names it (see `todaysTrip`), and the bakery runs once the
 * morning has put the day's plan in effect, to the end of its notice (see
 * `runsOn`). The van parks wherever a deliverer works, or on a delivery day
 * the owner drives; it drives on a delivery day someone can, and stops at
 * each grocer whose contract was signed before the day.
 */
export function cityView(
  game: GameState,
  grocers: GrocerContent = GROCERS,
): CityView {
  const work = todayWork(game, grocers)
  const has = (role: StaffRoleId) =>
    game.decisions.staff.some((hire) => hire.role === role)
  const place = todaysTrip(game)
  const bakery = runsOn(game.bakery, game.decisions.bakery, game.day)
  const van: CityVan | null =
    work.deliveriesDue && work.delivers !== null
      ? {
          stops: game.contracts.running
            .filter(({ startDay }) => startDay < game.day)
            .map(({ grocer }) => grocer),
          driver: work.delivers,
        }
      : null
  const deliverer = has('livreur')
  return {
    open: work.opens,
    atTruck: game.decisions.staff.filter(({ role }) => role === 'camion')
      .length,
    trip:
      place === null
        ? null
        : {
            place,
            label: enRouteLine(game) ?? '',
            time: tripTime(place, game.dream),
          },
    bakery,
    baker: bakery && has('boulanger'),
    deliverer,
    vanAt: deliverer || van !== null ? (bakery ? 'bakery' : 'truck') : null,
    van,
    contracts: game.contracts.running.map(({ grocer }) => grocer),
    trips: game.challenge === null,
  }
}

/** Where the owner is at a minute of the day. */
export type OwnerAt =
  /** Serving at the truck. */
  | { readonly kind: 'serving' }
  /**
   * On the way to the day's place: `share` of it walked, from 0 at the
   * truck to 1 at its door, where they wait while there.
   */
  | { readonly kind: 'away'; readonly share: number }
  /** Not drawn: a closed day without a trip, or the trip over. */
  | null

/** Where everyone is at a minute of the day. */
export interface CityActors {
  readonly owner: OwnerAt
  /** Whether the truck serves: open, with someone at it. */
  readonly truckOpen: boolean
  /** How far the van is along its round, 0 to 1; null while it is parked. */
  readonly van: number | null
}

/**
 * Where everyone is when the day replayed is `progress` through, from 0 at
 * the opening to 1 at the close of `walkIns`. On a trip the owner leaves the
 * truck at the minute the engine sends them, walks there, waits at the door
 * for the visit, then walks back, each walk its minutes; or they stay at the
 * place all day. The truck serves on a day it opens, but not while the owner
 * is away with no employee at it. The van drives through `vanHours`, its
 * window of the day.
 */
export function actorsAt(
  view: CityView,
  progress: number,
  walkIns: Pick<WalkIns, 'opensAtMinute' | 'closesAtMinute'>,
  vanHours: CityManifest['deliveries']['window'],
): CityActors {
  const { opensAtMinute: opens, closesAtMinute: closes } = walkIns
  const minute = opens + progress * (closes - opens)
  const away = awayAt(view.trip, minute)
  const owner: OwnerAt =
    away !== null
      ? { kind: 'away', share: away }
      : view.open
        ? { kind: 'serving' }
        : null
  const van =
    view.van !== null && progress >= vanHours.from && progress < vanHours.to
      ? (progress - vanHours.from) / (vanHours.to - vanHours.from)
      : null
  return {
    owner,
    truckOpen: view.open && (away === null || view.atTruck > 0),
    van,
  }
}

/**
 * How far along the way to the day's place the owner is at `minute`: 0
 * leaving the truck, 1 at the door; null while they are at the truck.
 */
function awayAt(trip: CityTrip | null, minute: number): number | null {
  if (trip === null) return null
  const { time } = trip
  if (time.wholeDay) return 1
  const { leavesAtMinute: leaves, legMinutes: leg, visitMinutes } = time
  const there = leaves + leg
  const back = there + visitMinutes
  if (minute < leaves || minute >= back + leg) return null
  if (minute < there) return (minute - leaves) / leg
  if (minute < back) return 1
  return 1 - (minute - back) / leg
}

/**
 * How many stand in line at the truck at `minute` of the day replayed: those
 * who came in the `minutes` before it, at most `max`. Nobody while the truck
 * does not serve, without a day to replay, or at a speed the street replays
 * none at, as at ×10.
 */
export function lineAt(
  replay: Replay | null,
  minute: number,
  truckOpen: boolean,
  line: Pick<CityManifest['truck']['line'], 'max' | 'minutes'>,
  replays: boolean,
): number {
  if (replay === null || !truckOpen || !replays) return 0
  let count = 0
  for (const { arrivalMinute } of replay.visits) {
    if (arrivalMinute > minute) break
    if (arrivalMinute > minute - line.minutes) count += 1
  }
  return Math.min(line.max, count)
}

/**
 * Whether a piece that `shows` so shows: the truck open or closed, as
 * `truckOpen` says at the minute; the bakery running or for rent; a
 * grocer's contract running.
 */
export function cityShowsOn(
  shows: CityShows,
  view: Pick<CityView, 'bakery' | 'contracts'>,
  truckOpen: boolean,
): boolean {
  switch (shows) {
    case 'truckOpen':
      return truckOpen
    case 'truckClosed':
      return !truckOpen
    case 'bakeryRuns':
      return view.bakery
    case 'bakeryForRent':
      return !view.bakery
    default:
      return view.contracts.includes(shows.contract)
  }
}

/** Whether `shows` changes in the day, a minute at a time. */
export function showsByMinute(shows: CityShows): boolean {
  return shows === 'truckOpen' || shows === 'truckClosed'
}
