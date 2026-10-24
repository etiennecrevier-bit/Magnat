import type { DecisionChange } from '../engine/decisions.ts'
import { FIRST_TRUCK, truckDecisionsOf, truckIds } from '../engine/trucks.ts'
import type { Decisions, GameState, TruckId } from '../engine/types.ts'
import { SHOWN_TRUCK, type ShownTruckStore } from '../world/shownTruck.ts'
import { formatBriefMoney } from './formatMoney.ts'
import { todayWork } from './staffBoard.ts'
import { gameStore, type GameStore } from './store.ts'
import {
  todayNumbers,
  truckWithout,
  type TodayNumbers,
} from './todayNumbers.ts'
import {
  closedText,
  hasTrucks,
  storedOn,
  truckDayOf,
  truckName,
  wasOpen,
  whoWorksToday,
  type StoredDay,
} from './trucks.ts'

// What the panels show of the truck picked (#265): the switcher's pills,
// « Hier » and the decisions « Le camion » shows and sends.

// A number before its truck has a day.
const NO_NUMBER = '—'

/** A truck's pill: « Vieux-Montréal · vous ». */
export interface TruckPill {
  readonly id: TruckId
  /** Its district's name. */
  readonly name: string
  /** Who works there today, « fermé » or « remisé » (see `whoWorksToday`). */
  readonly who: string
}

/**
 * Each truck's pill for `game`, the first one first; none while it has
 * one truck, when the switcher hides.
 */
export function truckPills(game: GameState): TruckPill[] {
  const ids = truckIds(game)
  if (ids.length < 2) return []
  const work = todayWork(game)
  return ids.map((id) => ({
    id,
    name: truckName(game, id),
    who: whoWorksToday(id, work),
  }))
}

/** The kinds of change that name the truck they change (#259). */
const TRUCK_KINDS: readonly DecisionChange['kind'][] = [
  'price',
  'restock',
  'daysOpen',
  'storage',
]

/**
 * `change` naming the truck `truck` when it changes one: a change that
 * names none changes the first truck, so only another is named.
 */
export function forTruck(
  change: DecisionChange,
  truck: TruckId,
): DecisionChange {
  if (truck === FIRST_TRUCK || !TRUCK_KINDS.includes(change.kind)) {
    return change
  }
  return { ...change, truck } as DecisionChange
}

/**
 * `decisions` as « Le camion » shows them for the truck `truck`: that
 * truck's prices, restock rules, days open and storage, and the
 * company's own decisions beside.
 */
export function shownDecisions(
  decisions: Decisions,
  truck: TruckId,
): Decisions {
  if (truck === FIRST_TRUCK) return decisions
  const rest = { ...decisions }
  delete rest.storage
  return { ...rest, ...truckDecisionsOf(decisions, truck) }
}

/** Another truck's line in « Hier »: « Plateau  402 $ ». */
export interface OtherTruckLine {
  readonly id: TruckId
  readonly name: string
  /** Its sales, « fermé », or « — » before it has a day. */
  readonly value: string
}

/** What « Hier » shows of `game` for the truck `shown`. */
export interface YesterdayCard {
  readonly numbers: TodayNumbers | null
  readonly note: string | null
  readonly title: string
  readonly closed: string | null
  readonly others: readonly OtherTruckLine[]
}

/**
 * « Hier » for `game`, showing the truck `shown`: its last day's numbers,
 * or why it was closed, from `stored`, the trucks stored that day (see
 * `watchStoredDays`); with two trucks or more, its name in the title and
 * a line per other truck. Who kept the truck open with the owner away
 * stays a fact of the first truck's day.
 */
export function yesterdayCard(
  game: GameState,
  shown: TruckId,
  stored: StoredDay | null = STORED_DAYS.last(),
): YesterdayCard {
  const day = truckDayOf(game, shown)
  const { lastDay } = game
  const several = hasTrucks(game)
  return {
    numbers: day === null ? null : todayNumbers(day),
    note:
      lastDay === null || shown !== FIRST_TRUCK
        ? null
        : truckWithout(lastDay, game.staff),
    title: several ? `Hier · ${truckName(game, shown)}` : 'Hier',
    closed: several ? closedText(game, shown, stored) : null,
    others: several
      ? truckIds(game)
          .filter((id) => id !== shown)
          .map((id) => {
            const other = truckDayOf(game, id)
            return {
              id,
              name: truckName(game, id),
              value:
                other === null
                  ? NO_NUMBER
                  : wasOpen(other)
                    ? formatBriefMoney(other.revenue)
                    : 'fermé',
            }
          })
      : [],
  }
}

/**
 * Forgets the truck picked in `shown` each time `store` starts or loads
 * another game, so a pick never carries into it. Returns the unsubscribe.
 * The app's stores are watched below for the page's whole life.
 */
export function forgetPickOnNewGame(
  store: GameStore = gameStore,
  shown: ShownTruckStore = SHOWN_TRUCK,
): () => void {
  return store.subscribe((state, previous) => {
    if (state.gamesStarted !== previous.gamesStarted) shown.pick(null)
  })
}

/** What remembers the trucks stored on the day last played. */
export interface StoredDays {
  /**
   * The trucks stored the day last played; null when that is not known,
   * before a day is played in this game, as after a load.
   */
  readonly last: () => StoredDay | null
  /** Stops watching. */
  readonly stop: () => void
}

/**
 * Remembers, as `store` plays each day, the trucks its storage kept closed
 * that day: the game no longer holds the decisions a day was played with
 * once its morning has the next day's (see `storedOn`).
 */
export function watchStoredDays(store: GameStore = gameStore): StoredDays {
  let morning: GameState | null = null
  let last: StoredDay | null = null
  const stopMornings = store.getState().watchMornings((next) => {
    // The game the day was played from: the store's for a run's first day,
    // the morning before for each next one, as the store takes a run's
    // last morning only.
    const current = store.getState().game
    const before = current.day === next.day - 1 ? current : morning
    last = before?.day === next.day - 1 ? storedOn(before) : null
    morning = next
  })
  const stopStarts = store.subscribe((state, previous) => {
    if (state.gamesStarted === previous.gamesStarted) return
    morning = null
    last = null
  })
  return {
    last: () => last,
    stop: () => {
      stopMornings()
      stopStarts()
    },
  }
}

/** The app store's, which « Hier » reads. */
const STORED_DAYS = watchStoredDays()

// Watched from the page's start rather than by a component: a game starts
// from the menu while the top bar is not shown, and a new game's truck may
// have the id of the one picked in the last.
forgetPickOnNewGame()
