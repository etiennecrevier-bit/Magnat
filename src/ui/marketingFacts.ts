import { marketingOver } from '../engine/marketing.ts'
import type { MarketingDay, MarketingWeek } from '../engine/types.ts'
import { formatDayAndMonth } from './formatGameDate.ts'
import { formatCount, formatWholeMoney } from './formatMoney.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What the marketing brought (#284), as facts beside its budget and in the
// week's report: what it spent, the walk-ins it brought and what they
// paid. Never a return on it: the player draws that conclusion.

// French puts a no-break space (U+00A0) before a colon.
const COLON = ' :'

/** The business days a week of the tooltip counts. */
const WEEK_DAYS = 7

/** The weeks the tooltip shows side by side. */
const WEEKS_SHOWN = 4

/**
 * What marketing spent and brought over some days, in one line: « 210 $
 * dépensés · 41 clients venus par la pub · 318 $ de ventes ».
 */
export function marketingText({
  spent,
  customers,
  sales,
}: MarketingWeek): string {
  const came =
    customers < 2 ? 'client venu par la pub' : 'clients venus par la pub'
  return `${formatWholeMoney(spent)} dépensés · ${formatCount(customers)} ${came} · ${formatWholeMoney(sales)} de ventes`
}

/** What « Salaire et marketing » shows under the budget. */
export interface MarketingFacts {
  /** The last 7 days, in one line. */
  readonly line: string
  /** The last 4 weeks, side by side. */
  readonly tip: TipContent
}

/**
 * What marketing spent and brought over the last 7 business days of
 * `history` (see `GameState.marketingDays`), and over each of the last 4
 * weeks for the tooltip, newest last; null before a day is kept.
 */
export function marketingFacts(
  history: readonly MarketingDay[] | undefined,
): MarketingFacts | null {
  const days = history ?? []
  const last = days.at(-1)
  if (last === undefined) return null
  const week = marketingOver(days, last.day - WEEK_DAYS + 1, last.day)
  const rows: TipRow[] = []
  for (let back = WEEKS_SHOWN - 1; back >= 0; back -= 1) {
    const toDay = last.day - back * WEEK_DAYS
    const fromDay = toDay - WEEK_DAYS + 1
    const kept = days.filter(({ day }) => day >= fromDay && day <= toDay)
    const first = kept[0]
    const end = kept.at(-1)
    if (first === undefined || end === undefined) continue
    const { spent, customers, sales } = marketingOver(kept, fromDay, toDay)
    rows.push({
      label: `${formatDayAndMonth(first.day)} – ${formatDayAndMonth(end.day)}`,
      value: `${formatWholeMoney(spent)} · ${formatCount(customers)} ${customers < 2 ? 'client' : 'clients'} · ${formatWholeMoney(sales)}`,
    })
  }
  return {
    line: `7 derniers jours${COLON} ${marketingText(week)}`,
    tip: {
      title: 'Marketing',
      text: 'Dépensé · clients venus par la pub · leurs ventes',
      rows,
    },
  }
}
