import type { DifficultyId, EventContent } from '../../src/content/schema.ts'
import { EVENTS } from '../../src/engine/day.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { int, isRngState, seedRng } from '../../src/engine/rng.ts'
import type { GameState } from '../../src/engine/types.ts'
import { incomeStatement } from '../../src/finance/statements.ts'
import { eventChooser, playMorning, startGame } from '../sim/simulate.ts'
import { branchEvent, sampleStream, type EventSample } from './eventBranches.ts'
import { STRATEGIES, strategyChanges, type Strategy } from './strategies.ts'

// The owners `npm run balance -- --percentiles` compares the player with:
// games that each hold a strategy of the grid drawn from their seed, answer
// the event cards at random, and note the bénéfice net at each Sunday's
// close. No I/O: phase3.ts writes the results.

// A calendar fact, not a tunable: day 0 is a Monday, so week n runs from
// day 7(n - 1) to its Sunday, day 7n - 1.
export const DAYS_PER_WEEK = 7

/** The weeks `--years` counts in a year. */
export const WEEKS_PER_YEAR = 52

/** The percentiles of the table, in %. */
export const PERCENTILES = [5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95] as const

// Mixed into a game's seed so the owner's strategy draws from a stream of
// its own, apart from the game's generator and its event choices.
const STRATEGY_SALT = 0x0a11_0e75

/**
 * The strategy the owner of game `seed` holds from day 0, drawn uniformly
 * from the grid, the same at every difficulty. Throws a RangeError unless
 * `seed` is an integer in [0, 2^32).
 */
export function ownerStrategy(
  seed: number,
  strategies: readonly Strategy[] = STRATEGIES,
): Strategy {
  if (!isRngState(seed)) throw new RangeError(`Invalid seed: ${seed}`)
  const [index] = int(
    seedRng((seed ^ STRATEGY_SALT) >>> 0),
    0,
    strategies.length - 1,
  )
  const strategy = strategies[index]
  if (strategy === undefined) throw new RangeError('No strategy to draw')
  return strategy
}

/** One owner's game. */
export interface OwnerGame {
  readonly seed: number
  readonly strategy: Strategy
  /**
   * Entry n - 1 is the Bénéfice net from day 0 to the close of week n's
   * Sunday, after the owner's pay; negative for a Perte nette.
   */
  readonly weeklyNetIncome: readonly Cents[]
  /**
   * One occurrence of each card that came up, drawn at random among its
   * occurrences, every choice played out (see `branchEvent`); in the order
   * of the cards in the content. Empty unless the game branches.
   */
  readonly events: readonly EventSample[]
}

/**
 * Plays game `seed` at `difficulty` for `weeks` weeks from day 0, its owner
 * holding `ownerStrategy(seed)` and answering the cards of `content` with
 * `eventChooser('random', seed)`, as `npm run sim -- --events random` does.
 * With `branch`, each card that came up then has one of its occurrences
 * drawn with `sampleStream(seed)` and branched. Throws a RangeError unless
 * `weeks` is a whole number from 1.
 */
export function playOwner(
  seed: number,
  difficulty: DifficultyId,
  weeks: number,
  {
    content = EVENTS,
    branch = true,
  }: {
    readonly content?: EventContent
    readonly branch?: boolean
  } = {},
): OwnerGame {
  if (!Number.isSafeInteger(weeks) || weeks < 1) {
    throw new RangeError(`Weeks must be a whole number from 1: ${weeks}`)
  }
  const strategy = ownerStrategy(seed)
  const choose = eventChooser('random', seed)
  let state = startGame(seed, difficulty, strategyChanges(strategy))
  const mornings = new Map<string, GameState[]>()
  const weeklyNetIncome: Cents[] = []
  for (let day = 0; day < weeks * DAYS_PER_WEEK; day += 1) {
    const { pending } = state.events
    if (branch && pending !== null) {
      mornings.set(pending.event, [
        ...(mornings.get(pending.event) ?? []),
        state,
      ])
    }
    state = playMorning(state, content, choose)
    if ((day + 1) % DAYS_PER_WEEK === 0) {
      weeklyNetIncome.push(
        incomeStatement(state.journal, 0, day).netIncome.amount,
      )
    }
  }

  const events: EventSample[] = []
  let pick = sampleStream(seed)
  for (const { id } of content.events) {
    const seen = mornings.get(id)
    if (seen === undefined) continue
    const [index, after] = int(pick, 0, seen.length - 1)
    pick = after
    const morning = seen[index]
    if (morning !== undefined) events.push(branchEvent(morning, seed, content))
  }
  return { seed, strategy, weeklyNetIncome, events }
}

/** Every owner's game at one difficulty, in seed order. */
export interface OwnersRun {
  readonly difficulty: DifficultyId
  readonly games: readonly OwnerGame[]
}

/**
 * Plays seeds 1 to `games` at `difficulty` for `years` years of 52 weeks
 * (see `playOwner`). Throws a RangeError unless both are whole numbers from
 * 1.
 */
export function runOwners({
  years,
  games,
  difficulty,
}: {
  readonly years: number
  readonly games: number
  readonly difficulty: DifficultyId
}): OwnersRun {
  for (const [name, value] of [
    ['Years', years],
    ['Games', games],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a whole number from 1: ${value}`)
    }
  }
  return {
    difficulty,
    games: Array.from({ length: games }, (_, index) =>
      playOwner(index + 1, difficulty, years * WEEKS_PER_YEAR),
    ),
  }
}

/**
 * The `percentile`th percentile of `sorted`, amounts in increasing order:
 * linear between the closest ranks (Hyndman and Fan's type 7, as R and
 * NumPy compute by default), rounded half away from zero to the cent.
 * Throws a RangeError on no amounts or unless `percentile` is a whole
 * number from 0 to 100.
 */
export function quantileCents(
  sorted: readonly number[],
  percentile: number,
): Cents {
  if (sorted.length === 0) throw new RangeError('No amounts')
  if (!Number.isSafeInteger(percentile) || percentile < 0 || percentile > 100) {
    throw new RangeError(`Not a percentile: ${percentile}`)
  }
  // The rank, (n - 1) × p / 100, in hundredths, so the arithmetic is exact.
  const rank = (sorted.length - 1) * percentile
  const below = Math.floor(rank / 100)
  const fraction = rank % 100
  const low = sorted[below] ?? 0
  const high = sorted[below + 1] ?? low
  return halfAwayFromZero(100 * low + fraction * (high - low), 100)
}

/**
 * For each week, the `percentiles` of every game's Bénéfice net to that
 * week's Sunday. Throws a RangeError on no games or when the games played
 * different numbers of weeks.
 */
export function percentileRows(
  games: readonly OwnerGame[],
  percentiles: readonly number[] = PERCENTILES,
): Cents[][] {
  const weeks = games[0]?.weeklyNetIncome.length
  if (weeks === undefined) throw new RangeError('No games')
  if (games.some(({ weeklyNetIncome }) => weeklyNetIncome.length !== weeks)) {
    throw new RangeError('The games played different numbers of weeks')
  }
  return Array.from({ length: weeks }, (_, week) => {
    const sorted = games
      .map(({ weeklyNetIncome }) => weeklyNetIncome[week] ?? 0)
      .sort((a, b) => a - b)
    return percentiles.map((percentile) => quantileCents(sorted, percentile))
  })
}

/**
 * `numerator / denominator`, rounded half away from zero to a whole number
 * of cents, in integers so that it is exact. `denominator` is above 0.
 */
export function halfAwayFromZero(
  numerator: number,
  denominator: number,
): Cents {
  const twice = 2 * Math.abs(numerator) + denominator
  const whole = (twice - (twice % (2 * denominator))) / (2 * denominator)
  return cents(numerator < 0 ? -whole : whole)
}
