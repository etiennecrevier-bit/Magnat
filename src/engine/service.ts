import type {
  DayType,
  EnergyContent,
  Segment,
  Service,
  StaffContent,
} from '../content/schema.ts'
import { effectsOf } from './energy.ts'
import { STAFF, crewOf } from './staff.ts'
import type { GameState } from './types.ts'

// The line at the counter: who serves, how long serving takes, and how long
// customers wait for it.

/** A calendar fact, not a tunable. */
export const SECONDS_PER_MINUTE = 60

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
}

// Speed 1 is the unit the content's service times are written in, not a
// tunable.
const AVATAR: Server = { speed: 1, owner: true }

/**
 * Who serves at the counter on business day `state.day`, with `state.staff`
 * on staff that day: first the owner, unless away all day (see `crewOf`), at
 * speed 1 when rested. Tired, they take `serviceTimeIncrease` longer (see
 * `effectsOf` in energy.ts), so their speed is 1 ÷ (1 + `serviceTimeIncrease`),
 * by their energy that morning, which holds for the whole day. Then each
 * employee at the truck, at `staff.truckSpeed`. Empty when nobody serves.
 */
export function servers(
  state: GameState,
  energy: EnergyContent,
  staff: StaffContent = STAFF,
): readonly Server[] {
  const crew = crewOf(state.staff, state.ownerAway)
  const employees = Array.from(
    { length: crew.atTruck },
    (): Server => ({ speed: staff.truckSpeed, owner: false }),
  )
  if (!crew.ownerServes) return employees
  const { serviceTimeIncrease } = effectsOf(state.energy, energy)
  return [
    { speed: AVATAR.speed / (1 + serviceTimeIncrease), owner: true },
    ...employees,
  ]
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
   * Returns the second they reach a server and that server: the one free
   * first, the first of them on a tie.
   */
  join: (second: number, items: number) => Joined
}

/** When a customer who joined the line reaches a server, and which. */
export interface Joined {
  readonly start: number
  readonly server: Server
}

/**
 * Opens an empty line served by `servers`, at the times of `service`. Each
 * customer takes `(baseSeconds + perItemSeconds × items) ÷ speed` seconds of
 * the server they reach. Customers must come in the order they arrive: the
 * seconds passed to `ahead()` and `join()` never go down, so those who join
 * reach a server in the order they joined. Throws a RangeError if there is
 * no server, if a speed is not a finite number above 0, or if a second goes
 * down.
 */
export function openLine(servers: readonly Server[], service: Service): Line {
  if (servers.length === 0) throw new RangeError('No one serves the line')
  for (const { speed } of servers) {
    if (!Number.isFinite(speed) || speed <= 0) {
      throw new RangeError(`Invalid server speed: ${speed}`)
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
  const firstFree = () => {
    let first = 0
    for (let index = 1; index < freeAt.length; index += 1) {
      if ((freeAt[index] ?? 0) < (freeAt[first] ?? 0)) first = index
    }
    return first
  }

  return {
    ahead: (second) => {
      at(second)
      return {
        wait: Math.max(0, (freeAt[firstFree()] ?? 0) - second),
        waiting: starts.length - head,
      }
    },
    join: (second, items) => {
      at(second)
      const server = firstFree()
      const start = Math.max(second, freeAt[server] ?? 0)
      const reached = servers[server] ?? AVATAR
      freeAt[server] =
        start +
        (service.baseSeconds + service.perItemSeconds * items) / reached.speed
      starts.push(start)
      return { start, server: reached }
    },
  }
}
