import type {
  CustomerContent,
  DifficultyContent,
  FoodTruckContent,
} from '../content/schema.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  FOOD_TRUCK,
  openingJournal,
  playDay,
} from './day.ts'
import { latestDecisions, startingDecisions } from './decisions.ts'
import { defaultProfile, validateProfile } from './profile.ts'
import { seedRng } from './rng.ts'
import type { GameState, Profile } from './types.ts'

// The calendar lives in calendar.ts, which day.ts reads too; it is exported
// from here as well, where the UI and the tools have always found it.
export { toCalendar, type CalendarDate } from './calendar.ts'

/**
 * Starts a game on day 0 with its generator seeded from `seed`, no stock,
 * the opening books of the profile's difficulty (see `openingJournal`), the
 * content's starting decisions and the player's `profile`. Throws a
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
  return {
    day: 0,
    seed,
    rngState: seedRng(seed),
    journal: openingJournal(profile.difficulty, content, difficulties),
    inventory: [],
    lastDay: null,
    decisions: startingDecisions(content),
    pendingDecisions: null,
    profile: {
      businessName: profile.businessName,
      avatar: profile.avatar,
      difficulty: profile.difficulty,
    },
  }
}

/**
 * Plays business day `state.day` with `state.decisions` (see `playDay`), then
 * moves on to the next morning, where the pending decisions, if any, take
 * effect. Returns a new state; never mutates `state`.
 */
export function tick(
  state: GameState,
  content: FoodTruckContent = FOOD_TRUCK,
  customers: CustomerContent = CUSTOMERS,
  difficulties: DifficultyContent = DIFFICULTIES,
): GameState {
  const played = playDay(state, content, customers, difficulties)
  return {
    ...played,
    day: state.day + 1,
    decisions: latestDecisions(played),
    pendingDecisions: null,
  }
}
