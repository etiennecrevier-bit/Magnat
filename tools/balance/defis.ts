import type {
  Defi,
  DefiContent,
  DefiMetric,
  FoodTruckContent,
  Medal,
} from '../../src/content/schema.ts'
import {
  allowedChoices,
  defiById,
  failedCondition,
  metricValue,
  setupDecisions,
} from '../../src/engine/challenge.ts'
import { startChallenge, tick } from '../../src/engine/clock.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../../src/engine/day.ts'
import {
  applyDecision,
  startingDecisions,
  type DecisionChange,
} from '../../src/engine/decisions.ts'
import { resolveEvent } from '../../src/engine/events.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import { int, seedRng } from '../../src/engine/rng.ts'
import type { ChallengeStatus } from '../../src/engine/types.ts'
import { ownerStrategy, PERCENTILES, quantileCents } from './owners.ts'
import {
  changedPrice,
  STRATEGIES,
  strategyChanges,
  WEEKDAYS,
  type Strategy,
} from './strategies.ts'

// The Défis, played as `npm run balance -- --defis` plays them: each by the
// simulated owners of `--percentiles`, and by the grid's best strategy for
// it, then summed up against the medal targets of #102. No I/O: defisReport.ts
// writes the results.

/**
 * The medal targets of #102, in % of the owners' games: « Or » in under
 * `orBelow`, « Argent » or better in `argentFrom` to `argentTo`, « Bronze »
 * or better in `bronzeFrom` to `bronzeTo`; and the best strategy's games
 * with « Or » in `bestOrFrom` or more. The issue says only that the best
 * strategy « gets or »; 80 % is our reading of it.
 */
export const DEFI_TARGETS = {
  orBelow: 10,
  argentFrom: 30,
  argentTo: 40,
  bronzeFrom: 65,
  bronzeTo: 75,
  bestOrFrom: 80,
} as const

/**
 * The percentiles of the owners' outcomes, best to worst, the report
 * suggests as thresholds: the middle of each target, with « Or » well
 * under its limit.
 */
export const SUGGESTED_PERCENTILES: Readonly<Record<Medal, number>> = {
  or: 92,
  argent: 65,
  bronze: 30,
}

// Mixed into a game's seed so the owner's event choices draw from a stream
// of their own, apart from the game's generator and the owner's strategy.
const CHOICE_SALT = 0x0def_1c0d

/** Where lower is better: the medals ask for at most their threshold. */
export function lowerIsBetter(metric: DefiMetric): boolean {
  return metric === 'spoilageRate'
}

/**
 * The decision changes an owner holding `strategy` makes on the Défi's
 * first morning: the grid moves the Défi's own opening decisions. Every
 * price moves by the strategy's % from the Défi's opening price; the
 * croissants bought each day scale the Défi's opening quantity as the grid
 * scales the content's starting one, rounded half up, so a Défi that keeps
 * the starting decisions gets the grid's own; the marketing budget, the
 * days open and the owner's pay are the grid's. Kinds the Défi locks are
 * left out. Café and chocolat restock keep the Défi's rules.
 */
export function defiOwnerChanges(
  strategy: Strategy,
  defi: Defi,
  content: FoodTruckContent = FOOD_TRUCK,
): DecisionChange[] {
  const opening = setupDecisions(defi, startingDecisions(content))
  const changes: DecisionChange[] = [
    ...PRODUCTS.map((product): DecisionChange => ({
      kind: 'price',
      product,
      price: changedPrice(
        strategy.priceChange,
        product,
        content,
        opening.prices[product],
      ),
    })),
    {
      kind: 'restock',
      product: 'croissant',
      rule: {
        kind: 'buyDaily',
        quantity: scaledQuantity(
          dailyQuantity(opening.restock.croissant),
          strategy.croissantsPerDay,
          dailyQuantity(content.startingDecisions.restock.croissant),
        ),
      },
    },
    { kind: 'marketingDaily', budget: strategy.marketingDaily },
    { kind: 'daysOpen', weekdays: WEEKDAYS[strategy.daysOpen] },
    { kind: 'ownerWeeklyPay', pay: strategy.ownerWeeklyPay },
  ]
  return changes.filter(({ kind }) => !defi.locked.includes(kind))
}

/**
 * The changes P3-13's owners make (#101): the grid's own values, whatever
 * the Défi opens on (see `strategyChanges`), less the kinds the Défi locks.
 * `npm run balance -- --defis` does not play them; the tests keep them as a
 * check that nothing moves unnoticed.
 */
export function gridOwnerChanges(
  strategy: Strategy,
  defi: Defi,
): DecisionChange[] {
  return strategyChanges(strategy).filter(
    ({ kind }) => !defi.locked.includes(kind),
  )
}

/** How an owner's strategy turns into the changes made in a Défi. */
export type OwnerChanges = (strategy: Strategy, defi: Defi) => DecisionChange[]

function dailyQuantity(
  rule: FoodTruckContent['startingDecisions']['restock']['croissant'],
): number {
  if (rule.kind !== 'buyDaily') {
    throw new RangeError(`Croissants must be bought daily: ${rule.kind}`)
  }
  return rule.quantity
}

/** `opening` × `grid` / `start`, rounded half up, in integers. */
function scaledQuantity(opening: number, grid: number, start: number): number {
  return Math.floor((2 * opening * grid + start) / (2 * start))
}

/** How one game of a Défi ended. */
export interface DefiGame {
  readonly seed: number
  readonly strategy: Strategy
  readonly status: Exclude<ChallengeStatus, 'enCours'>
  readonly medal: Medal | null
  /** Whether a condition broke, which ended the Défi at once. */
  readonly broken: boolean
  /** What the goal measured, up to the day the Défi ended. */
  readonly value: number
  readonly daysPlayed: number
}

/**
 * Plays the Défi `defiId` of `defis` from seed `seed` as a player would:
 * `startChallenge()`, then the owner's changes, by default those of
 * `defiOwnerChanges`, made with `applyDecision()` on the first morning, so
 * they take effect from the second day. Each morning, the card waiting is
 * answered with a choice drawn at random among those the Défi allows (see
 * `allowedChoices`), from a stream seeded from `seed` of its own; then
 * `tick()` plays the day with the shipped event cards, until the Défi is
 * over.
 */
export function playDefi(
  defiId: string,
  seed: number,
  strategy: Strategy,
  defis: DefiContent = DEFIS,
  changes: OwnerChanges = defiOwnerChanges,
): DefiGame {
  const defi = defiById(defis, defiId)
  let state = startChallenge(defiId, seed, FOOD_TRUCK, defis)
  for (const change of changes(strategy, defi)) {
    state = applyDecision(state, change, FOOD_TRUCK, defis)
  }
  let choices = seedRng((seed ^ CHOICE_SALT) >>> 0)
  while (state.challenge?.status === 'enCours') {
    const { pending } = state.events
    if (pending !== null) {
      const card = EVENTS.events.find(({ id }) => id === pending.event)
      if (card === undefined) {
        throw new RangeError(`Unknown event: ${pending.event}`)
      }
      const allowed =
        allowedChoices(state, defis) ?? card.choices.map(({ id }) => id)
      const [index, after] = int(choices, 0, allowed.length - 1)
      choices = after
      state = resolveEvent(
        state,
        allowed[index] ?? '',
        EVENTS,
        FOOD_TRUCK,
        defis,
      )
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      EVENTS,
      defis,
    )
  }
  const { challenge } = state
  if (challenge === null || challenge.status === 'enCours') {
    throw new Error(`The Défi ${defiId} did not start`)
  }
  const { progress, status, medal } = challenge
  return {
    seed,
    strategy,
    status,
    medal,
    broken: failedCondition(progress, defi) !== null,
    value: metricValue(progress, defi.goal.metric),
    daysPlayed: progress.daysPlayed,
  }
}

/**
 * How well `game` did, higher being better: -Infinity for a game that broke
 * a condition, below every game that did not; otherwise what the goal
 * measured, negated where lower is better.
 */
export function score(metric: DefiMetric, game: DefiGame): number {
  if (game.broken) return -Infinity
  return lowerIsBetter(metric) ? -game.value : game.value
}

/** `games`, worst first (see `score`), in seed order when tied. */
export function worstFirst(
  metric: DefiMetric,
  games: readonly DefiGame[],
): DefiGame[] {
  return [...games].sort(
    (a, b) => score(metric, a) - score(metric, b) || a.seed - b.seed,
  )
}

/** A strategy's games, scored for the search. */
interface Scored {
  readonly strategy: Strategy
  /** The lower middle score of its games. */
  readonly median: number
  readonly unbroken: number
}

/**
 * The strategy of `strategies` whose games of the Défi `defiId` on seeds 1
 * to `seeds` did best: the highest median score (see `score`),
 * the lower middle for an even number of games; on a tie, the most games
 * that broke no condition, then the first in `strategies`. Throws a
 * RangeError on no strategies, or unless `seeds` is a whole number from 1.
 */
export function bestStrategy(
  defiId: string,
  seeds: number,
  strategies: readonly Strategy[] = STRATEGIES,
  defis: DefiContent = DEFIS,
): Strategy {
  wholeFromOne('Seeds', seeds)
  const { metric } = defiById(defis, defiId).goal
  let best: Scored | null = null
  for (const strategy of strategies) {
    const games = Array.from({ length: seeds }, (_, index) =>
      playDefi(defiId, index + 1, strategy, defis),
    )
    const sorted = games
      .map((game) => score(metric, game))
      .sort((a, b) => a - b)
    const scored: Scored = {
      strategy,
      median: sorted[Math.floor((sorted.length - 1) / 2)] ?? -Infinity,
      unbroken: games.filter(({ broken }) => !broken).length,
    }
    if (
      best === null ||
      scored.median > best.median ||
      (scored.median === best.median && scored.unbroken > best.unbroken)
    ) {
      best = scored
    }
  }
  if (best === null) throw new RangeError('No strategy to search')
  return best.strategy
}

/** One Défi of a `--defis` run. */
export interface DefiRun {
  readonly defi: string
  /** Seed n's owner holds `ownerStrategy(n)`, seeds 1 to `games`. */
  readonly owners: readonly DefiGame[]
  /** The strategy `bestStrategy()` found, and its games on the same seeds. */
  readonly best: {
    readonly strategy: Strategy
    readonly games: readonly DefiGame[]
  }
}

/**
 * Plays the Défi `defi` on seeds 1 to `games`, each by the owner of the
 * seed (see `ownerStrategy`), then searches `strategies` for the best on
 * seeds 1 to `search` (see `bestStrategy`) and plays it on seeds 1 to
 * `games`. Throws a RangeError unless `games` and `search` are whole
 * numbers from 1.
 */
export function runDefi({
  defi,
  games,
  search,
  strategies = STRATEGIES,
  defis = DEFIS,
}: {
  readonly defi: string
  readonly games: number
  readonly search: number
  readonly strategies?: readonly Strategy[]
  readonly defis?: DefiContent
}): DefiRun {
  wholeFromOne('Games', games)
  wholeFromOne('Search', search)
  const seeds = Array.from({ length: games }, (_, index) => index + 1)
  const strategy = bestStrategy(defi, search, strategies, defis)
  return {
    defi,
    owners: seeds.map((seed) =>
      playDefi(defi, seed, ownerStrategy(seed), defis),
    ),
    best: {
      strategy,
      games: seeds.map((seed) => playDefi(defi, seed, strategy, defis)),
    },
  }
}

/** How many games of a Défi broke a condition, and won each medal or better. */
export interface MedalCounts {
  readonly games: number
  readonly broken: number
  readonly or: number
  readonly argentOrBetter: number
  readonly bronzeOrBetter: number
}

export function medalCounts(games: readonly DefiGame[]): MedalCounts {
  const count = (medals: readonly Medal[]) =>
    games.filter(({ medal }) => medal !== null && medals.includes(medal)).length
  return {
    games: games.length,
    broken: games.filter(({ broken }) => broken).length,
    or: count(['or']),
    argentOrBetter: count(['or', 'argent']),
    bronzeOrBetter: count(['or', 'argent', 'bronze']),
  }
}

/** Each target of `DEFI_TARGETS` a Défi's run meets. */
export interface DefiTargetCheck {
  readonly owners: MedalCounts
  readonly best: MedalCounts
  readonly or: boolean
  readonly argent: boolean
  readonly bronze: boolean
  readonly bestOr: boolean
  readonly met: boolean
}

/** Checks `run` against `DEFI_TARGETS`, in whole counts so it is exact. */
export function defiTarget(run: DefiRun): DefiTargetCheck {
  const owners = medalCounts(run.owners)
  const best = medalCounts(run.best.games)
  const within = (count: number, from: number, to: number) =>
    100 * count >= from * owners.games && 100 * count <= to * owners.games
  const t = DEFI_TARGETS
  const or = 100 * owners.or < t.orBelow * owners.games
  const argent = within(owners.argentOrBetter, t.argentFrom, t.argentTo)
  const bronze = within(owners.bronzeOrBetter, t.bronzeFrom, t.bronzeTo)
  const bestOr = 100 * best.or >= t.bestOrFrom * best.games
  return {
    owners,
    best,
    or,
    argent,
    bronze,
    bestOr,
    met: or && argent && bronze && bestOr,
  }
}

/** Whether `metric` counts whole cents or customers. */
function isWhole(metric: DefiMetric): boolean {
  return metric !== 'spoilageRate' && metric !== 'lowestEnergy'
}

/**
 * The `percentile`th percentile of `sorted`, values in increasing order:
 * linear between the closest ranks (type 7, as `quantileCents`), rounded
 * half away from zero to whole cents or customers, or to 4 decimals for a
 * share or an energy. Throws a RangeError on no values.
 */
export function quantile(
  metric: DefiMetric,
  sorted: readonly number[],
  percentile: number,
): number {
  if (isWhole(metric)) return quantileCents(sorted, percentile)
  if (sorted.length === 0) throw new RangeError('No values')
  const rank = ((sorted.length - 1) * percentile) / 100
  const below = Math.floor(rank)
  const low = sorted[below] ?? 0
  const high = sorted[below + 1] ?? low
  return fourDecimals(low + (rank - below) * (high - low))
}

/** `value` rounded to 4 decimals, as the files hold shares. */
export function fourDecimals(value: number): number {
  return Math.round(value * 10_000) / 10_000 || 0
}

/**
 * What the goal measured in the games that broke no condition, at each of
 * `percentiles`, in increasing order of the value whichever is better (see
 * `quantile`); null when every game broke one.
 */
export function finishedPercentiles(
  metric: DefiMetric,
  games: readonly DefiGame[],
  percentiles: readonly number[] = PERCENTILES,
): number[] | null {
  const sorted = games
    .filter(({ broken }) => !broken)
    .map(({ value }) => value)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return null
  return percentiles.map((percentile) => quantile(metric, sorted, percentile))
}

/**
 * The outcome at the `percentile`th percentile of `games`, counted from the
 * worst game, those that broke a condition first (see `quantile`): what the
 * goal measured. Null when that rank falls among the broken games.
 */
export function outcomeAt(
  metric: DefiMetric,
  games: readonly DefiGame[],
  percentile: number,
): number | null {
  const ranked = worstFirst(metric, games).map((game) => score(metric, game))
  const low = ranked[Math.floor(((ranked.length - 1) * percentile) / 100)]
  // Broken games come first, so every game above a finished one finished.
  if (low === undefined || low === -Infinity) return null
  const value = quantile(metric, ranked, percentile)
  return lowerIsBetter(metric) ? 0 - value : value
}

/**
 * The thresholds the owners' games suggest: for each medal, the outcome at
 * its percentile of `SUGGESTED_PERCENTILES` (see `outcomeAt`).
 */
export function suggestedThresholds(
  metric: DefiMetric,
  games: readonly DefiGame[],
): Record<Medal, number | null> {
  return {
    or: outcomeAt(metric, games, SUGGESTED_PERCENTILES.or),
    argent: outcomeAt(metric, games, SUGGESTED_PERCENTILES.argent),
    bronze: outcomeAt(metric, games, SUGGESTED_PERCENTILES.bronze),
  }
}

function wholeFromOne(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a whole number from 1: ${value}`)
  }
}
