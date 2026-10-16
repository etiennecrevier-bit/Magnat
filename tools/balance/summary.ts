import {
  add,
  cents,
  mulRatio,
  sub,
  type Cents,
} from '../../src/engine/money.ts'
import type { DifficultyRun, GameResult } from './play.ts'
import type { Strategy } from './strategies.ts'

// Sums up the games of each strategy and ranks the strategies, with no I/O:
// report.ts writes them and targets.ts checks them against #58.

/** One strategy's games at one difficulty, summed up. */
export interface StrategySummary {
  readonly strategy: Strategy
  /** The strategy's place in the run, from 0: the ranking's last tie-break. */
  readonly index: number
  readonly games: number
  /**
   * The owner's wealth at the end: Encaisse and their personal cash, as if
   * the business were theirs alone, less the cash in it that is not theirs,
   * what the emergency loans still owe and what the shares sold brought in.
   * Their pay only moves money from one to the other.
   */
  readonly medianWealth: Cents
  readonly medianCashAtEnd: Cents
  readonly worstCashAtEnd: Cents
  readonly medianNetIncome: Cents
  readonly medianPersonalCash: Cents
  readonly medianUnpaidRents: number
  /** The lowest cash of any game. */
  readonly lowestCash: Cents
  /** Games whose cash went below zero. */
  readonly gamesBelowZero: number
  readonly medianAverageEnergy: number
  readonly medianDaysExhausted: number
  readonly medianBotched: number
  /** Spoiled ÷ (sold + spoiled), every product, from 0 to 1. */
  readonly medianSpoilageRate: number
  readonly medianLostToStockouts: number
  readonly medianLostToPrices: number
  readonly medianLostToLine: number
  /** Emergency loans taken, over every game (#159). */
  readonly emergencyLoans: number
  /** Rounds of shares sold, over every game (#159). */
  readonly shareSales: number
}

/**
 * The middle value, or the mean of the middle two for an even count. Throws
 * a RangeError on no values.
 */
export function median(values: readonly number[]): number {
  const [low, high] = middle(values)
  return low === high ? low : (low + high) / 2
}

/**
 * The middle amount, or the mean of the middle two for an even count,
 * rounded half away from zero to the cent. Throws a RangeError on no values.
 */
export function medianCents(values: readonly Cents[]): Cents {
  const [low, high] = middle(values)
  return low === high ? cents(low) : mulRatio(cents(low + high), 0.5)
}

/**
 * Sums up `games`, the games of `strategy`, whose place in the run, from 0,
 * is `index`. Throws a RangeError on no games.
 */
export function summarize(
  strategy: Strategy,
  games: readonly GameResult[],
  index: number,
): StrategySummary {
  const cashAtEnd = games.map(({ cashAtEnd }) => cashAtEnd)
  const medianOf = (field: (game: GameResult) => number) =>
    median(games.map(field))
  return {
    strategy,
    index,
    games: games.length,
    medianWealth: medianCents(
      games.map(({ cashAtEnd, personalCash, financedAtEnd }) =>
        sub(add(cashAtEnd, personalCash), financedAtEnd),
      ),
    ),
    medianCashAtEnd: medianCents(cashAtEnd),
    worstCashAtEnd: cents(Math.min(...cashAtEnd)),
    medianNetIncome: medianCents(games.map(({ netIncome }) => netIncome)),
    medianPersonalCash: medianCents(
      games.map(({ personalCash }) => personalCash),
    ),
    medianUnpaidRents: medianOf(({ unpaidRents }) => unpaidRents),
    lowestCash: cents(Math.min(...games.map(({ lowestCash }) => lowestCash))),
    gamesBelowZero: games.filter(({ wentBelowZero }) => wentBelowZero).length,
    medianAverageEnergy: medianOf(({ averageEnergy }) => averageEnergy),
    medianDaysExhausted: medianOf(({ daysExhausted }) => daysExhausted),
    medianBotched: medianOf(({ botched }) => botched),
    medianSpoilageRate: medianOf(spoilageRate),
    medianLostToStockouts: medianOf(({ lostToStockouts }) => lostToStockouts),
    medianLostToPrices: medianOf(({ lostToPrices }) => lostToPrices),
    medianLostToLine: medianOf(({ lostToLine }) => lostToLine),
    emergencyLoans: games.reduce(
      (total, { emergencyLoans }) => total + emergencyLoans,
      0,
    ),
    shareSales: games.reduce((total, { shareSales }) => total + shareSales, 0),
  }
}

/**
 * Whether `a` does better than `b`, below 0, or worse, above 0, by what
 * they played, never by their place in the run: the higher median wealth at
 * the end, then the fewer median unpaid rents, then the higher median net
 * income. 0 when they tie on all three.
 */
export function compareResults(a: StrategySummary, b: StrategySummary): number {
  return (
    b.medianWealth - a.medianWealth ||
    a.medianUnpaidRents - b.medianUnpaidRents ||
    b.medianNetIncome - a.medianNetIncome
  )
}

/**
 * Best first, by `compareResults`, then the earlier in the run. Never
 * mutates `summaries`.
 */
export function rank(summaries: readonly StrategySummary[]): StrategySummary[] {
  return [...summaries].sort(
    (a, b) => compareResults(a, b) || a.index - b.index,
  )
}

/** A strategy's summary and its rank, from 1 for the best. */
export interface RankedStrategy extends StrategySummary {
  readonly rank: number
}

/** Every strategy of `run`, summed up and ranked, best first. */
export function ranked(run: DifficultyRun): RankedStrategy[] {
  const summaries = run.strategies.map(({ strategy, games }, index) =>
    summarize(strategy, games, index),
  )
  return rank(summaries).map((summary, index) => ({
    ...summary,
    rank: index + 1,
  }))
}

function spoilageRate({ unitsSold, unitsSpoiled }: GameResult): number {
  const units = unitsSold + unitsSpoiled
  return units === 0 ? 0 : unitsSpoiled / units
}

function middle(values: readonly number[]): [number, number] {
  if (values.length === 0) throw new RangeError('No values to take a median of')
  const sorted = [...values].sort((a, b) => a - b)
  const half = Math.floor(sorted.length / 2)
  const high = sorted[half] ?? 0
  const low = sorted.length % 2 === 0 ? (sorted[half - 1] ?? 0) : high
  return [low, high]
}
