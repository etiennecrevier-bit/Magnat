import { describe, expect, it } from 'vitest'
import { monthsSinceStart, sundayOf, toCalendar } from '../engine/calendar.ts'
import { createInitialState, tick } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { NO_EVENTS } from '../engine/events.ts'
import { cents, sum } from '../engine/money.ts'
import type {
  GameState,
  WeekDay,
  WeekRecord,
  WeekReport,
} from '../engine/types.ts'
import { weekFacts } from '../engine/week.ts'
import { formatBriefMoney, formatSignedMoney } from './formatMoney.ts'
import {
  formatWeekOf,
  isMonthReport,
  keepWeekReport,
  monthAdvice,
  monthChart,
  monthFactLines,
  monthFacts,
  monthReport,
  MOST_WEEKS_IN_A_MONTH,
  reportOnMorning,
  weeksFirstDay,
  weeksLastDay,
  type MonthReport,
} from './monthlyReport.ts'
import {
  factLines,
  newWeekOf,
  REPORT_TEXT,
  reportAdvice,
} from './weeklyReport.ts'

/** A morning of a seed-1 game, with the full reports kept as the store keeps them. */
interface Morning {
  readonly game: GameState
  readonly reports: readonly WeekReport[]
}

/**
 * The mornings of a seed-1 game played with no event card to the morning
 * of `lastDay`, each with the full reports kept up to it.
 */
function mornings(lastDay: number): Morning[] {
  let game = createInitialState(1)
  let reports: readonly WeekReport[] = []
  const all: Morning[] = []
  while (game.day < lastDay) {
    const before = game
    game = tick(
      game,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
    )
    const week = newWeekOf(before, game)
    if (week !== null) reports = keepWeekReport(reports, week)
    all.push({ game, reports })
  }
  return all
}

// Past January 1st of year 2, a Monday (day 245), the first 1st after
// the close of a Sunday.
const MORNINGS = mornings(250)

function morningOf(day: number): Morning {
  const morning = MORNINGS.find(({ game }) => game.day === day)
  if (morning === undefined) throw new Error(`No morning ${day}`)
  return morning
}

/** The 1sts of the months the game played through, after the first. */
const FIRSTS = MORNINGS.filter(
  ({ game }) => toCalendar(game.day).dayOfMonth === 1,
)

/** The month report on the morning of `day`, which must have one. */
function reportOn(day: number): MonthReport {
  const { game, reports } = morningOf(day)
  const report = monthReport(game, reports)
  if (report === null) throw new Error(`No month report on day ${day}`)
  return report
}

const FIRST_WEEK = morningOf(7).game.lastWeek!

/**
 * `FIRST_WEEK` moved to the week of Monday `firstDay`, telling no fact
 * unless `changes` make one hold.
 */
function weekOf(firstDay: number, changes: Partial<WeekReport> = {}) {
  return {
    ...FIRST_WEEK,
    firstDay,
    days: FIRST_WEEK.days.map((day) => ({ ...day, day: firstDay + day.day })),
    spoiledCost: cents(0),
    ...changes,
  }
}

function record({
  firstDay,
  sales,
  netIncome,
  cashAtEnd,
}: WeekReport): WeekRecord {
  return { firstDay, sales, netIncome, cashAtEnd }
}

/**
 * The month of June, year 1 (days 31 to 60), on the morning of July 1st,
 * from the weeks of Mondays 28, 35, 42 and 49, whose Sundays fall in it.
 */
function june(weeks: readonly WeekReport[]): MonthReport {
  const report = monthReport(
    {
      day: 61,
      weekHistory: weeks.map(record),
      weekSoFar: {
        cashAtStart: cents(0),
        partial: false,
        days: [],
        modifiers: [],
      },
    },
    weeks,
  )
  if (report === null) throw new Error('No month')
  return report
}

describe('keepWeekReport', () => {
  it(`keeps the last ${MOST_WEEKS_IN_A_MONTH} weeks, as many as a month holds`, () => {
    let reports: readonly WeekReport[] = []
    for (const firstDay of [0, 7, 14, 21, 28, 35]) {
      reports = keepWeekReport(reports, weekOf(firstDay))
    }
    expect(reports.map(({ firstDay }) => firstDay)).toEqual([7, 14, 21, 28, 35])
  })
})

describe('reportOnMorning', () => {
  it('brings the week on each Monday when the player wants it every week, never the month', () => {
    expect(reportOnMorning(7, weekOf(0), 'week')).toBe('week')
    expect(reportOnMorning(35, weekOf(28), 'week')).toBe('week')
    expect(reportOnMorning(245, weekOf(238), 'week')).toBe('week')
    expect(reportOnMorning(31, null, 'week')).toBeNull()
    expect(reportOnMorning(36, null, 'week')).toBeNull()
  })

  it('brings the week for the first 4 weeks of a game whatever the player wants', () => {
    for (const monday of [7, 14, 21, 28]) {
      expect(reportOnMorning(monday, weekOf(monday - 7), 'month')).toBe('week')
    }
  })

  it('then brings the month on the 1st only, with the monthly report', () => {
    expect(reportOnMorning(31, null, 'month')).toBe('month')
    expect(reportOnMorning(61, null, 'month')).toBe('month')
    for (const monday of [35, 42, 49, 56]) {
      expect(reportOnMorning(monday, weekOf(monday - 7), 'month')).toBeNull()
    }
    expect(reportOnMorning(32, null, 'month')).toBeNull()
    expect(reportOnMorning(60, null, 'month')).toBeNull()
  })

  it('brings one report, the month’s, on a 1st that is also a Monday', () => {
    // January 1st, year 2: the week of December 25 closed the night before.
    expect(toCalendar(245)).toMatchObject({
      month: 1,
      dayOfMonth: 1,
      weekday: 1,
    })
    expect(reportOnMorning(245, weekOf(238), 'month')).toBe('month')
  })

  it('counts the first weeks pacing.json gives', () => {
    expect(reportOnMorning(31, null, 'month', 5)).toBeNull()
    expect(reportOnMorning(35, weekOf(28), 'month', 5)).toBe('week')
    expect(reportOnMorning(14, weekOf(7), 'month', 1)).toBeNull()
  })
})

describe('monthReport', () => {
  it('finds a 1st in each month played, the first June 1st', () => {
    expect(FIRSTS.map(({ game }) => game.day)).toEqual([
      31, 61, 92, 123, 153, 184, 214, 245,
    ])
  })

  it.each(FIRSTS.map(({ game }) => [game.day]))(
    'on day %i, sums the weeks whose Sunday falls in the month before',
    (day) => {
      const { game } = morningOf(day)
      const report = reportOn(day)
      const lastDay = day - 1
      const { month } = toCalendar(lastDay)
      expect(toCalendar(report.firstDay)).toMatchObject({
        month,
        dayOfMonth: 1,
      })
      expect(report.lastDay).toBe(lastDay)

      const inMonth = game.weekHistory.filter(
        ({ firstDay }) =>
          toCalendar(sundayOf(firstDay)).month === month &&
          sundayOf(firstDay) < day,
      )
      expect(report.weeks).toEqual(inMonth)
      expect(report.weeks.length).toBeGreaterThanOrEqual(4)
      expect(report.reports.map(({ firstDay }) => firstDay)).toEqual(
        inMonth.map(({ firstDay }) => firstDay),
      )

      // The month's totals are the sums of its weeks, in the history and
      // in their full reports.
      expect(report.sales).toBe(sum(inMonth.map(({ sales }) => sales)))
      expect(report.netIncome).toBe(
        sum(inMonth.map(({ netIncome }) => netIncome)),
      )
      expect(report.sales).toBe(sum(report.reports.map(({ sales }) => sales)))
      expect(report.netIncome).toBe(
        sum(report.reports.map(({ netIncome }) => netIncome)),
      )

      expect(report.cashAtStart).toBe(report.reports[0]!.cashAtStart)
      expect(report.cashAtEnd).toBe(inMonth.at(-1)!.cashAtEnd)
      expect(report.lowestCash).toBe(
        Math.min(...report.reports.map(({ lowestCash }) => lowestCash)),
      )
    },
  )

  it.each(FIRSTS.map(({ game }) => [game.day]))(
    'on day %i, has every calendar day of the month before, in order',
    (day) => {
      const { game, reports } = morningOf(day)
      const report = reportOn(day)
      expect(report.days.map(({ day: at }) => at)).toEqual(
        Array.from(
          { length: report.lastDay - report.firstDay + 1 },
          (_, index) => report.firstDay + index,
        ),
      )
      const known = new Map<number, WeekDay>(
        [...reports.flatMap(({ days }) => days), ...game.weekSoFar.days].map(
          (weekDay) => [weekDay.day, weekDay],
        ),
      )
      for (const weekDay of report.days) {
        expect(weekDay).toBe(known.get(weekDay.day))
      }
    },
  )

  it('covers May on June 1st: the weeks of May 1 to 28, and the days to May 31 from the week under way', () => {
    const { game } = morningOf(31)
    const report = reportOn(31)
    expect(report).toMatchObject({ firstDay: 0, lastDay: 30 })
    expect(report.weeks.map(({ firstDay }) => firstDay)).toEqual([0, 7, 14, 21])
    expect(weeksFirstDay(report)).toBe(0)
    expect(weeksLastDay(report)).toBe(27)
    expect(game.weekSoFar.days.map(({ day }) => day)).toEqual([28, 29, 30])
    expect(report.days.slice(-3)).toEqual(game.weekSoFar.days)
  })

  it('covers June on July 1st: the weeks of May 29 to June 25, the chart June 1 to 30', () => {
    const report = reportOn(61)
    expect(report).toMatchObject({ firstDay: 31, lastDay: 60 })
    expect(report.weeks.map(({ firstDay }) => firstDay)).toEqual([
      28, 35, 42, 49,
    ])
    expect(weeksFirstDay(report)).toBe(28)
    expect(weeksLastDay(report)).toBe(55)
    expect(report.days[0]!.day).toBe(31)
    expect(report.days.at(-1)!.day).toBe(60)
  })

  it('takes in the week that closed the night before on a 1st that is a Monday', () => {
    const { game } = morningOf(245)
    expect(game.lastWeek!.firstDay).toBe(238)
    expect(game.weekSoFar.days).toEqual([])
    const report = reportOn(245)
    expect(report).toMatchObject({ firstDay: 214, lastDay: 244 })
    expect(report.weeks.map(({ firstDay }) => firstDay)).toEqual([
      210, 217, 224, 231, 238,
    ])
    expect(report.cashAtEnd).toBe(game.lastWeek!.cashAtEnd)
    expect(report.days).toHaveLength(31)
  })

  it('keeps the totals but leaves out what it lacks for a game loaded during the month', () => {
    // Loaded on the morning of June 26 (day 56): only that week's report
    // was kept before July 1st.
    const { game, reports } = morningOf(61)
    const kept = reports.filter(({ firstDay }) => firstDay >= 49)
    const report = monthReport(game, kept)!
    const full = reportOn(61)
    expect(report.sales).toBe(full.sales)
    expect(report.netIncome).toBe(full.netIncome)
    expect(report.cashAtEnd).toBe(full.cashAtEnd)
    // The week before the first is in the history: its close is the start.
    expect(report.cashAtStart).toBe(full.cashAtStart)
    expect(report.lowestCash).toBeNull()
    expect(report.reports.map(({ firstDay }) => firstDay)).toEqual([49])
    // The days of that week, then those of the week under way.
    expect(report.days.map(({ day }) => day)).toEqual([
      49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60,
    ])
  })

  it('has no encaisse at the start without the first week or the one before', () => {
    const { game, reports } = morningOf(61)
    const report = monthReport(
      {
        ...game,
        weekHistory: game.weekHistory.filter(({ firstDay }) => firstDay >= 28),
      },
      reports.filter(({ firstDay }) => firstDay >= 35),
    )!
    expect(report.cashAtStart).toBeNull()
    expect(report.lowestCash).toBeNull()
    expect(report.weeks).toHaveLength(4)
  })

  it('is null when none of the month’s weeks is in the history', () => {
    const { game, reports } = morningOf(61)
    expect(
      monthReport(
        {
          ...game,
          weekHistory: game.weekHistory.filter(({ firstDay }) => firstDay > 49),
        },
        reports,
      ),
    ).toBeNull()
    expect(monthReport({ ...game, weekHistory: [] }, [])).toBeNull()
  })

  it('tells a month from a week', () => {
    expect(isMonthReport(reportOn(31))).toBe(true)
    expect(isMonthReport(FIRST_WEEK)).toBe(false)
  })
})

describe('monthChart', () => {
  it('shows every day of the month, only Mondays labelled with their day', () => {
    const report = reportOn(61)
    const days = monthChart(report)
    expect(days).toHaveLength(30)
    expect(days.map(({ day }) => day)).toEqual(
      report.days.map(({ day }) => day),
    )
    expect(days.filter(({ label }) => label !== '')).toEqual(
      [35, 42, 49, 56].map((monday) =>
        expect.objectContaining({ day: monday }),
      ),
    )
    expect(days.map(({ label }) => label).filter(Boolean)).toEqual([
      '5',
      '12',
      '19',
      '26',
    ])
    expect(
      monthChart(reportOn(31))
        .map(({ label }) => label)
        .filter(Boolean),
    ).toEqual(['1er', '8', '15', '22', '29'])
    days.forEach((day, index) => {
      const played = report.days[index]!
      expect(day).toEqual({
        day: played.day,
        label: day.label,
        played: true,
        open: played.open,
        sales: played.sales,
        cashReceived: played.cashReceived,
      })
    })
  })

  it('has no data for the days of a week the UI did not keep', () => {
    const { game, reports } = morningOf(61)
    const report = monthReport(
      game,
      reports.filter(({ firstDay }) => firstDay !== 35),
    )!
    const days = monthChart(report)
    expect(days).toHaveLength(30)
    expect(days.filter(({ played }) => !played).map(({ day }) => day)).toEqual([
      35, 36, 37, 38, 39, 40, 41,
    ])
    expect(days[4]).toEqual({
      day: 35,
      label: '5',
      played: false,
      open: false,
      sales: 0,
      cashReceived: 0,
    })
  })
})

describe('the month’s facts', () => {
  // Gilles Lacasse buys on credit on May 31 (day 30), due June 10 (day 40);
  // he pays on time, so the week of June 5 no longer has him.
  const GILLES = {
    client: 'Gilles Lacasse',
    amount: cents(75_000),
    soldOnDay: 30,
    dueDay: 40,
  }
  const OWED = weekOf(28, { receivables: [GILLES] })
  // A week with a bénéfice while the encaisse went down, and stock thrown
  // out; then one with more thrown out.
  const PROFIT = weekOf(35, {
    netIncome: cents(52_000),
    cashAtStart: cents(1_200_000),
    cashAtEnd: cents(1_150_000),
    spoiledCost: cents(9_000),
  })
  const SPOILED = weekOf(42, { spoiledCost: cents(12_000) })
  const QUIET = weekOf(49)
  const MONTH = june([OWED, PROFIT, SPOILED, QUIET])

  it('tells each kind of fact once, from the newest week it held in, the bénéfice first', () => {
    expect(weekFacts(QUIET)).toEqual([])
    const facts = monthFacts(MONTH)
    expect(facts.map(({ fact, week }) => [fact.id, week.firstDay])).toEqual([
      ['profitUpCashDown', 35],
      ['receivableDue', 28],
      ['spoilage', 42],
    ])
  })

  it('dates each fact with its week, as that week’s report wrote it', () => {
    const lines = monthFactLines(MONTH)
    expect(lines).toEqual([
      { week: 35, text: factLines(PROFIT)[0] },
      { week: 28, text: factLines(OWED)[0] },
      { week: 42, text: factLines(SPOILED)[0] },
    ])
    expect(formatWeekOf(28)).toBe('Semaine du 29 mai')
    expect(formatWeekOf(0)).toBe('Semaine du 1er mai')
  })

  it('keeps a client paid later in the month to the week that still had them owing', () => {
    const [, owed] = monthFactLines(MONTH)
    expect(owed!.week).toBe(28)
    expect(owed!.text).toContain('Gilles Lacasse')
    expect(owed!.text).toContain(formatBriefMoney(GILLES.amount))
    expect(PROFIT.receivables).toEqual([])
  })

  it('tells the week’s amounts, not the month’s, with the week they are from', () => {
    const [profit] = monthFactLines(MONTH)
    expect(profit!.week).toBe(35)
    expect(profit!.text).toContain(formatBriefMoney(PROFIT.netIncome))
    expect(profit!.text).toContain(formatSignedMoney(cents(-50_000)))
    expect(MONTH.netIncome).not.toBe(PROFIT.netIncome)
    expect(profit!.text).not.toContain(formatBriefMoney(MONTH.netIncome))
  })

  it('advises on the first fact, as its week did, with that week', () => {
    expect(monthAdvice(MONTH)).toEqual({
      week: 35,
      text: reportAdvice(PROFIT),
    })
  })

  it('gives the last week’s quiet line, with that week, to a month with no fact', () => {
    const last = weekOf(49)
    const quiet = june([weekOf(28), weekOf(35), weekOf(42), last])
    expect(monthFacts(quiet)).toEqual([])
    expect(monthFactLines(quiet)).toEqual([])
    expect(monthAdvice(quiet)).toEqual({ week: 49, text: reportAdvice(last) })
    expect(REPORT_TEXT.quietAdvice).toContain(reportAdvice(last))
  })

  it('gives a quiet line about no week to a month with no week kept, the same for the same month', () => {
    const { game } = morningOf(61)
    const none = monthReport(game, [])!
    expect(none.reports).toEqual([])
    const { quietAdvice } = REPORT_TEXT
    const advice = monthAdvice(none)
    expect(advice).toEqual({
      week: null,
      text: quietAdvice[monthsSinceStart(31) % quietAdvice.length],
    })
    expect(monthAdvice(none)).toEqual(advice)
    expect(monthAdvice(monthReport(morningOf(92).game, [])!).text).toBe(
      quietAdvice[monthsSinceStart(61) % quietAdvice.length],
    )
  })
})
