import {
  difficultyIdSchema,
  type DifficultyId,
  type StreetModifierKind,
} from '../../src/content/schema.ts'
import { SEGMENTS } from '../../src/engine/customers.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import type {
  Day,
  DaySummary,
  PerProduct,
  ShareSale,
} from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import type { JournalEntry } from '../../src/finance/journal.ts'
import { DIFFICULTIES, ENERGY, EVENTS } from '../../src/engine/day.ts'
import { isFinancingMemo } from '../../src/engine/financing.ts'
import {
  simulate,
  type ContractPolicy,
  type EventPolicy,
  type FinancingPolicy,
} from '../sim/simulate.ts'
import { STRATEGIES, strategyChanges, type Strategy } from './strategies.ts'

// Plays the strategies headless and sums up each game, with no I/O: report.ts
// turns the games into the report and cli.ts writes it.

const CASH: AccountCode = '1000'
const BANK_LOANS: AccountCode = '2500'

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
  /**
   * The day of the first entry that left Encaisse below zero, or null when
   * none did.
   */
  readonly firstDayBelowZero: Day | null
  /** The owner's personal cash at the end of the game, outside the books. */
  readonly personalCash: Cents
  /** The 1sts of the month whose rent went unpaid. */
  readonly unpaidRents: number
  /** The owner's energy each morning, averaged over every day played. */
  readonly averageEnergy: number
  /** Mornings the owner started « Épuisé », below `exhausted.below`. */
  readonly daysExhausted: number
  /** Units botched at the counter and made again. */
  readonly botched: number
  /** Visits, every day and every segment. */
  readonly visits: number
  /** Visits that left the line without being served. */
  readonly lostToLine: number
  /** Units of every product sold. */
  readonly unitsSold: number
  /** Units of every product written off at the close. */
  readonly unitsSpoiled: number
  /** Visits that bought nothing because what they wanted had sold out. */
  readonly lostToStockouts: number
  /** Visits that bought nothing because a price was above what they pay. */
  readonly lostToPrices: number
  /**
   * What the Encaisse at the end holds that is not the owner's (#159): what
   * the emergency loans still owe, and what the shares sold brought in.
   */
  readonly financedAtEnd: Cents
  /** Emergency loans taken (#159). */
  readonly emergencyLoans: number
  /** Rounds of shares sold (#159). */
  readonly shareSales: number
  /** The sha256 of the books, as `simulate` gives it. */
  readonly journalHash: string
  /** The days each kind of change to the street was in effect. */
  readonly modifierDays: Readonly<Record<StreetModifierKind, number>>
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
  /** How the event cards were answered; by default none came up. */
  readonly events?: EventPolicy
  /**
   * How the grocers' cards were answered; by default as the other cards.
   */
  readonly contracts?: ContractPolicy
  /**
   * How the financing's cards were answered; by default as the other
   * cards.
   */
  readonly financing?: FinancingPolicy
  readonly difficulties: readonly DifficultyRun[]
}

export interface BalanceOptions {
  readonly years: number
  readonly games: number
  /** By default the whole grid. */
  readonly strategies?: readonly Strategy[]
  /** By default every difficulty, easiest first. */
  readonly difficulties?: readonly DifficultyId[]
  /** How the event cards are answered; by default none come up. */
  readonly events?: EventPolicy
  /**
   * How the grocers' cards are answered (see `simulate`); by default as the
   * other cards.
   */
  readonly contracts?: ContractPolicy
  /**
   * How the financing's cards are answered (see `simulate`); by default as
   * the other cards.
   */
  readonly financing?: FinancingPolicy
  /** Called after each difficulty is played. */
  readonly onProgress?: (run: DifficultyRun) => void
}

/**
 * Plays `strategy` from `seed` at `difficulty` for `days` days, from day 0,
 * answering the event cards by `events`, the grocers' by `contracts` and the
 * financing's by `financing`, if any (see `simulate`), and sums up the game.
 * Throws what `simulate` throws.
 */
export function playStrategy(
  strategy: Strategy,
  difficulty: DifficultyId,
  seed: number,
  days: number,
  events: EventPolicy = 'none',
  contracts: ContractPolicy | null = null,
  financing: FinancingPolicy | null = null,
): GameResult {
  const result = simulate(
    seed,
    days,
    difficulty,
    strategyChanges(strategy),
    events,
    EVENTS,
    DIFFICULTIES,
    contracts,
    financing,
  )
  const { daySummaries, years } = result
  const lastYear = years.at(-1)
  if (lastYear === undefined) throw new Error(`Seed ${seed} played no year`)
  const { morningEnergy, personalCash, unpaidRents } = result.owner
  const firstBelow = firstDayBelowZero(result.journal)
  return {
    seed,
    cashAtEnd: lastYear.cashAtYearEnd,
    netIncome: cents(
      years.reduce((total, { netIncome }) => total + netIncome, 0),
    ),
    lowestCash: lowestCash(result.journal),
    wentBelowZero: firstBelow !== null,
    firstDayBelowZero: firstBelow,
    personalCash,
    unpaidRents: unpaidRents.length,
    averageEnergy:
      morningEnergy.reduce((total, energy) => total + energy, 0) /
      morningEnergy.length,
    daysExhausted: morningEnergy.filter(
      (energy) => energy < ENERGY.exhausted.below,
    ).length,
    botched: sum(daySummaries.map(({ botched }) => botched)),
    visits: sum(daySummaries.map(({ visits }) => visits.length)),
    lostToLine: sum(daySummaries.map(({ leftLine }) => leftLine)),
    unitsSold: totalUnits(daySummaries.map(({ sold }) => sold)),
    unitsSpoiled: totalUnits(daySummaries.map(({ spoiled }) => spoiled)),
    lostToStockouts: totalVisits(daySummaries, 'soldOut'),
    lostToPrices: totalVisits(daySummaries, 'tooExpensive'),
    financedAtEnd: financedAtEnd(result.journal, result.shareSales),
    emergencyLoans: result.loans.length,
    shareSales: result.shareSales.length,
    journalHash: result.journalHash,
    modifierDays: result.modifierDays,
  }
}

/**
 * Plays every strategy at every difficulty on seeds 1 to `games`, for
 * `years` years each, answering the event cards by `events`, the grocers'
 * by `contracts` and the financing's by `financing`, if any. Throws a
 * RangeError unless both are whole numbers from 1.
 */
export function runBalance({
  years,
  games,
  strategies = STRATEGIES,
  difficulties = difficultyIdSchema.options,
  events = 'none',
  contracts,
  financing,
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
    events,
    ...(contracts === undefined ? {} : { contracts }),
    ...(financing === undefined ? {} : { financing }),
    difficulties: difficulties.map((difficulty) => {
      const run: DifficultyRun = {
        difficulty,
        strategies: strategies.map((strategy) => ({
          strategy,
          games: seeds.map((seed) =>
            playStrategy(
              strategy,
              difficulty,
              seed,
              days,
              events,
              contracts ?? null,
              financing ?? null,
            ),
          ),
        })),
      }
      onProgress?.(run)
      return run
    }),
  }
}

/**
 * What `entries`, the books at the end of a game, owe on its emergency
 * loans, their Emprunts bancaires lent less those paid back, plus what
 * `shareSales` brought in: cash in the Encaisse that is not the owner's.
 */
export function financedAtEnd(
  entries: readonly JournalEntry[],
  shareSales: readonly ShareSale[],
): Cents {
  let owed = 0
  for (const { memo, lines } of entries) {
    if (!isFinancingMemo(memo)) continue
    for (const { account, debit, credit } of lines) {
      if (account === BANK_LOANS) owed += credit - debit
    }
  }
  return cents(shareSales.reduce((total, { amount }) => total + amount, owed))
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

/**
 * The day of the first of `entries`, taken whole and in order from the first,
 * that left Encaisse below zero; null when none did. An entry that moves
 * cash both ways counts once, by its net, as in `lowestCash`.
 */
export function firstDayBelowZero(
  entries: readonly JournalEntry[],
): Day | null {
  let cash = 0
  for (const { day, lines } of entries) {
    for (const { account, debit, credit } of lines) {
      if (account === CASH) cash += debit - credit
    }
    if (cash < 0) return day
  }
  return null
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0)
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
