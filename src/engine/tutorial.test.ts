import { describe, expect, it } from 'vitest'
import {
  difficultyIdSchema,
  isNoticeCard,
  type DifficultyId,
  type EventContent,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance } from '../finance/journal.ts'
import { createInitialState, startTutorial, tick } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import { applyDecision, startingDecisions } from './decisions.ts'
import { applyEffect } from './effects.ts'
import { resolveEvent } from './events.ts'
import { FINANCING, noFinancing } from './financing.ts'
import { cents } from './money.ts'
import { goTo, tripRefusal } from './places.ts'
import { defaultProfile } from './profile.ts'
import {
  TUTORIAL,
  completeStep,
  isProtected,
  openingTutorial,
  skipTutorial,
  tutorialDay,
  tutorialFacts,
  tutorialStepOf,
} from './tutorial.ts'
import type { Day, GameState } from './types.ts'

// The tutorial game (#236): seven protected, scripted days, then the same
// game, unprotected. Tutorial day N is played on game day N − 1, so the
// story waits on the morning of game day 3 and the protection ends on the
// morning of game day 7.

const CASH: AccountCode = '1000'
const DIFFICULTIES_IDS = difficultyIdSchema.options
const STORY_MORNING = 3
const LAST_MORNING = 6

/** Far more than the truck could make up in a few months. */
const DEEP = 10_000_000

/**
 * The shipped cards coming every morning they may: from day 0, with no gap,
 * the essai card in the draw, so a day with no card is one the engine kept
 * it from.
 */
const EVERY_MORNING: EventContent = {
  ...EVENTS,
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
  events: EVENTS.events.map((card) =>
    card.id === 'essai' ? { ...card, weight: 1 } : card,
  ),
}

function tutorialAt(difficulty: DifficultyId = 'moyen'): GameState {
  return startTutorial({ ...defaultProfile(), difficulty })
}

/** One morning played with `events`. */
function step(state: GameState, events: EventContent = EVENTS): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    events,
  )
}

/** `state` with every step due that morning done, in order. */
function doSteps(state: GameState): GameState {
  let done = state
  for (let due = tutorialStepOf(done); due !== null;) {
    done = applyDecision(done, { kind: 'tutorialStep', step: due.id })
    due = tutorialStepOf(done)
  }
  return done
}

/** `state` with the card waiting, if any, answered with its first choice. */
function answer(state: GameState, events: EventContent = EVENTS): GameState {
  const { pending } = state.events
  if (pending === null) return state
  const card = events.events.find(({ id }) => id === pending.event)
  return resolveEvent(state, card?.choices[0]?.id ?? '', events)
}

/**
 * `from` played on to the morning of `day`, each card answered with its
 * first choice and each step done, but that morning's.
 */
function playUntil(
  from: GameState,
  day: Day,
  events: EventContent = EVENTS,
): GameState {
  let state = from
  while (state.day < day) state = step(doSteps(answer(state, events)), events)
  return state
}

/** A bill that leaves Encaisse far below zero, before the day plays. */
function bill(state: GameState): GameState {
  const cash = balance(state.journal, CASH, { toDay: state.day })
  return applyEffect(
    state,
    {
      kind: 'charge',
      amountCents: cents(Math.max(cash, 0) + DEEP),
      description: 'Facture imprévue',
    },
    FOOD_TRUCK,
    'test',
  )
}

describe('startTutorial', () => {
  it.each(DIFFICULTIES_IDS)(
    'opens a game at %s on the tutorial’s seed, its decisions and its first step',
    (difficulty) => {
      const profile = { ...defaultProfile(), difficulty }
      const state = startTutorial(profile)
      const opened = createInitialState(TUTORIAL.seed, FOOD_TRUCK, profile)
      const starting = startingDecisions()
      expect(state).toEqual({
        ...opened,
        decisions: {
          ...starting,
          prices: { ...starting.prices, cafe: 375 },
          restock: {
            ...starting.restock,
            croissant: { kind: 'buyDaily', quantity: 40 },
          },
          daysOpen: [1, 2, 3, 4, 5, 6, 7],
        },
        tutorial: {
          step: 'bienvenue',
          startedDay: 0,
          endsDay: 7,
          done: false,
          skipped: false,
        },
      })
      expect(state.journal).toEqual(opened.journal)
      expect(isProtected(state)).toBe(true)
      expect(tutorialDay(state)).toBe(1)
    },
  )

  it('refuses decisions that give a product another kind of restock rule', () => {
    const broken = {
      ...TUTORIAL,
      decisions: {
        restock: { cafe: { kind: 'buyDaily' as const, quantity: 10 } },
      },
    }
    expect(() =>
      startTutorial(defaultProfile(), FOOD_TRUCK, DIFFICULTIES, broken),
    ).toThrow(/restock\.cafe must stay a topUp rule/)
  })

  it('refuses decisions outside the content’s limits', () => {
    const broken = {
      ...TUTORIAL,
      decisions: { pricesCents: { cafe: cents(1) } },
    }
    expect(() =>
      startTutorial(defaultProfile(), FOOD_TRUCK, DIFFICULTIES, broken),
    ).toThrow(RangeError)
  })
})

describe('the steps', () => {
  it('come in order, day by day, and none is due before its day', () => {
    let state = tutorialAt()
    const seen: string[][] = []
    for (let day = 0; day <= LAST_MORNING; day += 1) {
      state = playUntil(state, day)
      const today: string[] = []
      for (let due = tutorialStepOf(state); due !== null;) {
        expect(due.day).toBe(day + 1)
        today.push(due.id)
        state = completeStep(answer(state), due.id)
        due = tutorialStepOf(state)
      }
      seen.push(today)
    }
    expect(seen).toEqual([
      ['bienvenue', 'ouvrirCamion', 'changerPrix', 'lancerJour'],
      ['lireHier', 'commander'],
      ['tropCher', 'ajuster'],
      ['evenement'],
      ['accelerer', 'pause'],
      ['encaisse', 'finances'],
      ['aurevoir'],
    ])
    expect(state.tutorial?.step).toBeNull()
    expect(isProtected(state)).toBe(true)
  })

  it('are marked done by applyDecision at once, the decisions left waiting as they were', () => {
    const state = applyDecision(tutorialAt(), {
      kind: 'price',
      product: 'cafe',
      price: cents(350),
    })
    const done = applyDecision(state, {
      kind: 'tutorialStep',
      step: 'bienvenue',
    })
    expect(done).toEqual({
      ...state,
      tutorial: { ...state.tutorial, step: 'ouvrirCamion' },
    })
    expect(done.pendingDecisions).toBe(state.pendingDecisions)
  })

  it('refuse another step than the one due, a later day’s, an unknown one, and any once the tutorial is done or absent', () => {
    const state = tutorialAt()
    expect(() => completeStep(state, 'ouvrirCamion')).toThrow(RangeError)
    expect(() => completeStep(state, 'inconnu')).toThrow(RangeError)
    const dayOne = doSteps(state)
    expect(tutorialStepOf(dayOne)).toBeNull()
    expect(dayOne.tutorial?.step).toBe('lireHier')
    expect(() => completeStep(dayOne, 'lireHier')).toThrow(
      /the step due on day 0 is none/,
    )
    expect(() => completeStep(skipTutorial(state), 'bienvenue')).toThrow(
      RangeError,
    )
    expect(() => completeStep(createInitialState(1), 'bienvenue')).toThrow(
      /no tutorial under way/,
    )
  })
})

describe('tick during the tutorial', () => {
  it('refuses a day with a step left, naming it', () => {
    expect(() => step(tutorialAt())).toThrow(
      "Day 0 cannot be played: the tutorial's step bienvenue is not done",
    )
    const halfway = completeStep(
      completeStep(tutorialAt(), 'bienvenue'),
      'ouvrirCamion',
    )
    expect(() => step(halfway)).toThrow(/step changerPrix is not done/)
    expect(step(doSteps(halfway)).day).toBe(1)
  })

  it('plays every day once skipped, unprotected', () => {
    const skipped = skipTutorial(tutorialAt())
    expect(skipped.tutorial).toEqual({
      ...openingTutorial(),
      step: null,
      done: true,
      skipped: true,
    })
    expect(isProtected(skipped)).toBe(false)
    expect(tutorialStepOf(skipped)).toBeNull()
    const morning = step(skipped, EVERY_MORNING)
    expect(morning.day).toBe(1)
    expect(morning.events.pending).not.toBeNull()
  })

  it('cannot skip a tutorial done, or none', () => {
    expect(() => skipTutorial(skipTutorial(tutorialAt()))).toThrow(RangeError)
    expect(() => skipTutorial(createInitialState(1))).toThrow(RangeError)
  })

  it('brings Coralie’s story on the morning of tutorial day 4, with the content that holds it', () => {
    const morning = playUntil(tutorialAt(), STORY_MORNING)
    expect(morning.events.pending).toEqual({
      event: 'tutoStory',
      followUp: false,
    })
    expect(morning.events.lastDrawnDay).toBe(STORY_MORNING)
    expect(tutorialStepOf(morning)?.id).toBe('evenement')
    expect(() => step(doSteps(morning))).toThrow(/tutoStory is waiting/)
    const without = playUntil(tutorialAt(), STORY_MORNING, {
      ...EVENTS,
      events: [],
    })
    expect(without.events.pending).toBeNull()
  })

  it('ends the protection on the morning of tutorial day 8, and changes nothing else', () => {
    const last = doSteps(playUntil(tutorialAt(), LAST_MORNING))
    const morning = step(last)
    expect(morning.day).toBe(7)
    expect(morning.tutorial).toEqual({ ...last.tutorial, done: true })
    expect(isProtected(morning)).toBe(false)
    const game: GameState = { ...last, tutorial: undefined }
    expect({ ...morning, tutorial: undefined }).toEqual(step(game))
  })

  it('keeps every card, the financing’s and the letters away until day 8, even below zero, then brings them back', () => {
    const events = EVERY_MORNING
    let state = bill(tutorialAt())
    const cards: { day: Day; event: string }[] = []
    while (state.day < 120) {
      const { pending } = state.events
      if (pending !== null) cards.push({ day: state.day, event: pending.event })
      state = step(doSteps(answer(state, events)), events)
    }
    expect(cards.filter(({ day }) => day < 7)).toEqual([
      { day: STORY_MORNING, event: 'tutoStory' },
    ])
    const after = cards.filter(({ day }) => day >= 7)
    const cardOf = (id: string) => events.events.find((card) => card.id === id)
    expect(after[0]).toEqual({ day: 7, event: FINANCING.loanEvent })
    expect(after.some(({ event }) => (cardOf(event)?.weight ?? 0) > 0)).toBe(
      true,
    )
    expect(
      after.some(({ event }) => {
        const card = cardOf(event)
        return card !== undefined && isNoticeCard(card)
      }),
    ).toBe(true)
    expect(after.some(({ event }) => event === 'tutoStory')).toBe(false)
  })

  it.each([1, 2, 3, 4, 5])(
    'at Difficile, on protected day %d, takes the trip to the Caisse only to bring her card the next morning',
    (day) => {
      // The tour's encaisse falls below a month of fixed costs at Difficile
      // (#273): a trip the Caisse takes must not be for nothing.
      const morning = doSteps(answer(playUntil(tutorialAt('difficile'), day)))
      expect(isProtected(morning)).toBe(true)
      if (tripRefusal(morning, 'caisse') !== null) return
      const next = step(goTo(morning, 'caisse'))
      expect(next.events.pending).toEqual({
        event: FINANCING.appointmentEvent,
        followUp: false,
      })
      expect(next.financing.lastLoanRequestDay).toBe(day + 1)
    },
  )

  it('ends no game while it protects it', () => {
    // An artificial tutorial still under way at the close of November 30,
    // after six whole months below zero (see bankruptcy.test.ts).
    const november30 = 213
    const morning: GameState = bill({
      ...createInitialState(1),
      day: november30,
      financing: { ...noFinancing(), belowZeroSince: 31 },
    })
    expect(playDay(morning).ended).toEqual({
      reason: 'bankruptcy',
      day: november30,
    })
    const protectedMorning = {
      ...morning,
      tutorial: { ...openingTutorial(), endsDay: 400 },
    }
    expect(playDay(protectedMorning).ended).toBeNull()
  })

  it.each(DIFFICULTIES_IDS)(
    'plays the same seven days twice at %s',
    (difficulty) => {
      const once = playUntil(tutorialAt(difficulty), 7)
      const twice = playUntil(tutorialAt(difficulty), 7)
      expect(twice).toEqual(once)
      expect(once.tutorial?.done).toBe(true)
    },
  )
})

describe('tutorialFacts', () => {
  it('says nothing before the first day', () => {
    expect(tutorialFacts(tutorialAt())).toEqual({
      croissantShortage: false,
      cafeTooExpensive: false,
    })
  })

  it.each(DIFFICULTIES_IDS)(
    'finds the croissants short on day 1 and the café too expensive on day 2, at %s, with the starting decisions',
    (difficulty) => {
      const dayTwo = playUntil(tutorialAt(difficulty), 1)
      expect(dayTwo.lastDay?.lostSales.croissant).toBeGreaterThan(0)
      expect(tutorialFacts(dayTwo).croissantShortage).toBe(true)
      const dayThree = playUntil(dayTwo, 2)
      expect(dayThree.lastDay?.pricedOut.cafe).toBeGreaterThan(0)
      expect(tutorialFacts(dayThree).cafeTooExpensive).toBe(true)
    },
  )

  it('finds neither when the player fixed both on day 1', () => {
    // The bargain hunters' café reference is 2,30 $; nobody's is lower.
    let state = applyDecision(tutorialAt(), {
      kind: 'price',
      product: 'cafe',
      price: cents(230),
    })
    state = applyDecision(state, {
      kind: 'restock',
      product: 'croissant',
      rule: { kind: 'buyDaily', quantity: 150 },
    })
    const dayThree = playUntil(state, 2)
    expect(tutorialFacts(dayThree)).toEqual({
      croissantShortage: false,
      cafeTooExpensive: false,
    })
  })
})
