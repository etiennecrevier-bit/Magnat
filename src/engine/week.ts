import {
  loadReportContent,
  weekFactIdSchema,
  type DreamContent,
  type GrocerContent,
  type ReportContent,
  type WeekFactId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, entriesSince, type Journal } from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import { mondayOf, sundayOf } from './calendar.ts'
import { GROCERS } from './contracts.ts'
import { DREAM } from './dream.ts'
import { marketingOver } from './marketing.ts'
import { PRODUCTS, perProduct } from './inventory.ts'
import { add, cents, sub, sum, type Cents } from './money.ts'
import { netWorth } from './netWorth.ts'
import type {
  Day,
  GameState,
  WeekDay,
  WeekRecord,
  WeekReport,
  WeekSoFar,
} from './types.ts'

// The week in numbers: each close adds its day to the week under way, and
// the close of a Sunday sums the week up for the « Bilan de la semaine » of
// the next morning. The engine computes the numbers and the facts worth
// telling; the UI only words and formats them. Nothing here posts an entry
// or draws from the generator.

/**
 * The shipped thresholds of the facts of a week, validated once when the
 * engine loads.
 */
export const REPORT: ReportContent = loadReportContent()

// A record length, not a tunable: the history keeps a year of weeks.
export const WEEKS_KEPT = 52

const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const SALES: AccountCode = '4000'

const ZERO = cents(0)

/** The numbers each fact of a week gives the UI to word it with. */
export interface WeekFactNumbers {
  /** The bénéfice net, above 0, and the change in Encaisse over the week. */
  readonly profitUpCashDown: {
    readonly netIncome: Cents
    readonly cashChange: Cents
  }
  /** The day the owner's rent went unpaid. */
  readonly unpaidRent: { readonly day: Day }
  /** The receivable due soonest, its client and its due day. */
  readonly receivableDue: {
    readonly client: string
    readonly amount: Cents
    readonly dueDay: Day
  }
  /** What the stock written off cost, and its units. */
  readonly spoilage: { readonly cost: Cents; readonly units: number }
  /** The week's ventes, and the best of the earlier weeks. */
  readonly bestWeek: { readonly sales: Cents; readonly previousBest: Cents }
  /** The visits that left the line. */
  readonly lostToLine: { readonly visits: number }
  /** The days in a row the truck opened. */
  readonly daysOpenInARow: { readonly days: number }
  /**
   * What the grocers of the contracts owe, and the grocers who owe it, by
   * name, the one due soonest first.
   */
  readonly contractsReceivable: {
    readonly amount: Cents
    readonly grocers: readonly string[]
  }
}

type FactOf = {
  readonly [Id in WeekFactId]: {
    readonly id: Id
    /** How much it matters, from the content: the highest is told first. */
    readonly weight: number
    readonly numbers: WeekFactNumbers[Id]
  }
}

/** A fact of a week worth telling, with its weight and its numbers. */
export type WeekFact = FactOf[WeekFactId]

type Rules = ReportContent['facts']

/**
 * Each fact, with its weight, when it holds for the week, the grocers those
 * of the contracts; null otherwise.
 */
const FACTS: {
  readonly [Id in WeekFactId]: (
    report: WeekReport,
    rule: Rules[Id],
    grocers: GrocerContent,
  ) => FactOf[Id] | null
} = {
  profitUpCashDown: (
    { netIncome, cashAtStart, cashAtEnd },
    { weight, minGapCents },
  ) => {
    const cashChange = sub(cashAtEnd, cashAtStart)
    const holds =
      netIncome > 0 &&
      (cashChange < 0 || sub(netIncome, cashChange) >= minGapCents)
    return holds
      ? { id: 'profitUpCashDown', weight, numbers: { netIncome, cashChange } }
      : null
  },
  unpaidRent: ({ unpaidRents: [day] }, { weight }) =>
    day === undefined ? null : { id: 'unpaidRent', weight, numbers: { day } },
  receivableDue: (
    { firstDay, receivables: [soonest] },
    { weight, withinDays },
  ) =>
    soonest !== undefined && soonest.dueDay - sundayOf(firstDay) <= withinDays
      ? {
          id: 'receivableDue',
          weight,
          numbers: {
            client: soonest.client,
            amount: soonest.amount,
            dueDay: soonest.dueDay,
          },
        }
      : null,
  spoilage: ({ spoiledCost, spoiled }, { weight, aboveCents }) =>
    spoiledCost > aboveCents
      ? {
          id: 'spoilage',
          weight,
          numbers: {
            cost: spoiledCost,
            units: PRODUCTS.reduce(
              (units, product) => units + spoiled[product],
              0,
            ),
          },
        }
      : null,
  bestWeek: ({ sales, previousBest }, { weight }) =>
    previousBest !== null && sales > previousBest
      ? { id: 'bestWeek', weight, numbers: { sales, previousBest } }
      : null,
  lostToLine: ({ lostToLine }, { weight, aboveVisits }) =>
    lostToLine > aboveVisits
      ? { id: 'lostToLine', weight, numbers: { visits: lostToLine } }
      : null,
  daysOpenInARow: ({ daysOpenInARow }, { weight, atLeast }) =>
    daysOpenInARow >= atLeast
      ? { id: 'daysOpenInARow', weight, numbers: { days: daysOpenInARow } }
      : null,
  contractsReceivable: ({ receivables }, { weight, aboveCents }, grocers) => {
    const names = new Set(
      Object.values(grocers.grocers).map(({ name }) => name),
    )
    const owed = receivables.filter(({ client }) => names.has(client))
    const amount = sum(owed.map(({ amount: each }) => each))
    return amount > aboveCents
      ? {
          id: 'contractsReceivable',
          weight,
          numbers: {
            amount,
            grocers: [...new Set(owed.map(({ client }) => client))],
          },
        }
      : null
  },
}

/**
 * What the marketing budget spent from `fromDay` to `toDay` and what it
 * brought, as a report's `marketing`, when it spent anything; nothing
 * otherwise.
 */
function marketingOf(
  { marketingDays }: GameState,
  fromDay: Day,
  toDay: Day,
): Pick<WeekReport, 'marketing'> {
  const week = marketingOver(marketingDays ?? [], fromDay, toDay)
  return week.spent > 0 ? { marketing: week } : {}
}

/**
 * The week a game opens with: partial, no day played yet, and the
 * Encaisse of `journal`, the books the game opens with, as its start.
 */
export function openingWeek(journal: Journal): WeekSoFar {
  return {
    cashAtStart: balance(journal, CASH, { toDay: 0 }),
    partial: true,
    days: [],
    modifiers: [],
  }
}

/**
 * Adds the day `closing` closes, `closing.lastDay`, to the week under way,
 * with whether any truck opened and what the stock written off cost. Its
 * customers, units written off and visits lost are every truck's (#259):
 * the first truck's `lastDay` and each other's of that day. Its
 * ventes, the cash customers paid and the change in Encaisse come from the
 * day's entries, the last of the journal, so the Encaisse at its close is
 * the close before plus that change; the close before the first day of a
 * week is `cashAtStart`, or nothing before day 0, whose entries open the
 * books. The changes to the street are those of `lastDay`. On a Sunday, the
 * week is summed up as `lastWeek` (see `WeekReport`), with its ventes and
 * bénéfice net from the état des résultats over its days, added to
 * `weekHistory` with the owner's net worth at the close (see `netWorth`,
 * with `dream`), of which the last `WEEKS_KEPT` are kept, and the next week
 * starts from the Sunday's close. The report says what the marketing
 * budget spent over the week and what it brought, from
 * `closing.marketingDays`, when it spent anything (#284). Throws an Error
 * unless a day was played.
 */
export function recordDay(
  closing: GameState,
  open: boolean,
  spoiledCost: Cents,
  dream: DreamContent = DREAM,
): Pick<GameState, 'weekSoFar' | 'lastWeek' | 'weekHistory'> {
  const { journal, lastDay, weekSoFar, lastWeek, weekHistory } = closing
  if (lastDay === null) throw new Error('No day was played')
  const { day } = lastDay
  // Every truck's day (#259): the first truck's, then each other's.
  const trucks = [
    lastDay,
    ...(closing.trucks ?? []).flatMap((truck) =>
      truck.lastDay?.day === day ? [truck.lastDay] : [],
    ),
  ]
  const segments = trucks.flatMap((truck) => Object.values(truck.segments))
  const before = weekSoFar.days.at(-1)
  const moved = movedOn(journal, day)
  const opened = day === 0 ? ZERO : weekSoFar.cashAtStart
  const today: WeekDay = {
    day,
    open,
    sales: moved.sales,
    cashReceived: moved.cashReceived,
    cashAtClose: add(before?.cashAtClose ?? opened, moved.cash),
    customersServed: trucks.reduce(
      (served, { visits }) =>
        served +
        visits.filter(({ servedMinute }) => servedMinute !== null).length,
      0,
    ),
    spoiled:
      trucks.length === 1
        ? lastDay.spoiled
        : perProduct((product) =>
            trucks.reduce((units, { spoiled }) => units + spoiled[product], 0),
          ),
    spoiledCost,
    lostToLine: trucks.reduce((visits, { leftLine }) => visits + leftLine, 0),
    lostToPrices: segments.reduce(
      (visits, { tooExpensive }) => visits + tooExpensive,
      0,
    ),
    lostToStockouts: segments.reduce(
      (visits, { soldOut }) => visits + soldOut,
      0,
    ),
  }
  const days = [...weekSoFar.days, today]
  // The first day brings every change in effect; a later one only those
  // that start on it, since the others were in effect the day before.
  const modifiers = [
    ...weekSoFar.modifiers,
    ...lastDay.modifiers.filter(
      ({ fromDay }) => before === undefined || fromDay === day,
    ),
  ]
  if (sundayOf(day) !== day) {
    return {
      weekSoFar: { ...weekSoFar, days, modifiers },
      lastWeek,
      weekHistory,
    }
  }

  const first = days[0]?.day ?? day
  const income = incomeStatement(journal, first, day)
  const report: WeekReport = {
    firstDay: mondayOf(day),
    partial: weekSoFar.partial,
    days,
    sales: income.sales.amount,
    netIncome: income.netIncome.amount,
    cashAtStart: weekSoFar.cashAtStart,
    cashAtEnd: today.cashAtClose,
    lowestCash: days.reduce(
      (lowest, { cashAtClose }) =>
        cashAtClose < lowest ? cashAtClose : lowest,
      today.cashAtClose,
    ),
    spoiled: perProduct((product) =>
      days.reduce((units, { spoiled }) => units + spoiled[product], 0),
    ),
    spoiledCost: sum(days.map(({ spoiledCost: cost }) => cost)),
    lostToLine: total(days, 'lostToLine'),
    lostToPrices: total(days, 'lostToPrices'),
    lostToStockouts: total(days, 'lostToStockouts'),
    energy: lastDay.energy,
    daysOpenInARow: openInARow(days, lastWeek),
    receivables: closing.receivables,
    unpaidRents: closing.personal.unpaidRents.filter(
      (rentDay) => rentDay >= first,
    ),
    events: closing.events.history.filter(({ day: at }) => at >= first),
    modifiers,
    previousBest: bestBefore(lastWeek),
    ...marketingOf(closing, first, day),
  }
  const record: WeekRecord = {
    firstDay: report.firstDay,
    sales: report.sales,
    netIncome: report.netIncome,
    cashAtEnd: report.cashAtEnd,
    netWorth: netWorth(closing, dream),
  }
  return {
    weekSoFar: {
      cashAtStart: report.cashAtEnd,
      partial: false,
      days: [],
      modifiers: [],
    },
    lastWeek: report,
    weekHistory: [...weekHistory, record].slice(-WEEKS_KEPT),
  }
}

/**
 * The facts of the week `report` worth telling, as `content` sets when each
 * holds and how much it matters, the contracts' those of `grocers`: at most
 * `maxFacts`, the bénéfice up while the encaisse goes down first whenever it
 * holds, then the others by weight, the highest first, a tie in the order of
 * `weekFactIdSchema`.
 */
export function weekFacts(
  report: WeekReport,
  content: ReportContent = REPORT,
  grocers: GrocerContent = GROCERS,
): WeekFact[] {
  const facts = weekFactIdSchema.options.flatMap((id) => {
    const fact = factOf(id, report, content.facts, grocers)
    return fact === null ? [] : [fact]
  })
  const others = facts
    .filter(({ id }) => id !== 'profitUpCashDown')
    .sort((a, b) => b.weight - a.weight)
  return [
    ...facts.filter(({ id }) => id === 'profitUpCashDown'),
    ...others,
  ].slice(0, content.maxFacts)
}

// Generic, so TypeScript pairs each fact with its own rule.
function factOf<Id extends WeekFactId>(
  id: Id,
  report: WeekReport,
  rules: Rules,
  grocers: GrocerContent,
): FactOf[Id] | null {
  return FACTS[id](report, rules[id], grocers)
}

/**
 * What the entries of `day`, the last of the journal, posted to Ventes,
 * moved in Encaisse, and brought in from customers: the Encaisse debited
 * by an entry that credits Ventes or Comptes clients.
 */
function movedOn(
  journal: Journal,
  day: Day,
): { sales: Cents; cashReceived: Cents; cash: Cents } {
  const entries = entriesSince(journal, day)
  let sales = ZERO
  let cashReceived = ZERO
  let cash = ZERO
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry === undefined || entry.day !== day) break
    let cashIn = ZERO
    let fromCustomers = false
    for (const { account, debit, credit } of entry.lines) {
      if (account === CASH) {
        cash = add(cash, sub(debit, credit))
        cashIn = add(cashIn, debit)
      } else if (account === SALES || account === RECEIVABLES) {
        if (account === SALES) sales = add(sales, sub(credit, debit))
        if (credit > 0) fromCustomers = true
      }
    }
    if (fromCustomers) cashReceived = add(cashReceived, cashIn)
  }
  return { sales, cashReceived, cash }
}

/**
 * The days in a row the truck opened up to the last of `days`: back into
 * `lastWeek`'s when every day of the week opened and `lastWeek` ended the
 * day before the first.
 */
function openInARow(
  days: readonly WeekDay[],
  lastWeek: WeekReport | null,
): number {
  const open = days.length - 1 - days.findLastIndex(({ open }) => !open)
  const runsBack =
    open === days.length &&
    lastWeek !== null &&
    lastWeek.days.at(-1)?.day === (days[0]?.day ?? 0) - 1
  return runsBack ? open + lastWeek.daysOpenInARow : open
}

/** The best ventes of the weeks up to `lastWeek`; null with none. */
function bestBefore(lastWeek: WeekReport | null): Cents | null {
  if (lastWeek === null) return null
  const { sales, previousBest } = lastWeek
  return previousBest !== null && previousBest > sales ? previousBest : sales
}

function total(
  days: readonly WeekDay[],
  field: 'lostToLine' | 'lostToPrices' | 'lostToStockouts',
): number {
  return days.reduce((visits, day) => visits + day[field], 0)
}
