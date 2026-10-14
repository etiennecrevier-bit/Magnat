import { toCalendar } from '../engine/clock.ts'
import type { Day } from '../engine/types.ts'
import type { Journal } from '../finance/journal.ts'
import {
  balanceSheet,
  cashFlowStatement,
  incomeStatement,
  type BalanceSheet,
  type CashFlowStatement,
  type IncomeStatement,
} from '../finance/statements.ts'

/** The periods the États financiers screen offers, relative to today. */
export type PeriodKey = 'thisMonth' | 'lastMonth' | 'yearToDate'

/** Game days from `fromDay` to `toDay`, both included. */
export interface Period {
  readonly fromDay: Day
  readonly toDay: Day
}

/** The three statements for one period; the bilan is at its last day. */
export interface Statements {
  readonly period: Period
  readonly balanceSheet: BalanceSheet
  readonly incomeStatement: IncomeStatement
  readonly cashFlow: CashFlowStatement
}

const JANUARY = 1

/** The first day of `day`'s month. Day 0 is a 1st, so this is never below 0. */
function startOfMonth(day: Day): Day {
  return day - (toCalendar(day).dayOfMonth - 1)
}

/** January 1st of `day`'s year, or day 0 during the game's first year. */
function startOfYear(day: Day): Day {
  let start = startOfMonth(day)
  while (start > 0 && toCalendar(start).month !== JANUARY) {
    start = startOfMonth(start - 1)
  }
  return start
}

/**
 * The days `key` covers when `today` is the day the game plays next: this
 * month so far, all of last month, or this year so far, never before day 0.
 * Null for last month during the game's first month, which has none.
 */
export function periodFor(key: PeriodKey, today: Day): Period | null {
  switch (key) {
    case 'thisMonth':
      return { fromDay: startOfMonth(today), toDay: today }
    case 'lastMonth': {
      const thisMonth = startOfMonth(today)
      if (thisMonth === 0) return null
      return { fromDay: startOfMonth(thisMonth - 1), toDay: thisMonth - 1 }
    }
    case 'yearToDate':
      return { fromDay: startOfYear(today), toDay: today }
  }
}

export function computeStatements(
  journal: Journal,
  period: Period,
): Statements {
  const { fromDay, toDay } = period
  return {
    period,
    balanceSheet: balanceSheet(journal, toDay),
    incomeStatement: incomeStatement(journal, fromDay, toDay),
    cashFlow: cashFlowStatement(journal, fromDay, toDay),
  }
}

export type StatementsReader = (
  journal: Journal,
  today: Day,
  key: PeriodKey,
) => Statements | null

/**
 * Reads the statements for a period, computing each period at most once per
 * game day: the books only change when a day is played, so re-renders and
 * switching back to a period seen today reuse the result. Null when the
 * period has no days (see `periodFor`).
 */
export function createStatementsReader(
  compute: typeof computeStatements = computeStatements,
): StatementsReader {
  let seenJournal: Journal | null = null
  let seenToday: Day | null = null
  let cache = new Map<PeriodKey, Statements | null>()

  return (journal, today, key) => {
    if (journal !== seenJournal || today !== seenToday) {
      seenJournal = journal
      seenToday = today
      cache = new Map()
    }
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const period = periodFor(key, today)
    const statements = period === null ? null : compute(journal, period)
    cache.set(key, statements)
    return statements
  }
}
