import type { Cents } from '../engine/money.ts'
import { formatBriefMoney, formatCount, formatMoney } from './formatMoney.ts'
import type { TodayNumbers } from './todayNumbers.ts'
import type { TipContent, TipRow } from './tooltip.ts'

// What the top bar's cash chip draws and says (CashGauge.tsx).

// Each number before the first day is over.
const NO_NUMBER = '—'

/** The sparkline's size in CSS pixels, as the reference draws it. */
export const SPARKLINE = { width: 70, height: 22 } as const

/**
 * The points of a sparkline of `values` in a `width` x `height` box, as
 * `ui_concepts.py` draws them: evenly apart, the lowest 2 px above the
 * bottom and the highest 2 px under the top, a flat line in the middle when
 * all are equal. Empty for fewer than two values.
 */
export function sparklinePoints(
  values: readonly number[],
  width: number = SPARKLINE.width,
  height: number = SPARKLINE.height,
): string {
  if (values.length < 2) return ''
  const highest = Math.max(...values)
  const lowest = Math.min(...values)
  const range = highest - lowest
  const step = width / (values.length - 1)
  return values
    .map((value, i) => {
      const y =
        range === 0
          ? height / 2
          : height - ((value - lowest) / range) * (height - 4) - 2
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/**
 * The cash chip's tooltip: today's encaisse to the cent, what the next 1st
 * of the month takes, and, given `yesterday`, as on a phone where the
 * « Hier » card folds into it, the last day's sales, customers served and
 * lost sales, those in amber when above zero.
 */
export function cashTip({
  cash,
  fixedCosts,
  yesterday,
}: {
  cash: Cents
  fixedCosts: Cents
  /** The last day's numbers, null before the first; left out, none show. */
  yesterday?: TodayNumbers | null
}): TipContent {
  const rows: TipRow[] = [
    { label: "Aujourd'hui", value: formatMoney(cash) },
    { label: 'Frais fixes du mois', value: formatMoney(fixedCosts) },
  ]
  if (yesterday !== undefined) {
    rows.push(
      {
        label: 'Ventes hier',
        value:
          yesterday === null ? NO_NUMBER : formatBriefMoney(yesterday.revenue),
      },
      {
        label: 'Clients servis',
        value:
          yesterday === null
            ? NO_NUMBER
            : formatCount(yesterday.customersServed),
      },
      {
        label: 'Ventes perdues',
        value:
          yesterday === null ? NO_NUMBER : formatCount(yesterday.lostSales),
        warn: yesterday !== null && yesterday.lostSales > 0,
      },
    )
  }
  return { title: 'Encaisse', rows, link: 'Ouvrir les finances' }
}
