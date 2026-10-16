import type { EventCard, EventContent } from '../../src/content/schema.ts'
import { EVENTS } from '../../src/engine/day.ts'
import { resolveEvent } from '../../src/engine/events.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import { seedRng } from '../../src/engine/rng.ts'
import type { Day, GameState } from '../../src/engine/types.ts'
import type { AccountCode } from '../../src/finance/accounts.ts'
import { balance } from '../../src/finance/journal.ts'
import { incomeStatement } from '../../src/finance/statements.ts'
import { answerEvent, eventChooser, playMorning } from '../sim/simulate.ts'
import { medianCents } from './summary.ts'

// What each choice of an event card does to the business: from the morning
// the card comes up, every choice plays the next 8 weeks, and so does the
// same morning with no card, and each choice is measured against that
// baseline. Every branch plays the same business days, so what differs is
// the choice alone. A card that moves only the owner's own money is judged
// on it instead, over long enough for all of it to come. No I/O: phase3.ts
// writes the results.

const CASH: AccountCode = '1000'

// A calendar fact, not a tunable: the next given weekday is a week away at
// most.
const DAYS_PER_WEEK = 7

/** Days each branch plays from the card's morning, that day included. */
export const WINDOW_DAYS = 56

/**
 * What a card's choices are judged on: the encaisse and the bénéfice net,
 * or, for a card whose choices move the owner's own money and touch neither
 * the business's books nor the street, that money (see `measuresOf`).
 */
export type CardMeasures = 'business' | 'ownMoney'

/**
 * What `card` is judged on: the owner's money when its effects, at every
 * difficulty, move it and do nothing else but the owner's energy; the
 * business otherwise.
 */
export function measuresOf(card: EventCard): CardMeasures {
  const effects = card.choices.flatMap(({ outcomes }) =>
    outcomes.flatMap(({ effects: of }) => of),
  )
  return effects.some(({ kind }) => kind === 'personal') &&
    effects.every(({ kind }) => kind === 'personal' || kind === 'energy')
    ? 'ownMoney'
    : 'business'
}

/**
 * The days each branch of `card` plays: `WINDOW_DAYS`, or for a card judged
 * on the owner's money, more if its last effect lands later, so that the
 * window holds it.
 */
export function windowOf(card: EventCard): number {
  if (measuresOf(card) === 'business') return WINDOW_DAYS
  const latest = Math.max(
    0,
    ...card.choices.flatMap(({ outcomes }) =>
      outcomes.flatMap(({ effects }) =>
        effects.map(({ inDays, onNextWeekday }) =>
          onNextWeekday === undefined ? (inDays ?? 0) : DAYS_PER_WEEK,
        ),
      ),
    ),
  )
  return Math.max(WINDOW_DAYS, latest + 1)
}

/** Too strong: best on both measures in more than this % of games. */
export const TOO_STRONG = 80
/** Too weak: best on neither measure in more than this % of games. */
export const TOO_WEAK = 85

// Mixed into each stream, so the business days, the outcomes drawn, the
// follow-ups' outcomes, the follow-ups' choices and the occurrence sampled
// never share a generator.
const DAY_SALT = 0xda75_0001
const OUTCOME_SALT = 0x0c0e_0002
const FOLLOW_UP_SALT = 0xf011_0003
const CHOOSER_SALT = 0xc400_0004
const SAMPLE_SALT = 0x5a3e_0005

/**
 * A generator state mixed from `values`, each taken as a uint32, with
 * murmur3's finalizer, so that nearby values give unrelated streams.
 */
export function streamOf(...values: readonly number[]): number {
  let hash = 0x9e37_79b9
  for (const value of values) {
    hash = Math.imul(hash ^ (value >>> 0), 0x85eb_ca6b)
    hash ^= hash >>> 13
    hash = Math.imul(hash, 0xc2b2_ae35)
    hash ^= hash >>> 16
  }
  return seedRng(hash >>> 0)
}

/** The generator a branch of game `seed` plays business day `day` with. */
export function dayStream(seed: number, day: Day): number {
  return streamOf(DAY_SALT, seed, day)
}

/**
 * The generator the choice at `index` of the card that came up on `day` of
 * game `seed` draws its outcome from.
 */
export function outcomeStream(seed: number, day: Day, index: number): number {
  return streamOf(OUTCOME_SALT, seed, day, index)
}

/** The generator game `seed` picks the occurrence of each card with. */
export function sampleStream(seed: number): number {
  return streamOf(SAMPLE_SALT, seed)
}

/** `content` where no card is drawn: only the follow-ups queued come up. */
export function followUpsOnly(content: EventContent): EventContent {
  return { ...content, pacing: { ...content.pacing, dailyChance: 0 } }
}

/**
 * Plays `days` business days of game `seed` from `state`'s morning, with
 * the cards of `content` but no new one drawn (see `followUpsOnly`), and
 * returns the morning after the last. Each morning, a follow-up waiting is
 * answered by a random choice whose generator is seeded from the game and
 * the first day, and draws its outcome from a stream of that day; then the
 * day is played with `dayStream(seed, day)`. So every branch that starts on
 * the same morning plays the same business days, whatever was drawn before.
 */
export function playWindow(
  state: GameState,
  seed: number,
  content: EventContent = EVENTS,
  days: number = WINDOW_DAYS,
): GameState {
  const followUps = followUpsOnly(content)
  const choose = eventChooser('random', streamOf(CHOOSER_SALT, seed, state.day))
  let played = state
  for (let offset = 0; offset < days; offset += 1) {
    const { day } = played
    if (played.events.pending !== null) {
      played = answerEvent(
        { ...played, rngState: streamOf(FOLLOW_UP_SALT, seed, day) },
        followUps,
        choose,
      )
    }
    played = playMorning(
      { ...played, rngState: dayStream(seed, day) },
      followUps,
      null,
    )
  }
  return played
}

/** One choice of a card in one game, against the same game with no card. */
export interface ChoiceResult {
  readonly choice: string
  /** Encaisse at the close of the window's last day, minus the baseline's. */
  readonly cash: Cents
  /** Bénéfice net over the window, minus the baseline's. */
  readonly netIncome: Cents
  /**
   * The owner's own cash at the close of the window's last day, minus the
   * baseline's.
   */
  readonly personal: Cents
}

/** One occurrence of a card, every choice played out. */
export interface EventSample {
  readonly event: string
  /** What the card is judged on (see `measuresOf`). */
  readonly measures: CardMeasures
  /** The morning the card came up. */
  readonly day: Day
  /** In the order of the card's choices. */
  readonly choices: readonly ChoiceResult[]
}

/**
 * Plays every choice of the card waiting on `morning`, a morning of game
 * `seed`, for `days` days from that morning, by default the card's window
 * (see `windowOf` and `playWindow`), each choice drawing its outcome from
 * `outcomeStream`, and the same morning with no card, the baseline.
 * Measures each choice against the baseline. Throws an Error when no card
 * waits, and a RangeError when `content` does not hold it.
 */
export function branchEvent(
  morning: GameState,
  seed: number,
  content: EventContent = EVENTS,
  days?: number,
): EventSample {
  const { pending } = morning.events
  if (pending === null) throw new Error(`No event waits on day ${morning.day}`)
  const card = content.events.find(({ id }) => id === pending.event)
  if (card === undefined) {
    throw new RangeError(`Unknown event: ${pending.event}`)
  }
  const window = days ?? windowOf(card)
  const { day } = morning
  const lastDay = day + window - 1
  function measure(end: GameState): {
    cash: number
    netIncome: number
    personal: number
  } {
    return {
      cash: balance(end.journal, CASH, { toDay: lastDay }),
      netIncome: incomeStatement(end.journal, day, lastDay).netIncome.amount,
      personal: end.personal.cash,
    }
  }

  const baseline = measure(
    playWindow(
      { ...morning, events: { ...morning.events, pending: null } },
      seed,
      content,
      window,
    ),
  )
  return {
    event: card.id,
    measures: measuresOf(card),
    day,
    choices: card.choices.map(({ id }, index) => {
      const answered = resolveEvent(
        { ...morning, rngState: outcomeStream(seed, day, index) },
        id,
        content,
      )
      const end = measure(playWindow(answered, seed, content, window))
      return {
        choice: id,
        cash: cents(end.cash - baseline.cash),
        netIncome: cents(end.netIncome - baseline.netIncome),
        personal: cents(end.personal - baseline.personal),
      }
    }),
  }
}

/** How one choice of a card fared over the games it came up in. */
export interface ChoiceVerdict {
  readonly choice: string
  /** What the card is judged on (see `measuresOf`). */
  readonly measures: CardMeasures
  /** Games the card came up in. */
  readonly games: number
  /** Over those games, rounded half away from zero to the cent. */
  readonly medianCash: Cents
  readonly medianNetIncome: Cents
  readonly medianPersonal: Cents
  /** Games where no other choice did strictly better on Encaisse. */
  readonly bestOnCash: number
  /** Games where no other choice did strictly better on Bénéfice net. */
  readonly bestOnNetIncome: number
  /** Games where no other choice did strictly better on the owner's cash. */
  readonly bestOnPersonal: number
  /**
   * Games where it was best on all the card is judged on: the encaisse and
   * the bénéfice net, or the owner's money.
   */
  readonly bestOnBoth: number
  /** Games where it was best on none of it. */
  readonly bestOnNeither: number
}

/**
 * Each choice of `samples`, every occurrence of one card, summed up: a
 * choice is best on a measure in a game when no other choice of the card
 * did strictly better there, so ties are all best. In the order of the
 * first sample's choices; none for no samples.
 */
export function choiceVerdicts(
  samples: readonly EventSample[],
): ChoiceVerdict[] {
  const first = samples[0]
  if (first === undefined) return []
  const { measures } = first
  const best = samples.map(({ choices }) => {
    const topCash = Math.max(...choices.map(({ cash }) => cash))
    const topNet = Math.max(...choices.map(({ netIncome }) => netIncome))
    const topPersonal = Math.max(...choices.map(({ personal }) => personal))
    return choices.map(({ cash, netIncome, personal }) => ({
      cash: cash === topCash,
      netIncome: netIncome === topNet,
      personal: personal === topPersonal,
    }))
  })
  const judged = (flags: {
    cash: boolean
    netIncome: boolean
    personal: boolean
  }): boolean[] =>
    measures === 'ownMoney' ? [flags.personal] : [flags.cash, flags.netIncome]
  return first.choices.map(({ choice }, index) => {
    const results = samples.map(({ choices }) => {
      const result = choices[index]
      if (result?.choice !== choice) {
        throw new RangeError('Samples disagree on the choices of a card')
      }
      return result
    })
    const flags = best.map(
      (game) =>
        game[index] ?? { cash: false, netIncome: false, personal: false },
    )
    return {
      choice,
      measures,
      games: samples.length,
      medianCash: medianCents(results.map(({ cash }) => cash)),
      medianNetIncome: medianCents(results.map(({ netIncome }) => netIncome)),
      medianPersonal: medianCents(results.map(({ personal }) => personal)),
      bestOnCash: flags.filter(({ cash }) => cash).length,
      bestOnNetIncome: flags.filter(({ netIncome }) => netIncome).length,
      bestOnPersonal: flags.filter(({ personal }) => personal).length,
      bestOnBoth: flags.filter((game) => judged(game).every(Boolean)).length,
      bestOnNeither: flags.filter((game) => !judged(game).some(Boolean)).length,
    }
  })
}

/** Whether a choice wins too often or too seldom, by the rule of #101. */
export interface TargetCheck {
  readonly event: string
  readonly games: number
  /** Null when the card never came up: nothing to judge. */
  readonly met: boolean | null
  /** The choices best on both in more than `TOO_STRONG` % of the games. */
  readonly tooStrong: readonly ChoiceVerdict[]
  /** The choices best on neither in more than `TOO_WEAK` % of the games. */
  readonly tooWeak: readonly ChoiceVerdict[]
}

/** Checks the choices of card `event`, summed up as `verdicts`. */
export function eventTarget(
  event: string,
  verdicts: readonly ChoiceVerdict[],
): TargetCheck {
  const games = verdicts[0]?.games ?? 0
  // In whole numbers, so that a share right at a limit is not over it.
  const tooStrong = verdicts.filter(
    ({ bestOnBoth }) => 100 * bestOnBoth > TOO_STRONG * games,
  )
  const tooWeak = verdicts.filter(
    ({ bestOnNeither }) => 100 * bestOnNeither > TOO_WEAK * games,
  )
  return {
    event,
    games,
    met: games === 0 ? null : tooStrong.length === 0 && tooWeak.length === 0,
    tooStrong,
    tooWeak,
  }
}
