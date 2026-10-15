import { createHash } from 'node:crypto'
import type { DifficultyId } from '../../src/content/schema.ts'
import { createInitialState, tick, toCalendar } from '../../src/engine/clock.ts'
import { FOOD_TRUCK } from '../../src/engine/day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from '../../src/engine/decisions.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import type { Cents } from '../../src/engine/money.ts'
import { defaultProfile } from '../../src/engine/profile.ts'
import type { Day, DaySummary, PerProduct } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import {
  balance,
  type Journal,
  type JournalEntry,
} from '../../src/finance/journal.ts'
import { incomeStatement } from '../../src/finance/statements.ts'

// Plays a game headless and sums it up, with no I/O: cli.ts prints the result
// and writes it to disk.

const CASH: AccountCode = '1000'

/**
 * One year of play. Years count from the first day of the game, so year 1
 * runs from day 0 to the day before its first anniversary; the last year
 * stops early when the run does.
 */
export interface YearSummary {
  /** Counts from 1. */
  readonly year: number
  readonly fromDay: Day
  /** The last day of the year, included. */
  readonly toDay: Day
  /** Ventes, read from the books. */
  readonly revenue: Cents
  /** Bénéfice net, or a negative Perte nette, read from the books. */
  readonly netIncome: Cents
  /** Encaisse at the close of `toDay`. */
  readonly cashAtYearEnd: Cents
  /** Units of every product written off at the close. */
  readonly unitsSpoiled: number
  /** Units of every product asked for after it sold out. */
  readonly lostSales: number
}

/** The owner's side of the game, outside the books. */
export interface OwnerSummary {
  /**
   * The owner's energy each morning, before the day is played: entry `n` is
   * day `n`'s, and day 0's is the full energy a game starts with.
   */
  readonly morningEnergy: readonly number[]
  /** The owner's personal cash at the end of the run. */
  readonly personalCash: Cents
  /**
   * Every 1st of the month whose rent went unpaid, in order, over the whole
   * run: the game's account keeps only the last 12 months.
   */
  readonly unpaidRents: readonly Day[]
}

export interface SimulationResult {
  readonly seed: number
  /** How the game started: the opening books and the truck's charges. */
  readonly difficulty: DifficultyId
  /** Days played, from day 0. */
  readonly days: number
  /** See `journalHash`. */
  readonly journalHash: string
  readonly years: readonly YearSummary[]
  /** What happened each day, in order: entry `n` is day `n`. */
  readonly daySummaries: readonly DaySummary[]
  /** Every entry in the books at the end of the run. */
  readonly journal: readonly JournalEntry[]
  readonly owner: OwnerSummary
}

/**
 * Starts a game from `seed` at `difficulty`, by default the new game
 * screen's, makes `changes` to the starting decisions, in order, and plays
 * `days` business days, from day 0. The changes are in effect from day 0,
 * where the player's would wait for the next morning. Throws a RangeError
 * unless `days` is a safe integer of at least 1, `seed` and `difficulty` are
 * ones `createInitialState` accepts and every change is one `applyDecision`
 * accepts.
 */
export function simulate(
  seed: number,
  days: number,
  difficulty: DifficultyId = defaultProfile().difficulty,
  changes: readonly DecisionChange[] = [],
): SimulationResult {
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new RangeError(`Days to play must be a whole number from 1: ${days}`)
  }

  let state = createInitialState(seed, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
  for (const change of changes) state = applyDecision(state, change)
  // What tick() does each morning, before day 0 is played.
  state = {
    ...state,
    decisions: latestDecisions(state),
    pendingDecisions: null,
  }
  const daySummaries: DaySummary[] = []
  const morningEnergy: number[] = []
  const unpaidRents: Day[] = []
  for (let day = 0; day < days; day += 1) {
    morningEnergy.push(state.energy)
    state = tick(state)
    if (state.lastDay === null) throw new Error(`Day ${day} left no summary`)
    daySummaries.push(state.lastDay)
    if (state.personal.unpaidRents.at(-1) === day) unpaidRents.push(day)
  }

  return {
    seed,
    difficulty,
    days,
    journalHash: journalHash(state.journal),
    years: summarizeYears(state.journal, daySummaries),
    daySummaries,
    journal: state.journal.entries,
    owner: { morningEnergy, personalCash: state.personal.cash, unpaidRents },
  }
}

/**
 * The sha256 of the journal's entries, in hex. `postEntry` builds every entry
 * and line itself, always with the same keys in the same order, so equal
 * journals serialize, and hash, the same.
 */
export function journalHash(journal: Journal): string {
  return createHash('sha256')
    .update(JSON.stringify(journal.entries))
    .digest('hex')
}

function summarizeYears(
  journal: Journal,
  daySummaries: readonly DaySummary[],
): YearSummary[] {
  const first = toCalendar(0)
  function isAnniversary(day: Day): boolean {
    const { month, dayOfMonth } = toCalendar(day)
    return month === first.month && dayOfMonth === first.dayOfMonth
  }

  const years: YearSummary[] = []
  let fromDay = 0
  for (let toDay = 0; toDay < daySummaries.length; toDay += 1) {
    const isLast = toDay === daySummaries.length - 1
    if (!isLast && !isAnniversary(toDay + 1)) continue

    const { sales, netIncome } = incomeStatement(journal, fromDay, toDay)
    const played = daySummaries.slice(fromDay, toDay + 1)
    years.push({
      year: years.length + 1,
      fromDay,
      toDay,
      revenue: sales.amount,
      netIncome: netIncome.amount,
      cashAtYearEnd: balance(journal, CASH, { toDay }),
      unitsSpoiled: totalUnits(played.map(({ spoiled }) => spoiled)),
      lostSales: totalUnits(played.map(({ lostSales }) => lostSales)),
    })
    fromDay = toDay + 1
  }
  return years
}

function totalUnits(counts: readonly PerProduct[]): number {
  return counts.reduce(
    (total, count) =>
      PRODUCTS.reduce((units, product) => units + count[product], total),
    0,
  )
}
