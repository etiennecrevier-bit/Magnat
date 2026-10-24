import { useSyncExternalStore } from 'react'
import type {
  DistrictContent,
  DistrictId,
  WinterStorage,
} from '../content/schema.ts'
import { toCalendar } from '../engine/calendar.ts'
import { latestDecisions } from '../engine/decisions.ts'
import { DISTRICTS, isStored } from '../engine/districts.ts'
import { STAFF } from '../engine/staff.ts'
import {
  FIRST_DISTRICT,
  FIRST_TRUCK,
  ownerAtOf,
  truckDecisionsOf,
  truckIds,
  truckOf,
  trucksOf,
} from '../engine/trucks.ts'
import type { Day, DaySummary, GameState, TruckId } from '../engine/types.ts'
import {
  SHOWN_TRUCK,
  shownTruckOf,
  type ShownTruckStore,
} from '../world/shownTruck.ts'
import {
  formatMonthDay,
  formatMonthName as monthName,
} from './formatGameDate.ts'
import type { TodayWork } from './staffBoard.ts'
import type { TipContent } from './tooltip.ts'

// The trucks as the player reads them (#265): each is named after its
// district, the switcher picks the one « Le camion », « Hier » and the
// street show, and each says who works there today. The engine plays them
// (src/engine/trucks.ts); this only reads and words them.

// The role whose employees work at a truck.
const AT_TRUCK = 'camion'
// Months in a year, a calendar fact.
const MONTHS_PER_YEAR = 12
// The text form of ☀ and ❄, so no colour emoji takes their place.
const TEXT_FORM = '︎'

/** What « Hier » and « Le camion » read of a truck's last day. */
export type ReportedDay = Pick<
  DaySummary,
  'day' | 'sold' | 'revenue' | 'lostSales' | 'pricedOut' | 'spoiled' | 'visits'
> & {
  /** Whether it opened; the first truck's day has none (see `wasOpen`). */
  readonly open?: boolean
}

/**
 * The truck the page shows in `game`: the one picked in `store`, or the
 * owner's (see `shownTruckOf`). Re-renders on each pick.
 */
export function useShownTruck(
  game: GameState,
  store: ShownTruckStore = SHOWN_TRUCK,
): TruckId {
  const picked = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState,
  )
  return shownTruckOf(game, picked)
}

/** The district of `game`'s truck `id`; the first truck's when unknown. */
export function districtOf(game: GameState, id: TruckId): DistrictId {
  return (
    trucksOf(game).find((truck) => truck.id === id)?.district ?? FIRST_DISTRICT
  )
}

/** The name of `game`'s truck `id`: its district's, « Vieux-Montréal ». */
export function truckName(
  game: GameState,
  id: TruckId,
  districts: DistrictContent = DISTRICTS,
): string {
  return districts.districts[districtOf(game, id)].name
}

/** Whether `game` has more than one truck, when the trucks get named. */
export function hasTrucks(game: Pick<GameState, 'trucks'>): boolean {
  return truckIds(game).length > 1
}

/**
 * The last day `game`'s truck `id` played: the game's own for the first
 * truck, the truck's for any other; null before it has one.
 */
export function truckDayOf(game: GameState, id: TruckId): ReportedDay | null {
  if (id === FIRST_TRUCK) return game.lastDay
  return game.trucks?.find((truck) => truck.id === id)?.lastDay ?? null
}

/**
 * Whether the truck opened on `day`: as its day records it, or for the
 * first truck, whose day does not, whether any customer came, as nobody
 * comes to a closed truck.
 */
export function wasOpen(day: ReportedDay): boolean {
  return day.open ?? day.visits.length > 0
}

/** The trucks a storage kept closed on the day `day`, as it was played. */
export interface StoredDay {
  readonly day: Day
  readonly trucks: readonly TruckId[]
}

/**
 * The trucks of `game` that its storage keeps closed on the day it plays
 * next. Read before `tick`: the morning after holds the next day's
 * decisions, which may store a truck, or not, otherwise.
 */
export function storedOn(game: GameState): StoredDay {
  return {
    day: game.day,
    trucks: truckIds(game).filter((id) =>
      isStored(truckDecisionsOf(game.decisions, id).storage, game.day),
    ),
  }
}

/**
 * Why `game`'s truck `id` sold nothing on its last day: « Fermé pour
 * l'hiver » when `stored`, the trucks stored the day it was played, has
 * it, else « Fermé », as when why is not known, after a load; null when it
 * opened, or has no day yet.
 */
export function closedText(
  game: GameState,
  id: TruckId,
  stored: StoredDay | null,
): string | null {
  const day = truckDayOf(game, id)
  if (day === null || wasOpen(day)) return null
  return stored?.day === day.day && stored.trucks.includes(id)
    ? "Fermé pour l'hiver"
    : 'Fermé'
}

/** `Kevin`: the first word of a name. */
function firstName(name: string): string {
  return name.split(' ')[0] ?? name
}

/** `a`, `a et b`, `a, b et c`. */
function listed(words: readonly string[]): string {
  if (words.length < 2) return words.join('')
  return `${words.slice(0, -1).join(', ')} et ${words.at(-1) ?? ''}`
}

/**
 * Who works at the truck `id` today, from the morning `work` (see
 * `todayWork`): « remisé » while its storage covers today, « fermé »
 * when it does not open, or else « vous » when the owner is there, then
 * the first names of the employees at it who came.
 */
export function whoWorksToday(id: TruckId, work: TodayWork): string {
  const today = work.trucks.find((truck) => truck.id === id)
  if (today === undefined) return 'fermé'
  if (today.stored) return 'remisé'
  if (!today.opens) return 'fermé'
  const names = today.truckers.map((candidate) =>
    firstName(STAFF.candidates[candidate].name),
  )
  return listed(today.owner ? ['vous', ...names] : names)
}

/**
 * The trucks of `game` that close tomorrow with nobody at them, as the
 * latest decisions leave them: a day open, not stored then, with neither
 * the owner nor any employee « Au camion » the player wants assigned to
 * them.
 */
export function unstaffedTomorrow(game: GameState): TruckId[] {
  const latest = latestDecisions(game)
  const tomorrow = game.day + 1
  const { weekday } = toCalendar(tomorrow)
  return truckIds(game).filter((id) => {
    const own = truckDecisionsOf(latest, id)
    if (!own.daysOpen.includes(weekday) || isStored(own.storage, tomorrow)) {
      return false
    }
    if (ownerAtOf(latest) === id) return false
    return !latest.staff.some(
      (hire) => hire.role === AT_TRUCK && truckOf(hire) === id,
    )
  })
}

/** A district's season in a month: by how its crowd compares to a usual one. */
export type Season = 'haute' | 'normale' | 'basse'

/** The season of `district` in `month` (1 = January). */
export function seasonOf(
  district: DistrictId,
  month: number,
  districts: DistrictContent = DISTRICTS,
): Season {
  const factor = districts.districts[district].monthlyWalkIns[month - 1]
  if (factor === undefined) throw new RangeError(`Invalid month: ${month}`)
  if (factor > 1) return 'haute'
  return factor < 1 ? 'basse' : 'normale'
}

/** Each season's name, as the chip and its tooltip say it. */
export const SEASON_NAMES: Readonly<Record<Season, string>> = {
  haute: 'Haute saison',
  normale: 'Saison normale',
  basse: 'Basse saison',
}

/** The symbol before a season's name; never the only cue. */
export const SEASON_SYMBOLS: Readonly<Record<Season, string | null>> = {
  haute: `☀${TEXT_FORM}`,
  normale: null,
  basse: `❄${TEXT_FORM}`,
}

/**
 * The months of `season` in `district`, as runs: `juin à août`, `décembre
 * à mars` over the year's end, `mai` alone; joined by « et ».
 */
export function seasonMonths(
  district: DistrictId,
  season: Season,
  districts: DistrictContent = DISTRICTS,
): string {
  const months = Array.from(
    { length: MONTHS_PER_YEAR },
    (_, index) => index + 1,
  )
  const inSeason = (month: number) =>
    seasonOf(district, month, districts) === season
  if (months.every(inSeason)) return "toute l'année"
  // Start after a month out of season, so no run is cut by the year's end.
  const start = months.find((month) => !inSeason(month)) ?? 1
  const runs: [number, number][] = []
  for (let step = 1; step <= MONTHS_PER_YEAR; step += 1) {
    const month = ((start - 1 + step) % MONTHS_PER_YEAR) + 1
    if (!inSeason(month)) continue
    const last = runs.at(-1)
    const before = ((month + MONTHS_PER_YEAR - 2) % MONTHS_PER_YEAR) + 1
    if (last !== undefined && last[1] === before) last[1] = month
    else runs.push([month, month])
  }
  return listed(
    runs.map(([from, to]) =>
      from === to ? monthName(from) : `${monthName(from)} à ${monthName(to)}`,
    ),
  )
}

/** The season chip beside the energy: its words and its tooltip. */
export interface SeasonChip {
  readonly season: Season
  readonly label: string
  readonly tip: TipContent
}

/**
 * The season chip of `district` in `month`: « ☀ Haute saison »,
 * « Saison normale » or « ❄ Basse saison », the tooltip giving the
 * district's high and low seasons, or that it has none.
 */
export function seasonChip(
  district: DistrictId,
  month: number,
  districts: DistrictContent = DISTRICTS,
): SeasonChip {
  const season = seasonOf(district, month, districts)
  const { name } = districts.districts[district]
  const seasons = (['haute', 'basse'] as const).filter((each) =>
    Array.from({ length: MONTHS_PER_YEAR }, (_, index) => index + 1).some(
      (one) => seasonOf(district, one, districts) === each,
    ),
  )
  return {
    season,
    label: SEASON_NAMES[season],
    tip:
      seasons.length === 0
        ? { title: name, text: `${SEASON_NAMES.normale} toute l'année` }
        : {
            title: name,
            rows: seasons.map((each) => ({
              label: SEASON_NAMES[each],
              value: seasonMonths(district, each, districts),
            })),
          },
  }
}

/** « Du 1er décembre au 30 avril »: the dates of a winter storage. */
export function storageDates({ from, to }: WinterStorage): string {
  return `Du ${formatMonthDay(from)} au ${formatMonthDay(to)}`
}

/** « Le camion · Vieux-Montréal », or the panel's own title alone. */
export function titledFor(game: GameState, id: TruckId, title: string): string {
  return hasTrucks(game) ? `${title} · ${truckName(game, id)}` : title
}
