import type {
  CustomerContent,
  DifficultyContent,
  EnergyContent,
  FoodTruckContent,
  PersonalContent,
} from '../content/schema.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  openingJournal,
  playDay,
} from './day.ts'
import { latestDecisions, startingDecisions } from './decisions.ts'
import { FULL_ENERGY, nightRest } from './energy.ts'
import { openingAccount } from './personal.ts'
import { defaultProfile, validateProfile } from './profile.ts'
import { seedRng } from './rng.ts'
import type { GameState, Profile } from './types.ts'

// The calendar lives in calendar.ts, which day.ts reads too; it is exported
// from here as well, where the UI and the tools have always found it.
export { toCalendar, type CalendarDate } from './calendar.ts'

/**
 * Starts a game on day 0 with its generator seeded from `seed`, no stock,
 * no marketing spent yet, the opening books of the profile's difficulty
 * (see `openingJournal`), the content's starting decisions, the player's
 * `profile`, the owner's personal account holding the difficulty's
 * starting savings, and the owner at full energy. Throws a RangeError unless `seed` is an integer in
 * [0, 2^32), if the starting decisions break the content's limits, if
 * `profile` breaks `validateProfile()`, or if the difficulty leaves a
 * negative Mise de fonds.
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
  return {
    day: 0,
    seed,
    rngState: seedRng(seed),
    journal: openingJournal(profile.difficulty, content, difficulties),
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
  }
}

/**
 * Plays business day `state.day` with `state.decisions` (see `playDay`), then
 * moves on to the next morning, where the pending decisions, if any, take
 * effect, after a night that gives the owner some energy back (see
 * `nightRest`). Returns a new state; never mutates `state`.
 */
export function tick(
  state: GameState,
  content: FoodTruckContent = FOOD_TRUCK,
  customers: CustomerContent = CUSTOMERS,
  difficulties: DifficultyContent = DIFFICULTIES,
  personal: PersonalContent = PERSONAL,
  energy: EnergyContent = ENERGY,
): GameState {
  const played = playDay(
    state,
    content,
    customers,
    difficulties,
    personal,
    energy,
  )
  return {
    ...played,
    day: state.day + 1,
    decisions: latestDecisions(played),
    pendingDecisions: null,
    energy: nightRest(played.energy, energy),
  }
}
