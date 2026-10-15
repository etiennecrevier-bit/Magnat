import type { Marketing } from '../content/schema.ts'
import type { ExtraCrowd } from './customers.ts'
import type { Cents } from './money.ts'

// The marketing budget: what it spent on the days before brings walk-ins on
// top of the day type's crowd, more of them the more it spent, but each
// dollar brings fewer than the one before.

/**
 * The truck's awareness on a day, in cents: what marketing spent on the
 * last `awarenessDays` business days before it, averaged over
 * `awarenessDays`. `history` is that spend, oldest first, as
 * `GameState.marketingHistory` keeps it. A day missing from it, before the
 * game started, counts as 0, like a closed day.
 */
export function awareness(
  history: readonly Cents[],
  marketing: Marketing,
): number {
  const { awarenessDays } = marketing
  const spent = history
    .slice(-awarenessDays)
    .reduce((total, cents) => total + cents, 0)
  return spent / awarenessDays
}

/**
 * The extra walk-ins `awareness` brings to an open day, before the day's
 * noise: k × √awareness, with k the content's `extraCustomersPerSqrtCent`.
 * Doubling the awareness brings √2 times as many, fewer than double.
 */
export function extraCustomers(
  awareness: number,
  marketing: Marketing,
): number {
  return marketing.extraCustomersPerSqrtCent * Math.sqrt(awareness)
}

/** The crowd marketing brings to an open day, after `history`. */
export function marketingCrowd(
  history: readonly Cents[],
  marketing: Marketing,
): ExtraCrowd {
  return {
    customers: extraCustomers(awareness(history, marketing), marketing),
    segmentShares: marketing.segmentShares,
  }
}

/**
 * `history` with what marketing spent on the day just played added last,
 * keeping the last `awarenessDays` days. Never mutates `history`.
 */
export function rememberSpend(
  history: readonly Cents[],
  spent: Cents,
  marketing: Marketing,
): readonly Cents[] {
  return [...history, spent].slice(-marketing.awarenessDays)
}
