import {
  medalSchema,
  type DecisionKind,
  type Defi,
  type DefiCondition,
  type DefiContent,
  type DefiGoal,
  type DefiMetric,
  type DifficultyContent,
  type Medal,
  type RestockRule,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  entriesOf,
  type Journal,
  type JournalEntry,
} from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import { dayOfDate } from './calendar.ts'
import { FULL_ENERGY } from './energy.ts'
import { PRODUCTS } from './inventory.ts'
import { add, cents, sub, type Cents } from './money.ts'
import type {
  ChallengeProgress,
  ChallengeState,
  ChallengeStatus,
  Day,
  DaySummary,
  Decisions,
  GameState,
  PerProduct,
} from './types.ts'

// The Défis: short games with one goal and a medal. A Défi is a game that
// opens on a day of the first season with its own setup, and that the
// content's forced changes to the street and forced events shape. Each
// close adds the day to its progress, which ends it on its last day or when
// a condition breaks. Nothing here posts an entry or draws from the
// generator, and nothing here imports what plays a day, so the modules that
// do can all read it.

const CASH: AccountCode = '1000'

/** The Défi of `defis` with the id `id`. Throws a RangeError if none has it. */
export function defiById(defis: DefiContent, id: string): Defi {
  const defi = defis.defis.find((candidate) => candidate.id === id)
  if (defi === undefined) throw new RangeError(`Unknown Défi: ${id}`)
  return defi
}

/** The game day of the Défi's first day, from its date in year 1. */
export function startDayOf(defi: Defi): Day {
  return dayOfDate(defi.start)
}

/** The game day of the Défi's last day. */
export function lastDayOf(defi: Defi): Day {
  return startDayOf(defi) + defi.lengthDays - 1
}

/**
 * `difficulties` with the Défi's difficulty opening with the Défi's cash,
 * if it sets one, so its books open as a game of that difficulty would with
 * that cash in the bank.
 */
export function challengeDifficulties(
  defi: Defi,
  difficulties: DifficultyContent,
): DifficultyContent {
  const { cashCents } = defi.setup
  if (cashCents === undefined) return difficulties
  const own = difficulties.difficulties[defi.difficulty]
  return {
    ...difficulties,
    difficulties: {
      ...difficulties.difficulties,
      [defi.difficulty]: { ...own, startingCashCents: cashCents },
    },
  }
}

/**
 * `base`, the decisions a game starts with, with the Défi's setup in their
 * place: product by product for the prices and the restock, the days open
 * in ascending order. The bakery's stay `base`'s. Checks nothing:
 * `validateDecisions()` does.
 */
export function setupDecisions(defi: Defi, base: Decisions): Decisions {
  const { setup } = defi
  const rule = (product: (typeof PRODUCTS)[number]): RestockRule => ({
    ...(setup.restock?.[product] ?? base.restock[product]),
  })
  return {
    prices: Object.fromEntries(
      PRODUCTS.map((product) => [
        product,
        setup.prices?.[product] ?? base.prices[product],
      ]),
    ) as Decisions['prices'],
    restock: Object.fromEntries(
      PRODUCTS.map((product) => [product, rule(product)]),
    ) as Decisions['restock'],
    daysOpen:
      setup.daysOpen === undefined
        ? [...base.daysOpen]
        : [...setup.daysOpen].sort((a, b) => a - b),
    ownerWeeklyPay: setup.ownerWeeklyPayCents ?? base.ownerWeeklyPay,
    marketingDaily: setup.marketingDailyCents ?? base.marketingDaily,
    bakery: base.bakery === null ? null : { ...base.bakery },
    croissantSource: base.croissantSource,
    bake: { ...base.bake },
  }
}

/** The owner's energy on the Défi's first morning: full unless it sets it. */
export function startingEnergy(defi: Defi): number {
  return defi.setup.energy ?? FULL_ENERGY
}

/**
 * A Défi under way with no day played yet: its books open with `cash` in
 * Encaisse and the owner with `energy`, the lowest so far.
 */
export function openingChallenge(
  defi: Defi,
  cash: Cents,
  energy: number,
): ChallengeState {
  return {
    id: defi.id,
    startDay: startDayOf(defi),
    progress: {
      daysPlayed: 0,
      sales: cents(0),
      netIncome: cents(0),
      lowestCash: cash,
      customersServed: 0,
      unitsSold: 0,
      unitsSpoiled: 0,
      lowestEnergy: energy,
    },
    lowestEnergySinceClose: energy,
    status: 'enCours',
    medal: null,
  }
}

/**
 * `challenge` with the owner's energy, now at `energy`, counted in its
 * lowest since the last close; null in a game that is not a Défi. Every
 * effect that moves the energy calls it (see `applyEffect`).
 */
export function withEnergyAt(
  challenge: ChallengeState | null,
  energy: number,
): ChallengeState | null {
  if (challenge === null || energy >= challenge.lowestEnergySinceClose) {
    return challenge
  }
  return { ...challenge, lowestEnergySinceClose: energy }
}

/**
 * The lowest Encaisse after any of the journal's entries from entry `from`
 * on, counting from 0, dated `throughDay` or before, and the Encaisse before
 * entry `from` if lower: an entry that moves cash both ways counts once, by
 * its net. With `from` the number of entries the books open with, it is the
 * lowest the cash went since they opened, the opening cash included.
 */
export function lowestCashSince(
  journal: Journal,
  from: number,
  throughDay: Day,
): Cents {
  const entries = entriesOf(journal)
  let cash = cents(0)
  for (const entry of entries.slice(0, from)) cash = add(cash, cashMoved(entry))
  let lowest = cash
  for (const entry of entries.slice(from)) {
    if (entry.day > throughDay) break
    cash = add(cash, cashMoved(entry))
    if (cash < lowest) lowest = cash
  }
  return lowest
}

/**
 * The units written off as a share of the units sold and written off; 0
 * when there are none.
 */
export function spoilageRate({
  unitsSold,
  unitsSpoiled,
}: Pick<ChallengeProgress, 'unitsSold' | 'unitsSpoiled'>): number {
  const total = unitsSold + unitsSpoiled
  return total === 0 ? 0 : unitsSpoiled / total
}

/** What `metric` reads in `progress`. */
export function metricValue(
  progress: ChallengeProgress,
  metric: DefiMetric,
): number {
  switch (metric) {
    case 'lowestCash':
      return progress.lowestCash
    case 'netIncome':
      return progress.netIncome
    case 'sales':
      return progress.sales
    case 'customersServed':
      return progress.customersServed
    case 'spoilageRate':
      return spoilageRate(progress)
    case 'lowestEnergy':
      return progress.lowestEnergy
  }
}

/**
 * The best medal `value` reaches: at least its threshold, or at most for
 * `spoilageRate`, where lower is better. Null below bronze.
 */
export function medalFor(goal: DefiGoal, value: number): Medal | null {
  const lowerIsBetter = goal.metric === 'spoilageRate'
  const { medals } = goal
  return (
    medalSchema.options.find((medal) =>
      lowerIsBetter ? value <= medals[medal] : value >= medals[medal],
    ) ?? null
  )
}

/** The first of the Défi's conditions `progress` breaks; null if none. */
export function failedCondition(
  progress: ChallengeProgress,
  defi: Defi,
): DefiCondition | null {
  return (
    defi.conditions.find((condition) => {
      switch (condition.kind) {
        case 'minCash':
          return progress.lowestCash < condition.amountCents
        case 'minEnergy':
          return progress.lowestEnergy < condition.amount
        case 'maxSpoilageRate':
          return spoilageRate(progress) > condition.rate
      }
    }) ?? null
  )
}

/**
 * Where a Défi with `progress` stands: « échoué » as soon as a condition
 * breaks; otherwise under way until its last day is played, then
 * « réussi » with the best medal the goal reaches, or « échoué » short of
 * bronze.
 */
export function verdict(
  progress: ChallengeProgress,
  defi: Defi,
): { status: ChallengeStatus; medal: Medal | null } {
  if (failedCondition(progress, defi) !== null) {
    return { status: 'echoue', medal: null }
  }
  if (progress.daysPlayed < defi.lengthDays) {
    return { status: 'enCours', medal: null }
  }
  const medal = medalFor(defi.goal, metricValue(progress, defi.goal.metric))
  return medal === null
    ? { status: 'echoue', medal: null }
    : { status: 'reussi', medal }
}

/**
 * The Défi of `closing`, the state `playDay()` returns, with the day it
 * closes added: the ventes and the bénéfice net of the état des résultats
 * from the Défi's first day, the lowest Encaisse since the books opened
 * with their first `openingEntries` entries (see `lowestCashSince`), the
 * visits that reached the counter, the units sold and written off, and the
 * owner's lowest energy so far, with the lowest since the last close and
 * the close's own, from which the next lowest counts. Before the close,
 * the energy only went up from the lowest since the last close, or down
 * by an effect that counted, so no level of the day is missed. Then its
 * status and medal (see `verdict`). Null in a game that is not a Défi.
 * Throws an Error unless a day was played.
 */
export function recordChallengeDay(
  closing: GameState,
  defi: Defi,
  openingEntries: number,
): ChallengeState | null {
  const { challenge, lastDay, journal } = closing
  if (challenge === null) return null
  if (lastDay === null) throw new Error('No day was played')
  const { progress, startDay } = challenge
  const { sales, netIncome } = incomeStatement(journal, startDay, lastDay.day)
  const next: ChallengeProgress = {
    daysPlayed: progress.daysPlayed + 1,
    sales: sales.amount,
    netIncome: netIncome.amount,
    lowestCash: lowestCashSince(journal, openingEntries, lastDay.day),
    customersServed: progress.customersServed + customersServed(lastDay),
    unitsSold: progress.unitsSold + units(lastDay.sold),
    unitsSpoiled: progress.unitsSpoiled + units(lastDay.spoiled),
    lowestEnergy: Math.min(
      progress.lowestEnergy,
      challenge.lowestEnergySinceClose,
      closing.energy,
    ),
  }
  return {
    ...challenge,
    progress: next,
    lowestEnergySinceClose: closing.energy,
    ...verdict(next, defi),
  }
}

/**
 * The event the Défi starting on `startDay` forces on the morning of game
 * day `day`; undefined if none.
 */
export function forcedEventOn(
  defi: Defi,
  startDay: Day,
  day: Day,
): Defi['events'][number] | undefined {
  return defi.events.find((forced) => startDay + forced.day === day)
}

/**
 * The choices the player may make on the event waiting: only those the
 * Défi allows when it is the event the Défi forces that morning; null, any
 * of the event's, otherwise.
 */
export function allowedChoices(
  state: GameState,
  defis: DefiContent,
): readonly string[] | null {
  const { challenge } = state
  const { pending } = state.events
  if (challenge === null || pending === null || pending.followUp) return null
  const defi = defiById(defis, challenge.id)
  const forced = forcedEventOn(defi, challenge.startDay, state.day)
  return forced?.event === pending.event ? forced.choices : null
}

/** Whether the Défi the game plays, if any, locks changes of `kind`. */
export function isLocked(
  state: GameState,
  kind: DecisionKind,
  defis: DefiContent,
): boolean {
  const { challenge } = state
  return (
    challenge !== null && defiById(defis, challenge.id).locked.includes(kind)
  )
}

/** Whether `a` and `b` agree on what a change of `kind` changes. */
export function sameLocked(
  a: Decisions,
  b: Decisions,
  kind: DecisionKind,
): boolean {
  switch (kind) {
    case 'price':
      return PRODUCTS.every(
        (product) => a.prices[product] === b.prices[product],
      )
    case 'restock':
      return PRODUCTS.every((product) =>
        sameRule(a.restock[product], b.restock[product]),
      )
    case 'daysOpen':
      return (
        a.daysOpen.length === b.daysOpen.length &&
        a.daysOpen.every((weekday, index) => weekday === b.daysOpen[index])
      )
    case 'ownerWeeklyPay':
      return a.ownerWeeklyPay === b.ownerWeeklyPay
    case 'marketingDaily':
      return a.marketingDaily === b.marketingDaily
  }
}

function sameRule(a: RestockRule, b: RestockRule): boolean {
  switch (a.kind) {
    case 'buyDaily':
      return b.kind === 'buyDaily' && a.quantity === b.quantity
    case 'topUp':
      return (
        b.kind === 'topUp' && a.whenBelow === b.whenBelow && a.upTo === b.upTo
      )
  }
}

/** What an entry moves in Encaisse: its debits there minus its credits. */
function cashMoved({ lines }: JournalEntry): Cents {
  let moved = cents(0)
  for (const { account, debit, credit } of lines) {
    if (account === CASH) moved = add(moved, sub(debit, credit))
  }
  return moved
}

/** The visits of `day` that reached the counter. */
function customersServed({ visits }: DaySummary): number {
  return visits.filter(({ servedMinute }) => servedMinute !== null).length
}

function units(perProduct: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + perProduct[product], 0)
}
