import type { Marketing, ProductId } from '../content/schema.ts'
import { visitSales, type ExtraCrowd } from './customers.ts'
import { add, cents, type Cents } from './money.ts'
import type { Day, MarketingDay, MarketingWeek, Visit } from './types.ts'

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

/**
 * The crowd marketing brings to an open day, after `history`, its visits
 * tagged as marketing's (#284).
 */
export function marketingCrowd(
  history: readonly Cents[],
  marketing: Marketing,
): ExtraCrowd {
  return {
    customers: extraCustomers(awareness(history, marketing), marketing),
    segmentShares: marketing.segmentShares,
    fromMarketing: true,
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

/**
 * The business days `GameState.marketingDays` keeps (#284): four weeks,
 * what « Salaire et marketing » shows. A display window, not a tunable.
 */
export const MARKETING_DAYS_KEPT = 28

/**
 * What marketing spent and brought on `day` (#284): `spent`, and the
 * visits it brought (see `Visit.fromMarketing`), whatever they came to,
 * with what they paid at the day's `price`.
 */
export function marketingDayOf(
  day: Day,
  spent: Cents,
  visits: readonly Visit[],
  price: (product: ProductId) => Cents,
): MarketingDay {
  const brought = visits.filter(({ fromMarketing }) => fromMarketing === true)
  return {
    day,
    spent,
    customers: brought.length,
    sales: brought.reduce(
      (total, visit) => add(total, visitSales(visit, price)),
      cents(0),
    ),
  }
}

/**
 * `history` with `today` added last, keeping the last `MARKETING_DAYS_KEPT`
 * days. An older save's missing history starts empty. Never mutates
 * `history`.
 */
export function rememberMarketingDay(
  history: readonly MarketingDay[] | undefined,
  today: MarketingDay,
): MarketingDay[] {
  return [...(history ?? []), today].slice(-MARKETING_DAYS_KEPT)
}

/**
 * What marketing spent and brought over the days of `history` from
 * `fromDay` to `toDay`, both included, added up.
 */
export function marketingOver(
  history: readonly MarketingDay[],
  fromDay: Day,
  toDay: Day,
): MarketingWeek {
  return history
    .filter(({ day }) => day >= fromDay && day <= toDay)
    .reduce(
      (week, { spent, customers, sales }) => ({
        spent: add(week.spent, spent),
        customers: week.customers + customers,
        sales: add(week.sales, sales),
      }),
      { spent: cents(0), customers: 0, sales: cents(0) },
    )
}
