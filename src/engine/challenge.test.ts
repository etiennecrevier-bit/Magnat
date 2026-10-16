import { describe, expect, it } from 'vitest'
import {
  loadDefiContent,
  loadEventContent,
  type DefiContent,
  type EventContent,
} from '../content/schema.ts'
import { balance, entriesOf } from '../finance/journal.ts'
import { loanSchedule } from '../finance/loan.ts'
import { incomeStatement } from '../finance/statements.ts'
import {
  allowedChoices,
  challengeDifficulties,
  defiById,
  failedCondition,
  isLocked,
  spoilageRate,
  verdict,
} from './challenge.ts'
import { createInitialState, startChallenge, tick } from './clock.ts'
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
import { NO_EVENTS, noEvents, resolveEvent } from './events.ts'
import { PRODUCTS } from './inventory.ts'
import { cents, type Cents } from './money.ts'
import { defaultProfile } from './profile.ts'
import type { ChallengeProgress, GameState, PerProduct } from './types.ts'

type Json = Record<string, unknown>

const SEED = 42
const CASH = '1000'

/**
 * A Défi of a week from Monday, May 8th, day 7, at Facile, with nothing
 * forced and a medal by ventes; `fields` replace its own.
 */
function defi(fields: Json = {}): Json {
  return {
    id: 'essai',
    title: 'Un essai',
    story: 'Une semaine pour essayer.',
    difficulty: 'facile',
    start: { month: 5, dayOfMonth: 8 },
    lengthDays: 7,
    setup: {},
    locked: [],
    modifiers: [],
    events: [],
    randomEvents: false,
    goal: {
      metric: 'sales',
      medals: { or: 300_000, argent: 200_000, bronze: 100_000 },
    },
    conditions: [],
    ...fields,
  }
}

function defis(list: Json[], events: EventContent = EVENTS): DefiContent {
  return loadDefiContent({ defis: list }, events)
}

/** The next morning, with the shipped content, `events` and `content`. */
function next(
  state: GameState,
  content: DefiContent,
  events: EventContent = EVENTS,
): GameState {
  return tick(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    events,
    content,
  )
}

/** The close of `state.day`, with the shipped content and `content`. */
function close(state: GameState, content: DefiContent): GameState {
  return playDay(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    content,
  )
}

/** The shipped essai card alone, drawn every morning it may be. */
const EVERY_MORNING: EventContent = loadEventContent({
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
  events: EVENTS.events
    .filter(({ id }) => id === 'essai')
    .map((card) => ({ ...card, weight: 1 })),
})

/** A card with one sure outcome per choice, each with its `effects`. */
function card(
  id: string,
  choices: Record<string, unknown[]>,
  conditions?: Json,
): Json {
  return {
    id,
    weight: 1,
    character: { id: 'gerant', name: 'Le gérant', role: 'Gérant' },
    title: 'Un appel',
    situation: 'Le téléphone sonne.',
    ...(conditions === undefined ? {} : { conditions }),
    choices: Object.entries(choices).map(([choice, effects]) => ({
      id: choice,
      label: choice,
      tags: ['Essai'],
      outcomes: [{ chance: 1, result: 'Voilà.', effects }],
    })),
  }
}

/**
 * A call that brings a callback the next morning, the callback, and a card
 * with nothing to it, all drawn every morning they may be.
 */
const CALLS: EventContent = loadEventContent({
  pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
  events: [
    card('appel', {
      rappeler: [{ kind: 'followUp', event: 'rappel', days: 1 }],
      raccrocher: [],
    }),
    card('rappel', { oui: [], non: [] }, { followUpOnly: true }),
    card('rien', { oui: [], non: [] }),
  ],
})

/** What an entry moves in Encaisse. */
function cashOf({ lines }: { lines: readonly Json[] }): number {
  return lines.reduce<number>(
    (moved, line) =>
      line.account === CASH
        ? moved + (line.debit as number) - (line.credit as number)
        : moved,
    0,
  )
}

function units(perProduct: PerProduct): number {
  return PRODUCTS.reduce((total, product) => total + perProduct[product], 0)
}

/** Every event waiting answered with `choice`, until the Défi is over. */
function playedOut(
  state: GameState,
  content: DefiContent,
  choice: string,
  events: EventContent = EVENTS,
): GameState {
  let played = state
  while (played.challenge?.status === 'enCours') {
    if (played.events.pending !== null) {
      played = resolveEvent(played, choice, events, FOOD_TRUCK, content)
    }
    played = next(played, content, events)
  }
  return played
}

describe('startChallenge', () => {
  const OPENING = defis([
    defi({
      id: 'ouverture',
      difficulty: 'moyen',
      setup: {
        cashCents: 350_000,
        prices: { cafe: 350 },
        restock: { croissant: { kind: 'buyDaily', quantity: 40 } },
        daysOpen: [7, 1, 2, 3, 4, 5, 6],
        ownerWeeklyPayCents: 50_000,
        marketingDailyCents: 1_000,
        energy: 80,
      },
      modifiers: [
        {
          day: 0,
          days: 5,
          event: 'conesOrange',
          change: { kind: 'walkIns', factor: 0.65 },
        },
        {
          day: 3,
          days: 2,
          event: 'festival',
          change: { kind: 'walkIns', factor: 1.8 },
        },
      ],
      events: [{ day: 0, event: 'essai', choices: ['rienFaire'] }],
    }),
  ])
  const moyen = { ...defaultProfile(), difficulty: 'moyen' as const }
  const opening = challengeDifficulties(
    defiById(OPENING, 'ouverture'),
    DIFFICULTIES,
  )

  it('opens a game of its difficulty with its cash on day 0, then moves to the morning of its first day with its setup, its changes to the street and its event', () => {
    const state = startChallenge('ouverture', SEED, FOOD_TRUCK, OPENING)
    const start = startingDecisions()
    expect(state).toStrictEqual({
      ...createInitialState(SEED, FOOD_TRUCK, moyen, opening),
      day: 7,
      decisions: {
        prices: { ...start.prices, cafe: 350 },
        restock: {
          ...start.restock,
          croissant: { kind: 'buyDaily', quantity: 40 },
        },
        daysOpen: [1, 2, 3, 4, 5, 6, 7],
        ownerWeeklyPay: 50_000,
        marketingDaily: 1_000,
      },
      energy: 80,
      events: {
        ...noEvents(),
        pending: { event: 'essai', followUp: false },
        lastDrawnDay: 7,
        delayed: [
          {
            day: 10,
            event: 'festival',
            effect: { kind: 'walkIns', factor: 1.8, days: 2 },
          },
        ],
        modifiers: [
          {
            event: 'conesOrange',
            change: { kind: 'walkIns', factor: 0.65 },
            fromDay: 7,
            lastDay: 11,
          },
        ],
      },
      challenge: {
        id: 'ouverture',
        startDay: 7,
        progress: {
          daysPlayed: 0,
          sales: 0,
          netIncome: 0,
          lowestCash: 350_000,
          customersServed: 0,
          unitsSold: 0,
          unitsSpoiled: 0,
          lowestEnergy: 80,
        },
        lowestEnergySinceClose: 80,
        status: 'enCours',
        medal: null,
      },
    })
    expect(balance(state.journal, CASH, { toDay: 6 })).toBe(350_000)
    expect(entriesOf(state.journal).every(({ day }) => day === 0)).toBe(true)
  })

  it("opens a Défi that sets nothing as a new game of its difficulty, with the player's name and avatar, on its first day", () => {
    const simple = defis([
      defi({
        id: 'simple',
        difficulty: 'difficile',
        start: { month: 5, dayOfMonth: 1 },
      }),
    ])
    const player = {
      businessName: 'Chez Lou',
      avatar: 'homme',
      difficulty: 'facile',
    } as const
    const state = startChallenge(
      'simple',
      SEED,
      FOOD_TRUCK,
      simple,
      DIFFICULTIES,
      player,
    )
    const game = createInitialState(SEED, FOOD_TRUCK, {
      ...player,
      difficulty: 'difficile',
    })
    expect(state).toStrictEqual({
      ...game,
      challenge: {
        id: 'simple',
        startDay: 0,
        progress: {
          daysPlayed: 0,
          sales: 0,
          netIncome: 0,
          lowestCash: game.weekSoFar.cashAtStart,
          customersServed: 0,
          unitsSold: 0,
          unitsSpoiled: 0,
          lowestEnergy: 100,
        },
        lowestEnergySinceClose: 100,
        status: 'enCours',
        medal: null,
      },
    })
  })

  it.each([
    ['a Défi of no such id', 'inconnu', {}, 'Unknown Défi: inconnu'],
    ['a price off the step', 'essai', { prices: { cafe: 327 } }, 'prices.cafe'],
    [
      'a price above the limit',
      'essai',
      { prices: { cafe: 5_000 } },
      'prices.cafe',
    ],
    ['the same day open twice', 'essai', { daysOpen: [1, 1] }, 'daysOpen'],
    [
      'a restock rule of another kind',
      'essai',
      { restock: { cafe: { kind: 'buyDaily', quantity: 10 } } },
      'restock.cafe must stay a topUp rule',
    ],
  ])('throws a RangeError on %s', (_, id, setup, message) => {
    const content = defis([defi({ setup })])
    expect(() => startChallenge(id, SEED, FOOD_TRUCK, content)).toThrow(
      RangeError,
    )
    expect(() => startChallenge(id, SEED, FOOD_TRUCK, content)).toThrow(message)
  })
})

describe('the progress of a Défi', () => {
  // Two weeks at Moyen with « Essai » forced on day 2: a cash sale, sales
  // on credit, charges, stock bought and used, the owner tired and the
  // truck closed a day later, all on the books.
  const TRIED = defis([
    defi({
      id: 'suivi',
      difficulty: 'moyen',
      lengthDays: 14,
      events: [{ day: 2, event: 'essai', choices: ['toutEssayer'] }],
      goal: {
        metric: 'netIncome',
        medals: { or: 1_000_000, argent: 500_000, bronze: -1_000_000 },
      },
    }),
  ])

  it('adds each close: ventes and bénéfice from the état des résultats, the lowest cash after any entry, the visits served, the units sold and spoiled, and the lowest energy', () => {
    let state = startChallenge('suivi', SEED, FOOD_TRUCK, TRIED)
    const opening = entriesOf(state.journal).length
    let served = 0
    let sold = 0
    let spoiled = 0
    let lowestEnergy = state.energy
    let closes = 0
    while (state.challenge?.status === 'enCours') {
      if (state.events.pending !== null) {
        state = resolveEvent(state, 'toutEssayer', EVENTS, FOOD_TRUCK, TRIED)
      }
      const closing = close(state, TRIED)
      const { lastDay, journal } = closing
      if (lastDay === null) throw new Error('No day was played')
      served += lastDay.visits.filter((v) => v.servedMinute !== null).length
      sold += units(lastDay.sold)
      spoiled += units(lastDay.spoiled)
      // No delayed effect of « Essai » changes the energy.
      lowestEnergy = Math.min(lowestEnergy, state.energy, lastDay.energy)
      let cash = 0
      let lowestCash = Infinity
      entriesOf(journal).forEach((entry, index) => {
        cash += cashOf(entry as unknown as { lines: Json[] })
        if (index >= opening - 1) lowestCash = Math.min(lowestCash, cash)
      })
      const income = incomeStatement(journal, 7, lastDay.day)
      expect(closing.challenge?.progress).toStrictEqual({
        daysPlayed: lastDay.day - 6,
        sales: income.sales.amount,
        netIncome: income.netIncome.amount,
        lowestCash,
        customersServed: served,
        unitsSold: sold,
        unitsSpoiled: spoiled,
        lowestEnergy,
      })
      state = next(state, TRIED)
      expect(state.challenge).toStrictEqual(closing.challenge)
      closes += 1
    }
    expect(closes).toBe(14)
    expect(state.challenge).toMatchObject({
      progress: { daysPlayed: 14 },
      status: 'reussi',
    })
    expect(spoiled).toBeGreaterThan(0)
  })

  it('keeps the cash a morning purchase took below zero, though the sales bring it back by the close', () => {
    // Tuesday, May 9th, with 100 $: the morning's purchases cost 294,50 $.
    const tight = defis([
      defi({
        id: 'serre',
        difficulty: 'moyen',
        start: { month: 5, dayOfMonth: 9 },
        setup: { cashCents: 10_000 },
        goal: {
          metric: 'lowestCash',
          medals: { or: 10_000, argent: 5_000, bronze: 0 },
        },
        conditions: [{ kind: 'minCash', amountCents: 0 }],
      }),
    ])
    const morning = startChallenge('serre', SEED, FOOD_TRUCK, tight)
    const closing = close(morning, tight)
    expect(balance(closing.journal, CASH, { toDay: 8 })).toBeGreaterThan(0)
    expect(closing.challenge).toMatchObject({
      progress: { daysPlayed: 1, lowestCash: -19_450 },
      status: 'echoue',
      medal: null,
    })
  })

  it("keeps the energy a morning's choice took, though a closed day gives it back by the close", () => {
    // Monday, closed, with 30 energy: « Essai » takes 10 that morning.
    const tired = defis([
      defi({
        id: 'fatigue',
        setup: { energy: 30 },
        events: [{ day: 0, event: 'essai', choices: ['toutEssayer'] }],
        goal: {
          metric: 'lowestEnergy',
          medals: { or: 30, argent: 25, bronze: 0 },
        },
        conditions: [{ kind: 'minEnergy', amount: 25 }],
      }),
    ])
    const morning = resolveEvent(
      startChallenge('fatigue', SEED, FOOD_TRUCK, tired),
      'toutEssayer',
      EVENTS,
      FOOD_TRUCK,
      tired,
    )
    expect(morning.energy).toBe(20)
    const closing = close(morning, tired)
    expect(closing.lastDay?.energy).toBe(65)
    expect(closing.challenge).toMatchObject({
      progress: { lowestEnergy: 20 },
      status: 'echoue',
      medal: null,
    })
  })

  it('keeps the energy the start of a day took, though a closed day gives it back by the close', () => {
    // « Ouvrir tôt pour les déménageurs » on Wednesday tires the owner by
    // 10 at the start of Thursday, a day off.
    const early = defis([
      defi({
        id: 'demenagement',
        setup: { daysOpen: [2, 3, 5, 6, 7] },
        events: [{ day: 2, event: 'premierJuillet', choices: ['ouvrirTot'] }],
      }),
    ])
    let state = startChallenge('demenagement', SEED, FOOD_TRUCK, early)
    while (state.day < 10) {
      if (state.events.pending !== null) {
        state = resolveEvent(state, 'ouvrirTot', EVENTS, FOOD_TRUCK, early)
      }
      state = next(state, early)
    }
    const before = state.challenge?.progress.lowestEnergy ?? 0
    expect(state.energy - 10).toBeLessThan(before)
    const thursday = close(state, early)
    expect(thursday.lastDay?.energy).toBeGreaterThan(state.energy - 10)
    expect(thursday.challenge?.progress.lowestEnergy).toBe(state.energy - 10)
  })

  // « Le remontant », forced on a closed Monday at 30 energy: « Maintenant »
  // takes 20 of the owner's energy and gives it back at once, « Demain »
  // takes 70 and gives it back at the start of the next day.
  const PICK_ME_UP: EventContent = loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 0 },
    events: [
      card('remontant', {
        maintenant: [
          { kind: 'energy', amount: -20 },
          { kind: 'energy', amount: 20 },
        ],
        demain: [
          { kind: 'energy', amount: -70, inDays: 1 },
          { kind: 'energy', amount: 70, inDays: 1 },
        ],
      }),
    ],
  })
  const pickMeUp = (choice: string, lengthDays: number): DefiContent =>
    defis(
      [
        defi({
          id: 'remontant',
          lengthDays,
          setup: { energy: 30, daysOpen: [3] },
          events: [{ day: 0, event: 'remontant', choices: [choice] }],
          goal: {
            metric: 'lowestEnergy',
            medals: { or: 30, argent: 25, bronze: 20 },
          },
          conditions: [{ kind: 'minEnergy', amount: 25 }],
        }),
      ],
      PICK_ME_UP,
    )

  it("keeps the energy a choice's effects took, though the next effect gives it back at once", () => {
    const content = pickMeUp('maintenant', 1)
    const morning = resolveEvent(
      startChallenge('remontant', SEED, FOOD_TRUCK, content),
      'maintenant',
      PICK_ME_UP,
      FOOD_TRUCK,
      content,
    )
    expect(morning.energy).toBe(30)
    expect(morning.challenge).toMatchObject({
      progress: { daysPlayed: 0, lowestEnergy: 30 },
      lowestEnergySinceClose: 10,
      status: 'enCours',
    })
    const after = next(morning, content, PICK_ME_UP)
    expect(after.lastDay?.energy).toBeGreaterThan(30)
    expect(after.challenge).toMatchObject({
      progress: { daysPlayed: 1, lowestEnergy: 10 },
      lowestEnergySinceClose: after.lastDay?.energy,
      status: 'echoue',
      medal: null,
    })
  })

  it('keeps the energy the start of a day took, though the next effect gives it back at once', () => {
    const content = pickMeUp('demain', 2)
    let state = resolveEvent(
      startChallenge('remontant', SEED, FOOD_TRUCK, content),
      'demain',
      PICK_ME_UP,
      FOOD_TRUCK,
      content,
    )
    expect(state.challenge?.lowestEnergySinceClose).toBe(30)
    // Monday closes at 75, and Tuesday opens at 80.
    state = next(state, content, PICK_ME_UP)
    expect(state.energy).toBe(80)
    expect(state.challenge).toMatchObject({
      progress: { daysPlayed: 1, lowestEnergy: 30 },
      lowestEnergySinceClose: state.lastDay?.energy,
      status: 'enCours',
    })
    const tuesday = close(state, content)
    expect(tuesday.lastDay?.energy).toBeGreaterThanOrEqual(80)
    expect(tuesday.challenge).toMatchObject({
      progress: { daysPlayed: 2, lowestEnergy: 10 },
      lowestEnergySinceClose: tuesday.lastDay?.energy,
      status: 'echoue',
      medal: null,
    })
  })

  it('counts the loan and the truck from the Défi’s first day, so a Défi that starts in July pays its first loan payment on August 1st, as the books hold it', () => {
    const summer = defis([
      defi({
        id: 'ete',
        difficulty: 'moyen',
        start: { month: 7, dayOfMonth: 10 },
        lengthDays: 28,
      }),
    ])
    const { truck } = DIFFICULTIES.difficulties.moyen
    if (truck.kind !== 'loan') throw new Error('Moyen borrows')
    const { payments } = loanSchedule(
      truck.loanCents,
      truck.annualRateBasisPoints,
      truck.termMonths,
    )
    const { priceCents, usefulLifeMonths } = FOOD_TRUCK.truck
    const august1st = 92
    /** What `state`'s close of August 1st posts, by memo. */
    const charged = (state: GameState): Record<string, Cents> => {
      let morning = state
      while (morning.day < august1st) {
        morning = next(morning, summer, NO_EVENTS)
      }
      const closing = close(morning, summer)
      return Object.fromEntries(
        entriesOf(closing.journal)
          .filter(({ day }) => day === august1st)
          .map(({ memo, lines }) => [memo, lines[0]?.debit ?? cents(0)]),
      )
    }

    const start = startChallenge('ete', SEED, FOOD_TRUCK, summer)
    expect(charged(start)).toMatchObject({
      "Intérêts sur l'emprunt": payments[0]?.interest,
      "Remboursement de l'emprunt": payments[0]?.principal,
      'Amortissement du camion': Math.floor(priceCents / usefulLifeMonths),
    })
    // A game from day 0 pays its third payment that day.
    expect(
      charged(
        createInitialState(SEED, FOOD_TRUCK, {
          ...defaultProfile(),
          difficulty: 'moyen',
        }),
      ),
    ).toMatchObject({
      "Intérêts sur l'emprunt": payments[2]?.interest,
      "Remboursement de l'emprunt": payments[2]?.principal,
    })
    // Nothing was charged before the Défi's first day, and the Défi's
    // bénéfice is that of the books over its days.
    const ended = playedOut(start, summer, 'rienFaire')
    expect(
      entriesOf(ended.journal).filter(({ day }) => day > 0 && day < 70),
    ).toEqual([])
    expect(ended.challenge?.progress.netIncome).toBe(
      incomeStatement(ended.journal, 70, 97).netIncome.amount,
    )
  })
})

describe('verdict', () => {
  const PROGRESS: ChallengeProgress = {
    daysPlayed: 7,
    sales: cents(0),
    netIncome: cents(0),
    lowestCash: cents(0),
    customersServed: 0,
    unitsSold: 0,
    unitsSpoiled: 0,
    lowestEnergy: 100,
  }
  const reached = (fields: Json) => {
    const content = defiById(defis([defi(fields)]), 'essai')
    return (progress: Partial<ChallengeProgress>) =>
      verdict({ ...PROGRESS, ...progress }, content)
  }
  const OR = { status: 'reussi', medal: 'or' }
  const ARGENT = { status: 'reussi', medal: 'argent' }
  const BRONZE = { status: 'reussi', medal: 'bronze' }
  const LOST = { status: 'echoue', medal: null }
  const UNDER_WAY = { status: 'enCours', medal: null }

  it.each([
    {
      metric: 'lowestCash',
      medals: { or: 300, argent: 200, bronze: -100 },
      at: (value: number) => ({ lowestCash: cents(value) }),
    },
    {
      metric: 'netIncome',
      medals: { or: 300, argent: 200, bronze: -100 },
      at: (value: number) => ({ netIncome: cents(value) }),
    },
    {
      metric: 'sales',
      medals: { or: 300, argent: 200, bronze: 100 },
      at: (value: number) => ({ sales: cents(value) }),
    },
    {
      metric: 'customersServed',
      medals: { or: 300, argent: 200, bronze: 100 },
      at: (value: number) => ({ customersServed: value }),
    },
    {
      metric: 'lowestEnergy',
      medals: { or: 60, argent: 40, bronze: 25 },
      at: (value: number) => ({ lowestEnergy: value }),
    },
  ])(
    'gives the best medal $metric reaches on the last day, and none before',
    ({ metric, medals, at }) => {
      const of = reached({ goal: { metric, medals } })
      expect(of(at(medals.or + 1))).toEqual(OR)
      expect(of(at(medals.or))).toEqual(OR)
      expect(of(at(medals.or - 1))).toEqual(ARGENT)
      expect(of(at(medals.argent))).toEqual(ARGENT)
      expect(of(at(medals.argent - 1))).toEqual(BRONZE)
      expect(of(at(medals.bronze))).toEqual(BRONZE)
      expect(of(at(medals.bronze - 1))).toEqual(LOST)
      expect(of({ ...at(medals.or), daysPlayed: 6 })).toEqual(UNDER_WAY)
    },
  )

  it('gives the medal of a spoilage rate, lower being better', () => {
    const of = reached({
      goal: {
        metric: 'spoilageRate',
        medals: { or: 0.01, argent: 0.05, bronze: 0.1 },
      },
    })
    const rate = (unitsSpoiled: number) => ({
      unitsSold: 100 - unitsSpoiled,
      unitsSpoiled,
    })
    expect(spoilageRate(PROGRESS)).toBe(0)
    expect(of({})).toEqual(OR)
    expect(of(rate(1))).toEqual(OR)
    expect(of(rate(2))).toEqual(ARGENT)
    expect(of(rate(5))).toEqual(ARGENT)
    expect(of(rate(6))).toEqual(BRONZE)
    expect(of(rate(10))).toEqual(BRONZE)
    expect(of(rate(11))).toEqual(LOST)
  })

  it.each([
    {
      condition: { kind: 'minCash', amountCents: 0 },
      broken: { lowestCash: cents(-1) },
      held: { lowestCash: cents(0) },
    },
    {
      condition: { kind: 'minEnergy', amount: 25 },
      broken: { lowestEnergy: 24.9 },
      held: { lowestEnergy: 25 },
    },
    {
      condition: { kind: 'maxSpoilageRate', rate: 0.03 },
      broken: { unitsSold: 96, unitsSpoiled: 4 },
      held: { unitsSold: 97, unitsSpoiled: 3 },
    },
  ])(
    'ends the Défi, lost, as soon as $condition.kind breaks, even with the goal met',
    ({ condition, broken, held }) => {
      const fields = {
        goal: {
          metric: 'sales',
          medals: { or: 0, argent: 0, bronze: 0 },
        },
        conditions: [condition],
      }
      const of = reached(fields)
      const content = defiById(defis([defi(fields)]), 'essai')
      expect(
        failedCondition({ ...PROGRESS, daysPlayed: 1, ...broken }, content),
      ).toEqual(condition)
      expect(of({ daysPlayed: 1, ...broken })).toEqual(LOST)
      expect(of({ daysPlayed: 1, ...held })).toEqual(UNDER_WAY)
      expect(of(broken)).toEqual(LOST)
      expect(of(held)).toEqual(OR)
    },
  )
})

describe('a Défi in play', () => {
  it('ends on its last day, after which tick() throws and no event comes', () => {
    const short = defis([defi({ lengthDays: 3, randomEvents: true })])
    let state = startChallenge('essai', SEED, FOOD_TRUCK, short)
    for (let day = 7; day < 10; day += 1) {
      expect(state.challenge?.status).toBe('enCours')
      state = next(state, short, EVERY_MORNING)
      if (state.challenge?.status === 'enCours') {
        expect(state.events.pending).toEqual({
          event: 'essai',
          followUp: false,
        })
        state = resolveEvent(
          state,
          'rienFaire',
          EVERY_MORNING,
          FOOD_TRUCK,
          short,
        )
      }
    }
    expect(state.day).toBe(10)
    expect(state.challenge).toMatchObject({
      progress: { daysPlayed: 3 },
      status: 'echoue',
    })
    expect(state.events.pending).toBeNull()
    expect(() => next(state, short, EVERY_MORNING)).toThrow(
      'the Défi essai is over',
    )
    expect(() =>
      playDay(
        state,
        FOOD_TRUCK,
        CUSTOMERS,
        DIFFICULTIES,
        PERSONAL,
        ENERGY,
        short,
      ),
    ).toThrow('the Défi essai is over')
  })

  it('ends at once when a condition breaks, on any day', () => {
    // 3 000 $ a week to the owner: Friday's pay leaves Encaisse below zero.
    const pay = defis([
      defi({
        difficulty: 'moyen',
        setup: { cashCents: 200_000, ownerWeeklyPayCents: 300_000 },
        conditions: [{ kind: 'minCash', amountCents: 0 }],
      }),
    ])
    const ended = playedOut(
      startChallenge('essai', SEED, FOOD_TRUCK, pay),
      pay,
      'rienFaire',
    )
    expect(ended.challenge).toMatchObject({
      progress: { daysPlayed: 5 },
      status: 'echoue',
      medal: null,
    })
    expect(ended.day).toBe(12)
  })

  it('draws no event without random events, while the same Défi with them draws one each morning', () => {
    const run = (randomEvents: boolean) => {
      const content = defis([defi({ randomEvents })])
      let state = startChallenge('essai', SEED, FOOD_TRUCK, content)
      const drawn: number[] = []
      while (state.challenge?.status === 'enCours') {
        if (state.events.pending !== null) {
          drawn.push(state.day)
          state = resolveEvent(
            state,
            'rienFaire',
            EVERY_MORNING,
            FOOD_TRUCK,
            content,
          )
        }
        state = next(state, content, EVERY_MORNING)
      }
      return drawn
    }
    expect(run(false)).toEqual([])
    expect(run(true)).toEqual([8, 9, 10, 11, 12, 13])
  })

  it('still brings follow-ups without random events', () => {
    const content = defis(
      [defi({ events: [{ day: 0, event: 'appel', choices: ['rappeler'] }] })],
      CALLS,
    )
    let state = startChallenge('essai', SEED, FOOD_TRUCK, content)
    state = resolveEvent(state, 'rappeler', CALLS, FOOD_TRUCK, content)
    state = next(state, content, CALLS)
    expect(state.events.pending).toEqual({ event: 'rappel', followUp: true })
    state = resolveEvent(state, 'oui', CALLS, FOOD_TRUCK, content)
    for (let day = 9; day < 14; day += 1) {
      state = next(state, content, CALLS)
      expect(state.events.pending).toBeNull()
    }
  })

  it('brings the event it forces on its day, in place of the draw, with only the choices it allows, and leaves the same card drawn on another day free', () => {
    const forced = defis([
      defi({
        randomEvents: true,
        events: [
          { day: 2, event: 'essai', choices: ['rienFaire', 'relancer'] },
        ],
      }),
    ])
    const choose = (state: GameState, choice: string) =>
      resolveEvent(state, choice, EVERY_MORNING, FOOD_TRUCK, forced)
    let state = next(
      startChallenge('essai', SEED, FOOD_TRUCK, forced),
      forced,
      EVERY_MORNING,
    )
    expect(state.day).toBe(8)
    expect(allowedChoices(state, forced)).toBeNull()
    state = next(choose(state, 'toutEssayer'), forced, EVERY_MORNING)
    expect(state.day).toBe(9)
    expect(state.events).toMatchObject({
      pending: { event: 'essai', followUp: false },
      lastDrawnDay: 9,
    })
    expect(allowedChoices(state, forced)).toEqual(['rienFaire', 'relancer'])
    expect(() => choose(state, 'toutEssayer')).toThrow(RangeError)
    expect(() => choose(state, 'toutEssayer')).toThrow(
      'does not allow the choice toutEssayer',
    )
    expect(choose(state, 'relancer').events.history.at(-1)).toMatchObject({
      day: 9,
      choice: 'relancer',
    })
  })

  it('refuses the kinds of change it locks, and only those', () => {
    const locked = defis([defi({ locked: ['daysOpen', 'price'] })])
    const state = startChallenge('essai', SEED, FOOD_TRUCK, locked)
    const apply = (change: Parameters<typeof applyDecision>[1]) =>
      applyDecision(state, change, FOOD_TRUCK, locked)
    expect(() => apply({ kind: 'daysOpen', weekdays: [1, 2, 3] })).toThrow(
      'the Défi essai locks daysOpen',
    )
    expect(() =>
      apply({ kind: 'price', product: 'cafe', price: cents(400) }),
    ).toThrow(RangeError)
    expect(
      apply({ kind: 'marketingDaily', budget: cents(2_000) }).pendingDecisions
        ?.marketingDaily,
    ).toBe(2_000)
    expect(isLocked(state, 'restock', locked)).toBe(false)
    expect(isLocked(createInitialState(SEED), 'daysOpen', locked)).toBe(false)
  })

  it('plays the same from the same seed and choices', () => {
    const content = defis([
      defi({
        lengthDays: 21,
        randomEvents: true,
        modifiers: [
          {
            day: 4,
            days: 3,
            event: 'festival',
            change: { kind: 'walkIns', factor: 1.8 },
          },
        ],
      }),
    ])
    const run = (seed: number) =>
      playedOut(
        startChallenge('essai', seed, FOOD_TRUCK, content),
        content,
        'rienFaire',
        EVERY_MORNING,
      )
    expect(run(SEED)).toStrictEqual(run(SEED))
    expect(run(SEED + 1).challenge).not.toEqual(run(SEED).challenge)
  })
})
