import pacing from '../content/pacing.json'
import type { ReportText } from '../content/reportText.ts'
import { weekFactIdSchema } from '../content/schema.ts'
import { monthsSinceStart, sundayOf, toCalendar } from '../engine/calendar.ts'
import { cents, sum, type Cents } from '../engine/money.ts'
import type {
  Day,
  GameState,
  WeekDay,
  WeekRecord,
  WeekReport,
} from '../engine/types.ts'
import { weekFacts, type WeekFact } from '../engine/week.ts'
import { formatDayAndMonth, formatDayOfMonth } from './formatGameDate.ts'
import type { ReportCadence } from './settings.ts'
import {
  adviceOnFact,
  factLine,
  isEarlyWeek,
  quietAdvice,
  REPORT_TEXT,
  reportAdvice,
  type ChartDay,
} from './weeklyReport.ts'

// The « Bilan du mois », for a player who wants the report once a month.
// The engine sums up weeks, Monday to Sunday, and months do not line up
// with them, so the UI builds the month from what it has of its weeks
// (`weekHistory`, and the full reports it kept as each week came), with no
// engine change. A month's figures are those of the weeks whose Sunday
// falls in it: on the morning of the 1st, each of them is closed, and the
// month's ventes and bénéfice are their sums. Its chart shows the calendar
// month's days, those of the week still under way on the 1st included.

// Calendar facts, not tunables: a game starts on a Monday, day 0, and a
// month holds at most 5 Sundays.
const DAYS_PER_WEEK = 7
export const MOST_WEEKS_IN_A_MONTH = 5

const ZERO = cents(0)

/** `reports` with `week` added, keeping the last weeks a month can hold. */
export function keepWeekReport(
  reports: readonly WeekReport[],
  week: WeekReport,
): readonly WeekReport[] {
  return [...reports, week].slice(-MOST_WEEKS_IN_A_MONTH)
}

/**
 * The report that comes on the morning of `morning`, `week` being the week
 * the morning brings, if any: the week's when the player wants it every
 * week, or for the first `fullReportWeeks` weeks of a game whatever they
 * want; with the monthly report, the month's on the 1st once those weeks
 * are over. Null on any other morning.
 */
export function reportOnMorning(
  morning: Day,
  week: WeekReport | null,
  cadence: ReportCadence,
  fullReportWeeks: number = pacing.fullReportWeeks,
): ReportCadence | null {
  if (
    week !== null &&
    (cadence === 'week' || isEarlyWeek(week, fullReportWeeks))
  ) {
    return 'week'
  }
  return cadence === 'month' &&
    morning >= fullReportWeeks * DAYS_PER_WEEK &&
    toCalendar(morning).dayOfMonth === 1
    ? 'month'
    : null
}

/** The « Bilan du mois » of a calendar month. */
export interface MonthReport {
  /** The month's 1st. */
  readonly firstDay: Day
  /** The month's last day. */
  readonly lastDay: Day
  /**
   * The weeks whose Sunday falls in the month, oldest first, as
   * `weekHistory` keeps them: the figures are theirs. They may start in
   * the month before, and end before the month does.
   */
  readonly weeks: readonly WeekRecord[]
  /**
   * The full reports of those weeks the UI kept, oldest first: all of
   * them, unless the game was loaded during the month.
   */
  readonly reports: readonly WeekReport[]
  /**
   * The calendar month's days the UI has, in order: those of the weeks
   * kept and of the week under way on the 1st.
   */
  readonly days: readonly WeekDay[]
  /** Ventes over the weeks. */
  readonly sales: Cents
  /** Bénéfice net over the weeks; negative for a loss. */
  readonly netIncome: Cents
  /**
   * Encaisse when the first week started; null when the UI has neither
   * that week's report nor the week before it.
   */
  readonly cashAtStart: Cents | null
  /** Encaisse at the close of the last week's Sunday. */
  readonly cashAtEnd: Cents
  /**
   * The lowest Encaisse at the close of any day of the weeks; null unless
   * the UI kept the report of every one of them.
   */
  readonly lowestCash: Cents | null
}

/**
 * The « Bilan du mois » on the morning of the 1st that is `game.day`: of
 * the calendar month before, from `game`'s weeks, the full `reports` the
 * UI kept, and the days of the week under way. Null when none of the
 * month's weeks is in `game.weekHistory`, as in a Défi that started late in
 * the month.
 */
export function monthReport(
  game: Pick<GameState, 'day' | 'weekHistory' | 'weekSoFar'>,
  reports: readonly WeekReport[],
): MonthReport | null {
  const lastDay = game.day - 1
  const firstDay = lastDay - (toCalendar(lastDay).dayOfMonth - 1)
  const weeks = game.weekHistory.filter((week) => {
    const sunday = sundayOf(week.firstDay)
    return sunday >= firstDay && sunday <= lastDay
  })
  const [firstWeek] = weeks
  const lastWeek = weeks.at(-1)
  if (firstWeek === undefined || lastWeek === undefined) return null

  const kept = reports.filter((report) =>
    weeks.some((week) => week.firstDay === report.firstDay),
  )
  const before = game.weekHistory[game.weekHistory.indexOf(firstWeek) - 1]
  const cashAtStart =
    kept.find((report) => report.firstDay === firstWeek.firstDay)
      ?.cashAtStart ??
    (before?.firstDay === firstWeek.firstDay - DAYS_PER_WEEK
      ? before.cashAtEnd
      : null)
  const lowestCash =
    kept.length === weeks.length
      ? kept.reduce<Cents>(
          (lowest, report) =>
            report.lowestCash < lowest ? report.lowestCash : lowest,
          lastWeek.cashAtEnd,
        )
      : null
  const days = [
    ...kept.flatMap((report) => report.days),
    ...game.weekSoFar.days,
  ]
    .filter(({ day }) => day >= firstDay && day <= lastDay)
    .toSorted((a, b) => a.day - b.day)
    .filter((day, index, all) => all[index - 1]?.day !== day.day)

  return {
    firstDay,
    lastDay,
    weeks,
    reports: kept,
    days,
    sales: sum(weeks.map(({ sales }) => sales)),
    netIncome: sum(weeks.map(({ netIncome }) => netIncome)),
    cashAtStart,
    cashAtEnd: lastWeek.cashAtEnd,
    lowestCash,
  }
}

/** Whether `report` is a month's rather than a week's. */
export function isMonthReport(
  report: WeekReport | MonthReport,
): report is MonthReport {
  return 'weeks' in report
}

/** The first day of the weeks the month's figures cover: a Monday. */
export function weeksFirstDay(report: MonthReport): Day {
  return report.weeks[0]?.firstDay ?? report.firstDay
}

/** The last day of the weeks the month's figures cover: a Sunday. */
export function weeksLastDay(report: MonthReport): Day {
  const last = report.weeks.at(-1)
  return last === undefined ? report.lastDay : sundayOf(last.firstDay)
}

/**
 * Every day of the calendar month, the 1st to the last: a day the report
 * does not have, of a week the UI did not keep, has no data. Only Mondays
 * are labelled, with their day of the month alone, so the labels stay
 * apart and inside the chart, even on a month's last day.
 */
export function monthChart(report: MonthReport): ChartDay[] {
  return Array.from(
    { length: report.lastDay - report.firstDay + 1 },
    (_, index) => {
      const day = report.firstDay + index
      const played = report.days.find((monthDay) => monthDay.day === day)
      return {
        day,
        label: toCalendar(day).weekday === 1 ? formatDayOfMonth(day) : '',
        played: played !== undefined,
        open: played?.open ?? false,
        sales: played?.sales ?? ZERO,
        cashReceived: played?.cashReceived ?? ZERO,
      }
    },
  )
}

/** A fact of a week of the month, with that week's report. */
export interface MonthFact {
  /** The report of the week the fact held in. */
  readonly week: WeekReport
  readonly fact: WeekFact
}

/**
 * The facts the month's weeks told, each kind once, from the newest week
 * it held in: the bénéfice up while the encaisse goes down first, as in a
 * week, then the others by weight, the highest first, a newer week first
 * on a tie, then in the order of `weekFactIdSchema`. Each keeps its week,
 * since its numbers, and what it says, are that week's.
 */
export function monthFacts(report: MonthReport): MonthFact[] {
  const newest = new Map<WeekFact['id'], MonthFact>()
  for (const week of report.reports.toReversed()) {
    for (const fact of weekFacts(week)) {
      if (!newest.has(fact.id)) newest.set(fact.id, { week, fact })
    }
  }
  const order = weekFactIdSchema.options
  const first = (fact: WeekFact) => (fact.id === 'profitUpCashDown' ? 0 : 1)
  return [...newest.values()].toSorted(
    (a, b) =>
      first(a.fact) - first(b.fact) ||
      b.fact.weight - a.fact.weight ||
      b.week.firstDay - a.week.firstDay ||
      order.indexOf(a.fact.id) - order.indexOf(b.fact.id),
  )
}

/** The week of `monday` as the month's report names it: `Semaine du 5 juin`. */
export function formatWeekOf(monday: Day): string {
  return `Semaine du ${formatDayAndMonth(monday)}`
}

/** A fact of the month in words, and the Monday of the week it held in. */
export interface MonthFactLine {
  readonly week: Day
  readonly text: string
}

/**
 * The month's facts in words, the first one first: each as its week's
 * report wrote it, with that week's Monday.
 */
export function monthFactLines(
  report: MonthReport,
  text: ReportText = REPORT_TEXT,
): MonthFactLine[] {
  return monthFacts(report).map(({ week, fact }) => ({
    week: week.firstDay,
    text: factLine(fact, week, text),
  }))
}

/** « Le conseil de Mme Prudhomme » on the month. */
export interface MonthAdvice {
  /**
   * The Monday of the week the advice is on, whose numbers it may use and
   * which its lines call « cette semaine »; null for a quiet line on no
   * week in particular.
   */
  readonly week: Day | null
  readonly text: string
}

/**
 * Her line on the month's first fact, as that fact's week had it. With no
 * fact, every week was quiet: her quiet line on the last week kept, as its
 * report had it, or, with none kept, one with no week, the months taking
 * them in turn, so a month always gets the same one.
 */
export function monthAdvice(
  report: MonthReport,
  text: ReportText = REPORT_TEXT,
): MonthAdvice {
  const [top] = monthFacts(report)
  if (top !== undefined) {
    return {
      week: top.week.firstDay,
      text: adviceOnFact(top.fact, top.week, text),
    }
  }
  const last = report.reports.at(-1)
  return last === undefined
    ? { week: null, text: quietAdvice(monthsSinceStart(report.firstDay), text) }
    : { week: last.firstDay, text: reportAdvice(last, text) }
}
