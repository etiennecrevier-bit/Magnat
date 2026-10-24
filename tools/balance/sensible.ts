import type {
  DifficultyId,
  EventCard,
  EventContent,
  GrocerId,
} from '../../src/content/schema.ts'
import { endOfMonth } from '../../src/engine/calendar.ts'
import { startContract } from '../../src/engine/contracts.ts'
import { EVENTS, FOOD_TRUCK } from '../../src/engine/day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from '../../src/engine/decisions.ts'
import { FINANCING } from '../../src/engine/financing.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { netWorth } from '../../src/engine/netWorth.ts'
import { keyedDraw } from '../../src/engine/rng.ts'
import type { Day, GameState } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import {
  contractChoices,
  financingChoices,
  grocerOf,
  isFinancingCard,
  playMorning,
  startGame,
} from '../sim/simulate.ts'
import { monthEnds } from './bakery.ts'
import {
  BASE_TRUCK,
  buyRungs,
  carefulSigning,
  grocersBySize,
  isLetter,
  type GrowthChooser,
  type Signing,
} from './growth.ts'
import { strategyChanges } from './strategies.ts'

// The sensible player of #298, next to #166's growth grid: the starting
// prices, a croissant restock that covers yesterday's demand and a margin,
// $30 of marketing a day, at most one grocer before month 2 and the
// emergency financing accepted. Its games run every event card of the
// content, Mme Prudhomme's letters included, and can be stopped on any
// morning and played on from there in several ways (see `Player`), which
// the lever check of audit.ts does. The numbers below are the policy of
// #298's definitions, not tunables of the game. No I/O.

const CASH: AccountCode = '1000'

/** How much more than yesterday's demand the croissant restock buys. */
export const RESTOCK_MARGIN = 1.15

/** Mixed into a game's seed so the answers draw from keys of their own. */
const ANSWER_SALT = 0x2980_0a5e

/**
 * How the cards no rule below answers are: a `random` choice, drawn from
 * the seed and the day alone so that a game played on from any morning
 * answers as it would have, or always the `first`.
 */
export type Answers = 'random' | 'first'

/**
 * How a game answers the grocers' offers: the `careful` chain's next
 * grocer only (see `carefulSigning`), and no second one before month 2;
 * `none`; or `all` of them.
 */
export type Offers = 'careful' | 'none' | 'all'

/** How a game plays from one morning on. */
export interface Policy {
  readonly answers: Answers
  readonly offers: Offers
  /** Whether the grocers' renewals are accepted. */
  readonly renewals: boolean
  readonly financing: GrowthChooser
  /**
   * Each morning, croissants for yesterday's demand (sold and asked for
   * after they sold out) times this margin, rounded up, from the last day
   * the truck opened: bought, or made at the bakery when they are made
   * there. Null keeps the rule as decided.
   */
  readonly restockMargin: number | null
  /** Whether « Le rêve »'s rungs are bought as soon as affordable. */
  readonly dream: boolean
  /** The morning every grocer signs at once, without a card; null if none. */
  readonly signAllOn: Day | null
}

/** The sensible policy of #298, answering the other cards by `answers`. */
export function sensiblePolicy(answers: Answers = 'random'): Policy {
  return {
    answers,
    offers: 'careful',
    renewals: true,
    financing: 'accept',
    restockMargin: RESTOCK_MARGIN,
    dream: false,
    signAllOn: null,
  }
}

/**
 * The starting decisions the sensible policy changes: `BASE_TRUCK`, the
 * starting prices, 70 croissants on day 0, $30 of marketing a day, open 6
 * days a week and the owner paid $700 a week.
 */
export function sensibleChanges(): DecisionChange[] {
  return strategyChanges(BASE_TRUCK)
}

/** The content a sensible game plays: every card, the letters included. */
export const SENSIBLE_EVENTS: EventContent = EVENTS

/**
 * What a game remembers outside the engine's state, as plain data, so a
 * game stopped on a morning plays on from a copy.
 */
export interface Memory {
  readonly seed: number
  readonly difficulty: DifficultyId
  /** Encaisse at the last close, read from the books' first `read` entries. */
  readonly cash: Cents
  readonly read: number
  /** Croissants asked for on the last day the truck opened. */
  readonly lastDemand: number | null
  readonly firstDayBelowZero: Day | null
  readonly lowestClose: Cents | null
  /** The contracts signed, in order; renewals are not signings. */
  readonly signings: readonly Signing[]
}

/** A game on a morning, ready to play on. */
export interface Player {
  readonly state: GameState
  readonly memory: Memory
}

/**
 * A new game from `seed` at `difficulty` on the morning of day 0, with
 * `changes`, by default the sensible ones, in effect that day.
 */
export function startPlayer(
  seed: number,
  difficulty: DifficultyId,
  changes: readonly DecisionChange[] = sensibleChanges(),
): Player {
  const state = startGame(seed, difficulty, changes)
  return {
    state,
    memory: {
      seed,
      difficulty,
      cash: cents(0),
      read: 0,
      lastDemand: null,
      firstDayBelowZero: null,
      lowestClose: null,
      signings: [],
    },
  }
}

/** Encaisse at the close, `memory` brought up to the books of `state`. */
function readCash(
  state: GameState,
  memory: Memory,
): { cash: Cents; read: number } {
  const { entries } = state.journal
  let cash: number = memory.cash
  let read = memory.read
  for (; read < entries.length; read += 1) {
    for (const { account, debit, credit } of entries[read]?.lines ?? []) {
      if (account === CASH) cash += debit - credit
    }
  }
  return { cash: cents(cash), read }
}

/** The index of the answer `answers` gives a card of `count` choices. */
export function answerIndex(
  answers: Answers,
  seed: number,
  day: Day,
  count: number,
): number {
  if (answers === 'first') return 0
  const draw = keyedDraw(seed >>> 0, [day, ANSWER_SALT])
  return Math.min(count - 1, Math.floor(draw * count))
}

/** The first day of month 2, before which `careful` signs one grocer. */
const MONTH_2 = endOfMonth(0, 0) + 1

/**
 * The choice `policy` makes on `card`, the morning of `player`: a letter's
 * only one; the financing's by `policy.financing`; a grocer's offer or
 * renewal by `policy.offers` and `policy.renewals`; any other drawn by
 * `policy.answers`. Returns the grocer signed too, if any.
 */
export function choiceOf(
  card: EventCard,
  player: Player,
  policy: Policy,
): { choice: string; signs: GrocerId | null } {
  const { state, memory } = player
  if (isLetter(card)) {
    const [only] = card.choices
    if (only === undefined) throw new RangeError(`${card.id} has no choice`)
    return { choice: only.id, signs: null }
  }
  if (isFinancingCard(card)) {
    const { accept, refuse } = financingChoices(card)
    const takes =
      policy.financing === 'accept' ||
      (policy.financing === 'loanOnly' && card.id === FINANCING.loanEvent)
    return { choice: takes ? accept : refuse, signs: null }
  }
  const grocer = grocerOf(card)
  if (grocer !== null) {
    const { accept, refuse } = contractChoices(card)
    const offer = card.conditions?.grocer !== undefined
    if (!offer) {
      return { choice: policy.renewals ? accept : refuse, signs: null }
    }
    const signed = memory.signings.map((each) => each.grocer)
    const signs =
      policy.offers === 'all' ||
      (policy.offers === 'careful' &&
        (state.day >= MONTH_2 || signed.length === 0) &&
        carefulSigning(state, signed, memory.cash) === grocer)
    return signs
      ? { choice: accept, signs: grocer }
      : { choice: refuse, signs: null }
  }
  const index = answerIndex(
    policy.answers,
    memory.seed,
    state.day,
    card.choices.length,
  )
  const choice = card.choices[index]
  if (choice === undefined) throw new RangeError(`${card.id} has no choice`)
  return { choice: choice.id, signs: null }
}

/**
 * What a game decides on a morning by a script of its own, before
 * `policy`'s decisions: the morning's state, changed or as it is.
 */
export type Script = (player: Player) => GameState

/** No change. */
export const NO_SCRIPT: Script = ({ state }) => state

/** A script that makes `changes`, in order, on the morning of `day`. */
export function changesOn(
  day: Day,
  changes: readonly DecisionChange[],
): Script {
  return ({ state }) =>
    state.day === day
      ? changes.reduce(
          (decided, change) => applyDecision(decided, change),
          state,
        )
      : state
}

/**
 * Plays `player` with `policy`, on `content`, to the close of `lastDay`,
 * or to the close that ends the game. Each morning, before the day is
 * played: what `script` decides; every grocer
 * signed on `policy.signAllOn`; the rungs bought with `policy.dream`; the
 * croissants of yesterday's demand decided with `policy.restockMargin`, in
 * effect the next morning, as a player's are. Then the morning's card, if
 * any, is answered (see `choiceOf`) and the day played.
 */
export function playUntil(
  player: Player,
  policy: Policy,
  lastDay: Day,
  content: EventContent = SENSIBLE_EVENTS,
  script: Script = NO_SCRIPT,
): Player {
  let { state, memory } = player
  while (state.day <= lastDay && state.ended === null) {
    const { day } = state
    state = script({ state, memory })
    if (policy.signAllOn === day) {
      const grocers = grocersBySize()
      state = {
        ...state,
        contracts: grocers.reduce(
          (contracts, grocer) => startContract(contracts, day, grocer),
          state.contracts,
        ),
      }
      memory = {
        ...memory,
        signings: [
          ...memory.signings,
          ...grocers.map((grocer) => ({ grocer, day })),
        ],
      }
    }
    if (policy.dream) {
      const cash = memory.cash
      state = buyRungs(state, () => cash)
    }
    if (policy.restockMargin !== null && memory.lastDemand !== null) {
      state = restocked(state, memory.lastDemand, policy.restockMargin)
    }
    let signs: GrocerId | null = null
    const morning = { state, memory }
    state = playMorning(state, content, (card) => {
      const made = choiceOf(card, morning, policy)
      signs = made.signs
      return made.choice
    })
    const signed: GrocerId | null = signs
    const { cash, read } = readCash(state, memory)
    const summary = state.lastDay
    const asked =
      summary === null || summary.day !== day
        ? null
        : summary.sold.croissant + summary.lostSales.croissant
    const opened =
      summary !== null && summary.day === day && summary.visits.length > 0
    memory = {
      ...memory,
      cash,
      read,
      lastDemand: opened && asked !== null ? asked : memory.lastDemand,
      firstDayBelowZero: memory.firstDayBelowZero ?? (cash < 0 ? day : null),
      lowestClose:
        memory.lowestClose === null || cash < memory.lowestClose
          ? cash
          : memory.lowestClose,
      signings:
        signed === null
          ? memory.signings
          : [...memory.signings, { grocer: signed, day }],
    }
  }
  return { state, memory }
}

/**
 * `state` with the croissants for `demand` times `margin`, rounded up and
 * within the content's limits, decided: bought, or made at the bakery when
 * the latest decisions make them there. `state` itself when the latest
 * rule is that already.
 */
export function restocked(
  state: GameState,
  demand: number,
  margin: number,
): GameState {
  const { min, max } = FOOD_TRUCK.decisionLimits.units
  const quantity = Math.min(
    max,
    Math.max(min, Math.ceil(demand * margin - 1e-9)),
  )
  const latest = latestDecisions(state)
  const bakes = latest.bakery !== null && latest.croissantSource === 'fabriquer'
  const rule = bakes ? latest.bake : latest.restock.croissant
  if (rule.kind === 'buyDaily' && rule.quantity === quantity) return state
  const next = { kind: 'buyDaily', quantity } as const
  return applyDecision(
    state,
    bakes
      ? { kind: 'bake', rule: next }
      : { kind: 'restock', product: 'croissant', rule: next },
  )
}

/** Mme Prudhomme's letters, in the order they come (#160). */
export const LETTERS: readonly string[] = FINANCING.bankruptcy.notices.map(
  ({ event }) => event,
)

/**
 * Whether `state`, if it ended, had a close below zero, on
 * `firstDayBelowZero`, and each of Mme Prudhomme's letters on a morning
 * before its end (#298's definition 7); true for a game that did not end.
 */
export function warnedBefore(
  state: GameState,
  firstDayBelowZero: Day | null,
): boolean {
  if (state.ended === null) return true
  const end = state.ended.day
  if (firstDayBelowZero === null || firstDayBelowZero > end) return false
  return LETTERS.every((letter) =>
    state.events.history.some(
      ({ event, day }) => event === letter && day <= end,
    ),
  )
}

/** One sensible game, as the audit reads it. */
export interface SensibleGame {
  readonly seed: number
  readonly difficulty: DifficultyId
  /** The day whose close ended the game in bankruptcy; null if none. */
  readonly endedDay: Day | null
  readonly netWorthAtEnd: Cents
  readonly firstDayBelowZero: Day | null
  readonly lowestClose: Cents
  /** Mme Prudhomme's letters received, each with its morning, in order. */
  readonly letters: readonly { readonly event: string; readonly day: Day }[]
  readonly emergencyLoans: number
  readonly shareSales: number
  readonly signings: readonly Signing[]
  /** See `warnedBefore`. */
  readonly warned: boolean
}

/** `player` summed up. */
export function summarize(player: Player): SensibleGame {
  const { state, memory } = player
  const letters = new Set(LETTERS)
  return {
    seed: memory.seed,
    difficulty: memory.difficulty,
    endedDay: state.ended?.day ?? null,
    netWorthAtEnd: netWorth(state),
    firstDayBelowZero: memory.firstDayBelowZero,
    lowestClose: memory.lowestClose ?? memory.cash,
    letters: state.events.history
      .filter(({ event }) => letters.has(event))
      .map(({ event, day }) => ({ event, day })),
    emergencyLoans: state.financing.loans.length,
    shareSales: state.financing.shareSales.length,
    signings: memory.signings,
    warned: warnedBefore(state, memory.firstDayBelowZero),
  }
}

/** The last day of a game of `months` months: its last month's last. */
export function lastDayOf(months: number): Day {
  const last = monthEnds(months).at(-1)
  if (last === undefined) throw new RangeError(`No month to play: ${months}`)
  return last
}

/**
 * Plays seed `seed` at `difficulty` with the sensible policy, the other
 * cards answered by `answers`, to the close of its `months`th month's last
 * day, and sums it up. Returns the last state too, for the tests.
 */
export function playSensibleGame(
  seed: number,
  difficulty: DifficultyId,
  months: number,
  answers: Answers = 'random',
): { game: SensibleGame; player: Player } {
  const player = playUntil(
    startPlayer(seed, difficulty),
    sensiblePolicy(answers),
    lastDayOf(months),
  )
  return { game: summarize(player), player }
}
