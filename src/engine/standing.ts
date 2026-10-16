import type {
  AdaptiveDraw,
  DifficultyContent,
  FoodTruckContent,
  PercentileContent,
  Standing,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import { DIFFICULTIES, FOOD_TRUCK } from './day.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { PERCENTILES, percentileOf } from './percentiles.ts'
import type { GameState } from './types.ts'

// How the player is doing on a morning, which Facile's draw of the event
// cards follows (#137), and where they stand among the owners, which the
// « Bilan de la semaine » tells. It is read from the state, so it needs no
// save.

const CASH: AccountCode = '1000'

// A calendar fact, not a tunable.
const DAYS_PER_WEEK = 7

/**
 * The player's standing on the morning of `state.day`, by `rules`:
 * « en difficulté » (`behind`) when the encaisse is below
 * `behindBelowMonthsOfFixedCosts` months of `monthlyFixedCosts`, the
 * bakery's included, or when the
 * bénéfice net, from the truck's first day to the close of the last week
 * played, reads below the percentile `behindBelowPercentile` of
 * `percentiles` at the game's difficulty and that week (see
 * `percentileOnMorning`); « en avance » (`ahead`) when it reads above
 * `aheadAbovePercentile`; « dans la moyenne » (`average`) otherwise, and
 * before the first week is over.
 */
export function standingOf(
  state: GameState,
  rules: AdaptiveDraw,
  percentiles: PercentileContent = PERCENTILES,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
): Standing {
  const { day, journal, challenge } = state
  const fixedCosts = monthlyFixedCosts(
    day,
    state.profile.difficulty,
    challenge?.startDay ?? 0,
    foodTruck,
    difficulties,
    state.bakery,
  )
  const cash = balance(journal, CASH, { toDay: day })
  if (cash < fixedCosts * rules.behindBelowMonthsOfFixedCosts) return 'behind'

  const percentile = percentileOnMorning(state, percentiles)
  if (percentile === null) return 'average'
  if (percentile < rules.behindBelowPercentile) return 'behind'
  if (percentile > rules.aheadAbovePercentile) return 'ahead'
  return 'average'
}

/**
 * Where the player stands among the owners of `percentiles` on the morning
 * of `state.day`, by `percentileOf`: the bénéfice net from the truck's first
 * day to the close of the last week played, at the game's difficulty and
 * that week, so the week `lastWeek` reports. Null before the first week is
 * over. A Défi counts its weeks from its first day.
 */
export function percentileOnMorning(
  state: GameState,
  percentiles: PercentileContent = PERCENTILES,
): number | null {
  const { day, journal, challenge } = state
  const firstDay = challenge?.startDay ?? 0
  const week = Math.floor((day - firstDay) / DAYS_PER_WEEK)
  if (week < 1) return null
  const lastSunday = firstDay + week * DAYS_PER_WEEK - 1
  const { netIncome } = incomeStatement(journal, firstDay, lastSunday)
  return percentileOf(
    state.profile.difficulty,
    week,
    netIncome.amount,
    percentiles,
  )
}
