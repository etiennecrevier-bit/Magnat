import pacing from '../content/pacing.json'
import {
  loadReportText,
  PLACEHOLDER,
  type ReportText,
} from '../content/reportText.ts'
import type { WeekFactId } from '../content/schema.ts'
import { cents, type Cents } from '../engine/money.ts'
import type { Day, GameState, WeekRecord, WeekReport } from '../engine/types.ts'
import {
  weekFacts,
  type WeekFact,
  type WeekFactNumbers,
} from '../engine/week.ts'
import { formatDayAndMonth, formatShortWeekdayName } from './formatGameDate.ts'
import { formatBriefMoney, formatSignedMoney } from './formatMoney.ts'

// The « Bilan de la semaine »: when it opens, and what it says. The engine
// sums up each week and finds the facts worth telling (src/engine/week.ts);
// this only picks their words, from src/content/report.fr.json, and formats
// their numbers. A week always takes the same variant of a text, so the
// report reads the same each time it shows, and the next week the next one.

/** The shipped text of the report, validated once. */
export const REPORT_TEXT: ReportText = loadReportText()

// Calendar facts, not tunables: a game starts on a Monday, day 0.
const DAYS_PER_WEEK = 7
// The weeks « Bilans » lists, as its card sets: about a season.
export const WEEKS_LISTED = 12
// The most steps up the chart's axis, so its labels stay apart.
const MAX_AXIS_STEPS = 4
// The round steps of the chart's axis, in cents: 1, 2 and 5 dollars, times
// a power of 10.
const AXIS_STEP_DIGITS = [1, 2, 5] as const
const CENTS_PER_DOLLAR = 100

const ZERO = cents(0)

/** The week `after` reports that `before` did not; null when none. */
export function newWeekOf(
  before: GameState,
  after: GameState,
): WeekReport | null {
  const week = after.lastWeek
  return week !== null && week.firstDay !== before.lastWeek?.firstDay
    ? week
    : null
}

/** The last `WEEKS_LISTED` weeks of `history`, newest first. */
export function recentWeeks(history: readonly WeekRecord[]): WeekRecord[] {
  return history.slice(-WEEKS_LISTED).reverse()
}

/** The week of the game `report` is: 0 for the week of day 0. */
function weekIndex(report: WeekReport): number {
  return Math.floor(report.firstDay / DAYS_PER_WEEK)
}

/**
 * Whether the report on the week `report` opens in full and pauses the
 * game: for the first `fullReportWeeks` weeks of a game, counted from
 * day 0, or every week when `everyWeek`. Otherwise it slides in.
 */
export function opensFullReport(
  report: WeekReport,
  everyWeek: boolean,
  fullReportWeeks: number = pacing.fullReportWeeks,
): boolean {
  return everyWeek || weekIndex(report) < fullReportWeeks
}

/** A day of the week's chart. */
export interface ChartDay {
  readonly day: Day
  /** Its short weekday, `lun.` to `dim.`. */
  readonly label: string
  /**
   * Whether the report has the day: not one before the first day of a
   * partial week.
   */
  readonly played: boolean
  /** Whether the truck opened. */
  readonly open: boolean
  readonly sales: Cents
  readonly cashReceived: Cents
}

/** The 7 days of the week of `report`, Monday to Sunday. */
export function weekChart(report: WeekReport): ChartDay[] {
  return Array.from({ length: DAYS_PER_WEEK }, (_, index) => {
    const day = report.firstDay + index
    const played = report.days.find((weekDay) => weekDay.day === day)
    return {
      day,
      label: formatShortWeekdayName(day),
      played: played !== undefined,
      open: played?.open ?? false,
      sales: played?.sales ?? ZERO,
      cashReceived: played?.cashReceived ?? ZERO,
    }
  })
}

/** The chart's axis: from 0 to `top`, a tick at each step. */
export interface ChartScale {
  readonly top: Cents
  readonly ticks: readonly Cents[]
}

/**
 * The axis for `days`: round steps, at most `MAX_AXIS_STEPS` of them, up to
 * the highest bar or just above it.
 */
export function chartScale(days: readonly ChartDay[]): ChartScale {
  const highest = Math.max(
    ...days.map(({ sales, cashReceived }) => Math.max(sales, cashReceived)),
  )
  const step = axisStep(highest)
  const steps = Math.max(1, Math.ceil(highest / step))
  const ticks = Array.from({ length: steps + 1 }, (_, index) =>
    cents(index * step),
  )
  return { top: cents(steps * step), ticks }
}

/** The smallest round step that reaches `highest` within the most steps. */
function axisStep(highest: number): number {
  for (let power = CENTS_PER_DOLLAR; ; power *= 10) {
    for (const digit of AXIS_STEP_DIGITS) {
      if (digit * power * MAX_AXIS_STEPS >= highest) return digit * power
    }
  }
}

/** The chart's note on the day of a sale on credit. */
export interface CreditNote {
  /** The day of the sale. */
  readonly day: Day
  readonly text: string
}

/**
 * A note for each sale on credit of the week still owed at the close of
 * its Sunday, on the day of the sale, in the order of the days.
 */
export function creditNotes(
  report: WeekReport,
  text: ReportText = REPORT_TEXT,
): CreditNote[] {
  const lastDay = report.firstDay + DAYS_PER_WEEK - 1
  return report.receivables
    .filter(
      ({ soldOnDay }) => soldOnDay >= report.firstDay && soldOnDay <= lastDay,
    )
    .toSorted((a, b) => a.soldOnDay - b.soldOnDay)
    .map(({ client, amount, soldOnDay, dueDay }) => ({
      day: soldOnDay,
      text: fillTemplate(text.creditSaleNote, {
        amount: formatBriefMoney(amount),
        client,
        dueDay: formatDayAndMonth(dueDay),
      }),
    }))
}

/** A fact's numbers as its text writes them, by placeholder. */
type FactValues<Id extends WeekFactId> = Record<
  keyof WeekFactNumbers[Id],
  string
>

const FACT_VALUES: {
  readonly [Id in WeekFactId]: (numbers: WeekFactNumbers[Id]) => FactValues<Id>
} = {
  profitUpCashDown: ({ netIncome, cashChange }) => ({
    netIncome: formatBriefMoney(netIncome),
    cashChange: formatSignedMoney(cashChange),
  }),
  unpaidRent: ({ day }) => ({ day: formatDayAndMonth(day) }),
  receivableDue: ({ client, amount, dueDay }) => ({
    client,
    amount: formatBriefMoney(amount),
    dueDay: formatDayAndMonth(dueDay),
  }),
  spoilage: ({ cost, units }) => ({
    cost: formatBriefMoney(cost),
    units: String(units),
  }),
  bestWeek: ({ sales, previousBest }) => ({
    sales: formatBriefMoney(sales),
    previousBest: formatBriefMoney(previousBest),
  }),
  lostToLine: ({ visits }) => ({ visits: String(visits) }),
  daysOpenInARow: ({ days }) => ({ days: String(days) }),
}

/** The numbers of `fact` as its text writes them, by placeholder. */
export function factValues(fact: WeekFact): Readonly<Record<string, string>> {
  return valuesOf(fact)
}

// Generic, so TypeScript pairs each fact with its own numbers.
function valuesOf<Id extends WeekFactId>(fact: {
  readonly id: Id
  readonly numbers: WeekFactNumbers[Id]
}): FactValues<Id> {
  return FACT_VALUES[fact.id](fact.numbers)
}

/**
 * `template` with each `{name}` replaced by `values[name]`. Throws an Error
 * for a name `values` lacks, which the content's validation rules out.
 */
export function fillTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return template.replace(PLACEHOLDER, (placeholder, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined
    if (value === undefined) throw new Error(`No value for ${placeholder}`)
    return value
  })
}

/** The variant of a text the week of `report` takes. */
function variant(variants: readonly string[], report: WeekReport): string {
  const text = variants[weekIndex(report) % variants.length]
  if (text === undefined) throw new Error('No text to pick from')
  return text
}

/** The facts of the week worth telling, in words, the first one first. */
export function factLines(
  report: WeekReport,
  text: ReportText = REPORT_TEXT,
): string[] {
  return weekFacts(report).map((fact) =>
    fillTemplate(variant(text.facts[fact.id], report), factValues(fact)),
  )
}

/**
 * La Presse-Citron's headline on the week: on its first fact, or a quiet
 * one when there is none.
 */
export function reportHeadline(
  report: WeekReport,
  text: ReportText = REPORT_TEXT,
): string {
  const [top] = weekFacts(report)
  return top === undefined
    ? variant(text.quietHeadlines, report)
    : fillTemplate(variant(text.headlines[top.id], report), factValues(top))
}
