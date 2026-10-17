import type {
  BakeryContent,
  CustomerContent,
  DefiContent,
  DifficultyContent,
  EnergyContent,
  EventContent,
  FinancingContent,
  FoodTruckContent,
  GrocerContent,
  PercentileContent,
  PersonalContent,
  StaffContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { BAKERY, closedBakery } from './bakery.ts'
import {
  challengeDifficulties,
  defiById,
  forcedEventOn,
  openingChallenge,
  setupDecisions,
  startDayOf,
  startingEnergy,
} from './challenge.ts'
import { GROCERS, noContracts } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  openingJournal,
  playDay,
} from './day.ts'
import {
  latestDecisions,
  startingDecisions,
  validateDecisions,
} from './decisions.ts'
import { applyEffect, insertByDay } from './effects.ts'
import { FULL_ENERGY, nightRest } from './energy.ts'
import { NO_EVENTS, drawEvent, noEvents } from './events.ts'
import { FINANCING, financingOffer, noFinancing } from './financing.ts'
import { PRODUCTS } from './inventory.ts'
import { PERCENTILES } from './percentiles.ts'
import { openingAccount } from './personal.ts'
import { defaultProfile, validateProfile } from './profile.ts'
import { seedRng } from './rng.ts'
import { STAFF } from './staff.ts'
import type { GameState, Profile } from './types.ts'
import { openingWeek } from './week.ts'

const CASH: AccountCode = '1000'

// The calendar lives in calendar.ts, which day.ts reads too; it is exported
// from here as well, where the UI and the tools have always found it.
export { toCalendar, type CalendarDate } from './calendar.ts'

/**
 * Starts a game on day 0 with its generator seeded from `seed`, no stock, no
 * marketing spent yet, the opening books of the profile's difficulty (see
 * `openingJournal`), the content's starting decisions, the player's `profile`,
 * the owner's personal account holding the difficulty's starting savings, the
 * owner at full energy, no event yet, nobody owing the business anything, a
 * first week to come, partial, from the cash the books open with (see
 * `openingWeek`), no Défi, no bakery, with the croissants bought, no
 * contract, nobody on staff, the owner at work and no financing. Throws a
 * RangeError unless `seed` is an integer in [0, 2^32), if the starting
 * decisions break the content's limits, if `profile` breaks
 * `validateProfile()`, or if the difficulty leaves a negative Mise de fonds.
 */
export function createInitialState(
  seed: number,
  content: FoodTruckContent = FOOD_TRUCK,
  profile: Profile = defaultProfile(),
  difficulties: DifficultyContent = DIFFICULTIES,
): GameState {
  validateProfile(profile)
  const { startingPersonalCashCents } =
    difficulties.difficulties[profile.difficulty]
  const journal = openingJournal(profile.difficulty, content, difficulties)
  return {
    day: 0,
    seed,
    rngState: seedRng(seed),
    journal,
    inventory: [],
    lastDay: null,
    marketingHistory: [],
    decisions: startingDecisions(content),
    pendingDecisions: null,
    profile: {
      businessName: profile.businessName,
      avatar: profile.avatar,
      difficulty: profile.difficulty,
    },
    personal: openingAccount(startingPersonalCashCents),
    energy: FULL_ENERGY,
    events: noEvents(),
    receivables: [],
    weekSoFar: openingWeek(journal),
    lastWeek: null,
    weekHistory: [],
    challenge: null,
    bakery: closedBakery(),
    contracts: noContracts(),
    staff: [],
    ownerAway: false,
    financing: noFinancing(),
  }
}

/**
 * Starts the Défi `defiId` of `defis` as a game seeded from `seed`, with
 * `player`'s business name and avatar and the Défi's difficulty. It opens as
 * `createInitialState()` does, with the Défi's cash, if it sets one, in
 * place of the difficulty's (see `challengeDifficulties`), the books on day
 * 0, then moves to the morning of its first day, a date of the first season,
 * with nothing played before it: the Défi's decisions in place of the
 * starting ones (see `setupDecisions`), the owner's energy it sets, the
 * changes to the street it forces, those of its first day made that morning
 * (see `applyEffect`) and the others queued for theirs, the event it forces
 * on its first day waiting, as if drawn that morning, and the Défi under
 * way with nothing played (see `openingChallenge`). Throws a RangeError if
 * no Défi has the id, if the Défi's decisions break the content's limits
 * (see `validateDecisions`) or give a product another kind of restock rule
 * than it starts with, and as `createInitialState()` does.
 */
export function startChallenge(
  defiId: string,
  seed: number,
  content: FoodTruckContent = FOOD_TRUCK,
  defis: DefiContent = DEFIS,
  difficulties: DifficultyContent = DIFFICULTIES,
  player: Profile = defaultProfile(),
): GameState {
  const defi = defiById(defis, defiId)
  const opened = createInitialState(
    seed,
    content,
    { ...player, difficulty: defi.difficulty },
    challengeDifficulties(defi, difficulties),
  )
  const decisions = setupDecisions(defi, opened.decisions)
  validateDecisions(decisions, content.decisionLimits)
  for (const product of PRODUCTS) {
    const { kind } = opened.decisions.restock[product]
    if (decisions.restock[product].kind !== kind) {
      throw new RangeError(
        `Invalid Défi ${defi.id}: restock.${product} must stay a ${kind} rule: ${decisions.restock[product].kind}`,
      )
    }
  }
  const day = startDayOf(defi)
  const energy = startingEnergy(defi)
  let state: GameState = {
    ...opened,
    day,
    decisions,
    energy,
    challenge: openingChallenge(
      defi,
      balance(opened.journal, CASH, { toDay: 0 }),
      energy,
    ),
  }
  for (const { day: at, days, event, change } of defi.modifiers) {
    const effect = { ...change, days }
    state =
      at === 0
        ? applyEffect(state, effect, content, event)
        : {
            ...state,
            events: {
              ...state.events,
              delayed: insertByDay(state.events.delayed, {
                day: day + at,
                event,
                effect,
              }),
            },
          }
  }
  return withForcedEvent(state, defis)
}

/**
 * Plays business day `state.day` with `state.decisions` (see `playDay`, with
 * `bakery` as the bakery's content, `grocers` as the contracts' and `staff`
 * as the employees'), then moves on to the next morning, where
 * the pending decisions, if any, take effect, after a night that gives the
 * owner some energy back (see `nightRest`), with the owner at work unless
 * something sends them away again, and where an event of `events` may
 * come up: the card of the emergency loan or the share sale when the day
 * closed below zero (see `financingOffer`, with `financing`'s rules), or
 * else the draw (see `drawEvent`, which reads the player's standing against
 * `percentiles`). By default no event ever does: a game turns them on by
 * passing the content, such as `EVENTS`. In a Défi of `defis`, the morning
 * brings the event the Défi forces that day, if any, in place of the draw;
 * otherwise the draw, with no chance of a new event unless the Défi lets
 * random events come, though a follow-up still comes, and never the
 * financing's cards, since a Défi's medals read the books as they are; and
 * nothing once the Défi is over. Returns a new state; never mutates
 * `state`. Throws an Error while an event waits for the player's choice,
 * and once the Défi is over.
 */
export function tick(
  state: GameState,
  content: FoodTruckContent = FOOD_TRUCK,
  customers: CustomerContent = CUSTOMERS,
  difficulties: DifficultyContent = DIFFICULTIES,
  personal: PersonalContent = PERSONAL,
  energy: EnergyContent = ENERGY,
  events: EventContent = NO_EVENTS,
  defis: DefiContent = DEFIS,
  percentiles: PercentileContent = PERCENTILES,
  bakery: BakeryContent = BAKERY,
  grocers: GrocerContent = GROCERS,
  staff: StaffContent = STAFF,
  financing: FinancingContent = FINANCING,
): GameState {
  const played = playDay(
    state,
    content,
    customers,
    difficulties,
    personal,
    energy,
    defis,
    bakery,
    grocers,
    staff,
  )
  const morning: GameState = {
    ...played,
    day: state.day + 1,
    decisions: latestDecisions(played),
    pendingDecisions: null,
    energy: nightRest(played.energy, energy),
    ownerAway: false,
  }
  const { challenge } = morning
  if (challenge === null) {
    return drawEvent(
      financingOffer(morning, events, financing),
      events,
      percentiles,
      grocers,
    )
  }
  if (challenge.status !== 'enCours') return morning
  const forced = withForcedEvent(morning, defis)
  if (forced !== morning) return forced
  return drawEvent(
    morning,
    defiById(defis, challenge.id).randomEvents
      ? events
      : { ...events, pacing: { ...events.pacing, dailyChance: 0 } },
    percentiles,
    grocers,
  )
}

/**
 * `state` with the event its Défi forces that morning waiting, as if drawn
 * then; `state` itself when the Défi forces none.
 */
function withForcedEvent(state: GameState, defis: DefiContent): GameState {
  const { challenge } = state
  if (challenge === null) return state
  const forced = forcedEventOn(
    defiById(defis, challenge.id),
    challenge.startDay,
    state.day,
  )
  if (forced === undefined) return state
  return {
    ...state,
    events: {
      ...state.events,
      pending: { event: forced.event, followUp: false },
      lastDrawnDay: state.day,
    },
  }
}
