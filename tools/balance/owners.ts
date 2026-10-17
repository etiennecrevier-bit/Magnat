import type {
  DifficultyId,
  EventContent,
  PercentileContent,
  Standing,
} from '../../src/content/schema.ts'
import { EVENTS } from '../../src/engine/day.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { PERCENTILES as SHIPPED_PERCENTILES } from '../../src/engine/percentiles.ts'
import { int, isRngState, seedRng } from '../../src/engine/rng.ts'
import { standingOf } from '../../src/engine/standing.ts'
import type { GameState } from '../../src/engine/types.ts'
import { incomeStatement } from '../../src/finance/statements.ts'
import {
  answerEvent,
  eventChooser,
  playMorning,
  startGame,
} from '../sim/simulate.ts'
import { branchEvent, sampleStream, type EventSample } from './eventBranches.ts'
import { STRATEGIES, strategyChanges, type Strategy } from './strategies.ts'

// The owners `npm run balance -- --percentiles` compares the player with:
// games that each hold a strategy of the grid drawn from their seed, answer
// the event cards at random, and note the bénéfice net at each Sunday's
// close. At a difficulty whose draw follows the player's standing, the
// owners draw against the table they make, built week by week, so it never
// depends on the table shipped before. No I/O: phase3.ts writes the
// results.

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

/** A card drawn by weight, and the owner's standing the morning it came. */
export interface StandingDraw {
  readonly event: string
  readonly standing: Standing
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
   * At a difficulty whose draw follows the standing (see `adapts`), each
   * card drawn by weight, in the order they came, with the standing that
   * drew it; empty at the others. Follow-ups are not drawn by weight.
   */
  readonly draws: readonly StandingDraw[]
  /**
   * One occurrence of each card that came up, drawn at random among its
   * occurrences, every choice played out (see `branchEvent`); in the order
   * of the cards in the content. Empty unless the game branches.
   */
  readonly events: readonly EventSample[]
}

/** Whether `content`'s draw follows the player's standing at `difficulty`. */
export function adapts(
  content: EventContent,
  difficulty: DifficultyId,
): boolean {
  return content.adaptiveDraw?.difficulties.includes(difficulty) ?? false
}

/**
 * Plays game `seed` at `difficulty` for `weeks` weeks from day 0, its owner
 * holding `ownerStrategy(seed)` and answering the cards of `content` with
 * `eventChooser('random', seed)`, as `npm run sim -- --events random` does,
 * the standing read against `percentiles`, by default the shipped table.
 * A game that ends, in bankruptcy (#160), plays no more: its bénéfice net
 * stays at its last close's for the weeks after. With `branch`, each card
 * that came up then has one of its occurrences drawn with
 * `sampleStream(seed)` and branched. Throws a RangeError unless `weeks` is
 * a whole number from 1.
 */
export function playOwner(
  seed: number,
  difficulty: DifficultyId,
  weeks: number,
  {
    content = EVENTS,
    branch = true,
    percentiles = SHIPPED_PERCENTILES,
  }: {
    readonly content?: EventContent
    readonly branch?: boolean
    readonly percentiles?: PercentileContent
  } = {},
): OwnerGame {
  if (!Number.isSafeInteger(weeks) || weeks < 1) {
    throw new RangeError(`Weeks must be a whole number from 1: ${weeks}`)
  }
  const strategy = ownerStrategy(seed)
  const choose = eventChooser('random', seed)
  const rules = adapts(content, difficulty) ? content.adaptiveDraw : undefined
  let state = startGame(seed, difficulty, strategyChanges(strategy))
  const mornings = new Map<string, GameState[]>()
  const weeklyNetIncome: Cents[] = []
  const draws: StandingDraw[] = []
  for (let day = 0; day < weeks * DAYS_PER_WEEK; day += 1) {
    const { pending } = state.events
    if (branch && pending !== null) {
      mornings.set(pending.event, [
        ...(mornings.get(pending.event) ?? []),
        state,
      ])
    }
    if (rules !== undefined && pending !== null && !pending.followUp) {
      draws.push({
        event: pending.event,
        standing: standingOf(state, rules, percentiles),
      })
    }
    state = playMorning(state, content, choose, percentiles)
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
  return { seed, strategy, weeklyNetIncome, draws, events }
}

/** Every owner's game at one difficulty, in seed order. */
export interface OwnersRun {
  readonly difficulty: DifficultyId
  readonly games: readonly OwnerGame[]
}

/**
 * Plays seeds 1 to `games` at `difficulty` for `years` years of 52 weeks
 * with the cards of `content` (see `playOwner`). Where the draw follows the
 * standing, the owners read it against the table they make themselves (see
 * `stagedPercentiles`), so the table they make is the one they played
 * against; elsewhere no table is read. Throws a RangeError unless both are
 * whole numbers from 1, and an Error if the owners did not play the games
 * the table came from, which would be a bug.
 */
export function runOwners({
  years,
  games,
  difficulty,
  content = EVENTS,
}: {
  readonly years: number
  readonly games: number
  readonly difficulty: DifficultyId
  readonly content?: EventContent
}): OwnersRun {
  for (const [name, value] of [
    ['Years', years],
    ['Games', games],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a whole number from 1: ${value}`)
    }
  }
  const weeks = years * WEEKS_PER_YEAR
  const staged = adapts(content, difficulty)
    ? stagedPercentiles(games, difficulty, weeks, content)
    : undefined
  const played = Array.from({ length: games }, (_, index) =>
    playOwner(index + 1, difficulty, weeks, {
      content,
      percentiles: staged,
    }),
  )
  if (
    staged !== undefined &&
    JSON.stringify(percentileRows(played)) !==
      JSON.stringify(staged.difficulties[difficulty])
  ) {
    throw new Error(`The ${difficulty} owners left the table they made`)
  }
  return { difficulty, games: played }
}

/**
 * The percentile table of seeds 1 to `games` at `difficulty`, `weeks` weeks
 * each, the owners drawing by their standing against the table as it is
 * built: all the owners play each week side by side, and once each has
 * closed its Sunday, the week's row is made from their bénéfice net, before
 * any of them draws the card of the Monday, the first morning that reads
 * that row. So the table is the one the owners played against, whatever the
 * table shipped. An owner whose game ended, in bankruptcy (#160), plays no
 * more, its bénéfice net in each row after that of its last close, as
 * `playOwner` counts it. The other difficulties copy this one's rows: none
 * reads them. No branching: `runOwners` plays the games again for that.
 */
export function stagedPercentiles(
  games: number,
  difficulty: DifficultyId,
  weeks: number,
  content: EventContent = EVENTS,
): PercentileContent {
  const owners = Array.from({ length: games }, (_, index) => {
    const seed = index + 1
    return {
      choose: eventChooser('random', seed),
      state: startGame(seed, difficulty, strategyChanges(ownerStrategy(seed))),
    }
  })
  const rows: Cents[][] = []
  const table = (): PercentileContent => ({
    games,
    percentiles: [...PERCENTILES],
    difficulties: { facile: rows, moyen: rows, difficile: rows },
  })
  for (let week = 1; week <= weeks; week += 1) {
    const sunday = week * DAYS_PER_WEEK - 1
    for (const owner of owners) {
      // A game that ended stays on the morning after its last day.
      while (owner.state.day < sunday && owner.state.ended === null) {
        owner.state = playMorning(owner.state, content, owner.choose, table())
      }
      // Answered once, so the chooser draws once for the Sunday.
      owner.state = answerEvent(owner.state, content, owner.choose)
    }
    // Monday's draw reads this week's row, made from Sunday's close: each
    // Sunday is played once for its close, whatever Monday draws then, and
    // played again once the row is made.
    rows.push(
      percentileRow(
        owners.map(
          ({ state }) =>
            incomeStatement(
              playMorning(state, content, null, table()).journal,
              0,
              sunday,
            ).netIncome.amount,
        ),
      ),
    )
    for (const owner of owners) {
      owner.state = playMorning(owner.state, content, null, table())
    }
  }
  return table()
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
  return Array.from({ length: weeks }, (_, week) =>
    percentileRow(
      games.map(({ weeklyNetIncome }) => weeklyNetIncome[week] ?? 0),
      percentiles,
    ),
  )
}

/** The `percentiles` of `amounts`, in any order (see `quantileCents`). */
export function percentileRow(
  amounts: readonly number[],
  percentiles: readonly number[] = PERCENTILES,
): Cents[] {
  const sorted = [...amounts].sort((a, b) => a - b)
  return percentiles.map((percentile) => quantileCents(sorted, percentile))
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
