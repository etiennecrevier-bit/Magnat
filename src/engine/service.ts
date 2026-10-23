import type {
  CandidateId,
  DayType,
  EnergyContent,
  Segment,
  Service,
  StaffContent,
} from '../content/schema.ts'
import { effectsOf } from './energy.ts'
import { STAFF, crewOf, traitValue } from './staff.ts'
import { FIRST_TRUCK, ownerAtOf, truckersAt } from './trucks.ts'
import type { GameState, TruckId, Worker } from './types.ts'

// The line at the counter: who serves, how long serving takes, and how long
// customers wait for it.

/** A calendar fact, not a tunable. */
export const SECONDS_PER_MINUTE = 60

/**
 * When a server is away from the counter, in seconds of the day: from
 * `from`, included, to `to`, excluded.
 */
export interface Away {
  readonly from: number
  readonly to: number
}

/** Someone serving at the counter. */
export interface Server {
  /**
   * How fast they serve, as a ratio to the content's service times: 1 takes
   * exactly those times, 2 half of them.
   */
  readonly speed: number
  /**
   * Whether they are the owner, whose fatigue botches units; an employee
   * never tires.
   */
  readonly owner: boolean
  /**
   * The share of the units they make that are botched and made again: the
   * owner's by their fatigue, an employee's by their minutie.
   */
  readonly botchedShare: number
  /** When they leave the counter for a while (#164); never when absent. */
  readonly away?: Away
  /**
   * Who they are (#283), whom the visits they serve name (see
   * `Visit.servedBy`); `servers()` always says.
   */
  readonly who?: Worker
}

// Speed 1 is the unit the content's service times are written in, not a
// tunable.
const AVATAR: Server = { speed: 1, owner: true, botchedShare: 0, who: 'owner' }

const AT_TRUCK = 'camion'

/**
 * Who serves at the counter of the truck `truck` on business day
 * `state.day`, with `state.staff` on staff that day and those of `absent`
 * away (see `crewOf`): first the owner, unless away all day or at another
 * truck (#259), at speed 1 when rested, and `away` from the
 * counter for that window of the day, if any, such as a trip's. Tired, they
 * take `serviceTimeIncrease` longer and botch `botchedShare` of their units
 * (see `effectsOf` in energy.ts), so their speed is 1 ÷ (1 +
 * `serviceTimeIncrease`), by their energy that morning, which holds for the
 * whole day. Then each employee at that truck who came, at `staff.truckSpeed`
 * × their rapidité, botching `staff.employeeBotchedShare` × their minutie
 * (see `traitValue`). Empty when nobody serves.
 */
export function servers(
  state: GameState,
  energy: EnergyContent,
  staff: StaffContent = STAFF,
  away: Away | null = null,
  absent: readonly CandidateId[] = [],
  truck: TruckId = FIRST_TRUCK,
): readonly Server[] {
  const crew = crewOf(state.staff, state.ownerAway, absent)
  const employees = truckersAt(crew.truckers, truck).map(
    ({ candidate }): Server => ({
      speed:
        staff.truckSpeed * traitValue(candidate, 'rapidite', AT_TRUCK, staff),
      owner: false,
      botchedShare:
        staff.employeeBotchedShare *
        traitValue(candidate, 'minutie', AT_TRUCK, staff),
      who: candidate,
    }),
  )
  if (!crew.ownerServes || ownerAtOf(state.decisions) !== truck) {
    return employees
  }
  const { serviceTimeIncrease, botchedShare } = effectsOf(state.energy, energy)
  const speed = AVATAR.speed / (1 + serviceTimeIncrease)
  const owner: Server = { speed, owner: true, botchedShare, who: 'owner' }
  return [away === null ? owner : { ...owner, away }, ...employees]
}

/**
 * The longest wait in line, in seconds, a customer of `segment` accepts on a
 * day of `dayType`.
 */
export function patienceSeconds(segment: Segment, dayType: DayType): number {
  return (
    segment.patienceMinutes * dayType.patienceMultiplier * SECONDS_PER_MINUTE
  )
}

/** The line as a newcomer finds it. */
export interface Ahead {
  /** Seconds until a server is free for them; 0 when one is free now. */
  readonly wait: number
  /**
   * Customers in line who have not reached a server yet; those already at
   * the counter do not count.
   */
  readonly waiting: number
}

/** One day's line at the counter, first come, first served. */
export interface Line {
  /** The line as a customer arriving at `second` of the day finds it. */
  ahead: (second: number) => Ahead
  /**
   * Puts a customer arriving at `second` and ordering `items` units in line.
   * Returns the second they reach a server and that server: the one who
   * can start serving them first, at their counter by then; on a tie, the
   * one free since earliest, then the first of them.
   */
  join: (second: number, items: number) => Joined
  /** Whether someone is at the counter at `second`: not every server away. */
  isOpen: (second: number) => boolean
}

/** When a customer who joined the line reaches a server, and which. */
export interface Joined {
  readonly start: number
  readonly server: Server
}

/**
 * Opens an empty line served by `servers`, at the times of `service`. Each
 * customer takes `(baseSeconds + perItemSeconds × items) ÷ speed` seconds of
 * the server they reach. A server starts no one while `away`: a customer
 * who would reach them then waits until they are back, unless another
 * server can start them sooner. One they started before leaving they serve
 * in full, then leave; they come back at the same second. Customers must
 * come in the order they arrive: the seconds passed to `ahead()`, `join()`
 * and `isOpen()` never go down, so those who join reach a server in the
 * order they joined. Throws a RangeError if there is no server, if a speed
 * is not a finite number above 0, if an absence ends before it starts, or
 * if a second goes down.
 */
export function openLine(servers: readonly Server[], service: Service): Line {
  if (servers.length === 0) throw new RangeError('No one serves the line')
  for (const { speed, away } of servers) {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new RangeError(`Invalid server speed: ${speed}`)
    }
    if (
      away !== undefined &&
      !(
        Number.isFinite(away.from) &&
        Number.isFinite(away.to) &&
        away.from <= away.to
      )
    ) {
      throw new RangeError(`Invalid absence: ${away.from} to ${away.to}`)
    }
  }
  /** The second each server is next free. */
  const freeAt = servers.map(() => 0)
  /** The second each customer who joined reaches a server, in order. */
  const starts: number[] = []
  /** The first customer who had not reached a server at the last second. */
  let head = 0
  let last = 0

  const at = (second: number) => {
    if (second < last) {
      throw new RangeError(`The line went back in time: ${second} < ${last}`)
    }
    last = second
    while (head < starts.length && (starts[head] ?? 0) <= second) head += 1
  }
  /**
   * The second server `index` can start a customer who arrives at
   * `second`: once free, or once back if away by then.
   */
  const startOf = (index: number, second: number) => {
    const free = Math.max(second, freeAt[index] ?? 0)
    const away = servers[index]?.away
    return away !== undefined && away.from <= free && free < away.to
      ? away.to
      : free
  }
  /**
   * The server who can start a customer arriving at `second` first: on a
   * tie, the one free since earliest, then the first of them. With nobody
   * away, that is the one free first, the first of them on a tie.
   */
  const firstFree = (second: number) => {
    let first = 0
    let earliest = startOf(0, second)
    for (let index = 1; index < freeAt.length; index += 1) {
      const start = startOf(index, second)
      if (
        start < earliest ||
        (start === earliest && (freeAt[index] ?? 0) < (freeAt[first] ?? 0))
      ) {
        first = index
        earliest = start
      }
    }
    return first
  }

  return {
    ahead: (second) => {
      at(second)
      return {
        wait: startOf(firstFree(second), second) - second,
        waiting: starts.length - head,
      }
    },
    join: (second, items) => {
      at(second)
      const server = firstFree(second)
      const start = startOf(server, second)
      const reached = servers[server] ?? AVATAR
      freeAt[server] =
        start +
        (service.baseSeconds + service.perItemSeconds * items) / reached.speed
      starts.push(start)
      return { start, server: reached }
    },
    isOpen: (second) => {
      at(second)
      return servers.some(
        ({ away }) =>
          away === undefined || second < away.from || second >= away.to,
      )
    },
  }
}
