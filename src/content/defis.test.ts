import { describe, expect, it } from 'vitest'
import { entriesOf } from '../finance/journal.ts'
import {
  allowedChoices,
  defiById,
  failedCondition,
  startDayOf,
} from '../engine/challenge.ts'
import { startChallenge, tick, toCalendar } from '../engine/clock.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from '../engine/day.ts'
import { applyDecision, type DecisionChange } from '../engine/decisions.ts'
import { resolveEvent } from '../engine/events.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import { cents } from '../engine/money.ts'
import type { GameState } from '../engine/types.ts'
import defisJson from './defis.json'
import { loadDefiContent } from './schema.ts'

type Json = Record<string, unknown>

/** A valid Défi; `fields` replace its own. */
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

/** Expects `defis` to fail to load, naming each of `reasons`. */
function expectInvalid(defis: Json[], reasons: readonly string[]): void {
  let message: string | undefined
  try {
    loadDefiContent({ defis }, EVENTS)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    message = error.message
  }
  expect(message, 'the Défis loaded').toBeDefined()
  expect(message).toMatch(/^defis\.json is invalid:/)
  for (const reason of reasons) expect(message).toContain(reason)
}

describe('loadDefiContent', () => {
  it('loads a Défi and its forced events against the event cards', () => {
    const content = loadDefiContent(
      {
        defis: [
          defi({
            setup: {
              cashCents: 100_000,
              prices: { cafe: 300 },
              restock: { croissant: { kind: 'buyDaily', quantity: 10 } },
              daysOpen: [1, 2],
              ownerWeeklyPayCents: 0,
              marketingDailyCents: 500,
              energy: 50,
            },
            locked: ['price', 'restock'],
            modifiers: [
              {
                day: 6,
                days: 1,
                event: 'conesOrange',
                change: { kind: 'closed' },
              },
            ],
            events: [
              { day: 0, event: 'grosseCommande', choices: ['accepter'] },
              { day: 6, event: 'essai', choices: ['relancer', 'rienFaire'] },
            ],
            conditions: [
              { kind: 'minCash', amountCents: -5_000 },
              { kind: 'minEnergy', amount: 25 },
              { kind: 'maxSpoilageRate', rate: 0.1 },
            ],
          }),
        ],
      },
      EVENTS,
    )
    expect(defiById(content, 'essai').setup.prices).toEqual({ cafe: 300 })
  })

  it.each([
    [
      'two Défis with one id',
      [defi(), defi()],
      'the Défi id essai appears twice',
    ],
    [
      'a story of more than 400 characters',
      [defi({ story: 'a'.repeat(401) })],
      '→ at defis[0].story',
    ],
    [
      'a story with a space at its end',
      [defi({ story: 'Une histoire. ' })],
      'text starts and ends with a character',
    ],
    [
      'a start before May',
      [defi({ start: { month: 4, dayOfMonth: 30 } })],
      'a Défi starts in the first season, from May 1st',
    ],
    [
      'a start on a date that does not exist',
      [defi({ start: { month: 6, dayOfMonth: 31 } })],
      'no such day in that month',
    ],
    ['no days', [defi({ lengthDays: 0 })], '→ at defis[0].lengthDays'],
    [
      'a forced change to the street after its last day',
      [
        defi({
          modifiers: [
            {
              day: 7,
              days: 1,
              event: 'conesOrange',
              change: { kind: 'closed' },
            },
          ],
        }),
      ],
      'day 7 is not one of the 7 days',
    ],
    [
      'a forced event after its last day',
      [defi({ events: [{ day: 7, event: 'essai', choices: ['rienFaire'] }] })],
      'day 7 is not one of the 7 days',
    ],
    [
      'a forced change to the street of no card',
      [
        defi({
          modifiers: [
            { day: 0, days: 1, event: 'inconnu', change: { kind: 'closed' } },
          ],
        }),
      ],
      'no event has the id inconnu',
    ],
    [
      'a forced event of no card',
      [defi({ events: [{ day: 0, event: 'inconnu', choices: ['oui'] }] })],
      'no event has the id inconnu',
    ],
    [
      'a choice the card does not have',
      [defi({ events: [{ day: 0, event: 'essai', choices: ['oui'] }] })],
      'the event essai has no choice oui',
    ],
    [
      'a forced event only the tutorial brings (#236)',
      [
        defi({
          events: [{ day: 0, event: 'tutoStory', choices: ['avecPlaisir'] }],
        }),
      ],
      'the event tutoStory only comes in the tutorial',
    ],
    [
      'no choice allowed',
      [defi({ events: [{ day: 0, event: 'essai', choices: [] }] })],
      '→ at defis[0].events[0].choices',
    ],
    [
      'a choice allowed twice',
      [
        defi({
          events: [
            { day: 0, event: 'essai', choices: ['rienFaire', 'rienFaire'] },
          ],
        }),
      ],
      'a choice appears twice',
    ],
    [
      'two forced events on one day',
      [
        defi({
          events: [
            { day: 1, event: 'essai', choices: ['rienFaire'] },
            { day: 1, event: 'festival', choices: ['payer'] },
          ],
        }),
      ],
      'one forced event a day at most',
    ],
    [
      'medals out of order',
      [
        defi({
          goal: {
            metric: 'netIncome',
            medals: { or: 100, argent: 200, bronze: 0 },
          },
        }),
      ],
      'expected or ≥ argent ≥ bronze',
    ],
    [
      'spoilage medals out of order, lower being better',
      [
        defi({
          goal: {
            metric: 'spoilageRate',
            medals: { or: 0.1, argent: 0.05, bronze: 0.01 },
          },
        }),
      ],
      'expected or ≤ argent ≤ bronze, since lower is better',
    ],
    [
      'a medal of a share above 1',
      [
        defi({
          goal: {
            metric: 'spoilageRate',
            medals: { or: 0.1, argent: 0.5, bronze: 2 },
          },
        }),
      ],
      '→ at defis[0].goal.medals.bronze',
    ],
    [
      'ventes below zero',
      [
        defi({
          goal: { metric: 'sales', medals: { or: 0, argent: 0, bronze: -1 } },
        }),
      ],
      '→ at defis[0].goal.medals.bronze',
    ],
    [
      'an unknown metric',
      [
        defi({
          goal: { metric: 'bonheur', medals: { or: 1, argent: 1, bronze: 1 } },
        }),
      ],
      '→ at defis[0].goal.metric',
    ],
    [
      'a condition set twice',
      [
        defi({
          conditions: [
            { kind: 'minCash', amountCents: 0 },
            { kind: 'minCash', amountCents: 100 },
          ],
        }),
      ],
      'a kind of condition appears twice',
    ],
    [
      'a decision locked twice',
      [defi({ locked: ['price', 'price'] })],
      'a kind of decision appears twice',
    ],
    [
      'an unknown decision locked',
      [defi({ locked: ['loyer'] })],
      '→ at defis[0].locked[0]',
    ],
    [
      'an unknown product in the setup',
      [defi({ setup: { prices: { the: 300 } } })],
      '→ at defis[0].setup.prices',
    ],
    [
      'energy above 100 in the setup',
      [defi({ setup: { energy: 101 } })],
      '→ at defis[0].setup.energy',
    ],
    [
      'a key it does not know',
      [defi({ bonus: 1 })],
      'Unrecognized key: "bonus"',
    ],
  ])('rejects %s', (_, defis, reason) => {
    expectInvalid(defis, [reason])
  })
})

describe('defis.json', () => {
  const ids = [
    'travauxSaintDenis',
    'semaineDesMilleDollars',
    'zeroGaspillage',
    'festivalDuPasPire',
    'payeDans60Jours',
    'moisSansConge',
  ]

  it('holds the six Défis of issue #99, in order, and loads', () => {
    expect(DEFIS.defis.map(({ id }) => id)).toEqual(ids)
    expect(loadDefiContent()).toEqual(DEFIS)
    expect(loadDefiContent(defisJson, EVENTS)).toEqual(DEFIS)
  })

  it.each(ids)(
    'starts %s on a Monday morning of its difficulty, with nothing played',
    (id) => {
      const defi = defiById(DEFIS, id)
      const state = startChallenge(id, 42)
      expect(state.day).toBe(startDayOf(defi))
      expect(toCalendar(state.day).weekday).toBe(1)
      expect(state.profile.difficulty).toBe(defi.difficulty)
      expect(state.lastDay).toBeNull()
      expect(state.challenge).toMatchObject({ id, status: 'enCours' })
    },
  )
})

/** What the player does in a scripted Défi. */
interface Script {
  /** The changes made on the first morning. */
  readonly start?: readonly DecisionChange[]
  /** The changes made each morning, for the next. */
  readonly daily?: (state: GameState) => readonly DecisionChange[]
  /**
   * The choice made on an event the Défi does not force; the card's last
   * when undefined.
   */
  readonly answer?: (event: string) => string | undefined
}

/**
 * The Défi `id` from seed `seed`, played to its end with the shipped
 * content as `script` says: the event the Défi forces answered with the
 * first choice it allows, any other with the card's last choice unless
 * `script` answers it.
 */
function played(id: string, seed: number, script: Script = {}): GameState {
  let state = startChallenge(id, seed)
  for (const change of script.start ?? []) state = applyDecision(state, change)
  while (state.challenge?.status === 'enCours') {
    const { pending } = state.events
    if (pending !== null) {
      const card = EVENTS.events.find(
        ({ id: event }) => event === pending.event,
      )
      const choice =
        allowedChoices(state, DEFIS)?.[0] ??
        script.answer?.(pending.event) ??
        card?.choices.at(-1)?.id
      state = resolveEvent(state, choice ?? '')
    }
    for (const change of script.daily?.(state) ?? []) {
      state = applyDecision(state, change)
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      EVENTS,
    )
  }
  return state
}

const pay = (amount: number): DecisionChange => ({
  kind: 'ownerWeeklyPay',
  pay: cents(amount),
})
const croissants = (quantity: number): DecisionChange => ({
  kind: 'restock',
  product: 'croissant',
  rule: { kind: 'buyDaily', quantity },
})
const prices = (price: number): DecisionChange[] =>
  (['cafe', 'chocolat', 'croissant'] as const).map((product) => ({
    kind: 'price',
    product,
    price: cents(price),
  }))
/** The content's starting prices, those of a game that is not a Défi. */
const startingPrices: DecisionChange[] = PRODUCTS.map((product) => ({
  kind: 'price',
  product,
  price: FOOD_TRUCK.startingDecisions.pricesCents[product],
}))
const marketing = (budget: number): DecisionChange => ({
  kind: 'marketingDaily',
  budget: cents(budget),
})
const everyDay: DecisionChange = {
  kind: 'daysOpen',
  weekdays: [1, 2, 3, 4, 5, 6, 7],
}

/** The Défi `ended` played, with the condition it broke, if any. */
function outcome(ended: GameState) {
  const { challenge } = ended
  if (challenge === null) throw new Error('Not a Défi')
  const broken = failedCondition(
    challenge.progress,
    defiById(DEFIS, challenge.id),
  )
  return {
    status: challenge.status,
    medal: challenge.medal,
    daysPlayed: challenge.progress.daysPlayed,
    broken: broken?.kind ?? null,
  }
}

// One scripted success and one scripted failure for each Défi, from seed
// 42. P3-14 (#102) tuned the setups and the thresholds with
// `npm run balance -- --defis` (docs/balance/phase-3.md), so these
// expectations move with them.
describe('the six Défis, scripted', () => {
  it('« Les travaux de la rue Saint-Denis »: or for a tight truck without pay, open every day; lost when 1 500 $ a week to the owner leaves the cash below zero', () => {
    expect(
      outcome(
        played('travauxSaintDenis', 42, {
          start: [pay(0), croissants(30), everyDay],
        }),
      ),
    ).toEqual({ status: 'reussi', medal: 'or', daysPlayed: 21, broken: null })
    // Doing nothing gets through the 1st of June with some cash left.
    expect(outcome(played('travauxSaintDenis', 42))).toMatchObject({
      status: 'reussi',
      medal: 'argent',
    })
    expect(
      outcome(played('travauxSaintDenis', 42, { start: [pay(150_000)] })),
    ).toEqual({
      status: 'echoue',
      medal: null,
      daysPlayed: 19,
      broken: 'minCash',
    })
  })

  it('« La semaine des 1 000 $ »: or without pay; lost short of bronze after 200 $ a day of marketing', () => {
    expect(
      outcome(played('semaineDesMilleDollars', 42, { start: [pay(0)] })),
    ).toEqual({ status: 'reussi', medal: 'or', daysPlayed: 7, broken: null })
    expect(
      outcome(
        played('semaineDesMilleDollars', 42, { start: [marketing(20_000)] }),
      ),
    ).toEqual({ status: 'echoue', medal: null, daysPlayed: 7, broken: null })
  })

  it('« Zéro gaspillage »: argent with low prices, open every day, with marketing; lost on its second day when the croissants go back to 70', () => {
    expect(
      outcome(
        played('zeroGaspillage', 42, {
          start: [...prices(250), everyDay, marketing(3_000)],
        }),
      ),
    ).toEqual({
      status: 'reussi',
      medal: 'argent',
      daysPlayed: 14,
      broken: null,
    })
    expect(
      outcome(played('zeroGaspillage', 42, { start: [croissants(70)] })),
    ).toEqual({
      status: 'echoue',
      medal: null,
      daysPlayed: 2,
      broken: 'maxSpoilageRate',
    })
  })

  it('« Le Festival du Pas Pire »: or with fewer croissants in the week and more for the festival; lost on its second day with 70 croissants', () => {
    const forTomorrow = (state: GameState) => [
      croissants(toCalendar(state.day + 1).weekday >= 5 ? 90 : 40),
    ]
    const ended = played('festivalDuPasPire', 42, {
      start: forTomorrow(startChallenge('festivalDuPasPire', 42)),
      daily: forTomorrow,
    })
    expect(outcome(ended)).toEqual({
      status: 'reussi',
      medal: 'or',
      daysPlayed: 7,
      broken: null,
    })
    // The festival came from Friday to Sunday.
    expect(ended.lastDay?.modifiers).toEqual([
      {
        event: 'festival',
        change: { kind: 'walkIns', factor: 1.8 },
        fromDay: 74,
        lastDay: 76,
      },
    ])
    // Played as it starts, it orders no lemonade, which customers ask for in
    // July and wait in line for (#261): « Bronze » until #266 retunes it.
    expect(outcome(played('festivalDuPasPire', 42))).toMatchObject({
      status: 'reussi',
      medal: 'bronze',
    })
    expect(
      outcome(played('festivalDuPasPire', 42, { start: [croissants(70)] })),
    ).toEqual({
      status: 'echoue',
      medal: null,
      daysPlayed: 2,
      broken: 'maxSpoilageRate',
    })
  })

  describe('« Payé dans 60 jours »', () => {
    // With rarer events (#155), seed 42 meets only « Le 1er juillet » after
    // Gilles's order: the starting pay of 700 $ a week leaves a middle medal.
    const careful: Script = { start: [pay(70_000), croissants(45)] }
    const gilles = 'Gilles Lacasse'

    it('argent at the starting pay, Gilles paying on the last day; lost when 1 500 $ a week to the owner leaves the cash below zero', () => {
      const ended = played('payeDans60Jours', 42, careful)
      expect(outcome(ended)).toEqual({
        status: 'reussi',
        medal: 'argent',
        daysPlayed: 64,
        broken: null,
      })
      expect(ended.events.history[0]).toMatchObject({
        day: 9,
        event: 'grosseCommande',
        choice: 'accepter',
        outcome: 0,
      })
      expect(ended.receivables).toEqual([])
      expect(
        entriesOf(ended.journal).filter(({ memo }) => memo.includes(gilles)),
      ).toMatchObject([
        { day: 10, memo: `Vente à crédit · ${gilles}` },
        { day: 70, memo: `Encaissement · ${gilles}` },
      ])
      expect(
        outcome(played('payeDans60Jours', 42, { start: [pay(150_000)] })),
      ).toEqual({
        status: 'echoue',
        medal: null,
        daysPlayed: 55,
        broken: 'minCash',
      })
    })

    it('ends on its last day all the same when Gilles is late and the player waits for the cheque', () => {
      const ended = played('payeDans60Jours', 1, {
        ...careful,
        answer: (event) =>
          event === 'chequeDansLaMalle' ? 'patienter' : undefined,
      })
      expect(ended.events.history[0]).toMatchObject({
        event: 'grosseCommande',
        outcome: 1,
      })
      expect(ended.events.history.at(-1)).toMatchObject({
        day: 70,
        event: 'chequeDansLaMalle',
        choice: 'patienter',
      })
      expect(outcome(ended)).toMatchObject({
        status: 'reussi',
        daysPlayed: 64,
      })
      expect(ended.receivables).toMatchObject([{ client: gilles, dueDay: 100 }])
    })
  })

  it('« Les deux semaines sans congé »: argent at its opening prices, and at 5,75 $ a unit without pay; lost when serving everyone at the starting prices tires the owner under the floor on day 13', () => {
    expect(outcome(played('moisSansConge', 42))).toEqual({
      status: 'reussi',
      medal: 'argent',
      daysPlayed: 14,
      broken: null,
    })
    expect(
      outcome(
        played('moisSansConge', 42, {
          start: [...prices(575), pay(0), croissants(20)],
        }),
      ),
    ).toEqual({
      status: 'reussi',
      medal: 'argent',
      daysPlayed: 14,
      broken: null,
    })
    const tired = played('moisSansConge', 42, { start: startingPrices })
    expect(outcome(tired)).toEqual({
      status: 'echoue',
      medal: null,
      daysPlayed: 13,
      broken: 'minEnergy',
    })
    expect(() => applyDecision(tired, everyDay)).toThrow(
      'the Défi moisSansConge locks daysOpen',
    )
  })
})
