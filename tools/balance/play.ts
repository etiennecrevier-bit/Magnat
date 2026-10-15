import {
  difficultyIdSchema,
  type DifficultyId,
} from '../../src/content/schema.ts'
import { SEGMENTS } from '../../src/engine/customers.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import type { DaySummary, PerProduct } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import type { JournalEntry } from '../../src/finance/journal.ts'
import { simulate } from '../sim/simulate.ts'
import { STRATEGIES, strategyChanges, type Strategy } from './strategies.ts'

// Plays the strategies headless and sums up each game, with no I/O: report.ts
// turns the games into the report and cli.ts writes it.

const CASH: AccountCode = '1000'

/** A business year, in days, as `--years` counts them. */
export const DAYS_PER_YEAR = 365

/** One game: one strategy, one difficulty, one seed. */
export interface GameResult {
  readonly seed: number
  /** Encaisse at the close of the last day played. */
  readonly cashAtEnd: Cents
  /** Bénéfice net, or a negative Perte nette, over every day played. */
  readonly netIncome: Cents
  /**
   * The lowest Encaisse after any entry of the books, those of the morning
   * included: a day's purchases and charges are paid before its sales come
   * in, so the cash at the close can hide a shortfall.
   */
  readonly lowestCash: Cents
  /** Whether the cash went below zero, when the game would need the bank. */
  readonly wentBelowZero: boolean
  /** Units of every product sold. */
  readonly unitsSold: number
  /** Units of every product written off at the close. */
  readonly unitsSpoiled: number
  /** Visits that bought nothing because what they wanted had sold out. */
  readonly lostToStockouts: number
  /** Visits that bought nothing because a price was above what they pay. */
  readonly lostToPrices: number
  /** The sha256 of the books, as `simulate` gives it. */
  readonly journalHash: string
}

/** Every game of one strategy at one difficulty, in seed order. */
export interface StrategyRun {
  readonly strategy: Strategy
  readonly games: readonly GameResult[]
}

export interface DifficultyRun {
  readonly difficulty: DifficultyId
  /** In the order of the strategies played. */
  readonly strategies: readonly StrategyRun[]
}

export interface BalanceRun {
  readonly years: number
  /** Games per strategy, on seeds 1 to `games`. */
  readonly games: number
  readonly difficulties: readonly DifficultyRun[]
}

export interface BalanceOptions {
  readonly years: number
  readonly games: number
  /** By default the whole grid. */
  readonly strategies?: readonly Strategy[]
  /** By default every difficulty, easiest first. */
  readonly difficulties?: readonly DifficultyId[]
  /** Called after each difficulty is played. */
  readonly onProgress?: (run: DifficultyRun) => void
}

/**
 * Plays `strategy` from `seed` at `difficulty` for `days` days, from day 0,
 * and sums up the game. Throws what `simulate` throws.
 */
export function playStrategy(
  strategy: Strategy,
  difficulty: DifficultyId,
  seed: number,
  days: number,
): GameResult {
  const result = simulate(seed, days, difficulty, strategyChanges(strategy))
  const { daySummaries, years } = result
  const lastYear = years.at(-1)
  if (lastYear === undefined) throw new Error(`Seed ${seed} played no year`)
  const lowest = lowestCash(result.journal)
  return {
    seed,
    cashAtEnd: lastYear.cashAtYearEnd,
    netIncome: cents(
      years.reduce((total, { netIncome }) => total + netIncome, 0),
    ),
    lowestCash: lowest,
    wentBelowZero: lowest < 0,
    unitsSold: totalUnits(daySummaries.map(({ sold }) => sold)),
    unitsSpoiled: totalUnits(daySummaries.map(({ spoiled }) => spoiled)),
    lostToStockouts: totalVisits(daySummaries, 'soldOut'),
    lostToPrices: totalVisits(daySummaries, 'tooExpensive'),
    journalHash: result.journalHash,
  }
}

/**
 * Plays every strategy at every difficulty on seeds 1 to `games`, for
 * `years` years each. Throws a RangeError unless both are whole numbers
 * from 1.
 */
export function runBalance({
  years,
  games,
  strategies = STRATEGIES,
  difficulties = difficultyIdSchema.options,
  onProgress,
}: BalanceOptions): BalanceRun {
  for (const [name, value] of [
    ['Years', years],
    ['Games', games],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a whole number from 1: ${value}`)
    }
  }

  const seeds = Array.from({ length: games }, (_, index) => index + 1)
  const days = years * DAYS_PER_YEAR
  return {
    years,
    games,
    difficulties: difficulties.map((difficulty) => {
      const run: DifficultyRun = {
        difficulty,
        strategies: strategies.map((strategy) => ({
          strategy,
          games: seeds.map((seed) =>
            playStrategy(strategy, difficulty, seed, days),
          ),
        })),
      }
      onProgress?.(run)
      return run
    }),
  }
}

/**
 * The lowest Encaisse after any of `entries`, taken whole and in order from
 * the first: an entry that moves cash both ways counts once, by its net.
 * The books open with the cash paid in, so no zero comes before them.
 * Throws a RangeError on no entries.
 */
export function lowestCash(entries: readonly JournalEntry[]): Cents {
  if (entries.length === 0) throw new RangeError('No entries in the books')
  let cash = 0
  let lowest = Infinity
  for (const { lines } of entries) {
    for (const { account, debit, credit } of lines) {
      if (account === CASH) cash += debit - credit
    }
    lowest = Math.min(lowest, cash)
  }
  return cents(lowest)
}

function totalUnits(counts: readonly PerProduct[]): number {
  return counts.reduce(
    (total, count) =>
      PRODUCTS.reduce((units, product) => units + count[product], total),
    0,
  )
}

function totalVisits(
  daySummaries: readonly DaySummary[],
  outcome: 'soldOut' | 'tooExpensive',
): number {
  return daySummaries.reduce(
    (total, { segments }) =>
      SEGMENTS.reduce(
        (visits, segment) => visits + segments[segment][outcome],
        total,
      ),
    0,
  )
}
