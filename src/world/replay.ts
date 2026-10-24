import type { DayTypeId, WalkIns } from '../content/schema.ts'
import { toCalendar } from '../engine/clock.ts'
import { dayTypeOf } from '../engine/customers.ts'
import { FIRST_TRUCK } from '../engine/trucks.ts'
import type {
  GameState,
  TruckId,
  Visit,
  VisitOutcome,
} from '../engine/types.ts'
import type { CrowdSettings } from './crowdSettings.ts'
import { opensToday } from './truckView.ts'

// What the street replays: yesterday's visits, a sample of them, as today
// goes by. Pure, so the rules are tested without Pixi.

/** The day the street replays: the last one played. */
export interface Replay {
  /** Its visits, in arrival order. */
  readonly visits: readonly Visit[]
  /** Its crowd, which picks the office cues or the families. */
  readonly dayType: DayTypeId
  /**
   * Visits that reached the counter, as « Hier »'s « Clients servis » counts
   * them (`todayNumbers`).
   */
  readonly served: number
}

/**
 * The day the street of the truck `truck` replays while the top bar shows
 * `game.day`: its last day played, `game.lastDay` for the first truck's.
 * Null when there is none, when it had no visits, or when the truck is
 * closed on `game.day` (`open`, see `opensToday`), so no one buys from a
 * truck showing « Fermé ».
 */
export function replayOf(
  game: GameState,
  truck: TruckId = FIRST_TRUCK,
  open: boolean = opensToday(game, truck),
): Replay | null {
  const lastDay =
    truck === FIRST_TRUCK
      ? game.lastDay
      : (game.trucks?.find(({ id }) => id === truck)?.lastDay ?? null)
  if (lastDay === null || lastDay.visits.length === 0) return null
  if (!open) return null
  return {
    visits: lastDay.visits,
    dayType: dayTypeOf(toCalendar(lastDay.day).weekday),
    served: lastDay.visits.filter(({ servedMinute }) => servedMinute !== null)
      .length,
  }
}

/** The face on a customer's bubble as they leave. */
export type Mood = 'happy' | 'annoyed' | 'sad' | 'neutral'

/** How a customer feels about how their visit ended. */
export function moodOf(outcome: VisitOutcome): Mood {
  switch (outcome) {
    case 'bought':
      return 'happy'
    case 'tooExpensive':
      return 'annoyed'
    case 'soldOut':
      return 'sad'
    case 'leftLine':
      return 'annoyed'
    case 'browsed':
      return 'neutral'
  }
}

/** How far through the open hours `visit` arrived, from 0 to just under 1. */
export function arrivalShare(visit: Visit, walkIns: WalkIns): number {
  const { opensAtMinute, closesAtMinute } = walkIns
  return (
    (visit.arrivalMinute - opensAtMinute) / (closesAtMinute - opensAtMinute)
  )
}

/** How far the street is through the day it replays. */
export interface DayClock {
  /**
   * Follows `game`. Returns true when the replay starts again from the top:
   * on the first game, a new day or a new last day played. A game changed
   * on the same day, as a decision changes it, carries on.
   */
  follow: (game: GameState) => boolean
  /**
   * Moves on by `deltaMs` real milliseconds at `speed`, where a day takes
   * `msPerDay` at speed 1, and returns how far through the day it is, from
   * 0 to 1. It stops at 1 until the next day.
   */
  elapse: (deltaMs: number, speed: number) => number
}

export function createDayClock(msPerDay: number): DayClock {
  let day: number | null = null
  let lastDay: GameState['lastDay'] = null
  let progress = 0
  return {
    follow: (game) => {
      if (game.day === day && game.lastDay === lastDay) return false
      day = game.day
      lastDay = game.lastDay
      progress = 0
      return true
    },
    elapse: (deltaMs, speed) => {
      if (speed > 0 && deltaMs > 0) {
        progress = Math.min(1, progress + (deltaMs * speed) / msPerDay)
      }
      return progress
    },
  }
}

/** Picks which of the day's visits walk onto the street. */
export interface Sampler {
  /** Replays `visits` from now on, dropping those of the last list still to come. */
  start: (visits: readonly Visit[]) => void
  /**
   * Moves on to `progress` through the day, `deltaMs` real milliseconds
   * after the last step, with `onScreen` customers on the street. Returns
   * the visit that walks on now, if any.
   */
  step: (
    progress: number,
    deltaMs: number,
    onScreen: number,
    speed: number,
  ) => Visit | null
}

/**
 * Samples the visits to show, in arrival order. Each visit comes up once
 * the day is as far through as its arrival (see `arrivalShare`), and is
 * kept with the speed's `keepChance`, so busier days and busier hours bring
 * more people. A kept visit walks on only if the gate is open: the speed's
 * `minGapMs`, give or take `jitterMs`, has gone by since the last one, and
 * fewer than its `maxOnScreen` are on screen. Otherwise it is dropped, never
 * held back, so the people who do walk on come when they came.
 *
 * Nothing comes up while paused. A speed above 0 with no settings lets the
 * visits come up and drops them all. At most one visit walks on per step.
 */
export function createSampler(
  walkIns: WalkIns,
  speeds: CrowdSettings['speeds'],
  random: () => number,
): Sampler {
  let visits: readonly Visit[] = []
  let shares: readonly number[] = []
  let cursor = 0
  // The real time since the last arrival, and where the next gap falls
  // between -1 (minGapMs − jitterMs) and 1 (minGapMs + jitterMs).
  let sinceMs = Number.POSITIVE_INFINITY
  let gapDraw = random() * 2 - 1

  return {
    start: (next) => {
      visits = next
      shares = next.map((visit) => arrivalShare(visit, walkIns))
      cursor = 0
    },
    step: (progress, deltaMs, onScreen, speed) => {
      if (speed <= 0) return null
      sinceMs += Math.max(0, deltaMs)
      const settings = speeds[speed]
      let arriving: Visit | null = null
      while (cursor < visits.length && (shares[cursor] ?? 1) <= progress) {
        const visit = visits[cursor] as Visit
        cursor += 1
        if (settings === undefined || arriving !== null) continue
        if (random() >= settings.keepChance) continue
        const gapMs = settings.minGapMs + gapDraw * settings.jitterMs
        if (sinceMs < gapMs || onScreen >= settings.maxOnScreen) continue
        arriving = visit
        sinceMs = 0
        gapDraw = random() * 2 - 1
      }
      return arriving
    },
  }
}
