import type { DifficultyId } from '../../src/content/schema.ts'
import { monthsSinceStart } from '../../src/engine/calendar.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { formatDollars } from '../sim/cli.ts'
import type { DifficultyRun, GameResult } from './play.ts'
import {
  formatPriceChange,
  MARKETING_DAILY,
  PRICE_CHANGES,
  type Strategy,
} from './strategies.ts'
import { compareResults, type RankedStrategy } from './summary.ts'

// The design targets of #58, checked on a one-year run, with no I/O: one row
// per target, one check per difficulty played. The numbers below are #58's,
// a test of the content like the grid of strategies, not tunables of the
// game.

/** The best strategy's year-1 net income, after the owner's pay. */
export const NET_INCOME_TARGETS: Readonly<Record<DifficultyId, Cents>> = {
  facile: cents(3_000_000),
  moyen: cents(2_000_000),
  difficile: cents(1_000_000),
}
/** How far from its target the best net income may land, either way. */
export const NET_INCOME_TOLERANCE = cents(500_000)

/** Careless play (#44): prices far off and much too much stock. */
export const CARELESS = { priceChange: 40, croissantsPerDay: 110 } as const
/** "Before month 6": in the first 5 months of the game, May to September. */
export const CARELESS_MONTHS = 5
/** "Most seeds": more than this share of them. */
export const MOST = 0.5

/** The strategy that keeps the content's starting decisions. */
export const DEFAULT_STRATEGY: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}

/** The premium prices where some marketing should beat none. */
export const PREMIUM_PRICES = [20, 40] as const
/** No budget, the sweet spot, and too much. */
const [NO_MARKETING, SOME_MARKETING, TOO_MUCH_MARKETING] = MARKETING_DAILY

/**
 * At the cheapest prices, on a rested schedule, the line loses at least this
 * share of the visits, and at least `LINE_RATIO` times the share it loses
 * at the starting prices.
 */
export const LINE_SHARE = 0.05
export const LINE_RATIO = 2
/** Days open a week that leave the owner rested: fewer than every day. */
const EVERY_DAY = 7

/** The pay that runs the owner out of rent money within year 1. */
export const LOW_PAY = cents(40_000)

const CHEAPEST = Math.min(...PRICE_CHANGES)
const DEAREST = Math.max(...PRICE_CHANGES)

/** How one difficulty fares against one target. */
export interface TargetCheck {
  /**
   * Whether the run meets the target; null when the target does not apply
   * to the difficulty or the run lacks the strategies it needs.
   */
  readonly met: boolean | null
  /** What the run measured; empty when `met` is null. */
  readonly measured: string
}

export interface TargetRow {
  /** The target, as the report states it. */
  readonly target: string
  /** One check per difficulty, in the order of the run. */
  readonly checks: readonly TargetCheck[]
}

/** One difficulty of a run and its strategies, ranked. */
export interface RankedRun {
  readonly run: DifficultyRun
  /** The strategies of `run` summed up and ranked, best first. */
  readonly ranked: readonly RankedStrategy[]
}

interface Target {
  readonly target: string
  readonly difficulties: readonly DifficultyId[]
  /** null when the run lacks the strategies the target needs. */
  readonly check: (ranked: RankedRun) => TargetCheck | null
}

const EVERY_DIFFICULTY: readonly DifficultyId[] = [
  'facile',
  'moyen',
  'difficile',
]

const TARGETS: readonly Target[] = [
  {
    target: `The best strategy's net income lands within ${formatDollars(NET_INCOME_TOLERANCE)} of Facile ${formatDollars(NET_INCOME_TARGETS.facile)}, Moyen ${formatDollars(NET_INCOME_TARGETS.moyen)}, Difficile ${formatDollars(NET_INCOME_TARGETS.difficile)}`,
    difficulties: EVERY_DIFFICULTY,
    check: ({ run, ranked }) => {
      const first = ranked[0]
      if (first === undefined) return null
      const gap = first.medianNetIncome - NET_INCOME_TARGETS[run.difficulty]
      return {
        met: Math.abs(gap) <= NET_INCOME_TOLERANCE,
        measured: formatDollars(first.medianNetIncome),
      }
    },
  },
  {
    target: `Every careless strategy (${formatPriceChange(CARELESS.priceChange)}, ${CARELESS.croissantsPerDay} croissants a day) goes below zero before October 1st in more than ${percent(MOST)} of its games`,
    difficulties: ['moyen', 'difficile'],
    check: ({ run }) => {
      const careless = run.strategies.filter(
        ({ strategy }) =>
          strategy.priceChange === CARELESS.priceChange &&
          strategy.croissantsPerDay === CARELESS.croissantsPerDay,
      )
      if (careless.length === 0) return null
      const shares = careless.map(
        ({ games }) => games.filter(belowZeroEarly).length / games.length,
      )
      const meeting = shares.filter((share) => share > MOST).length
      return {
        met: meeting === careless.length,
        measured: `${meeting} of ${careless.length} strategies; lowest ${percent(Math.min(...shares))}`,
      }
    },
  },
  {
    target: 'The starting decisions never go below zero',
    difficulties: ['facile'],
    check: ({ run }) => {
      const games = gamesOf(run, (strategy) =>
        sameStrategy(strategy, DEFAULT_STRATEGY),
      )
      if (games.length === 0) return null
      const below = games.filter(({ wentBelowZero }) => wentBelowZero).length
      return {
        met: below === 0,
        measured: `${below} of ${games.length} games below zero`,
      }
    },
  },
  {
    target: `The best prices are neither ${formatPriceChange(CHEAPEST)} nor ${formatPriceChange(DEAREST)}`,
    difficulties: EVERY_DIFFICULTY,
    check: ({ ranked }) => {
      const extreme = ({ priceChange }: Strategy) =>
        priceChange === CHEAPEST || priceChange === DEAREST
      const between = best(ranked, (strategy) => !extreme(strategy))
      const outside = best(ranked, extreme)
      if (between === undefined || outside === undefined) return null
      return {
        met: beats(between, outside),
        measured: `best at ${formatPriceChange(between.strategy.priceChange)}: ${standing(between, outside)}; best at ${formatPriceChange(CHEAPEST)} or ${formatPriceChange(DEAREST)}: #${outside.rank}`,
      }
    },
  },
  {
    target: `At ${PREMIUM_PRICES.map(formatPriceChange).join(' and ')}, the best with ${formatDollars(SOME_MARKETING)} of marketing a day beats the best with ${formatDollars(NO_MARKETING)} and the best with ${formatDollars(TOO_MUCH_MARKETING)}`,
    difficulties: EVERY_DIFFICULTY,
    check: ({ ranked }) => {
      const results = PREMIUM_PRICES.map((priceChange) => {
        const [none, some, tooMuch] = [
          NO_MARKETING,
          SOME_MARKETING,
          TOO_MUCH_MARKETING,
        ].map((budget) =>
          best(
            ranked,
            (strategy) =>
              strategy.priceChange === priceChange &&
              strategy.marketingDaily === budget,
          ),
        )
        if (none === undefined || some === undefined || tooMuch === undefined)
          return null
        return {
          met: beats(some, none) && beats(some, tooMuch),
          measured: `${formatPriceChange(priceChange)}: ${[none, some, tooMuch].map(({ strategy, rank }) => `${formatDollars(strategy.marketingDaily)} #${rank}`).join(', ')}`,
        }
      })
      if (results.some((result) => result === null)) return null
      const found = results.filter((result) => result !== null)
      return {
        met: found.every(({ met }) => met),
        measured: found.map(({ measured }) => measured).join('; '),
      }
    },
  },
  {
    target: `On fewer than 7 days a week, ${formatPriceChange(CHEAPEST)} prices lose at least ${percent(LINE_SHARE)} of the visits to the line, and at least ${LINE_RATIO} times the share at base prices`,
    difficulties: EVERY_DIFFICULTY,
    check: ({ run }) => {
      const rested = (priceChange: number) =>
        gamesOf(
          run,
          (strategy) =>
            strategy.priceChange === priceChange &&
            strategy.daysOpen < EVERY_DAY,
        )
      const cheap = lineShare(rested(CHEAPEST))
      const base = lineShare(rested(0))
      if (cheap === null || base === null) return null
      return {
        met: cheap >= LINE_SHARE && cheap >= LINE_RATIO * base,
        measured: `${formatPriceChange(CHEAPEST)}: ${percent(cheap, 1)}; base: ${percent(base, 1)}`,
      }
    },
  },
  {
    target: 'Opening 7 days a week is never the best',
    difficulties: EVERY_DIFFICULTY,
    check: ({ ranked }) => {
      const everyDay = best(ranked, ({ daysOpen }) => daysOpen === EVERY_DAY)
      const fewer = best(ranked, ({ daysOpen }) => daysOpen < EVERY_DAY)
      if (everyDay === undefined || fewer === undefined) return null
      return {
        met: beats(fewer, everyDay),
        measured: `best on 7 days: #${everyDay.rank}${compareResults(fewer, everyDay) === 0 ? ', tied' : ''}`,
      }
    },
  },
  {
    target: `Paying the owner ${formatDollars(LOW_PAY)} a week leaves a rent unpaid in every game`,
    difficulties: ['moyen', 'difficile'],
    check: ({ run }) => {
      const games = gamesOf(
        run,
        ({ ownerWeeklyPay }) => ownerWeeklyPay === LOW_PAY,
      )
      if (games.length === 0) return null
      const missed = games.filter(({ unpaidRents }) => unpaidRents > 0).length
      return {
        met: missed === games.length,
        measured: `${missed} of ${games.length} games`,
      }
    },
  },
]

const NOT_APPLICABLE: TargetCheck = { met: null, measured: '' }

/**
 * Checks each difficulty of a one-year run against every design target of
 * #58, in the order the report lists them.
 */
export function designTargets(runs: readonly RankedRun[]): TargetRow[] {
  return TARGETS.map(({ target, difficulties, check }) => ({
    target,
    checks: runs.map(
      (ranked) =>
        (difficulties.includes(ranked.run.difficulty) ? check(ranked) : null) ??
        NOT_APPLICABLE,
    ),
  }))
}

/** The highest ranked strategy that `matches`, if any. */
function best(
  ranked: readonly RankedStrategy[],
  matches: (strategy: Strategy) => boolean,
): RankedStrategy | undefined {
  return ranked.find(({ strategy }) => matches(strategy))
}

/**
 * Whether `a` does strictly better than `b` by what they played: a tie that
 * only the order of the grid breaks does not count.
 */
function beats(a: RankedStrategy, b: RankedStrategy): boolean {
  return compareResults(a, b) < 0
}

/** `#1`, or `#1, tied` when only the grid's order puts `a` before `b`. */
function standing(a: RankedStrategy, b: RankedStrategy): string {
  return `#${a.rank}${compareResults(a, b) === 0 ? ', tied' : ''}`
}

function gamesOf(
  run: DifficultyRun,
  matches: (strategy: Strategy) => boolean,
): GameResult[] {
  return run.strategies
    .filter(({ strategy }) => matches(strategy))
    .flatMap(({ games }) => games)
}

function sameStrategy(a: Strategy, b: Strategy): boolean {
  return (Object.keys(a) as (keyof Strategy)[]).every(
    (key) => a[key] === b[key],
  )
}

function belowZeroEarly({ firstDayBelowZero }: GameResult): boolean {
  return (
    firstDayBelowZero !== null &&
    monthsSinceStart(firstDayBelowZero) < CARELESS_MONTHS
  )
}

/** Visits lost to the line ÷ visits, over `games`; null with no visits. */
function lineShare(games: readonly GameResult[]): number | null {
  const visits = games.reduce((total, game) => total + game.visits, 0)
  const lost = games.reduce((total, game) => total + game.lostToLine, 0)
  return visits === 0 ? null : lost / visits
}

function percent(share: number, digits = 0): string {
  return `${(100 * share).toFixed(digits)}%`
}
