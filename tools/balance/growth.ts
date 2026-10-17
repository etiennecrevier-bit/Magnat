import {
  grocerIdSchema,
  type DifficultyId,
  type EventCard,
  type EventContent,
  type GrocerContent,
  type GrocerId,
} from '../../src/content/schema.ts'
import { endOfMonth } from '../../src/engine/calendar.ts'
import { GROCERS, startContract } from '../../src/engine/contracts.ts'
import { EVENTS, FOOD_TRUCK } from '../../src/engine/day.ts'
import { applyDecision } from '../../src/engine/decisions.ts'
import { cashNeeded, isPersonal, nextRung } from '../../src/engine/dream.ts'
import { FINANCING } from '../../src/engine/financing.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { netWorth } from '../../src/engine/netWorth.ts'
import type { Day, GameState } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import type { Journal } from '../../src/finance/journal.ts'
import {
  contractChooser,
  financingChoices,
  financingChooser,
  isFinancingCard,
  playMorning,
  startGame,
  withFinancingCards,
  type FinancingPolicy,
} from '../sim/simulate.ts'
import {
  AT_TRUCK_HIRE,
  RENEWALS_ONLY,
  monthEnds,
  openingChanges,
} from './bakery.ts'
import { strategyChanges, type Strategy } from './strategies.ts'

// The growth run of phase 4, `npm run balance -- --growth` (#166): the
// best truck of the phase-2 grid grows with the grocers' contracts, the
// bakery, an employee at the truck and « Le rêve », and runs out of cash
// or not, at every difficulty. Each game plays two years and records what
// #166's targets read: the owner's net worth, the closes below zero, the
// emergency financing taken and the bankruptcies. The axes below are the
// test grid of #166, not tunables of the game. No I/O: growthReport.ts
// writes the report and cli.ts the file.

const CASH: AccountCode = '1000'

/**
 * The truck every game runs: the best of the phase-2 grid at every
 * difficulty (docs/balance/phase-2.md), base prices, 70 croissants a day,
 * $30 of marketing a day, open 6 days a week, the owner paid $700 a week.
 */
export const BASE_TRUCK: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(3_000),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}

/**
 * Which grocers' contracts a game signs: none; the smallest grocer's; the
 * two smallest at once; all three at once, the naive growth of #166; or
 * all three in a `careful` chain (see `carefulSigning`).
 */
export type ContractPlan = 'none' | 'one' | 'two' | 'three' | 'careful'

export const CONTRACT_PLANS: readonly ContractPlan[] = [
  'none',
  'one',
  'two',
  'three',
  'careful',
]

/**
 * When a game opens the bakery: never, on day 0, or on the 1st of its
 * fourth month.
 */
export type BakeryOpening = 'never' | 'day0' | 'month4'

export const BAKERY_OPENINGS: readonly BakeryOpening[] = [
  'never',
  'day0',
  'month4',
]

/** One way to grow the truck over a whole game. */
export interface GrowthStrategy {
  readonly contracts: ContractPlan
  readonly bakery: BakeryOpening
  /** Whether an employee at the truck is hired on day 0. */
  readonly atTruck: boolean
  /** Whether « Le rêve »'s rungs are bought as soon as affordable. */
  readonly dream: boolean
  /** How the cards of the emergency financing are answered (#159). */
  readonly financing: FinancingPolicy
}

/**
 * Every combination of the axes, contracts first and the financing last:
 * 5 × 3 × 2 × 2 × 2 = 120 strategies.
 */
export const GROWTH_STRATEGIES: readonly GrowthStrategy[] =
  CONTRACT_PLANS.flatMap((contracts) =>
    BAKERY_OPENINGS.flatMap((bakery) =>
      [false, true].flatMap((atTruck) =>
        [false, true].flatMap((dream) =>
          (['accept', 'refuse'] as const).map((financing): GrowthStrategy => ({
            contracts,
            bakery,
            atTruck,
            dream,
            financing,
          })),
        ),
      ),
    ),
  )

/** `strategy` in a few words, for the report and the tests. */
export function strategyLabel({
  contracts,
  bakery,
  atTruck,
  dream,
  financing,
}: GrowthStrategy): string {
  return [
    `contracts ${contracts}`,
    `bakery ${bakery}`,
    atTruck ? 'employee' : 'no employee',
    dream ? 'dream' : 'no dream',
    `financing ${financing}`,
  ].join(', ')
}

/** The grocers, the one with the fewest croissants a week first. */
export function grocersBySize(
  grocers: GrocerContent = GROCERS,
): readonly GrocerId[] {
  return [...grocerIdSchema.options].sort(
    (a, b) => grocers.grocers[a].unitsPerWeek - grocers.grocers[b].unitsPerWeek,
  )
}

/** The grocers `plan` signs, in the order it signs them. */
export function plannedGrocers(
  plan: ContractPlan,
  grocers: GrocerContent = GROCERS,
): readonly GrocerId[] {
  const bySize = grocersBySize(grocers)
  switch (plan) {
    case 'none':
      return []
    case 'one':
      return bySize.slice(0, 1)
    case 'two':
      return bySize.slice(0, 2)
    case 'three':
    case 'careful':
      return bySize
  }
}

/**
 * The first day a grocer may offer a contract: the earliest `fromDay` of
 * the grocers' offer cards of `events`, 0 for a card without one. Throws a
 * RangeError when `events` has no offer card.
 */
export function signingDay(events: EventContent = EVENTS): Day {
  const days = events.events
    .filter(({ conditions }) => conditions?.grocer !== undefined)
    .map(({ conditions }) => conditions?.fromDay ?? 0)
  if (days.length === 0) throw new RangeError('No grocer offers a contract')
  return Math.min(...days)
}

/**
 * The cash the careful chain keeps before it signs with `grocer`: the
 * croissants of a week's delivery at the truck's buying price, once for each
 * week the first payment takes, rounded up, and once more.
 */
export function contractReserve(
  grocer: GrocerId,
  grocers: GrocerContent = GROCERS,
): Cents {
  const { unitsPerWeek, paymentDays } = grocers.grocers[grocer]
  const { unitCostCents } = FOOD_TRUCK.products.croissant
  return cents(unitsPerWeek * unitCostCents * (Math.ceil(paymentDays / 7) + 1))
}

/**
 * The grocer the careful chain signs with on the morning of `state.day`,
 * after those of `signed`; null when it waits or has signed them all. It
 * signs the next one of `plannedGrocers('careful')` once the last one it
 * signed was paid for a first delivery, before that morning, and `cash`,
 * the morning's Encaisse, covers the next one's `contractReserve`. The
 * first one waits for the reserve only.
 */
export function carefulSigning(
  state: Pick<GameState, 'day' | 'contracts'>,
  signed: readonly GrocerId[],
  cash: Cents,
  grocers: GrocerContent = GROCERS,
): GrocerId | null {
  const next = plannedGrocers('careful', grocers)[signed.length]
  if (next === undefined) return null
  const last = signed.at(-1)
  const paid =
    last === undefined ||
    state.contracts.deliveries.some(
      ({ grocer, dueDay }) => grocer === last && dueDay < state.day,
    )
  return paid && cash >= contractReserve(next, grocers) ? next : null
}

/**
 * Answers the financing's cards as `loanOnly` has them: takes Mme
 * Prudhomme's emergency loan and refuses Max Duvent's shares. Every other
 * card goes to `fallback`, as in `financingChooser`.
 */
export function loanOnlyChooser(
  fallback: ((event: EventCard) => string) | null,
): (event: EventCard) => string {
  const either = financingChooser('accept', fallback)
  return (card) =>
    card.id === FINANCING.investorEvent && isFinancingCard(card)
      ? financingChoices(card).refuse
      : either(card)
}

/** The content a growth game plays: the renewals and the financing. */
export const GROWTH_EVENTS: EventContent = withFinancingCards(RENEWALS_ONLY)

/** A contract the chain or the plan signed, and the morning it did. */
export interface Signing {
  readonly grocer: GrocerId
  readonly day: Day
}

/** One game, as the report reads it. */
export interface GrowthGame {
  readonly seed: number
  /**
   * The owner's net worth at the close of each month's last day, for the
   * months the game played to their end, the one that ended it included.
   */
  readonly netWorthAtMonthEnds: readonly Cents[]
  /**
   * The owner's net worth at the close of the last month's last day, or of
   * the day that ended the game.
   */
  readonly netWorthAtEnd: Cents
  /** The first close with Encaisse below zero; null when none was. */
  readonly firstDayBelowZero: Day | null
  /** The lowest Encaisse at a close. */
  readonly lowestClose: Cents
  /** Emergency loans taken (#159). */
  readonly emergencyLoans: number
  /** Rounds of shares sold (#159). */
  readonly shareSales: number
  /** Whether Max Duvent's card came up. */
  readonly duventCame: boolean
  /** The day whose close ended the game in bankruptcy (#160); null if none. */
  readonly endedDay: Day | null
  /** Whether the owner became « Magnat » (#162). */
  readonly magnat: boolean
  /** Rungs of « Le rêve » bought. */
  readonly rungsBought: number
  /** The contracts signed, in order; renewals are not signings. */
  readonly signings: readonly Signing[]
  /**
   * The same seed and strategy with Max Duvent refused and Mme Prudhomme
   * accepted, for a game that accepted him (see `duventWorth`); null for
   * any other game.
   */
  readonly withoutDuvent: DuventTwin | null
}

/** What the twin of a game that took Max Duvent's money did. */
export interface DuventTwin {
  readonly endedDay: Day | null
  readonly netWorthAtEnd: Cents
}

/** One strategy's games at one difficulty, seed 1 first. */
export interface GrowthStrategyRun {
  readonly strategy: GrowthStrategy
  readonly games: readonly GrowthGame[]
}

/** What one worker plays for `--growth`: a difficulty and a contract plan. */
export interface GrowthJob {
  readonly kind: 'growth'
  readonly difficulty: DifficultyId
  readonly contracts: ContractPlan
  readonly games: number
  readonly months: number
}

/** What a growth job played. */
export interface GrowthRun {
  readonly difficulty: DifficultyId
  readonly contracts: ContractPlan
  readonly games: number
  readonly months: number
  /** The job's strategies, in the order of `GROWTH_STRATEGIES`. */
  readonly strategies: readonly GrowthStrategyRun[]
}

/** How a growth game answers the financing's cards. */
export type GrowthChooser = FinancingPolicy | 'loanOnly'

/**
 * Encaisse kept up to date entry by entry: the books only grow, so each
 * read adds the entries posted since the last.
 */
function cashBook(): (journal: Journal) => Cents {
  let cash = 0
  let read = 0
  return (journal) => {
    const { entries } = journal
    for (; read < entries.length; read += 1) {
      for (const { account, debit, credit } of entries[read]?.lines ?? []) {
        if (account === CASH) cash += debit - credit
      }
    }
    return cents(cash)
  }
}

/**
 * Plays seed `seed` at `difficulty` with `strategy` to the close of the last
 * day of its `months`th month, or to the close that ends it in bankruptcy,
 * and sums it up. Every game runs `BASE_TRUCK`, with the employee at the
 * truck hired on day 0 when the strategy has one, and the bakery opened on
 * day 0, in effect that day, or on the morning of the 1st of the fourth
 * month through `applyDecision`, in effect the next morning: a leased oven,
 * the truck's croissants made there, and a baker hired. Each morning, before
 * the day is played, the game first signs the contracts of its plan:
 * every one of them on `signingDay()`, or the careful chain's next one (see
 * `carefulSigning`). Then, with `strategy.dream`, it buys the next rung of
 * the personal ladder when the owner's cash covers what it needs, then the
 * next rung of the company's when Encaisse does; a rung coming soon is not
 * for sale. Only the renewals and the financing's cards come up: each
 * renewal is accepted, and the financing answered by `chooser`, by default
 * the strategy's. Returns the last state too, for the tests.
 */
export function playGrowthGame(
  seed: number,
  difficulty: DifficultyId,
  strategy: GrowthStrategy,
  months: number,
  chooser: GrowthChooser = strategy.financing,
): { game: GrowthGame; state: GameState } {
  const ends = monthEnds(months)
  const lastDay = ends.at(-1) ?? 0
  const opening = openingChanges(BASE_TRUCK.croissantsPerDay, 'louer')
  let state = startGame(seed, difficulty, [
    ...strategyChanges(BASE_TRUCK),
    ...(strategy.atTruck ? [AT_TRUCK_HIRE] : []),
    ...(strategy.bakery === 'day0' ? opening : []),
  ])
  const bakeryDay = strategy.bakery === 'month4' ? endOfMonth(0, 2) + 1 : null
  const planned = plannedGrocers(strategy.contracts)
  const firstSigning = signingDay()
  const renewals = contractChooser('all', null)
  const choose =
    chooser === 'loanOnly'
      ? loanOnlyChooser(renewals)
      : financingChooser(chooser, renewals)
  const cashOf = cashBook()
  const signings: Signing[] = []
  const netWorthAtMonthEnds: Cents[] = []
  let firstDayBelowZero: Day | null = null
  let lowestClose: Cents | null = null
  for (let day = 0; day <= lastDay && state.ended === null; day += 1) {
    if (day === bakeryDay) {
      state = opening.reduce(
        (decided, change) => applyDecision(decided, change),
        state,
      )
    }
    state = signContracts(state, strategy.contracts, planned, firstSigning, {
      signings,
      cash: cashOf(state.journal),
    })
    if (strategy.dream) state = buyRungs(state, cashOf)
    state = playMorning(state, GROWTH_EVENTS, choose)
    const close = cashOf(state.journal)
    if (lowestClose === null || close < lowestClose) lowestClose = close
    if (close < 0 && firstDayBelowZero === null) firstDayBelowZero = day
    if (day === ends[netWorthAtMonthEnds.length]) {
      netWorthAtMonthEnds.push(netWorth(state))
    }
  }
  return {
    game: {
      seed,
      netWorthAtMonthEnds,
      netWorthAtEnd: netWorth(state),
      firstDayBelowZero,
      lowestClose: lowestClose ?? cashOf(state.journal),
      emergencyLoans: state.financing.loans.length,
      shareSales: state.financing.shareSales.length,
      duventCame: state.events.history.some(
        ({ event }) => event === FINANCING.investorEvent,
      ),
      endedDay: state.ended?.day ?? null,
      magnat: state.dream.magnatOn !== null,
      rungsBought: state.dream.bought.length,
      signings,
      withoutDuvent: null,
    },
    state,
  }
}

/**
 * `state` with the contracts `plan` signs on its morning, each added to
 * `signings`: every grocer of `planned` on `firstSigning`, or the careful
 * chain's next one from that day on, with `cash` the morning's Encaisse.
 */
function signContracts(
  state: GameState,
  plan: ContractPlan,
  planned: readonly GrocerId[],
  firstSigning: Day,
  { signings, cash }: { signings: Signing[]; cash: Cents },
): GameState {
  const { day } = state
  if (day < firstSigning) return state
  const grocers =
    plan === 'careful'
      ? [
          carefulSigning(
            state,
            signings.map(({ grocer }) => grocer),
            cash,
          ),
        ].filter((grocer) => grocer !== null)
      : day === firstSigning
        ? planned
        : []
  if (grocers.length === 0) return state
  for (const grocer of grocers) signings.push({ grocer, day })
  return {
    ...state,
    contracts: grocers.reduce(
      (contracts, grocer) => startContract(contracts, day, grocer),
      state.contracts,
    ),
  }
}

/**
 * `state` with the next personal rung bought if the owner's cash covers
 * what it needs, then the next company rung if Encaisse, read by
 * `cashOf`, does. A rung coming soon is not for sale.
 */
function buyRungs(
  state: GameState,
  cashOf: (journal: Journal) => Cents,
): GameState {
  let bought = state
  for (const ladder of ['personal', 'company'] as const) {
    const rung = nextRung(bought.dream, ladder)
    if (rung === null || rung.comingSoon === true) continue
    const held = isPersonal(rung)
      ? bought.personal.cash
      : cashOf(bought.journal)
    if (held >= cashNeeded(rung)) {
      bought = applyDecision(bought, { kind: 'buy', rung: rung.id })
    }
  }
  return bought
}

/**
 * Whether taking Max Duvent's money was worth it in `game`, against its
 * twin that refused him: it avoided a bankruptcy the twin had, or, both
 * ended alike, it ends with the higher net worth. Null when the game did
 * not take it.
 */
export function duventWorth(game: GrowthGame): boolean | null {
  const twin = game.withoutDuvent
  if (twin === null) return null
  const bankrupt = game.endedDay !== null
  const twinBankrupt = twin.endedDay !== null
  if (bankrupt !== twinBankrupt) return twinBankrupt
  return game.netWorthAtEnd > twin.netWorthAtEnd
}

/**
 * Plays `job`: each strategy of its contract plan, in the order of
 * `GROWTH_STRATEGIES`, on seeds 1 to `games`. A game that accepts the
 * financing and sees Max Duvent's card plays again with the same seed and
 * strategy, his offer refused (see `loanOnlyChooser`), and keeps that twin.
 */
export function runGrowth({
  difficulty,
  contracts,
  games,
  months,
}: GrowthJob): GrowthRun {
  const seeds = Array.from({ length: games }, (_, index) => index + 1)
  const strategies = GROWTH_STRATEGIES.filter(
    (strategy) => strategy.contracts === contracts,
  ).map((strategy): GrowthStrategyRun => ({
    strategy,
    games: seeds.map((seed) => {
      const { game } = playGrowthGame(seed, difficulty, strategy, months)
      if (strategy.financing !== 'accept' || !game.duventCame) return game
      const twin = playGrowthGame(
        seed,
        difficulty,
        strategy,
        months,
        'loanOnly',
      ).game
      return {
        ...game,
        withoutDuvent: {
          endedDay: twin.endedDay,
          netWorthAtEnd: twin.netWorthAtEnd,
        },
      }
    }),
  }))
  return { difficulty, contracts, games, months, strategies }
}

/** The month of the game, counting from 1, that `day` falls in. */
export function monthOf(day: Day): number {
  let month = 1
  while (endOfMonth(0, month - 1) < day) month += 1
  return month
}
