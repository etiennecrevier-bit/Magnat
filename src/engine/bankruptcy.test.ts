import { describe, expect, it } from 'vitest'
import {
  isNoticeCard,
  type EventContent,
  type FinancingContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, postEntry } from '../finance/journal.ts'
import { BAKERY } from './bakery.ts'
import {
  bankruptcyNotice,
  endAtClose,
  monthsBelowZero,
  noticeDue,
} from './bankruptcy.ts'
import { endOfMonth } from './calendar.ts'
import { createInitialState, startChallenge, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import { applyEffect } from './effects.ts'
import { NO_EVENTS, resolveEvent } from './events.ts'
import { FINANCING, noFinancing } from './financing.ts'
import { cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { deserialize, serialize } from './save.ts'
import { STAFF } from './staff.ts'
import type { Day, EventRecord, GameState } from './types.ts'

// The bankruptcy (#160): six whole calendar months below zero end the game
// at the close of the sixth one's last day, and Mme Prudhomme's letters
// come after one, three and five. A game is pushed far below zero by a bill
// on the morning of June 1st, day 31, so every close from then on is below
// zero: Premier avis the morning of July 1st, Deuxième avis on September
// 1st, Dernier avis on November 1st, and the end at the close of November
// 30th.

const SEED = 42
const CASH: AccountCode = '1000'
const SHARE_CAPITAL: AccountCode = '3000'

const JUNE_1 = 31
const JULY_1 = 61
const SEPTEMBER_1 = 123
const SEPTEMBER_15 = 137
const NOVEMBER_1 = 184
const NOVEMBER_30 = 213
/** The new run's dates, when the count starts again on September 16th. */
const JANUARY_1 = 245
const MARCH_1 = 304
const MARCH_31 = 334

/** Far more than the truck could make up in a year. */
const DEEP = 10_000_000

/** The shipped cards with only the letters, which no draw brings. */
const NOTICES: EventContent = {
  ...EVENTS,
  events: EVENTS.events.filter(isNoticeCard),
}

/** The letters, with Mme Prudhomme's loan and Max Duvent's offer too. */
const WITH_FINANCING: EventContent = {
  ...EVENTS,
  events: EVENTS.events.filter(
    (card) =>
      isNoticeCard(card) ||
      card.id === FINANCING.loanEvent ||
      card.id === FINANCING.investorEvent,
  ),
}

/** One morning played with `events` and the financing's `rules`. */
function step(
  state: GameState,
  events: EventContent = NOTICES,
  rules: FinancingContent = FINANCING,
): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    events,
    DEFIS,
    PERCENTILES,
    BAKERY,
    GROCERS,
    STAFF,
    rules,
  )
}

/**
 * `state` with the card waiting answered: « Compris » for a letter,
 * « Accepter » for the others.
 */
function answer(
  state: GameState,
  events: EventContent = NOTICES,
  rules: FinancingContent = FINANCING,
): GameState {
  const { pending } = state.events
  if (pending === null) return state
  const card = events.events.find(({ id }) => id === pending.event)
  const choice =
    card !== undefined && isNoticeCard(card) ? 'compris' : 'accepter'
  return resolveEvent(state, choice, events, FOOD_TRUCK, DEFIS, GROCERS, rules)
}

/**
 * `from` played on to the morning of `day`, or to the morning after the
 * end, each card answered (see `answer`) but that morning's.
 */
function playUntil(
  from: GameState,
  day: Day,
  events: EventContent = NOTICES,
  rules: FinancingContent = FINANCING,
): GameState {
  let state = from
  while (state.day < day && state.ended === null) {
    state = step(answer(state, events, rules), events, rules)
  }
  return state
}

/** A bill that leaves Encaisse `short` below zero, before the day plays. */
function bill(state: GameState, short: number = DEEP): GameState {
  const cash = balance(state.journal, CASH, { toDay: state.day })
  return applyEffect(
    state,
    {
      kind: 'charge',
      amountCents: cents(Math.max(cash, 0) + short),
      description: 'Facture imprévue',
    },
    FOOD_TRUCK,
    'test',
  )
}

/**
 * The morning of `morning.day` with the owner putting in what leaves
 * Encaisse at `target` at its close: nothing the day plays reads the
 * encaisse, so the day's own cash flows are the same.
 */
function closingAt(morning: GameState, target: number): GameState {
  const dry = playDay(morning)
  const gap = target - balance(dry.journal, CASH, { toDay: morning.day })
  return {
    ...morning,
    journal: postEntry(morning.journal, {
      day: morning.day,
      memo: 'Mise de fonds',
      lines: [
        { account: CASH, debit: cents(gap), credit: cents(0) },
        { account: SHARE_CAPITAL, debit: cents(0), credit: cents(gap) },
      ],
    }),
  }
}

/** The letters among `state`'s events, by the morning they came. */
function letters({ events }: GameState): [Day, string][] {
  return events.history
    .filter(({ event }) =>
      FINANCING.bankruptcy.notices.some((n) => n.event === event),
    )
    .map(({ day, event }) => [day, event])
}

/** The morning of June 1st, the bill in, with no event in play before. */
const BILLED = bill(playUntil(createInitialState(SEED), JUNE_1, NO_EVENTS))
/** The morning after the end, the letters answered. */
const ENDED = playUntil(BILLED, 400)

describe('monthsBelowZero', () => {
  it.each<[string, Day | null, Day, number]>([
    ['no close below zero', null, NOVEMBER_30, 0],
    ['a run that starts after the day', JULY_1, JUNE_1, 0],
    ['a run from June 1st, at its first close', JUNE_1, JUNE_1, 0],
    ['a run from June 1st, at the close of June 29th', JUNE_1, JULY_1 - 2, 0],
    ['a run from June 1st, at the close of June 30th', JUNE_1, JULY_1 - 1, 1],
    ['a run from June 1st, mid-July', JUNE_1, JULY_1 + 14, 1],
    [
      'a run from June 1st, at the close of August 31st',
      JUNE_1,
      SEPTEMBER_1 - 1,
      3,
    ],
    [
      'a run from June 1st, at the close of November 30th',
      JUNE_1,
      NOVEMBER_30,
      6,
    ],
    [
      'a run from June 2nd, at the close of June 30th',
      JUNE_1 + 1,
      JULY_1 - 1,
      0,
    ],
    ['a run from June 2nd, at the close of July 31st', JUNE_1 + 1, 91, 1],
    ['a run from day 0, at the close of May 31st', 0, JUNE_1 - 1, 1],
    ['a run from May 31st, over the new year', JUNE_1 - 1, MARCH_31, 10],
  ])('%s', (_, since, day, months) => {
    expect(monthsBelowZero(since, day)).toBe(months)
  })
})

describe('endAtClose', () => {
  const below = (since: Day | null) => ({
    ...noFinancing(),
    belowZeroSince: since,
  })

  it('ends the game at the close of the sixth whole month, and not before', () => {
    expect(
      endAtClose({
        day: NOVEMBER_30,
        challenge: null,
        financing: below(JUNE_1),
      }),
    ).toEqual({ reason: 'bankruptcy', day: NOVEMBER_30 })
    expect(
      endAtClose({
        day: NOVEMBER_30 - 1,
        challenge: null,
        financing: below(JUNE_1),
      }),
    ).toBeNull()
    expect(
      endAtClose({
        day: NOVEMBER_30,
        challenge: null,
        financing: below(JUNE_1 + 1),
      }),
    ).toBeNull()
    expect(
      endAtClose({ day: NOVEMBER_30, challenge: null, financing: below(null) }),
    ).toBeNull()
  })

  it('ends a run longer still, such as an older save’s, at its next month’s last close only', () => {
    const financing = below(JUNE_1)
    expect(
      endAtClose({ day: NOVEMBER_30 + 10, challenge: null, financing }),
    ).toBeNull()
    expect(
      endAtClose({
        day: endOfMonth(NOVEMBER_30 + 1),
        challenge: null,
        financing,
      }),
    ).toEqual({ reason: 'bankruptcy', day: endOfMonth(NOVEMBER_30 + 1) })
  })

  it('follows the months the rules set', () => {
    const rules: FinancingContent = {
      ...FINANCING,
      bankruptcy: { months: 2, notices: [] },
    }
    expect(
      endAtClose(
        { day: SEPTEMBER_1 - 32, challenge: null, financing: below(JUNE_1) },
        rules,
      ),
    ).toEqual({ reason: 'bankruptcy', day: SEPTEMBER_1 - 32 })
  })

  it('never ends a Défi', () => {
    const { challenge } = startChallenge('moisSansConge', SEED)
    expect(
      endAtClose({ day: NOVEMBER_30, challenge, financing: below(JUNE_1) }),
    ).toBeNull()
  })
})

describe('six months below zero', () => {
  it('starts the run at the close of the bill’s day', () => {
    expect(step(BILLED).financing.belowZeroSince).toBe(JUNE_1)
  })

  it('end the game at the close of November 30th, and the morning after brings no card', () => {
    expect(ENDED.ended).toEqual({ reason: 'bankruptcy', day: NOVEMBER_30 })
    expect(ENDED.day).toBe(NOVEMBER_30 + 1)
    expect(ENDED.lastDay?.day).toBe(NOVEMBER_30)
    expect(ENDED.events.pending).toBeNull()
    expect(balance(ENDED.journal, CASH, { toDay: NOVEMBER_30 })).toBeLessThan(0)
  })

  it('leave the game ended at the close itself, as playDay() returns it', () => {
    const lastMorning = playUntil(BILLED, NOVEMBER_30)
    expect(lastMorning.ended).toBeNull()
    expect(playDay(lastMorning).ended).toEqual({
      reason: 'bankruptcy',
      day: NOVEMBER_30,
    })
  })

  it('play no day after', () => {
    const reason = `Day ${NOVEMBER_30 + 1} cannot be played: the game ended in bankruptcy on day ${NOVEMBER_30}`
    expect(() => step(ENDED)).toThrow(reason)
    expect(() => playDay(ENDED)).toThrow(reason)
  })

  it('bring Mme Prudhomme’s letters the mornings after one, three and five whole months', () => {
    expect(letters(ENDED)).toEqual([
      [JULY_1, 'premierAvis'],
      [SEPTEMBER_1, 'deuxiemeAvis'],
      [NOVEMBER_1, 'dernierAvis'],
    ])
    const record = ENDED.events.history.find(
      ({ event }) => event === 'premierAvis',
    )
    expect(record).toEqual<EventRecord>({
      day: JULY_1,
      event: 'premierAvis',
      followUp: false,
      choice: 'compris',
      outcome: 0,
    })
  })

  it('bring each letter as a draw that morning, and its choice changes nothing', () => {
    const waiting = playUntil(BILLED, JULY_1)
    expect(waiting.events.pending).toEqual({
      event: 'premierAvis',
      followUp: false,
    })
    expect(waiting.events.lastDrawnDay).toBe(JULY_1)
    const read = answer(waiting)
    expect(read.journal).toBe(waiting.journal)
    expect(read.rngState).toBe(waiting.rngState)
    expect({ ...read, events: waiting.events }).toEqual(waiting)
  })

  it('end the game on the same day with no event in play, and bring no letter', () => {
    const quiet = playUntil(BILLED, 400, NO_EVENTS)
    expect(quiet.ended).toEqual({ reason: 'bankruptcy', day: NOVEMBER_30 })
    expect(quiet.events.history).toEqual([])
  })

  it('leave the books and the generator as a game with no event leaves them', () => {
    const quiet = playUntil(BILLED, 400, NO_EVENTS)
    expect(ENDED.rngState).toBe(quiet.rngState)
    expect(ENDED.journal.entries).toEqual(quiet.journal.entries)
  })

  it('wait a morning for another card, and come on the next free one', () => {
    // Max Duvent comes 30 days after the loan of June 2nd: on July 1st.
    const rules: FinancingContent = { ...FINANCING, investorDaysAfterLoan: 29 }
    const played = playUntil(BILLED, 400, WITH_FINANCING, rules)
    expect(played.financing.loans.map(({ day }) => day)).toEqual([JUNE_1 + 1])
    expect(played.financing.shareSales.map(({ day }) => day)).toEqual([JULY_1])
    expect(letters(played)).toEqual([
      [JULY_1 + 1, 'premierAvis'],
      [SEPTEMBER_1, 'deuxiemeAvis'],
      [NOVEMBER_1, 'dernierAvis'],
    ])
    expect(played.ended).toEqual({ reason: 'bankruptcy', day: NOVEMBER_30 })
  })

  it('bring a letter once a run, even once saved and loaded', () => {
    const read = answer(playUntil(BILLED, JULY_1))
    const loaded = deserialize(serialize(read))
    expect(loaded).toStrictEqual(read)
    expect(letters(playUntil(loaded, 400))).toEqual(letters(ENDED))
    const waiting = playUntil(BILLED, SEPTEMBER_1)
    expect(deserialize(serialize(waiting))).toStrictEqual(waiting)
  })

  it.each([
    ['at zero', 0],
    ['above zero', 100_00],
  ])(
    'start again after a close %s in the fourth month, the end moving to the sixth month of the new run, its letters coming again',
    (_, target) => {
      const mid = playUntil(BILLED, SEPTEMBER_15)
      const back = step(closingAt(mid, target))
      expect(balance(back.journal, CASH, { toDay: SEPTEMBER_15 })).toBe(target)
      expect(back.financing.belowZeroSince).toBeNull()
      expect(back.events.pending).toBeNull()
      // From September 16th, its first whole month is October.
      const again = step(bill(back))
      expect(again.financing.belowZeroSince).toBe(SEPTEMBER_15 + 1)
      const ended = playUntil(again, 400)
      expect(ended.ended).toEqual({ reason: 'bankruptcy', day: MARCH_31 })
      expect(letters(ended)).toEqual([
        [JULY_1, 'premierAvis'],
        [SEPTEMBER_1, 'deuxiemeAvis'],
        [NOVEMBER_1, 'premierAvis'],
        [JANUARY_1, 'deuxiemeAvis'],
        [MARCH_1, 'dernierAvis'],
      ])
    },
  )
})

describe('noticeDue and bankruptcyNotice', () => {
  const read = (state: GameState, day: Day, event: string): GameState => ({
    ...state,
    events: {
      ...state.events,
      history: [
        ...state.events.history,
        { day, event, followUp: false, choice: 'compris', outcome: 0 },
      ],
    },
  })

  it('give the last letter the months reach, unless the run had it', () => {
    const morning = playUntil(BILLED, SEPTEMBER_1 + 10)
    expect(noticeDue(morning)).toBeNull()
    const lost = { ...morning, events: { ...morning.events, history: [] } }
    expect(noticeDue(lost)).toBe('deuxiemeAvis')
    expect(noticeDue(read(lost, JUNE_1, 'deuxiemeAvis'))).toBe('deuxiemeAvis')
    expect(noticeDue(read(lost, JUNE_1 + 1, 'deuxiemeAvis'))).toBeNull()
  })

  it('give none before a whole month, nor above zero', () => {
    expect(noticeDue(playUntil(BILLED, JULY_1 - 1))).toBeNull()
    expect(noticeDue(createInitialState(SEED))).toBeNull()
  })

  it('bring nothing while a card waits or was chosen that morning, once ended, or for a letter the content does not hold', () => {
    const due = {
      ...playUntil(BILLED, JULY_1),
      events: playUntil(BILLED, JULY_1 - 1).events,
    }
    expect(noticeDue(due)).toBe('premierAvis')
    expect(bankruptcyNotice(due, NOTICES).events.pending?.event).toBe(
      'premierAvis',
    )
    const waiting = {
      ...due,
      events: {
        ...due.events,
        pending: { event: 'pretUrgence', followUp: false },
      },
    }
    expect(bankruptcyNotice(waiting, NOTICES)).toBe(waiting)
    const chosen = read(due, JULY_1, 'pretUrgence')
    expect(bankruptcyNotice(chosen, NOTICES)).toBe(chosen)
    const ended = {
      ...due,
      ended: { reason: 'bankruptcy' as const, day: JULY_1 - 1 },
    }
    expect(bankruptcyNotice(ended, NOTICES)).toBe(ended)
    expect(bankruptcyNotice(due, NO_EVENTS)).toBe(due)
  })

  it('bring nothing in a Défi, below zero however long', () => {
    const defi = startChallenge('moisSansConge', SEED)
    const below = {
      ...defi,
      day: JULY_1,
      financing: { ...defi.financing, belowZeroSince: JUNE_1 },
      events: { ...defi.events, pending: null },
    }
    expect(noticeDue(below)).toBeNull()
    expect(bankruptcyNotice(below, NOTICES)).toBe(below)
  })
})
