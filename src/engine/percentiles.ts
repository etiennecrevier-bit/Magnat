import {
  loadPercentileContent,
  type DifficultyId,
  type PercentileContent,
} from '../content/schema.ts'
import type { Cents } from './money.ts'

// Where the player stands among the simulated owners of
// `npm run balance -- --percentiles`: « Mieux que N % des propriétaires ».

/** The shipped percentile table, validated once when the engine loads. */
export const PERCENTILES: PercentileContent = loadPercentileContent()

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
  const { percentiles } = content
  // The highest knot at or below the income; none when it is below them all.
  let knot = -1
  while (
    knot + 1 < amounts.length &&
    (amounts[knot + 1] ?? Infinity) <= cumulativeNetIncome
  ) {
    knot += 1
  }
  if (knot === -1) return 0
  const percentile = percentiles[knot] ?? 0
  const amount = amounts[knot] ?? 0
  const nextPercentile = percentiles[knot + 1]
  const nextAmount = amounts[knot + 1]
  if (nextPercentile === undefined || nextAmount === undefined) {
    return percentile
  }
  // Above the knot and below the next, so the next amount is higher.
  return (
    percentile +
    ((nextPercentile - percentile) * (cumulativeNetIncome - amount)) /
      (nextAmount - amount)
  )
}
