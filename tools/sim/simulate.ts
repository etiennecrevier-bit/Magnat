import { createHash } from 'node:crypto'
import {
  grocerIdSchema,
  type DifficultyContent,
  type DifficultyId,
  type EventCard,
  type EventContent,
  type GrocerContent,
  type GrocerId,
  type PercentileContent,
  type StreetModifierKind,
} from '../../src/content/schema.ts'
import { createInitialState, tick, toCalendar } from '../../src/engine/clock.ts'
import { GROCERS } from '../../src/engine/contracts.ts'
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
  latestDecisions,
  type DecisionChange,
} from '../../src/engine/decisions.ts'
import { NO_EVENTS, resolveEvent } from '../../src/engine/events.ts'
import { PRODUCTS } from '../../src/engine/inventory.ts'
import type { Cents } from '../../src/engine/money.ts'
import { defaultProfile } from '../../src/engine/profile.ts'
import { int, seedRng } from '../../src/engine/rng.ts'
import { PERCENTILES } from '../../src/engine/percentiles.ts'
import { MODIFIER_KINDS } from '../../src/engine/street.ts'
import type {
  Day,
  DaySummary,
  EventRecord,
  GameState,
  PerProduct,
} from '../../src/engine/types.ts'
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
 * How the headless player answers the event cards: always the `first`
 * choice, a `random` one, or `none`, a game where no event ever comes up.
 */
export type EventPolicy = 'first' | 'random' | 'none'

export const EVENT_POLICIES: readonly EventPolicy[] = [
  'first',
  'random',
  'none',
]

// Mixed into the game's seed so the random choices draw from a stream of
// their own, apart from the game's generator.
const CHOICE_SALT = 0x5eed_c0de

/**
 * Picks the id of a choice for each event card `policy` answers, in turn:
 * the first choice, or, for `random`, one drawn uniformly from a seeded
 * generator of its own, seeded from `seed`, so the same game makes the same
 * choices. Throws a RangeError for `none`, which never answers one.
 */
export function eventChooser(
  policy: EventPolicy,
  seed: number,
): (event: EventCard) => string {
  switch (policy) {
    case 'first':
      return ({ choices }) => idOf(choices, 0)
    case 'random': {
      let state = seedRng((seed ^ CHOICE_SALT) >>> 0)
      return ({ choices }) => {
        const [index, after] = int(state, 0, choices.length - 1)
        state = after
        return idOf(choices, index)
      }
    }
    case 'none':
      throw new RangeError('No event comes up in a game that plays none')
  }
}

function idOf(choices: EventCard['choices'], index: number): string {
  const choice = choices[index]
  if (choice === undefined) throw new RangeError(`No choice ${index}`)
  return choice.id
}

/**
 * How the headless player answers the grocers' cards (#156), whatever the
 * event policy: accepts every contract (`all`), refuses them all (`none`),
 * or accepts the `first` grocer to offer one, then that grocer's renewals,
 * and refuses the others.
 */
export type ContractPolicy = 'all' | 'none' | 'first'

export const CONTRACT_POLICIES: readonly ContractPolicy[] = [
  'all',
  'none',
  'first',
]

/**
 * The grocer of `grocers` whose contract `card` offers, by its `grocer`
 * condition, or renews, as their `renewalEvent`; null for any other card.
 */
export function grocerOf(
  card: EventCard,
  grocers: GrocerContent = GROCERS,
): GrocerId | null {
  const offered = card.conditions?.grocer
  if (offered !== undefined) return offered
  const renewing = grocerIdSchema.options.find(
    (id) => grocers.grocers[id].renewalEvent === card.id,
  )
  return renewing ?? null
}

/**
 * The choices of a grocer's card that accept, every outcome signing the
 * contract, and that refuse, no outcome signing it. Throws a RangeError
 * unless `card` has exactly one of each.
 */
export function contractChoices(card: EventCard): {
  accept: string
  refuse: string
} {
  const signs = (outcome: EventCard['choices'][number]['outcomes'][number]) =>
    outcome.effects.some(({ kind }) => kind === 'contract')
  const accept = card.choices.filter(({ outcomes }) => outcomes.every(signs))
  const refuse = card.choices.filter(({ outcomes }) => !outcomes.some(signs))
  const [accepted] = accept
  const [refused] = refuse
  if (
    accept.length !== 1 ||
    refuse.length !== 1 ||
    accepted === undefined ||
    refused === undefined
  ) {
    throw new RangeError(
      `${card.id} needs one choice that signs the contract and one that does not`,
    )
  }
  return { accept: accepted.id, refuse: refused.id }
}

/**
 * Answers each grocer's card by `policy` (see `ContractPolicy`) and every
 * other card with `fallback`. Throws a RangeError on a card that is not a
 * grocer's when `fallback` is null.
 */
export function contractChooser(
  policy: ContractPolicy,
  fallback: ((event: EventCard) => string) | null,
): (event: EventCard) => string {
  let first: GrocerId | null = null
  return (card) => {
    const grocer = grocerOf(card)
    if (grocer === null) {
      if (fallback === null) {
        throw new RangeError(`Only the grocers' cards come up: ${card.id}`)
      }
      return fallback(card)
    }
    const { accept, refuse } = contractChoices(card)
    switch (policy) {
      case 'all':
        return accept
      case 'none':
        return refuse
      case 'first':
        first ??= grocer
        return grocer === first ? accept : refuse
    }
  }
}

/** `content` with the grocers' cards only, at its pacing. */
export function grocerCards(content: EventContent): EventContent {
  return {
    ...content,
    events: content.events.filter((card) => grocerOf(card) !== null),
  }
}

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
  /** How the event cards were answered. */
  readonly events: EventPolicy
  /**
   * How the grocers' cards were answered; null when the event policy
   * answered them like any other.
   */
  readonly contracts: ContractPolicy | null
  /** Every event that came up and the choice made, oldest first. */
  readonly eventHistory: readonly EventRecord[]
  /** See `modifierDays`. */
  readonly modifierDays: Readonly<Record<StreetModifierKind, number>>
}

/**
 * Starts a game from `seed` at `difficulty`, by default the new game
 * screen's, makes `changes` to the starting decisions, in order, and plays
 * `days` business days, from day 0. The changes are in effect from day 0,
 * where the player's would wait for the next morning. With an `events`
 * policy other than `none`, the event cards of `eventContent` come up, and
 * each morning one does, before the owner's energy is read, `eventChooser`
 * answers it for the game's seed. With a `contracts` policy, it answers the
 * grocers' cards instead (see `contractChooser`), and with `events` at
 * `none`, the grocers' cards of `eventContent` still come up, alone at its
 * pacing, unless `contracts` is `none` too. The game opens, and plays every
 * day, with `difficulties`, by default the shipped ones. Throws a RangeError
 * unless `days` is a safe integer of at least 1, `seed` and `difficulty` are
 * ones `createInitialState` accepts and every change is one `applyDecision`
 * accepts.
 */
export function simulate(
  seed: number,
  days: number,
  difficulty: DifficultyId = defaultProfile().difficulty,
  changes: readonly DecisionChange[] = [],
  events: EventPolicy = 'none',
  eventContent: EventContent = EVENTS,
  difficulties: DifficultyContent = DIFFICULTIES,
  contracts: ContractPolicy | null = null,
): SimulationResult {
  if (!Number.isSafeInteger(days) || days < 1) {
    throw new RangeError(`Days to play must be a whole number from 1: ${days}`)
  }

  let state = startGame(seed, difficulty, changes, difficulties)
  const grocersOnly =
    events === 'none' && contracts !== null && contracts !== 'none'
  const content = grocersOnly
    ? grocerCards(eventContent)
    : events === 'none'
      ? NO_EVENTS
      : eventContent
  const answer = events === 'none' ? null : eventChooser(events, seed)
  const choose =
    contracts === null || content === NO_EVENTS
      ? answer
      : contractChooser(contracts, answer)
  const daySummaries: DaySummary[] = []
  const morningEnergy: number[] = []
  const unpaidRents: Day[] = []
  for (let day = 0; day < days; day += 1) {
    state = answerEvent(state, content, choose)
    morningEnergy.push(state.energy)
    state = playMorning(state, content, null, PERCENTILES, difficulties)
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
    events,
    contracts,
    eventHistory: state.events.history,
    modifierDays: modifierDays(daySummaries),
  }
}

/**
 * A new game from `seed` at `difficulty`, by default the new game screen's,
 * opened with `difficulties`, by default the shipped ones, on the morning of
 * day 0, with `changes` made to the starting decisions, in order, and
 * already in effect, where the player's would wait for the next morning.
 * Throws a RangeError unless `seed` and `difficulty` are ones
 * `createInitialState` accepts and every change is one `applyDecision`
 * accepts.
 */
export function startGame(
  seed: number,
  difficulty: DifficultyId = defaultProfile().difficulty,
  changes: readonly DecisionChange[] = [],
  difficulties: DifficultyContent = DIFFICULTIES,
): GameState {
  let state = createInitialState(
    seed,
    FOOD_TRUCK,
    { ...defaultProfile(), difficulty },
    difficulties,
  )
  for (const change of changes) state = applyDecision(state, change)
  // What tick() does each morning, before day 0 is played.
  return {
    ...state,
    decisions: latestDecisions(state),
    pendingDecisions: null,
  }
}

/**
 * `state` with the event waiting that morning, if `content` holds it,
 * answered by `choose`; `state` itself when none waits or `choose` is null.
 */
export function answerEvent(
  state: GameState,
  content: EventContent,
  choose: ((event: EventCard) => string) | null,
): GameState {
  const { pending } = state.events
  const card = content.events.find(({ id }) => id === pending?.event)
  if (choose === null || card === undefined) return state
  return resolveEvent(state, choose(card), content)
}

/**
 * Answers the event waiting on `state`'s morning, if any, with `choose` (see
 * `answerEvent`), then plays the day with the shipped content but
 * `difficulties`, by default the shipped ones too, and the event cards of
 * `content`, the player's standing read against `percentiles`, by default
 * the shipped table, and returns the next morning.
 */
export function playMorning(
  state: GameState,
  content: EventContent,
  choose: ((event: EventCard) => string) | null,
  percentiles: PercentileContent = PERCENTILES,
  difficulties: DifficultyContent = DIFFICULTIES,
): GameState {
  return tick(
    answerEvent(state, content, choose),
    FOOD_TRUCK,
    CUSTOMERS,
    difficulties,
    PERSONAL,
    ENERGY,
    content,
    DEFIS,
    percentiles,
  )
}

/**
 * For each kind of change to the street, the days of `daySummaries` it was
 * in effect: a day counts once for a kind, however many of that kind it
 * had.
 */
export function modifierDays(
  daySummaries: readonly DaySummary[],
): Record<StreetModifierKind, number> {
  const days = Object.fromEntries(
    MODIFIER_KINDS.map((kind) => [kind, 0]),
  ) as Record<StreetModifierKind, number>
  for (const { modifiers } of daySummaries) {
    for (const kind of new Set(modifiers.map(({ change }) => change.kind))) {
      days[kind] += 1
    }
  }
  return days
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
