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
// cards follows (#137). It is read from the state, so it needs no save.

const CASH: AccountCode = '1000'

// A calendar fact, not a tunable.
const DAYS_PER_WEEK = 7

/**
 * The player's standing on the morning of `state.day`, by `rules`:
 * « en difficulté » (`behind`) when the encaisse is below
 * `behindBelowMonthsOfFixedCosts` months of `monthlyFixedCosts`, or when the
 * bénéfice net, from the truck's first day to the close of the last week
 * played, reads below the percentile `behindBelowPercentile` of
 * `percentiles` at the game's difficulty and that week (see
 * `percentileOf`); « en avance » (`ahead`) when it reads above
 * `aheadAbovePercentile`; « dans la moyenne » (`average`) otherwise, and
 * before the first week is over. A Défi counts its weeks from its first
 * day.
 */
export function standingOf(
  state: GameState,
  rules: AdaptiveDraw,
  percentiles: PercentileContent = PERCENTILES,
  foodTruck: FoodTruckContent = FOOD_TRUCK,
  difficulties: DifficultyContent = DIFFICULTIES,
): Standing {
  const { day, journal, challenge } = state
  const { difficulty } = state.profile
  const firstDay = challenge?.startDay ?? 0
  const fixedCosts = monthlyFixedCosts(
    day,
    difficulty,
    firstDay,
    foodTruck,
    difficulties,
  )
  const cash = balance(journal, CASH, { toDay: day })
  if (cash < fixedCosts * rules.behindBelowMonthsOfFixedCosts) return 'behind'

  const week = Math.floor((day - firstDay) / DAYS_PER_WEEK)
  if (week < 1) return 'average'
  const lastSunday = firstDay + week * DAYS_PER_WEEK - 1
  const { netIncome } = incomeStatement(journal, firstDay, lastSunday)
  const percentile = percentileOf(
    difficulty,
    week,
    netIncome.amount,
    percentiles,
  )
  if (percentile < rules.behindBelowPercentile) return 'behind'
  if (percentile > rules.aheadAbovePercentile) return 'ahead'
  return 'average'
}
