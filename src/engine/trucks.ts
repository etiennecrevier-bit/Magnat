import { FIRST_TRUCK_ID, type DistrictId } from '../content/schema.ts'
import { keyedDraw } from './rng.ts'
import type {
  Day,
  Decisions,
  Employee,
  GameState,
  Hire,
  Lot,
  Truck,
  TruckDecisions,
  TruckId,
} from './types.ts'

// The trucks (#259). The first truck, the Plateau's, is the game's own:
// `GameState.rngState`, `inventory` and `lastDay`, and the decisions'
// `prices`, `restock` and `daysOpen`, where they have always been. Each
// truck bought after it is in `GameState.trucks`, its decisions in
// `Decisions.trucks`. Everything that plays or reads a truck goes through
// `trucksOf` and `withTrucks`, so every truck is read the same way.

/** The first truck's id. */
export const FIRST_TRUCK: TruckId = FIRST_TRUCK_ID

/** The first truck's district. */
export const FIRST_DISTRICT: DistrictId = 'plateau'

// 2^32: a keyed draw in [0, 1) times this is a generator state.
const UINT32_RANGE = 2 ** 32

/** What a day plays of one truck, wherever the truck is kept. */
export interface TruckView {
  readonly id: TruckId
  readonly district: DistrictId
  /** Its generator's state. */
  readonly rngState: number
  /** Its stock on hand, oldest lot first. */
  readonly inventory: readonly Lot[]
}

/**
 * Every truck of `state`, the first one first, then the others in the
 * order they were bought.
 */
export function trucksOf(state: GameState): TruckView[] {
  const first: TruckView = {
    id: FIRST_TRUCK,
    district: FIRST_DISTRICT,
    rngState: state.rngState,
    inventory: state.inventory,
  }
  return [first, ...(state.trucks ?? [])]
}

/**
 * `state` with each truck of `views` put back where it is kept, by its id:
 * the first truck's generator and stock in the game's own, each other's,
 * with its last day, in `state.trucks`. The first truck's last day is the
 * game's `lastDay`, which `playDay` writes with the whole day. Throws a
 * RangeError for a truck `state` does not have. Never mutates `state`.
 */
export function withTrucks(
  state: GameState,
  views: readonly (Pick<TruckView, 'id' | 'rngState' | 'inventory'> & {
    readonly lastDay: Truck['lastDay']
  })[],
): GameState {
  let next = state
  for (const { id, rngState, inventory, lastDay } of views) {
    if (id === FIRST_TRUCK) {
      next = { ...next, rngState, inventory }
      continue
    }
    const trucks = next.trucks ?? []
    const index = trucks.findIndex((truck) => truck.id === id)
    const truck = trucks[index]
    if (truck === undefined) throw new RangeError(`Unknown truck: ${id}`)
    next = {
      ...next,
      trucks: trucks.with(index, { ...truck, rngState, inventory, lastDay }),
    }
  }
  return next
}

/** The ids of `state`'s trucks, the first one first. */
export function truckIds(state: Pick<GameState, 'trucks'>): TruckId[] {
  return [FIRST_TRUCK, ...(state.trucks ?? []).map(({ id }) => id)]
}

/** Whether `state` has the truck `id`. */
export function hasTruck(
  state: Pick<GameState, 'trucks'>,
  id: TruckId,
): boolean {
  return truckIds(state).includes(id)
}

/**
 * How the truck `id` runs under `decisions`: the first truck's prices,
 * restock rules, days open and storage, or another's from
 * `decisions.trucks`. Throws a RangeError for a truck the decisions do not
 * run.
 */
export function truckDecisionsOf(
  decisions: Decisions,
  id: TruckId,
): TruckDecisions {
  if (id === FIRST_TRUCK) {
    const { prices, restock, daysOpen, storage } = decisions
    return {
      prices,
      restock,
      daysOpen,
      ...(storage === undefined ? {} : { storage }),
    }
  }
  const own = decisions.trucks?.[id]
  if (own === undefined) throw new RangeError(`Unknown truck: ${id}`)
  return own
}

/**
 * `decisions` with the truck `id` running as `truck`, stored only if
 * `truck` is. Throws a RangeError for a truck the decisions do not run.
 * Never mutates `decisions`.
 */
export function withTruckDecisions(
  decisions: Decisions,
  id: TruckId,
  truck: TruckDecisions,
): Decisions {
  if (id === FIRST_TRUCK) {
    const rest = { ...decisions }
    delete rest.storage
    return { ...rest, ...truck }
  }
  if (decisions.trucks?.[id] === undefined) {
    throw new RangeError(`Unknown truck: ${id}`)
  }
  return { ...decisions, trucks: { ...decisions.trucks, [id]: truck } }
}

/** The truck the owner works at under `decisions`. */
export function ownerAtOf(decisions: Decisions): TruckId {
  return decisions.ownerAt ?? FIRST_TRUCK
}

/** The truck `hire` works at, when « Au camion »: the first one by default. */
export function truckOf(hire: Pick<Hire, 'truck'>): TruckId {
  return hire.truck ?? FIRST_TRUCK
}

/** The employees of `truckers` who work at the truck `id`, in their order. */
export function truckersAt(
  truckers: readonly Employee[],
  id: TruckId,
): Employee[] {
  return truckers.filter((employee) => truckOf(employee) === id)
}

/**
 * The generator state the truck `id` of a game seeded `seed` starts from:
 * a keyed draw of the seed and the id (see `keyedDraw`), so the same seed
 * and id always give the same stream, wherever the truck is in the list
 * and whenever it was bought, and the game's own stream never moves for
 * it.
 */
export function truckStream(seed: number, id: TruckId): number {
  return Math.floor(keyedDraw(seed, idKeys(id)) * UINT32_RANGE)
}

/**
 * The id's characters as keys of a keyed draw, prefixed by its length so
 * no id's keys start another's.
 */
function idKeys(id: TruckId): number[] {
  return [id.length, ...Array.from(id, (char) => char.codePointAt(0) ?? 0)]
}

/**
 * A truck bought on `day`, with the id and district its rung adds, in a
 * game seeded `seed`: its own generator (see `truckStream`), no stock
 * and no day played yet.
 */
export function newTruck(
  seed: number,
  { id, district }: { id: TruckId; district: DistrictId },
  day: Day,
): Truck {
  return {
    id,
    district,
    boughtOnDay: day,
    rngState: truckStream(seed, id),
    inventory: [],
    lastDay: null,
  }
}
