import {
  loadDefiPercentileContent,
  loadPercentileContent,
  type Defi,
  type DefiPercentileContent,
  type DifficultyId,
  type PercentileContent,
} from '../content/schema.ts'
import { failedCondition, metricValue } from './challenge.ts'
import type { Cents } from './money.ts'
import type { ChallengeProgress } from './types.ts'

// Where the player stands among the simulated owners of
// `npm run balance -- --percentiles`: « Mieux que N % des propriétaires »;
// and where a Défi over stands among the simulated games of
// `npm run balance -- --defis`: « Mieux que N % des parties simulées ».

// A scale, not a tunable: every simulated game is 100 %.
const FULL_PERCENT = 100

/** The shipped percentile table, validated once when the engine loads. */
export const PERCENTILES: PercentileContent = loadPercentileContent()

/** The shipped Défis' percentile table, validated once when the engine loads. */
export const DEFI_PERCENTILES: DefiPercentileContent =
  loadDefiPercentileContent()

/**
 * The percentile, from 0 to the table's highest, of `cumulativeNetIncome`,
 * the bénéfice net from day 0 to the close of week `week`'s Sunday, among
 * the owners of `content` at `difficulty`. Week n runs from day 7(n - 1) to
 * day 7n - 1, so week 1 is the first; a week after the table's last reads
 * the last. Below the lowest percentile's amount gives 0, and at or above
 * the highest's gives the highest. In between, the percentile is linear
 * between the two amounts around it, taking the highest percentile of a run
 * of equal amounts, so it never goes down as the income goes up. The UI
 * rounds it down. Throws a RangeError unless `week` is a whole number from 1
 * and `cumulativeNetIncome` a safe integer.
 */
export function percentileOf(
  difficulty: DifficultyId,
  week: number,
  cumulativeNetIncome: Cents,
  content: PercentileContent = PERCENTILES,
): number {
  if (!Number.isSafeInteger(week) || week < 1) {
    throw new RangeError(`Not a week of the game: ${week}`)
  }
  if (!Number.isSafeInteger(cumulativeNetIncome)) {
    throw new RangeError(`Not a whole number of cents: ${cumulativeNetIncome}`)
  }
  const weeks = content.difficulties[difficulty]
  const amounts = weeks[Math.min(week, weeks.length) - 1] ?? []
  return percentileAmong(content.percentiles, amounts, cumulativeNetIncome)
}

/**
 * Where a Défi with `progress` stands among the simulated games of
 * `content`, from 0 to 100, as the table's `_note` reads it. A game that
 * broke one of the Défi's conditions is better than none: 0. One that broke
 * none ranks above every game that broke one, and among the others by the
 * percentile of its goal's value, read as `percentileOf` reads an amount;
 * for `spoilageRate`, where lower is better, 100 minus that. The share that
 * broke one counts in whole games, so a value on a percentile reads its N
 * exactly. Null when the table has no row for the Défi measuring its goal.
 * The UI rounds it down.
 */
export function defiPercentileOf(
  defi: Defi,
  progress: ChallengeProgress,
  content: DefiPercentileContent = DEFI_PERCENTILES,
): number | null {
  const { metric } = defi.goal
  const outcomes = content.defis[defi.id]
  if (outcomes?.metric !== metric) return null
  if (failedCondition(progress, defi) !== null) return 0
  // Every simulated game broke a condition, and this one broke none.
  if (outcomes.values === null) return FULL_PERCENT
  const { games, percentiles } = content
  const broken = Math.round(outcomes.brokenShare * games)
  const read = percentileAmong(
    percentiles,
    outcomes.values,
    metricValue(progress, metric),
  )
  const percentile = metric === 'spoilageRate' ? FULL_PERCENT - read : read
  return (broken * FULL_PERCENT + (games - broken) * percentile) / games
}

/**
 * The percentile of `value` among `values`, one at each of `percentiles`,
 * never going down: 0 below the lowest value, the highest percentile at or
 * above the highest, and linear between the two values around it, taking
 * the highest percentile of a run of equal values.
 */
function percentileAmong(
  percentiles: readonly number[],
  values: readonly number[],
  value: number,
): number {
  // The highest knot at or below the value; none when it is below them all.
  let knot = -1
  while (knot + 1 < values.length && (values[knot + 1] ?? Infinity) <= value) {
    knot += 1
  }
  if (knot === -1) return 0
  const percentile = percentiles[knot] ?? 0
  const atKnot = values[knot] ?? 0
  const nextPercentile = percentiles[knot + 1]
  const nextValue = values[knot + 1]
  if (nextPercentile === undefined || nextValue === undefined) {
    return percentile
  }
  // Above the knot and below the next, so the next value is higher.
  return (
    percentile +
    ((nextPercentile - percentile) * (value - atKnot)) / (nextValue - atKnot)
  )
}
