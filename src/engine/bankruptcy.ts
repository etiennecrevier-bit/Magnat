import type { EventContent, FinancingContent } from '../content/schema.ts'
import { endOfMonth, monthsSinceStart, toCalendar } from './calendar.ts'
import { FINANCING } from './financing.ts'
import type { Day, GameEnd, GameState } from './types.ts'

// The bankruptcy (#160): Encaisse below zero at every close of six whole
// calendar months in a row ends the game, at the close of the sixth month's
// last day. Mme Prudhomme's letters warn of it, as event cards with a
// single choice, the morning after the close that reaches their months.
// A Défi never goes bankrupt, as it never gets the financing. Nothing here
// draws from the generator, and nothing here is new state: the count is
// read from `financing.belowZeroSince`, the letters sent from the history.

/**
 * The whole calendar months from `since`, the first of the closes in a row
 * below zero, to `day`, the last: those whose every day is in that run. A
 * run that starts on a 1st counts its first month, and one that starts
 * later counts from the next; a month counts once its last day closed.
 * 0 when `since` is null or after `day`. Throws a RangeError unless both
 * days are non-negative safe integers.
 */
export function monthsBelowZero(since: Day | null, day: Day): number {
  if (since === null || since > day) return 0
  const first =
    monthsSinceStart(since) + (toCalendar(since).dayOfMonth === 1 ? 0 : 1)
  const last = monthsSinceStart(day) - (endOfMonth(day) === day ? 0 : 1)
  return Math.max(0, last - first + 1)
}

/**
 * How `closing`, a state at the close of `closing.day` as `playDay()`
 * leaves it, ends: in bankruptcy when the day is the last of its month and
 * `rules.bankruptcy.months` whole months closed below zero (see
 * `monthsBelowZero`); null otherwise, and always in a Défi. A game whose
 * run already holds more months, such as an older save's, ends at its next
 * month's last close.
 */
export function endAtClose(
  closing: Pick<GameState, 'day' | 'challenge' | 'financing'>,
  rules: FinancingContent = FINANCING,
): GameEnd | null {
  const { day, challenge, financing } = closing
  if (challenge !== null || endOfMonth(day) !== day) return null
  return monthsBelowZero(financing.belowZeroSince, day) >=
    rules.bankruptcy.months
    ? { reason: 'bankruptcy', day }
    : null
}

/**
 * The id of the letter of `rules.bankruptcy.notices` due on the morning of
 * `state.day`, while Encaisse closed below zero: the last whose
 * `afterMonths` the whole months to the last close reach (see
 * `monthsBelowZero`), unless it came up since the run began, so a run
 * gets each letter once, and a new run gets them again. Null when none is
 * due, before the first close and in a Défi.
 */
export function noticeDue(
  { day, challenge, financing, events }: GameState,
  rules: FinancingContent = FINANCING,
): string | null {
  const since = financing.belowZeroSince
  if (challenge !== null || since === null || day === 0) return null
  const months = monthsBelowZero(since, day - 1)
  const notice = rules.bankruptcy.notices.findLast(
    ({ afterMonths }) => afterMonths <= months,
  )
  if (notice === undefined) return null
  const sent = events.history.some(
    (record) => record.event === notice.event && record.day > since,
  )
  return sent ? null : notice.event
}

/**
 * The morning of `state.day` with the letter due waiting, as if drawn that
 * morning (see `noticeDue`); `state` itself when none is due, once the game
 * has ended, while an event waits or was chosen that morning, or when
 * `events` does not hold the letter, so a game with no event gets none
 * though it still ends. A letter that waits for another card comes on the
 * first free morning after, while the run lasts. Returns a new state; never
 * mutates `state`.
 */
export function bankruptcyNotice(
  state: GameState,
  events: EventContent,
  rules: FinancingContent = FINANCING,
): GameState {
  if (
    state.ended !== null ||
    state.events.pending !== null ||
    state.events.history.at(-1)?.day === state.day
  ) {
    return state
  }
  const event = noticeDue(state, rules)
  if (event === null || !events.events.some(({ id }) => id === event)) {
    return state
  }
  return {
    ...state,
    events: {
      ...state.events,
      pending: { event, followUp: false },
      lastDrawnDay: state.day,
    },
  }
}
