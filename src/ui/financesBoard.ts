import type { EventContent } from '../content/schema.ts'
import { endOfMonth, toCalendar } from '../engine/calendar.ts'
import { EVENTS } from '../engine/day.ts'
import { add, cents, sub, sum, type Cents } from '../engine/money.ts'
import { netWorthChange, netWorthParts } from '../engine/netWorth.ts'
import { effectsAt } from '../engine/scaling.ts'
import type {
  Day,
  EventRecord,
  GameState,
  Receivable,
  WeekDay,
  WeekReport,
} from '../engine/types.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import type { StatementLine } from '../finance/statements.ts'
import { nextFixedCosts } from './cashLevel.ts'
import { financingSummary, type FinancingSummary } from './financingSummary.ts'
import { formatDayAndMonth, formatDayOfMonth } from './formatGameDate.ts'
import {
  formatMoney,
  formatStatementAmount,
  formatWholeMoney,
  formatWholeStatementAmount,
} from './formatMoney.ts'
import {
  computeStatements,
  periodFor,
  type Statements,
} from './statementPeriods.ts'
import type { FinanceSection } from './store.ts'
import type { TipContent, TipRow } from './tooltip.ts'
import type { ChartDay } from './weeklyReport.ts'

// « Entreprise » of « Finances » (#205): four tiles, the last 30 days and
// « À surveiller », each read from the books and the game as they stand,
// with no rule of their own.

const CASH = '1000' satisfies AccountCode
const RECEIVABLES = '1100' satisfies AccountCode
const STOCK_LOSSES = '5100' satisfies AccountCode
const ZERO = cents(0)
// A no-break space (U+00A0) before a colon, as French writes it.
const COLON = ' :'
// The arrow's shape tells up from down, so colour is never the only signal.
const UP = '▲'
const DOWN = '▼'

/** How many days the chart shows, the last one played the last. */
export const CHART_DAYS = 30
/** How many lines « À surveiller » shows at most. */
export const MOST_WATCH_LINES = 3
/** How many receivables the tooltip of « À recevoir » lists by name. */
export const MOST_RECEIVABLES_LISTED = 3

/** What the board reads of a game. */
export type FinancesGame = Pick<
  GameState,
  | 'day'
  | 'journal'
  | 'financing'
  | 'personal'
  | 'dream'
  | 'weekHistory'
  | 'receivables'
  | 'challenge'
>

/** Whether a tile's status reads well, badly, or neither. */
export type TileTone = 'good' | 'bad' | 'neutral'

/** A tile of « En un coup d'œil ». */
export interface FinanceTile {
  readonly id: 'cash' | 'month' | 'netWorth' | 'receivables'
  readonly label: string
  /** Its amount, to the cent, as the books have it. */
  readonly amount: Cents
  /** Its amount as the tile shows it, to the dollar. */
  readonly value: string
  /** The line under the amount, with an arrow or a word; null for none. */
  readonly status: string | null
  readonly tone: TileTone
  readonly tip: TipContent
  /** What a click opens: an accordion of « Entreprise », or « Personnel ». */
  readonly opens: FinanceSection | 'personal'
}

/** The first day the game played: day 0, but in a Défi its first day. */
function firstDayOf(game: Pick<GameState, 'challenge'>): Day {
  return game.challenge?.startDay ?? 0
}

/** The 1st of `day`'s month. */
function startOfMonth(day: Day): Day {
  return day - (toCalendar(day).dayOfMonth - 1)
}

/** The next 1st of a month seen on the morning of `day`: today if one. */
export function nextFirstOfMonth(day: Day): Day {
  return toCalendar(day).dayOfMonth === 1 ? day : endOfMonth(day) + 1
}

/**
 * How many days of this game's current month were played by the morning of
 * `game.day`: none on the morning of the 1st, nor before a Défi's first day.
 */
export function daysPlayedThisMonth(
  game: Pick<GameState, 'day' | 'challenge'>,
): number {
  const from = Math.max(startOfMonth(game.day), firstDayOf(game))
  return Math.max(0, game.day - from)
}

/** `le 1er mai`, or `du 1er au 9 mai`, for days of one month. */
export function monthDays(fromDay: Day, toDay: Day): string {
  if (fromDay === toDay) return `le ${formatDayAndMonth(toDay)}`
  return `du ${formatDayOfMonth(fromDay)} au ${formatDayAndMonth(toDay)}`
}

/** `1 jour`, `9 jours`. */
function dayCount(days: number): string {
  return days === 1 ? '1 jour' : `${days} jours`
}

/** `▲ 318 $ <after>`, `▼ 318 $ <after>`; null when `change` is 0 or null. */
function arrowLine(change: Cents | null, after: string): string | null {
  if (change === null || change === 0) return null
  const arrow = change > 0 ? UP : DOWN
  return `${arrow} ${formatWholeMoney(cents(Math.abs(change)))} ${after}`
}

function toneOf(change: Cents | null): TileTone {
  if (change === null || change === 0) return 'neutral'
  return change > 0 ? 'good' : 'bad'
}

/** « Encaisse » and how it moved since the last Sunday's close. */
function cashTile(game: FinancesGame, statements: Statements): FinanceTile {
  const cash = balance(game.journal, CASH, { toDay: game.day })
  const sunday = game.weekHistory.at(-1)?.cashAtEnd ?? null
  const change = sunday === null ? null : sub(cash, sunday)
  const { cashFlow, period } = statements
  const flows = [cashFlow.operating, cashFlow.investing, cashFlow.financing]
  return {
    id: 'cash',
    label: 'Encaisse',
    amount: cash,
    value: formatWholeMoney(cash),
    status: arrowLine(change, 'cette semaine'),
    tone: toneOf(change),
    tip: {
      title: `Encaisse, ${monthDays(period.fromDay, period.toDay)}`,
      rows: [
        {
          label: 'Au début du mois',
          value: formatStatementAmount(cashFlow.openingCash.amount),
        },
        ...flows.map(({ label, total }) => ({
          label,
          value: formatStatementAmount(total.amount),
        })),
        {
          label: "Aujourd'hui",
          value: formatStatementAmount(cashFlow.closingCash.amount),
          divider: true,
        },
      ],
      link: "Ouvrir l'état des flux de trésorerie",
    },
    opens: 'cashFlow',
  }
}

/** The biggest charge of the état des résultats, if it has any. */
function biggestCharge(statements: Statements): StatementLine | null {
  const { costOfGoodsSold, expenses } = statements.incomeStatement
  let biggest: StatementLine | null = null
  for (const line of [costOfGoodsSold, ...expenses.lines]) {
    if (line.amount > (biggest?.amount ?? ZERO)) biggest = line
  }
  return biggest
}

/** « Ce mois-ci », the bénéfice net of the calendar month so far. */
function monthTile(game: FinancesGame, statements: Statements): FinanceTile {
  const { sales, netIncome } = statements.incomeStatement
  const days = daysPlayedThisMonth(game)
  const biggest = biggestCharge(statements)
  const { fromDay, toDay } = statements.period
  const rows: TipRow[] = [
    { label: 'Ventes', value: formatMoney(sales.amount) },
    {
      label: 'Charges',
      value: formatMoney(sub(sales.amount, netIncome.amount)),
    },
  ]
  if (biggest !== null) {
    rows.push({ label: 'Plus grosse charge', value: biggest.label })
  }
  const loss = netIncome.amount < 0
  return {
    id: 'month',
    label: 'Ce mois-ci',
    amount: netIncome.amount,
    value: formatWholeStatementAmount(netIncome.amount),
    status:
      days === 0
        ? 'Aucune journée encore'
        : `${loss ? 'Perte' : 'Bénéfice'} · ${dayCount(days)}`,
    tone: days === 0 ? 'neutral' : loss ? 'bad' : 'good',
    tip: {
      title: `Ce mois-ci, ${monthDays(fromDay, toDay)}`,
      rows,
      link: "Ouvrir l'état des résultats",
    },
    opens: 'incomeStatement',
  }
}

/** « Valeur nette » and how it moved since the last Sunday's close. */
function netWorthTile(game: FinancesGame): FinanceTile {
  const parts = netWorthParts(game)
  const change = netWorthChange(game)
  return {
    id: 'netWorth',
    label: 'Valeur nette',
    amount: parts.total,
    value: formatWholeMoney(parts.total),
    status: arrowLine(change, 'depuis dimanche'),
    tone: toneOf(change),
    tip: {
      title: 'Valeur nette',
      rows: [
        {
          label: "Part de l'entreprise",
          value: formatMoney(parts.companyShare),
        },
        {
          label: 'Argent et biens personnels',
          value: formatMoney(add(parts.personalCash, parts.personalAssets)),
        },
        {
          label: 'Dettes personnelles',
          value: formatMoney(sub(ZERO, parts.personalDebts)),
        },
      ],
      link: 'Voir « Personnel »',
    },
    opens: 'personal',
  }
}

/** `Gilles Lacasse · 8 août`: who owes and when they pay. */
function owedBy({ client, dueDay }: Receivable): string {
  return `${client} · ${formatDayAndMonth(dueDay)}`
}

/** « À recevoir », the comptes clients, and who pays next. */
function receivablesTile(game: FinancesGame): FinanceTile {
  const owed = balance(game.journal, RECEIVABLES, { toDay: game.day })
  const byDue = game.receivables.toSorted((a, b) => a.dueDay - b.dueDay)
  const [next] = byDue
  const listed = byDue.slice(0, MOST_RECEIVABLES_LISTED)
  const others = byDue.slice(MOST_RECEIVABLES_LISTED)
  const rows: TipRow[] = listed.map((receivable) => ({
    label: owedBy(receivable),
    value: formatMoney(receivable.amount),
  }))
  if (others.length > 0) {
    rows.push({
      label: `${others.length} autre${others.length > 1 ? 's' : ''}`,
      value: formatMoney(sum(others.map(({ amount }) => amount))),
    })
  }
  if (rows.length > 0) {
    rows.push({ label: 'Total', value: formatMoney(owed), divider: true })
  }
  return {
    id: 'receivables',
    label: 'À recevoir',
    amount: owed,
    value: formatWholeMoney(owed),
    status: next === undefined ? 'Rien à recevoir' : owedBy(next),
    tone: 'neutral',
    tip: {
      title: 'À recevoir',
      ...(rows.length > 0
        ? { rows }
        : { text: "Aucun client ne vous doit d'argent." }),
      link: 'Ouvrir le bilan',
    },
    opens: 'balanceSheet',
  }
}

/**
 * The four tiles of « En un coup d'œil », in the order they show: «
 * Encaisse », « Ce mois-ci », « Valeur nette » and « À recevoir », from the
 * books on the morning of `game.day` and `statements`, this month's.
 */
export function financeTiles(
  game: FinancesGame,
  statements: Statements,
): FinanceTile[] {
  return [
    cashTile(game, statements),
    monthTile(game, statements),
    netWorthTile(game),
    receivablesTile(game),
  ]
}

/**
 * Whether the choice of `record` delayed what `client` owes: the outcome
 * that came has a `delayReceivable` for them at the game's difficulty.
 */
function delayed(
  record: EventRecord,
  client: string,
  game: Pick<GameState, 'profile'>,
  content: EventContent,
): boolean {
  const event = content.events.find(({ id }) => id === record.event)
  const choice = event?.choices.find(({ id }) => id === record.choice)
  const outcome = choice?.outcomes[record.outcome]
  if (outcome === undefined) return false
  return effectsAt(outcome.effects, game.profile.difficulty, content).some(
    (effect) => effect.kind === 'delayReceivable' && effect.client === client,
  )
}

/**
 * The money still owed whose payment a choice put off since the sale: a
 * receivable whose client an event's outcome, as `events.history` recorded
 * it, delayed on or after the day of the sale. Each comes off as it is
 * paid or written off.
 */
export function lateReceivables(
  game: Pick<GameState, 'receivables' | 'events' | 'profile'>,
  content: EventContent = EVENTS,
): Receivable[] {
  return game.receivables.filter((receivable) =>
    game.events.history.some(
      (record) =>
        record.day >= receivable.soldOnDay &&
        delayed(record, receivable.client, game, content),
    ),
  )
}

/** A line of « À surveiller ». */
export interface WatchLine {
  readonly id: 'charges' | 'spoilage' | 'late'
  readonly text: string
}

/**
 * « À surveiller », at most `MOST_WATCH_LINES` lines: what the next 1st
 * takes, the fixed costs `fixedCosts` (see `nextFixedCosts`) and the
 * payments `financing` has the loans make that day; the stock lost this
 * month, from `statements`, this month's, when there is some; and the
 * money owed whose payment a choice put off (see `lateReceivables`).
 */
export function watchLines(
  game: Pick<GameState, 'day' | 'receivables' | 'events' | 'profile'>,
  statements: Statements,
  fixedCosts: Cents,
  financing: FinancingSummary | null,
  content: EventContent = EVENTS,
): WatchLine[] {
  const lines: WatchLine[] = []
  const first = nextFirstOfMonth(game.day)
  const loans = sum(
    (financing?.loans ?? []).flatMap(({ next }) =>
      next !== null && next.day === first ? [next.amount] : [],
    ),
  )
  const charges = add(fixedCosts, loans)
  if (charges > 0) {
    const what = loans > 0 ? 'de frais fixes et de prêts' : 'de frais fixes'
    lines.push({
      id: 'charges',
      text: `${formatWholeMoney(charges)} ${what} le ${formatDayAndMonth(first)}`,
    })
  }
  const lost = statements.incomeStatement.expenses.lines.find(
    ({ account }) => account === STOCK_LOSSES,
  )
  if (lost !== undefined && lost.amount > 0) {
    lines.push({
      id: 'spoilage',
      text: `${formatWholeMoney(lost.amount)} de stock jeté ce mois-ci`,
    })
  }
  const late = lateReceivables(game, content)
  const clients = new Set(late.map(({ client }) => client))
  const [firstLate] = late
  if (firstLate !== undefined) {
    const total = formatWholeMoney(sum(late.map(({ amount }) => amount)))
    lines.push({
      id: 'late',
      text:
        clients.size === 1
          ? `${firstLate.client} paie en retard${COLON} ${total} le ${formatDayAndMonth(firstLate.dueDay)}`
          : `${clients.size} clients paient en retard${COLON} ${total}`,
    })
  }
  return lines.slice(0, MOST_WATCH_LINES)
}

/**
 * The chart of the last `CHART_DAYS` days, up to `lastPlayed`, never before
 * `firstDay`, the day the game started: those of the full reports the UI
 * kept, `weekReports`, and of the week under way, `weekSoFar`; any other
 * has no data, as after a save is loaded. Only Mondays are labelled, with
 * their day of the month. Empty before the first day is played.
 */
export function recentChartDays(
  weekReports: readonly WeekReport[],
  weekSoFar: readonly WeekDay[],
  firstDay: Day,
  lastPlayed: Day | null,
): ChartDay[] {
  if (lastPlayed === null || lastPlayed < firstDay) return []
  const from = Math.max(firstDay, lastPlayed - CHART_DAYS + 1)
  const known = new Map<Day, WeekDay>()
  for (const day of [...weekReports.flatMap(({ days }) => days), ...weekSoFar])
    known.set(day.day, day)
  return Array.from({ length: lastPlayed - from + 1 }, (_, index) => {
    const day = from + index
    const played = known.get(day)
    return {
      day,
      label: toCalendar(day).weekday === 1 ? formatDayOfMonth(day) : '',
      played: played !== undefined,
      open: played?.open ?? false,
      sales: played?.sales ?? ZERO,
      cashReceived: played?.cashReceived ?? ZERO,
    }
  })
}

/** This month's statements on the morning of `game.day`. */
function thisMonth(game: Pick<GameState, 'journal' | 'day'>): Statements {
  const period = periodFor('thisMonth', game.day)
  if (period === null) throw new Error(`No month on day ${game.day}`)
  return computeStatements(game.journal, period)
}

/** Everything « Entreprise » shows, read from `game` on its morning. */
export interface CompanyBoard {
  readonly tiles: readonly FinanceTile[]
  readonly chart: readonly ChartDay[]
  readonly watch: readonly WatchLine[]
  /** Null when the game never took a loan nor sold shares. */
  readonly financing: FinancingSummary | null
}

/** The board of `game`, with the full reports the UI kept, `weekReports`. */
export function companyBoard(
  game: GameState,
  weekReports: readonly WeekReport[],
): CompanyBoard {
  const statements = thisMonth(game)
  const financing = financingSummary(game)
  const firstDay = game.challenge?.startDay ?? 0
  const fixedCosts = nextFixedCosts({
    day: game.day,
    difficulty: game.profile.difficulty,
    firstDay,
    bakery: game.bakery,
    dream: game.dream,
  })
  return {
    tiles: financeTiles(game, statements),
    chart: recentChartDays(
      weekReports,
      game.weekSoFar.days,
      firstDay,
      game.lastDay?.day ?? null,
    ),
    watch: watchLines(game, statements, fixedCosts, financing),
    financing,
  }
}
