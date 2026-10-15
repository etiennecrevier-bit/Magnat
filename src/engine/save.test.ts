import { describe, expect, it } from 'vitest'
import {
  loadEventContent,
  loadFoodTruckContent,
  type EventContent,
} from '../content/schema.ts'
import {
  balance,
  entriesOf,
  postEntry,
  type Journal,
} from '../finance/journal.ts'
import { createInitialState, tick } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import { applyDecision } from './decisions.ts'
import { FULL_ENERGY } from './energy.ts'
import { drawEvent, noEvents, resolveEvent } from './events.ts'
import { inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
import { LABELS } from './personal.ts'
import { PROFILE_CONTENT } from './profile.ts'
import { SAVE_VERSION, deserialize, serialize } from './save.ts'
import type { GameState, Profile } from './types.ts'

const SEED = 42
const LIMITS = FOOD_TRUCK.decisionLimits

type Json = Record<string, unknown>

function played(days: number, from = createInitialState(SEED)): GameState {
  let state = from
  for (let i = 0; i < days; i += 1) state = tick(state)
  return state
}

function reloaded(state: GameState): GameState {
  return deserialize(serialize(state))
}

const DAY_400 = played(400)

/**
 * A game at the lowest prices, played up to the first day some customers
 * left the line.
 */
function lineDay(): GameState {
  let state = createInitialState(SEED)
  for (const product of ['cafe', 'chocolat', 'croissant'] as const) {
    state = applyDecision(state, {
      kind: 'price',
      product,
      price: cents(LIMITS.priceCents.min),
    })
  }
  for (let day = 0; day < 60; day += 1) {
    state = tick(state)
    if ((state.lastDay?.leftLine ?? 0) > 0) return state
  }
  throw new Error('No one left the line in 60 days')
}

/**
 * A game that spends `budget` a day on marketing from day 1, played `days`
 * days; closed Mondays spend nothing.
 */
function marketed(days: number, budget = cents(3_000)): GameState {
  const start = applyDecision(createInitialState(SEED), {
    kind: 'marketingDaily',
    budget,
  })
  return played(days, start)
}

const MARKETED = marketed(40)

/**
 * A game that pays the owner 400 $ a week from day 1, played past the days
 * their rent went unpaid.
 */
const LOW_PAY = played(
  200,
  applyDecision(createInitialState(SEED), {
    kind: 'ownerWeeklyPay',
    pay: cents(40_000),
  }),
)

/**
 * A game open every day from day 1, played up to the first day the owner,
 * worn out, botched a unit.
 */
function botchedDay(): GameState {
  let state = applyDecision(createInitialState(SEED), {
    kind: 'daysOpen',
    weekdays: [1, 2, 3, 4, 5, 6, 7],
  })
  for (let day = 0; day < 60; day += 1) {
    state = tick(state)
    if ((state.lastDay?.botched ?? 0) > 0) return state
  }
  throw new Error('No unit botched in 60 days')
}

const BOTCHED = botchedDay()

/** A cheaper price for café, waiting for the next morning. */
function withPendingPrice(state: GameState): GameState {
  return applyDecision(state, {
    kind: 'price',
    product: 'cafe',
    price: cents(LIMITS.priceCents.min),
  })
}

// The save the rejection tests break: day 14, the morning after a Sunday
// the truck opened, with two lots on hand, chocolat from day 8 then café
// from day 9.
const FORTNIGHT = played(14)
const SAVED = serialize(FORTNIGHT)
const ENTRIES = entriesOf(FORTNIGHT.journal).length

/**
 * The valid save `text`, by default `SAVED`, parsed, with `change` applied
 * to the object holding the last key of the dotted `path`, as text again.
 */
function edited(
  path: string,
  change: (parent: Json, key: string) => void,
  text = SAVED,
): string {
  const save = JSON.parse(text) as Json
  const keys = path.split('.')
  const key = keys.pop() as string
  const parent = keys.reduce((node, k) => node[k] as Json, save)
  change(parent, key)
  return JSON.stringify(save)
}

function withValue(path: string, value: unknown, text = SAVED): string {
  return edited(
    path,
    (parent, key) => {
      parent[key] = value
    },
    text,
  )
}

/** On an array index, this leaves a hole, which JSON writes as null. */
function without(path: string): string {
  return edited(path, (parent, key) => {
    delete parent[key]
  })
}

/** The shipped essai card alone, drawn every morning from day 1. */
const ESSAI: EventContent = {
  pacing: { firstDay: 1, minDaysBetween: 0, dailyChance: 1 },
  events: EVENTS.events
    .filter(({ id }) => id === 'essai')
    .map((event) => ({ ...event, weight: 1 })),
}

function withEvents(state: GameState, events = ESSAI): GameState {
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

/**
 * A card every morning from `firstDay` whose « Oui » moves `amount` under
 * `label` in the owner's pocket and takes 5 energy, and whose « Non » does
 * nothing.
 */
function pocketCard(label: string, amount: number, firstDay = 1): EventContent {
  return loadEventContent({
    pacing: { firstDay, minDaysBetween: 0, dailyChance: 1 },
    events: [
      {
        id: 'poche',
        weight: 1,
        character: { id: 'gilles', name: 'Gilles Lacasse', role: 'Proprio' },
        title: 'Une carte',
        situation: 'Il se passe quelque chose.',
        choices: [
          {
            id: 'oui',
            label: 'Oui',
            tags: ['Poche'],
            outcomes: [
              {
                chance: 1,
                result: 'Fait.',
                effects: [
                  { kind: 'personal', amountCents: amount, label },
                  { kind: 'energy', amount: -5 },
                ],
              },
            ],
          },
          {
            id: 'non',
            label: 'Non',
            tags: ['Rien ne change'],
            outcomes: [{ chance: 1, result: 'Rien.', effects: [] }],
          },
        ],
      },
    ],
  })
}

// The morning of day 1, a Tuesday, with the essai card waiting, then once
// « Tout essayer » is chosen: a credit sale due on day 91, a collection
// queued for Thursday, day 3, and a charge for day 4, the owner down to 90
// energy, « Cadeau d'essai » in their pocket, a headline, and the street
// changed: fewer walk-ins to day 15, more chic ones to day 3, less chocolat
// to day 5 and no café to day 2, with what customers will pay raised on day
// 2 alone and the truck closed on day 3, both queued.
const WAITING = withEvents(createInitialState(SEED))
const CHOSEN = resolveEvent(WAITING, 'toutEssayer', ESSAI)
const CHOSEN_SAVE = serialize(CHOSEN)
// The close of day 2, the credit sale still owed, and the last day of the
// café's and of the raised willingness, which only `lastDay` still holds.
const CLOSE_2 = playDay(resolveEvent(withEvents(CHOSEN), 'rienFaire', ESSAI))
// The morning of day 0, before it is played, with a card from day 0
// waiting, then once « Oui » is chosen: the owner down to 95 energy and
// « Cadeau » in their pocket.
const DAY_0_CARD = pocketCard('Cadeau', 6_000, 0)
const DAY_0_WAITING = drawEvent(createInitialState(SEED), DAY_0_CARD)
const DAY_0_CHOSEN = resolveEvent(DAY_0_WAITING, 'oui', DAY_0_CARD)
const DAY_0_SAVE = serialize(DAY_0_CHOSEN)

/** Expects the load to fail, its message naming each of `reasons`. */
function expectInvalid(
  text: string,
  reasons: readonly string[],
  content = FOOD_TRUCK,
  events = EVENTS,
): void {
  let message: string | undefined
  try {
    deserialize(text, content, events)
  } catch (error) {
    if (!(error instanceof Error)) throw error
    message = error.message
  }
  expect(message, 'the save loaded').toBeDefined()
  expect(message).toMatch(/^Invalid save:/)
  for (const reason of reasons) expect(message).toContain(reason)
}

describe('serialize and deserialize', () => {
  it('write the current save version', () => {
    expect(SAVE_VERSION).toBe(9)
    expect(JSON.parse(serialize(DAY_400))).toMatchObject({ saveVersion: 9 })
  })

  it.each<Profile>([
    { businessName: 'Café Facile', avatar: 'femme', difficulty: 'facile' },
    { businessName: "Le P'tit Camion", avatar: 'homme', difficulty: 'moyen' },
    { businessName: 'Chez Mimi 🥐', avatar: 'femme', difficulty: 'difficile' },
  ])('give back the profile of a $difficulty game', (profile) => {
    const game = played(20, createInitialState(SEED, FOOD_TRUCK, profile))
    const back = reloaded(game)
    expect(back.profile).toStrictEqual(profile)
    expect(back).toStrictEqual(game)
  })

  it('give back the state after 400 days', () => {
    expect(reloaded(DAY_400)).toStrictEqual(DAY_400)
  })

  it('give back a day when some customers left the line', () => {
    const busy = lineDay()
    const visits = busy.lastDay?.visits ?? []
    expect(visits.some(({ outcome }) => outcome === 'leftLine')).toBe(true)
    expect(visits.some(({ servedMinute }) => servedMinute !== null)).toBe(true)
    expect(busy.lastDay?.longestWaitSeconds).toBeGreaterThan(0)
    expect(reloaded(busy)).toStrictEqual(busy)
  })

  it('give back the state on day 0, before any day is played', () => {
    const start = createInitialState(SEED)
    expect(reloaded(start)).toStrictEqual(start)
  })

  it('give back a game that spends on marketing', () => {
    const history = MARKETED.marketingHistory
    expect(history).toHaveLength(FOOD_TRUCK.marketing.awarenessDays)
    expect(history).toContain(3_000)
    // Day 35 was a Monday, when the truck stays closed.
    expect(history).toContain(0)
    expect(reloaded(MARKETED)).toStrictEqual(MARKETED)
  })

  it("give back the close of a day, with that day's marketing", () => {
    const start = applyDecision(createInitialState(SEED), {
      kind: 'marketingDaily',
      budget: cents(3_000),
    })
    // Day 0 is a Monday, when the truck is closed; day 1 spends.
    const closed = playDay(tick(start))
    expect(closed.day).toBe(1)
    expect(closed.marketingHistory).toEqual([0, 3_000])
    expect(reloaded(closed)).toStrictEqual(closed)
  })

  it("give back the owner's account at the close of day 0, then the next morning", () => {
    for (const difficulty of ['moyen', 'difficile'] as const) {
      const profile = { ...createInitialState(SEED).profile, difficulty }
      const closed = playDay(createInitialState(SEED, FOOD_TRUCK, profile))
      expect(closed.personal.movements).toEqual([
        { day: 0, label: LABELS.rent, amount: expect.any(Number) },
      ])
      expect(reloaded(closed)).toStrictEqual(closed)
      const morning = tick(createInitialState(SEED, FOOD_TRUCK, profile))
      expect(reloaded(morning)).toStrictEqual(morning)
    }
  })

  it('give back an owner who missed their rent, in debt', () => {
    expect(LOW_PAY.personal.unpaidRents.length).toBeGreaterThan(1)
    expect(LOW_PAY.personal.cash).toBeLessThan(0)
    expect(reloaded(LOW_PAY)).toStrictEqual(LOW_PAY)
  })

  it('load an owner in debt, who lives on the same', () => {
    const resumed = played(60, reloaded(LOW_PAY))
    expect(resumed).toStrictEqual(played(60, LOW_PAY))
    expect(resumed.personal.unpaidRents).not.toEqual(
      LOW_PAY.personal.unpaidRents,
    )
  })

  it('give back a worn-out owner who botched units, and the next days the same', () => {
    const { lastDay, energy } = BOTCHED
    expect(energy).toBeLessThan(FULL_ENERGY)
    expect(lastDay?.botched).toBeGreaterThan(0)
    expect(lastDay?.visits.some(({ botched }) => botched > 0)).toBe(true)
    expect(reloaded(BOTCHED)).toStrictEqual(BOTCHED)
    const closed = playDay(BOTCHED)
    expect(reloaded(closed)).toStrictEqual(closed)
    expect(played(30, reloaded(BOTCHED))).toStrictEqual(played(30, BOTCHED))
  })

  it('give back decisions waiting for the next morning', () => {
    const pending = withPendingPrice(DAY_400)
    expect(pending.pendingDecisions).not.toBeNull()
    expect(reloaded(pending)).toStrictEqual(pending)
  })

  it('give back a state at the close of its day', () => {
    const closed = playDay(DAY_400)
    expect(closed.lastDay?.day).toBe(closed.day)
    expect(reloaded(closed)).toStrictEqual(closed)
  })

  it('load a save that continues as if the game had never stopped', () => {
    const resumed = played(30, reloaded(DAY_400))
    const uninterrupted = played(30, DAY_400)
    // The bytes tools/sim's journalHash hashes.
    expect(JSON.stringify(entriesOf(resumed.journal))).toBe(
      JSON.stringify(entriesOf(uninterrupted.journal)),
    )
    expect(resumed).toStrictEqual(uninterrupted)
  })

  it('load a game that spends on marketing, and continues the same', () => {
    const resumed = played(30, reloaded(MARKETED))
    const uninterrupted = played(30, MARKETED)
    expect(JSON.stringify(entriesOf(resumed.journal))).toBe(
      JSON.stringify(entriesOf(uninterrupted.journal)),
    )
    expect(resumed).toStrictEqual(uninterrupted)
  })

  it('load pending decisions that take effect the next morning', () => {
    const pending = withPendingPrice(DAY_400)
    const resumed = played(30, reloaded(pending))
    const uninterrupted = played(30, pending)
    expect(resumed.decisions.prices.cafe).toBe(LIMITS.priceCents.min)
    expect(JSON.stringify(entriesOf(resumed.journal))).toBe(
      JSON.stringify(entriesOf(uninterrupted.journal)),
    )
    expect(resumed).toStrictEqual(uninterrupted)
  })

  it('give back an event waiting on its morning', () => {
    expect(WAITING.events.pending).toEqual({ event: 'essai', followUp: false })
    expect(reloaded(WAITING)).toEqual(WAITING)
  })

  it('give back what a choice left: receivables, effects to come, history, headlines, and the owner it tired that morning', () => {
    expect(CHOSEN.receivables).toEqual([
      { client: "Client d'essai", amount: 75_000, soldOnDay: 1, dueDay: 91 },
    ])
    expect(
      CHOSEN.events.delayed.map(({ day, effect }) => [day, effect.kind]),
    ).toEqual([
      [2, 'willingness'],
      [3, 'collectReceivable'],
      [3, 'closed'],
      [4, 'charge'],
    ])
    expect(
      CHOSEN.events.modifiers.map(({ change, fromDay, lastDay }) => [
        change.kind,
        fromDay,
        lastDay,
      ]),
    ).toEqual([
      ['walkIns', 1, 15],
      ['walkIns', 1, 3],
      ['appeal', 1, 5],
      ['unavailable', 1, 2],
    ])
    expect(CHOSEN.events.history).toHaveLength(1)
    expect(CHOSEN.events.headlines).toEqual([{ day: 1, id: 'essai' }])
    expect(CHOSEN.energy).toBeLessThan(CHOSEN.lastDay?.energy ?? 0)
    expect(CHOSEN.personal.movements.at(-1)).toEqual({
      day: 1,
      label: "Cadeau d'essai",
      amount: 6_000,
    })
    expect(reloaded(CHOSEN)).toEqual(CHOSEN)
    expect(reloaded(CLOSE_2)).toEqual(CLOSE_2)
  })

  it('give back queued follow-ups', () => {
    const queued: GameState = {
      ...CHOSEN,
      events: {
        ...CHOSEN.events,
        followUps: [
          { day: 20, event: 'essai' },
          { day: 31, event: 'essai' },
        ],
      },
    }
    expect(reloaded(queued)).toEqual(queued)
  })

  it('load a game with events that continues as if it had never stopped', () => {
    const choices = ['relancer', 'toutEssayer', 'rienFaire'] as const
    const go = (from: GameState) => {
      let state = from
      for (let day = 0; day < 40; day += 1) {
        state = withEvents(state)
        const choice = choices[state.day % choices.length] ?? 'rienFaire'
        state = resolveEvent(state, choice, ESSAI)
      }
      return state
    }
    const straight = go(CHOSEN)
    expect(straight.events.history.length).toBeGreaterThan(40)
    expect(serialize(go(deserialize(CHOSEN_SAVE)))).toBe(serialize(straight))
  })

  it('load a version 7 game as one with no event and no receivable', () => {
    const text = edited('events', (save, key) => {
      delete save[key]
      delete save.receivables
      delete (save.lastDay as Json).modifiers
      save.saveVersion = 7
    })
    const back = deserialize(text)
    expect(back).toEqual(FORTNIGHT)
    expect(back.events).toEqual(noEvents())
    expect(back.receivables).toEqual([])
  })

  it('load a version 8 game as one with no change to the street', () => {
    /** `state`, with no change to the street, saved as version 8. */
    const v8 = (state: GameState) => {
      const save = JSON.parse(serialize(state)) as Json
      const { events, lastDay } = save as { events: Json; lastDay: Json | null }
      expect(events.modifiers).toEqual([])
      delete events.modifiers
      if (lastDay !== null) delete lastDay.modifiers
      return JSON.stringify({ ...save, saveVersion: 8 })
    }
    expect(deserialize(v8(FORTNIGHT))).toEqual(FORTNIGHT)
    // An event, a receivable and a delayed effect of version 8 come too.
    const owed = {
      ...CHOSEN,
      events: {
        ...CHOSEN.events,
        delayed: CHOSEN.events.delayed.filter(
          ({ effect }) => effect.kind === 'collectReceivable',
        ),
        modifiers: [],
      },
    }
    expect(deserialize(v8(owed))).toEqual(owed)
    expect(deserialize(v8(createInitialState(SEED)))).toEqual(
      createInitialState(SEED),
    )
  })

  it('give back the street each morning and each close, as each change ends', () => {
    const load = (state: GameState) =>
      deserialize(serialize(state), FOOD_TRUCK, ESSAI)
    let state = CHOSEN
    const ends = new Set<number>()
    for (let day = 1; day <= 17; day += 1) {
      expect(load(state)).toEqual(state)
      const closed = playDay(state)
      expect(load(closed)).toEqual(closed)
      const summary = closed.lastDay?.modifiers ?? []
      for (const modifier of summary) {
        if (modifier.lastDay === day) {
          ends.add(day)
          // Its last close drops it: only the summary of its day holds it.
          expect(closed.events.modifiers).not.toContainEqual(modifier)
        }
      }
      state = resolveEvent(withEvents(state), 'rienFaire', ESSAI)
    }
    // Every change ended, the one of a single day on day 2.
    expect([...ends].sort((a, b) => a - b)).toEqual([2, 3, 5, 15])
    expect(state.events.modifiers).toEqual([])
    expect(CLOSE_2.lastDay?.modifiers.map(({ change }) => change.kind)).toEqual(
      ['walkIns', 'walkIns', 'appeal', 'unavailable', 'willingness'],
    )
    expect(CLOSE_2.events.modifiers.map(({ change }) => change.kind)).toEqual([
      'walkIns',
      'walkIns',
      'appeal',
    ])
  })

  it.each([
    [LABELS.rent, -100],
    [LABELS.rent, 100],
    [LABELS.salary, 100],
    [LABELS.salary, -100],
    [LABELS.weeklyExpenses, 100],
  ])(
    "give back an event's « %s » of %i, the owner's own label, each morning it is chosen and each close after",
    (label, amount) => {
      const events = pocketCard(label, amount)
      const load = (state: GameState) =>
        deserialize(serialize(state), FOOD_TRUCK, events)
      let state = createInitialState(SEED)
      // Five weeks: their paydays, and the rent of June 1st, day 31.
      for (let day = 1; day <= 35; day += 1) {
        state = resolveEvent(withEvents(state, events), 'oui', events)
        expect(state.personal.movements.at(-1)).toEqual({ day, label, amount })
        expect(load(state)).toEqual(state)
        const closed = playDay(state)
        expect(load(closed)).toEqual(closed)
      }
      // The owner's own movements under the label, besides the card's 35.
      const same = state.personal.movements.filter(
        (movement) => movement.label === label,
      )
      expect(same.length).toBeGreaterThan(35)
    },
  )

  it('give back a choice made on the morning of day 0, and the game goes on as if it had never stopped', () => {
    expect(DAY_0_WAITING.events.pending).toEqual({
      event: 'poche',
      followUp: false,
    })
    expect(
      deserialize(serialize(DAY_0_WAITING), FOOD_TRUCK, DAY_0_CARD),
    ).toEqual(DAY_0_WAITING)
    expect(DAY_0_CHOSEN.lastDay).toBeNull()
    expect(DAY_0_CHOSEN.energy).toBe(FULL_ENERGY - 5)
    expect(DAY_0_CHOSEN.personal.movements).toEqual([
      { day: 0, label: 'Cadeau', amount: 6_000 },
    ])
    const back = deserialize(DAY_0_SAVE, FOOD_TRUCK, DAY_0_CARD)
    expect(back).toEqual(DAY_0_CHOSEN)
    const go = (from: GameState) => {
      let state = from
      for (let day = 0; day < 10; day += 1) {
        state = resolveEvent(withEvents(state, DAY_0_CARD), 'oui', DAY_0_CARD)
      }
      return state
    }
    expect(serialize(go(back))).toBe(serialize(go(DAY_0_CHOSEN)))
  })

  it('load books the finance functions accept, frozen', () => {
    const { journal, day } = reloaded(DAY_400)
    expect(Object.isFrozen(journal)).toBe(true)
    expect(Object.isFrozen(entriesOf(journal))).toBe(true)
    expect(Object.isFrozen(entriesOf(journal)[0])).toBe(true)
    expect(balance(journal, '1000', { toDay: day })).toBe(
      balance(DAY_400.journal, '1000', { toDay: day }),
    )
    const posted = postEntry(journal, {
      day,
      memo: 'Test',
      lines: [
        { account: '1000', debit: cents(100), credit: cents(0) },
        { account: '3000', debit: cents(0), credit: cents(100) },
      ],
    })
    expect(entriesOf(posted)).toHaveLength(entriesOf(journal).length + 1)
  })

  it('refuse to save a journal postEntry() did not make', () => {
    const forged = [
      { ...DAY_400.journal },
      { entries: [...DAY_400.journal.entries] },
    ] as unknown as Journal[]
    for (const journal of forged) {
      expect(() => serialize({ ...DAY_400, journal })).toThrow(TypeError)
    }
  })
})

describe('deserialize rejects', () => {
  it.each(['', 'not json {', '{"day":', '{"day": 1,}'])(
    'malformed JSON: %j',
    (text) => {
      expectInvalid(text, ['Invalid save: not JSON'])
    },
  )

  it.each(['null', '[]', '42', '"save"', 'true'])('JSON that is %s', (text) => {
    expectInvalid(text, ['Invalid save: not a saved game'])
  })

  it('a save without its version', () => {
    expectInvalid(without('saveVersion'), ['unsupported saveVersion undefined'])
  })

  it.each([0, 1, 6, 10, '9', '8', '7', null])('saveVersion %j', (version) => {
    expectInvalid(withValue('saveVersion', version), [
      `unsupported saveVersion ${JSON.stringify(version)}`,
    ])
  })

  describe('a key the game does not know', () => {
    it('in the save', () => {
      expectInvalid(withValue('cheat', 1), ['Unrecognized key: "cheat"'])
    })

    it.each([
      ['a lot', 'inventory.0.free', 'inventory[0]'],
      ['an entry', 'journal.1.approved', 'journal[1]'],
      ['a line', 'journal.1.lines.0.note', 'journal[1].lines[0]'],
      ['the last day', 'lastDay.profit', 'lastDay'],
      ['a visit', 'lastDay.visits.0.tip', 'lastDay.visits[0]'],
      ['the decisions', 'decisions.discount', 'decisions'],
      ['the prices', 'decisions.prices.poutine', 'decisions.prices'],
      ['the profile', 'profile.level', 'profile'],
      ['the personal account', 'personal.bonus', 'personal'],
      [
        'a personal movement',
        'personal.movements.0.note',
        'personal.movements[0]',
      ],
    ])('in %s', (_, path, at) => {
      const key = path.split('.').at(-1)
      expectInvalid(withValue(path, 1), [
        `Unrecognized key: "${key}"\n  → at ${at}`,
      ])
    })

    it('__proto__', () => {
      const text = SAVED.replace(/^\{/, '{"__proto__":{"day":0},')
      expectInvalid(text, ['Unrecognized key: "__proto__"'])
    })
  })

  it.each([
    'day',
    'seed',
    'rngState',
    'journal',
    'inventory',
    'lastDay',
    'decisions',
    'pendingDecisions',
    'profile',
    'profile.businessName',
    'profile.avatar',
    'profile.difficulty',
    'journal.1.memo',
    'inventory.0.unitCost',
    'lastDay.segments.chic',
    'decisions.prices.croissant',
    'personal',
    'personal.cash',
    'personal.movements',
    'personal.unpaidRents',
    'personal.movements.0.day',
    'personal.movements.0.label',
    'personal.movements.0.amount',
    'energy',
    'lastDay.energy',
    'lastDay.botched',
    'lastDay.visits.0.botched',
    'lastDay.modifiers',
    'events.modifiers',
  ])('a save missing %s', (path) => {
    const at = path.replace(/\.(\d+)/g, '[$1]')
    expectInvalid(without(path), [`→ at ${at}`])
  })

  describe('a journal', () => {
    it('with a sparse lines array', () => {
      expectInvalid(without('journal.1.lines.0'), [
        'expected object, received null',
        '→ at journal[1].lines[0]',
      ])
    })

    it.each([42, { text: 'Ventes' }, null])('with the memo %j', (memo) => {
      expectInvalid(withValue('journal.1.memo', memo), [
        'expected string',
        '→ at journal[1].memo',
      ])
    })

    it('with an unbalanced entry', () => {
      const debit = FORTNIGHT.journal.entries[0]?.lines[0]?.debit ?? 0
      expectInvalid(withValue('journal.0.lines.0.debit', debit + 1), [
        'journal entry 1: Cannot post "Mise de fonds" on day 0',
        'do not equal credits',
      ])
    })

    it('with a line on both sides', () => {
      expectInvalid(withValue('journal.0.lines.0.credit', 5), [
        'journal entry 1:',
        'line 1: both a debit and a credit',
      ])
    })

    it('with a line of no amount', () => {
      expectInvalid(withValue('journal.0.lines.0.debit', 0), [
        'journal entry 1:',
        'line 1: no amount',
      ])
    })

    it.each(['9999', 1000, null])('with the account %j', (account) => {
      expectInvalid(withValue('journal.0.lines.0.account', account), [
        'unknown account',
        '→ at journal[0].lines[0].account',
      ])
    })

    it('whose days go down', () => {
      expectInvalid(withValue(`journal.${ENTRIES - 1}.day`, 0), [
        `journal entry ${ENTRIES}:`,
        'the last entry is on day 13',
      ])
    })

    it('with an entry dated after the save', () => {
      expectInvalid(withValue(`journal.${ENTRIES - 1}.day`, 15), [
        `journal entry ${ENTRIES} is on day 15, after day 14`,
      ])
    })

    it('with an entry of no lines', () => {
      expectInvalid(withValue('journal.0.lines', []), [
        'Too small',
        '→ at journal[0].lines',
      ])
    })

    it.each([12.5, -100, '100', Number.MAX_SAFE_INTEGER + 1])(
      'with the amount %j',
      (amount) => {
        expectInvalid(withValue('journal.0.lines.0.debit', amount), [
          '→ at journal[0].lines[0].debit',
        ])
      },
    )

    // Each entry is in range; their sums are not.
    const huge = {
      day: 14,
      memo: 'Test',
      lines: [
        { account: '1500', debit: Number.MAX_SAFE_INTEGER, credit: 0 },
        { account: '2500', debit: 0, credit: Number.MAX_SAFE_INTEGER },
      ],
    }

    it('whose balances leave the safe integer range', () => {
      const text = edited('journal', (save, key) => {
        save[key] = [...(save[key] as unknown[]), huge, huge]
      })
      expectInvalid(text, ['the books: Not a whole number of cents'])
    })

    it('whose debit column leaves the safe integer range', () => {
      const text = edited('journal', (save, key) => {
        save[key] = [...(save[key] as unknown[]), huge]
      })
      expectInvalid(text, ['the books: Not a whole number of cents'])
    })
  })

  describe('an inventory', () => {
    it('with an unknown product', () => {
      expectInvalid(withValue('inventory.0.product', 'poutine'), [
        '→ at inventory[0].product',
      ])
    })

    it.each([0, -1, 1.5, '24', null])('with the quantity %j', (quantity) => {
      expectInvalid(withValue('inventory.0.quantity', quantity), [
        '→ at inventory[0].quantity',
      ])
    })

    it('with a lot bought after the save', () => {
      expectInvalid(withValue('inventory.1.boughtOnDay', 15), [
        'lot 2 was bought on day 15, after day 14',
      ])
    })

    it('whose lots are not oldest first', () => {
      const second = FORTNIGHT.inventory[1]?.boughtOnDay ?? 0
      expectInvalid(withValue('inventory.0.boughtOnDay', second + 1), [
        `lot 2 is older than the lot before it: day ${second} < day ${second + 1}`,
      ])
    })

    it('that costs more than the Stocks account carries', () => {
      const stocks = inventoryValue(FORTNIGHT.inventory)
      const unitCost = FORTNIGHT.inventory[0]?.unitCost ?? 0
      const quantity = FORTNIGHT.inventory[0]?.quantity ?? 0
      expectInvalid(withValue('inventory.0.quantity', quantity + 1), [
        `the Stocks balance of ${stocks} does not equal the lots' cost of ${stocks + unitCost}`,
      ])
    })

    it('that is gone while the Stocks account still carries it', () => {
      expect(FORTNIGHT.inventory.length).toBeGreaterThan(0)
      expectInvalid(withValue('inventory', []), [
        "does not equal the lots' cost of 0",
      ])
    })

    it('whose cost leaves the safe integer range', () => {
      expectInvalid(withValue('inventory.0.quantity', 2 ** 52), [
        'the lots: Not a whole number of cents',
      ])
    })
  })

  describe('a generator or a day', () => {
    it.each([-1, 2 ** 32, 1.5, '7', null])('rngState %j', (state) => {
      expectInvalid(withValue('rngState', state), ['→ at rngState'])
    })

    it.each([-1, 2 ** 32, 1.5, '7', null])('seed %j', (seed) => {
      expectInvalid(withValue('seed', seed), ['→ at seed'])
    })

    it('a generator state out of range, named as such', () => {
      expectInvalid(withValue('rngState', 2 ** 32), [
        'expected an integer in [0, 2^32)',
      ])
    })

    it.each([-1, 1.5, '14'])('day %j', (day) => {
      expectInvalid(withValue('day', day), ['→ at day'])
    })
  })

  describe('a last day', () => {
    it('that is neither the save day nor the day before', () => {
      expectInvalid(withValue('lastDay.day', 5), ['lastDay is day 5 on day 14'])
      expectInvalid(withValue('day', 20), ['lastDay is day 13 on day 20'])
    })

    it('that is missing after day 0', () => {
      expectInvalid(withValue('lastDay', null), ['lastDay is null on day 14'])
    })

    it('with a visit that ends in an unknown way', () => {
      expectInvalid(withValue('lastDay.visits.0.outcome', 'stole'), [
        '→ at lastDay.visits[0].outcome',
      ])
    })

    it('with a visit after midnight', () => {
      expectInvalid(withValue('lastDay.visits.0.arrivalMinute', 1441), [
        '→ at lastDay.visits[0].arrivalMinute',
      ])
    })

    it.each(['servedMinute', 'leftMinute'])(
      'with a visit missing its %s',
      (field) => {
        expectInvalid(without(`lastDay.visits.0.${field}`), [
          `→ at lastDay.visits[0].${field}`,
        ])
      },
    )

    it.each([
      ['servedMinute', 450.5],
      ['servedMinute', -1],
      ['leftMinute', 450.5],
      ['leftMinute', 1441],
    ])('with a visit whose %s is %j', (field, value) => {
      expectInvalid(withValue(`lastDay.visits.0.${field}`, value), [
        `→ at lastDay.visits[0].${field}`,
      ])
    })

    it.each(['leftLine', 'averageWaitSeconds', 'longestWaitSeconds'])(
      'with its %s missing or negative',
      (field) => {
        expectInvalid(without(`lastDay.${field}`), [`→ at lastDay.${field}`])
        expectInvalid(withValue(`lastDay.${field}`, -1), [
          `→ at lastDay.${field}`,
        ])
      },
    )
  })

  describe("the owner's energy", () => {
    // FORTNIGHT is the morning after Sunday, day 13, which the truck opened.
    const closedAt = FORTNIGHT.lastDay?.energy ?? 0

    it('starts from a tired Sunday and a night of rest', () => {
      expect(closedAt).toBeLessThan(FORTNIGHT.energy)
      expect(FORTNIGHT.energy).toBeLessThan(FULL_ENERGY)
    })

    it.each([-1, 100.5, '50', null])('of %j', (energy) => {
      expectInvalid(withValue('energy', energy), ['→ at energy'])
    })

    it.each([-0.5, 101, '50', null])('of %j at the last close', (energy) => {
      expectInvalid(withValue('lastDay.energy', energy), [
        '→ at lastDay.energy',
      ])
    })

    it('below the close before, after a night that only gives energy back', () => {
      const energy = closedAt - 1
      expectInvalid(withValue('energy', energy), [
        `energy is ${energy} on the morning of day 14, below the ${closedAt} of the close before`,
      ])
    })

    it("other than the last day's at its close", () => {
      // Day 14 is a Monday: closed, the owner rests up to full.
      const closed = playDay(FORTNIGHT)
      const at = closed.energy
      expect(at).toBe(FULL_ENERGY)
      const text = withValue('energy', at - 1, serialize(closed))
      expectInvalid(text, [
        `energy is ${at - 1} at the close of day 14, not lastDay's ${at}`,
      ])
      expect(reloaded(closed).energy).toBe(at)
    })

    it('other than full before day 0 is played', () => {
      const text = withValue('energy', 99, serialize(createInitialState(SEED)))
      expectInvalid(text, [
        `energy is 99 before day 0 is played, not ${FULL_ENERGY}`,
      ])
    })

    it.each([-1, 1.5, '1', null])('with a visit that botched %j', (botched) => {
      expectInvalid(withValue('lastDay.visits.0.botched', botched), [
        '→ at lastDay.visits[0].botched',
      ])
    })

    it("with botched units other than its visits'", () => {
      const text = serialize(BOTCHED)
      const botched = BOTCHED.lastDay?.botched ?? 0
      expectInvalid(withValue('lastDay.botched', botched + 1, text), [
        `lastDay.botched is ${botched + 1}, not the ${botched} its visits botched`,
      ])
      expectInvalid(withValue('lastDay.botched', -1), ['→ at lastDay.botched'])
    })

    it('in a game saved before the energy, as version 6', () => {
      const text = edited('energy', (save, key) => {
        delete save[key]
        save.saveVersion = 6
      })
      expectInvalid(text, ['unsupported saveVersion 6'])
    })
  })

  describe('decisions', () => {
    const { step, max } = LIMITS.priceCents

    it('with a price off the step', () => {
      const price = FORTNIGHT.decisions.prices.cafe + 1
      expectInvalid(withValue('decisions.prices.cafe', price), [
        `decisions: Invalid decision: prices.cafe must be a multiple of ${step}`,
      ])
    })

    it('with a price out of range', () => {
      expectInvalid(withValue('decisions.prices.cafe', max + step), [
        'decisions: Invalid decision: prices.cafe must be a whole number',
      ])
    })

    it.each([[[3, 2]], [[2, 2, 3]], [[0, 1]], [[7, 8]], [[]]])(
      'open on the weekdays %j',
      (daysOpen) => {
        expectInvalid(withValue('decisions.daysOpen', daysOpen), [
          'decisions: Invalid decision: daysOpen',
        ])
      },
    )

    it('that change a product to another kind of restock rule', () => {
      expectInvalid(
        withValue('decisions.restock.croissant', {
          kind: 'topUp',
          whenBelow: 10,
          upTo: 70,
        }),
        ['decisions.restock.croissant must be a buyDaily rule: topUp'],
      )
    })

    it('with a restock rule that tops up below more than it buys up to', () => {
      expectInvalid(withValue('decisions.restock.cafe.whenBelow', 400), [
        'decisions: Invalid decision: restock.cafe.whenBelow must not exceed upTo',
      ])
    })

    it('with an unknown kind of restock rule', () => {
      expectInvalid(withValue('decisions.restock.cafe.kind', 'steal'), [
        '→ at decisions.restock.cafe.kind',
      ])
    })

    it('pending for the next morning, held to the same limits', () => {
      const pending = { ...FORTNIGHT.decisions, marketingDaily: -1 }
      expectInvalid(withValue('pendingDecisions', pending), [
        '→ at pendingDecisions.marketingDaily',
      ])
      const offStep = {
        ...FORTNIGHT.decisions,
        prices: { ...FORTNIGHT.decisions.prices, chocolat: 351 },
      }
      expectInvalid(withValue('pendingDecisions', offStep), [
        'pendingDecisions: Invalid decision: prices.chocolat',
      ])
      const otherKind = {
        ...FORTNIGHT.decisions,
        restock: {
          ...FORTNIGHT.decisions.restock,
          cafe: { kind: 'buyDaily', quantity: 100 },
        },
      }
      expectInvalid(withValue('pendingDecisions', otherKind), [
        'pendingDecisions.restock.cafe must be a topUp rule: buyDaily',
      ])
    })

    it('outside the limits of the content it loads with', () => {
      const narrowed = loadFoodTruckContent({
        ...FOOD_TRUCK,
        decisionLimits: {
          ...LIMITS,
          priceCents: { ...LIMITS.priceCents, max: LIMITS.priceCents.min },
        },
      })
      expectInvalid(
        SAVED,
        ['decisions: Invalid decision: prices.cafe must be a whole number'],
        narrowed,
      )
    })
  })

  describe('a marketing history', () => {
    const { awarenessDays } = FOOD_TRUCK.marketing
    const { max } = LIMITS.marketingDailyCents
    const days = (spent: number) => Array.from({ length: 7 }, () => spent)

    /** A save of `state` with `history` as its marketing history. */
    function withHistory(state: GameState, history: unknown): string {
      return JSON.stringify({
        ...(JSON.parse(serialize(state)) as Json),
        marketingHistory: history,
      })
    }

    it('that is missing', () => {
      expectInvalid(without('marketingHistory'), ['→ at marketingHistory'])
    })

    it.each([-1, 12.5, '100', null])('with the spend %j', (spent) => {
      expectInvalid(withValue('marketingHistory.3', spent), [
        '→ at marketingHistory[3]',
      ])
    })

    it('shorter than the days played', () => {
      // Its oldest day of spend is gone, so the awareness would drop.
      expect(FORTNIGHT.marketingHistory).toHaveLength(awarenessDays)
      expectInvalid(withValue('marketingHistory', days(0).slice(1)), [
        `marketingHistory holds 6 days, not ${awarenessDays}`,
      ])
      expectInvalid(withValue('marketingHistory', []), [
        `marketingHistory holds 0 days, not ${awarenessDays}`,
      ])
    })

    it('longer than awarenessDays', () => {
      expectInvalid(withValue('marketingHistory', [...days(0), 0]), [
        `marketingHistory holds 8 days, not ${awarenessDays}`,
      ])
    })

    it('longer than the days played', () => {
      expectInvalid(withHistory(played(3), [0, 0, 0, 0]), [
        'marketingHistory holds 4 days, not 3',
      ])
      expectInvalid(withHistory(createInitialState(SEED), [0]), [
        'marketingHistory holds 1 days, not 0',
      ])
    })

    it('with a day that spent more than the budget may be', () => {
      expectInvalid(withValue('marketingHistory.6', max + 1), [
        `marketingHistory day 7 spent ${max + 1}, more than the ${max} the budget may be`,
      ])
      expect(deserialize(withValue('marketingHistory.6', max))).toMatchObject({
        marketingHistory: [...days(0).slice(1), max],
      })
    })

    it('of other days than the content it loads with', () => {
      const longer = loadFoodTruckContent({
        ...FOOD_TRUCK,
        marketing: { ...FOOD_TRUCK.marketing, awarenessDays: 10 },
      })
      expectInvalid(SAVED, ['marketingHistory holds 7 days, not 10'], longer)
    })

    it('in a game saved before marketing, as version 4', () => {
      const text = edited('marketingHistory', (save, key) => {
        delete save[key]
        save.saveVersion = 4
      })
      expectInvalid(text, ['unsupported saveVersion 4'])
    })
  })

  it('a game saved before the line, as version 3', () => {
    // Its last day has no visits served or left and no waits.
    const text = edited('lastDay', (save, key) => {
      const lastDay = save[key] as Json
      delete lastDay.leftLine
      delete lastDay.averageWaitSeconds
      delete lastDay.longestWaitSeconds
      for (const visit of lastDay.visits as Json[]) {
        delete visit.servedMinute
        delete visit.leftMinute
      }
      save.saveVersion = 3
    })
    expectInvalid(text, ['unsupported saveVersion 3'])
  })

  it('a game saved before the real costs, as version 2', () => {
    // Its books hold no truck and no loan, so it cannot play on under the
    // rules of version 3.
    expectInvalid(withValue('saveVersion', 2), ['unsupported saveVersion 2'])
  })

  describe('a personal account', () => {
    // FORTNIGHT's movements, as the tests below break them.
    it('starts from a fortnight of movements', () => {
      expect(
        FORTNIGHT.personal.movements.map(({ day, label }) => [day, label]),
      ).toEqual([
        [0, LABELS.rent],
        [4, LABELS.salary],
        [4, LABELS.weeklyExpenses],
        [11, LABELS.salary],
        [11, LABELS.weeklyExpenses],
      ])
      expect(FORTNIGHT.personal.unpaidRents).toEqual([])
    })

    it.each([12.5, '100', null, Number.MAX_SAFE_INTEGER + 1])(
      'with the cash %j',
      (cash) => {
        expectInvalid(withValue('personal.cash', cash), ['→ at personal.cash'])
      },
    )

    it('with cash below zero, which loads', () => {
      const back = deserialize(withValue('personal.cash', -500))
      expect(back.personal.cash).toBe(-500)
    })

    it.each(['Loto', 'salaire'])('with the label %j', (label) => {
      expectInvalid(withValue('personal.movements.0.label', label), [
        `personal movement 1 has an unknown label: « ${label} »`,
      ])
    })

    it.each([42, null])('with the label %j', (label) => {
      expectInvalid(withValue('personal.movements.0.label', label), [
        '→ at personal.movements[0].label',
      ])
    })

    it.each([-12.5, '-130000', null])('with the amount %j', (amount) => {
      expectInvalid(withValue('personal.movements.0.amount', amount), [
        '→ at personal.movements[0].amount',
      ])
    })

    it.each([
      [0, 130_000, 'below'],
      [0, 0, 'below'],
      [1, -70_000, 'above'],
      [1, 0, 'above'],
      [2, 25_000, 'below'],
    ])('with movement %i of the amount %i, not %s 0', (index, amount, side) => {
      const label = FORTNIGHT.personal.movements[index]?.label ?? ''
      expectInvalid(withValue(`personal.movements.${index}.amount`, amount), [
        `personal movement ${index + 1}, « ${label} », must be ${side} 0: ${amount}`,
      ])
    })

    it('whose movements are not oldest first', () => {
      expectInvalid(withValue('personal.movements.1.day', 12), [
        'personal movement 3 is older than the one before it: day 4 < day 12',
      ])
    })

    it('with a movement after the last day played', () => {
      expectInvalid(withValue('personal.movements.4.day', 14), [
        'personal movement 5 is on day 14, after day 13',
      ])
    })

    it('with a movement older than the months kept', () => {
      // On day 399, in June of year 2, the account keeps July of year 1 on.
      const text = serialize(DAY_400)
      expect(DAY_400.personal.movements[0]?.day).toBe(61)
      expectInvalid(withValue('personal.movements.0.day', 60, text), [
        'personal movement 1 is on day 60, outside the months kept on day 399',
      ])
    })

    it('with anything before day 0 is played', () => {
      const text = serialize(createInitialState(SEED))
      const rent = { day: 0, label: LABELS.rent, amount: -130_000 }
      expectInvalid(withValue('personal.movements', [rent], text), [
        'personal holds movements before day 0 is played',
      ])
      expectInvalid(withValue('personal.unpaidRents', [0], text), [
        'personal holds movements before day 0 is played',
      ])
    })

    it('with an unpaid rent on a day with no « Loyer »', () => {
      expect(
        deserialize(withValue('personal.unpaidRents', [0])).personal,
      ).toMatchObject({ unpaidRents: [0] })
      expectInvalid(withValue('personal.unpaidRents', [4]), [
        'unpaid rent 1 is on day 4, with no « Loyer » that day',
      ])
    })

    it('with an unpaid rent twice', () => {
      expectInvalid(withValue('personal.unpaidRents', [0, 0]), [
        'unpaid rent 2 repeats day 0',
      ])
    })

    it('with an unpaid rent after the last day played', () => {
      expectInvalid(withValue('personal.unpaidRents', [14]), [
        'unpaid rent 1 is on day 14, after day 13',
      ])
    })

    it('whose unpaid rents are not in order', () => {
      const [first, second] = LOW_PAY.personal.unpaidRents
      const text = serialize(LOW_PAY)
      expectInvalid(withValue('personal.unpaidRents', [second, first], text), [
        `unpaid rent 2 is older than the one before it: day ${first} < day ${second}`,
      ])
    })

    it.each([-1, 1.5, '0', null])('with the unpaid rent %j', (day) => {
      expectInvalid(withValue('personal.unpaidRents', [day]), [
        '→ at personal.unpaidRents[0]',
      ])
    })

    it('in a game saved before the personal account, as version 5', () => {
      const text = edited('personal', (save, key) => {
        delete save[key]
        save.saveVersion = 5
      })
      expectInvalid(text, ['unsupported saveVersion 5'])
    })
  })

  describe('a profile', () => {
    it('saved before the profile, as version 1', () => {
      const text = edited('profile', (save, key) => {
        delete save[key]
        save.saveVersion = 1
      })
      expectInvalid(text, ['unsupported saveVersion 1'])
    })

    it.each([
      ['avatar', 'robot'],
      ['avatar', null],
      ['difficulty', 'extreme'],
      ['difficulty', 2],
    ])('with the %s %j', (field, value) => {
      expectInvalid(withValue(`profile.${field}`, value), [
        `→ at profile.${field}`,
      ])
    })

    it.each([42, null])('with the business name %j', (name) => {
      expectInvalid(withValue('profile.businessName', name), [
        'expected string',
        '→ at profile.businessName',
      ])
    })

    const max = PROFILE_CONTENT.businessNameMaxLength

    it.each([
      ['', `must hold 1 to ${max} characters: 0`],
      ['x'.repeat(max + 1), `must hold 1 to ${max} characters: ${max + 1}`],
      [' Chez Mimi', 'must not start or end with a space'],
      ['Chez\nMimi', 'must not hold a control character'],
    ])('with the business name %j', (name, reason) => {
      expectInvalid(withValue('profile.businessName', name), [
        `profile: Invalid profile: businessName ${reason}`,
      ])
    })
  })

  describe('a version 7 game', () => {
    const v7 = (change: (save: Json) => void = () => undefined) =>
      edited('events', (save, key) => {
        delete save[key]
        delete save.receivables
        delete (save.lastDay as Json).modifiers
        save.saveVersion = 7
        change(save)
      })

    it('with a key version 7 did not know', () => {
      expectInvalid(
        v7((save) => {
          save.events = noEvents()
        }),
        ['Unrecognized key: "events"'],
      )
    })

    it('with a field it breaks', () => {
      expectInvalid(
        v7((save) => {
          save.energy = 101
        }),
        ['→ at energy'],
      )
    })

    it('with changes to the street, which came in version 9', () => {
      expectInvalid(
        v7((save) => {
          ;(save.lastDay as Json).modifiers = []
        }),
        ['Unrecognized key: "modifiers"\n  → at lastDay'],
      )
    })
  })

  describe('a version 8 game', () => {
    const v8 = (change: (save: Json) => void = () => undefined) =>
      edited('events', (save, key) => {
        delete (save[key] as Json).modifiers
        delete (save.lastDay as Json).modifiers
        save.saveVersion = 8
        change(save)
      })

    it('which loads', () => {
      expect(deserialize(v8())).toEqual(FORTNIGHT)
    })

    it.each(['events', 'lastDay'])(
      'with changes to the street in %s, which came in version 9',
      (field) => {
        expectInvalid(
          v8((save) => {
            ;(save[field] as Json).modifiers = []
          }),
          [`Unrecognized key: "modifiers"\n  → at ${field}`],
        )
      },
    )

    it('with a field it breaks', () => {
      expectInvalid(
        v8((save) => {
          save.receivables = [{ client: '' }]
        }),
        ['→ at receivables[0].client'],
      )
    })
  })

  describe('receivables', () => {
    const at = (path: string, value: unknown, text = CHOSEN_SAVE) =>
      withValue(`receivables.0.${path}`, value, text)

    it.each([
      ['client', ''],
      ['client', '  '],
      ['client', 42],
      ['amount', 0],
      ['amount', -100],
      ['amount', 12.5],
      ['soldOnDay', -1],
      ['dueDay', '91'],
    ])('with the %s %j', (field, value) => {
      expectInvalid(at(field, value), [`→ at receivables[0].${field}`])
    })

    it('with a key the game does not know', () => {
      expectInvalid(at('paid', true), ['Unrecognized key: "paid"'])
    })

    it('sold after the save', () => {
      expectInvalid(at('soldOnDay', 2), [
        'receivable 1 was sold on day 2, after day 1',
      ])
    })

    it('due no later than its sale', () => {
      expectInvalid(at('dueDay', 1), [
        'receivable 1 is due on day 1, not after its sale',
      ])
    })

    it('due on a day already played, which collected it', () => {
      expectInvalid(at('dueDay', 2, serialize(CLOSE_2)), [
        'receivable 1 is due on day 2, a day already played',
      ])
    })

    it('not by due day', () => {
      const text = withValue(
        'receivables',
        [
          { client: 'B', amount: 40_000, soldOnDay: 1, dueDay: 50 },
          { client: 'A', amount: 35_000, soldOnDay: 1, dueDay: 40 },
        ],
        CHOSEN_SAVE,
      )
      expectInvalid(text, [
        'receivable 2 is due before the one before it: day 40 < day 50',
      ])
    })

    it('other than what Comptes clients carries', () => {
      expectInvalid(at('amount', 75_001), [
        'the Comptes clients balance of 75000 does not equal the 75001 the receivables add up to',
      ])
      expectInvalid(withValue('receivables', [], CHOSEN_SAVE), [
        'the Comptes clients balance of 75000 does not equal the 0 the receivables add up to',
      ])
    })
  })

  describe('events', () => {
    const at = (path: string, value: unknown, text = CHOSEN_SAVE) =>
      withValue(`events.${path}`, value, text)

    it('that are missing', () => {
      expectInvalid(
        edited('events', (save, key) => {
          delete save[key]
        }),
        ['→ at events'],
      )
    })

    it('with a key the game does not know', () => {
      expectInvalid(at('cheat', 1), ['Unrecognized key: "cheat"'])
    })

    it('with an event waiting at the close of its day', () => {
      expectInvalid(
        at('pending', { event: 'essai', followUp: true }, serialize(CLOSE_2)),
        ['an event waits at the close of day 2'],
      )
    })

    it('with an event waiting on a morning one was already chosen', () => {
      expectInvalid(at('pending', { event: 'essai', followUp: true }), [
        'an event waits on day 1, after one was chosen that morning',
      ])
    })

    it('with an unknown event waiting', () => {
      const text = serialize(WAITING)
      expectInvalid(at('pending.event', 'nope', text), [
        'the event waiting is an unknown event: nope',
      ])
    })

    it('with an event waiting that was drawn another day', () => {
      const text = serialize(WAITING)
      expectInvalid(at('lastDrawnDay', 0, text), [
        'the event waiting was drawn on day 1, but lastDrawnDay is 0',
      ])
      // A follow-up is brought back, not drawn.
      const followUp = at('pending.followUp', true, at('lastDrawnDay', 0, text))
      expect(deserialize(followUp).events.pending).toEqual({
        event: 'essai',
        followUp: true,
      })
    })

    it('known to the shipped content but not to the content it loads with', () => {
      const text = serialize(WAITING)
      expect(deserialize(text).events.pending?.event).toBe('essai')
      expect(deserialize(text, FOOD_TRUCK, ESSAI)).toEqual(WAITING)
      expect(() =>
        deserialize(text, FOOD_TRUCK, { ...ESSAI, events: [] }),
      ).toThrow('the event waiting is an unknown event: essai')
    })

    it('drawn after the save', () => {
      expectInvalid(at('lastDrawnDay', 2), [
        'lastDrawnDay is day 2, after day 1',
      ])
    })

    it.each([
      [
        'delayed.0.day',
        0,
        'delayed effect 1 is due on day 0, a day already played',
      ],
      [
        'delayed.0.day',
        5,
        'delayed effect 2 comes before the one before it: day 3 < day 5',
      ],
      ['delayed.0.event', 'nope', 'delayed effect 1 is an unknown event: nope'],
      [
        'followUps',
        [{ day: 31, event: 'nope' }],
        'follow-up 1 is an unknown event: nope',
      ],
      [
        'followUps',
        [
          { day: 31, event: 'essai' },
          { day: 30, event: 'essai' },
        ],
        'follow-up 2 comes before the one before it: day 30 < day 31',
      ],
      ['history.0.day', 2, 'event record 1 is on day 2, after day 1'],
      ['history.0.event', 'nope', 'event record 1 is an unknown event: nope'],
      [
        'history.0.choice',
        'nope',
        'event record 1 is an unknown choice of essai: nope',
      ],
      [
        'history.0.outcome',
        1,
        "event record 1 is outcome 1 of essai's toutEssayer, which has 1",
      ],
      ['headlines.0.day', 2, 'headline 1 is on day 2, after day 1'],
    ])('with %s at %j', (path, value, reason) => {
      expectInvalid(at(path, value), [reason])
    })

    it('with a delayed follow-up to an unknown event', () => {
      const text = at('delayed.0.effect', {
        kind: 'followUp',
        event: 'nope',
        days: 3,
        chance: 1,
      })
      expectInvalid(text, [
        "delayed effect 1's follow-up is an unknown event: nope",
      ])
    })

    it.each([
      [
        { kind: 'collectReceivable', client: 'A', inDays: 2 },
        'Unrecognized key: "inDays"',
      ],
      [
        { kind: 'collectReceivable', client: 'A', onNextWeekday: 4 },
        'Unrecognized key: "onNextWeekday"',
      ],
      [{ kind: 'lottery' }, '→ at events.delayed[0].effect.kind'],
      [{ kind: 'energy', amount: 0 }, '→ at events.delayed[0].effect.amount'],
      [
        { kind: 'charge', amountCents: 100, description: 'x', account: '1000' },
        '→ at events.delayed[0].effect.account',
      ],
    ])('with the delayed effect %j', (effect, reason) => {
      expectInvalid(at('delayed.0.effect', effect), [reason])
    })

    it('whose history goes back in time', () => {
      const record = CHOSEN.events.history[0]
      const text = at('history', [record, { ...record, day: 0 }])
      expectInvalid(text, [
        'event record 2 comes before the one before it: day 0 < day 1',
      ])
    })

    it('whose headlines go back in time', () => {
      const text = at('headlines', [
        { day: 1, id: 'essai' },
        { day: 0, id: 'essai' },
      ])
      expectInvalid(text, [
        'headline 2 comes before the one before it: day 0 < day 1',
      ])
    })

    describe('changes to the street', () => {
      const closing = serialize(CLOSE_2)
      const summaryOnly = (CLOSE_2.lastDay?.modifiers ?? []).findIndex(
        ({ change }) => change.kind === 'willingness',
      )

      it.each([
        [
          'modifiers.0.event',
          'nope',
          'street modifier 1 is an unknown event: nope',
        ],
        [
          'modifiers.0.fromDay',
          2,
          'street modifier 1 starts on day 2, after day 1',
        ],
        [
          'modifiers.1.lastDay',
          0,
          'street modifier 2 ends on day 0, before it starts on day 1',
        ],
      ])('with %s at %j', (path, value, reason) => {
        expectInvalid(at(path, value), [reason])
      })

      it('that ended on a day already played', () => {
        expectInvalid(at('modifiers.0.lastDay', 2, closing), [
          'street modifier 1 ends on day 2, a day already played',
        ])
      })

      it('out of order', () => {
        const [first, second] = CHOSEN.events.modifiers
        expectInvalid(at('modifiers', [first, { ...second, fromDay: 0 }]), [
          'street modifier 2 comes before the one before it: day 0 < day 1',
        ])
      })

      it.each([
        [{ kind: 'walkIns', factor: 0 }, 'change.factor'],
        [{ kind: 'walkIns', factor: -0.5 }, 'change.factor'],
        [
          { kind: 'walkIns', factor: 0.5, segment: 'touriste' },
          'change.segment',
        ],
        [{ kind: 'appeal', product: 'poutine', factor: 2 }, 'change.product'],
        [{ kind: 'unavailable' }, 'change.product'],
        [{ kind: 'pluie' }, 'change.kind'],
      ])('with the change %j', (change, field) => {
        expectInvalid(at('modifiers.0.change', change), [
          `→ at events.modifiers[0].${field}`,
        ])
      })

      it('with a change that still has its days', () => {
        expectInvalid(at('modifiers.0.change', { kind: 'closed', days: 2 }), [
          'Unrecognized key: "days"',
        ])
      })

      it('with a key the game does not know', () => {
        expectInvalid(at('modifiers.0.note', 'x'), ['Unrecognized key: "note"'])
      })

      it('of lastDay, from an unknown event, even once it ended', () => {
        expect(summaryOnly).toBeGreaterThan(-1)
        expect(CLOSE_2.events.modifiers).toHaveLength(3)
        const text = withValue(
          `lastDay.modifiers.${summaryOnly}.event`,
          'nope',
          closing,
        )
        expectInvalid(text, [
          `lastDay's street modifier ${summaryOnly + 1} is an unknown event: nope`,
        ])
      })

      it.each([
        ['fromDay', 3, 'from day 3 to day 15, not on day 2'],
        ['lastDay', 1, 'from day 1 to day 1, not on day 2'],
      ])(
        'of lastDay, with a %s %j it was not in effect',
        (field, value, reason) => {
          const text = withValue(`lastDay.modifiers.0.${field}`, value, closing)
          expectInvalid(text, [
            `lastDay's street modifier 1 is in effect ${reason}`,
          ])
        },
      )

      it('of lastDay, out of order', () => {
        const text = withValue('lastDay.modifiers.0.fromDay', 2, closing)
        expectInvalid(text, [
          "lastDay's street modifier 2 comes before the one before it: day 1 < day 2",
        ])
      })

      it('of lastDay, with a change it breaks', () => {
        const text = withValue(
          'lastDay.modifiers.0.change',
          { kind: 'appeal', factor: 2 },
          closing,
        )
        expectInvalid(text, ['→ at lastDay.modifiers[0].change.product'])
      })
    })

    it("with the owner's energy below the close before, unless a choice was made that morning", () => {
      const tired = CHOSEN.energy
      expect(tired).toBeLessThan(CHOSEN.lastDay?.energy ?? 0)
      expect(deserialize(CHOSEN_SAVE).energy).toBe(tired)
      expectInvalid(at('history', []), [
        `energy is ${tired} on the morning of day 1, below the 100 of the close before`,
      ])
    })
  })

  describe("an event's personal movement", () => {
    const gift = 'personal.movements.1'

    it('dated the morning of the save, which loads', () => {
      expect(deserialize(CHOSEN_SAVE).personal.movements).toHaveLength(2)
    })

    it('of 0', () => {
      expectInvalid(withValue(`${gift}.amount`, 0, CHOSEN_SAVE), [
        "personal movement 2, « Cadeau d'essai », must not be 0",
      ])
    })

    it('after the save', () => {
      expectInvalid(withValue(`${gift}.day`, 2, CHOSEN_SAVE), [
        'personal movement 2 is on day 2, after day 1',
      ])
    })

    it('whose label no event gives', () => {
      expectInvalid(withValue(`${gift}.label`, 'Loto', CHOSEN_SAVE), [
        'personal movement 2 has an unknown label: « Loto »',
      ])
    })

    it("dated after the last day played, for the owner's own labels", () => {
      expectInvalid(
        withValue(
          `${gift}.label`,
          LABELS.rent,
          withValue(`${gift}.amount`, -100, CHOSEN_SAVE),
        ),
        ['personal movement 2 is on day 1, after day 0'],
      )
    })

    it("under a label of the owner's no event gives, held to its own rule", () => {
      const events = pocketCard(LABELS.rent, 100)
      // FORTNIGHT's movement 1 is a « Loyer », 2 a « Salaire », 3 a
      // « Dépenses de la semaine ».
      expectInvalid(
        withValue('personal.movements.1.amount', -70_000),
        ['personal movement 2, « Salaire », must be above 0: -70000'],
        FOOD_TRUCK,
        events,
      )
      expectInvalid(
        withValue('personal.movements.2.amount', 25_000),
        [
          'personal movement 3, « Dépenses de la semaine », must be below 0: 25000',
        ],
        FOOD_TRUCK,
        events,
      )
      // The « Loyer » the card gives is held to the card's rule instead.
      const refund = withValue('personal.movements.0.amount', 130_000)
      expect(
        deserialize(refund, FOOD_TRUCK, events).personal.movements[0]?.amount,
      ).toBe(130_000)
      expectInvalid(refund, [
        'personal movement 1, « Loyer », must be below 0: 130000',
      ])
      expectInvalid(
        withValue('personal.movements.0.amount', 0),
        ['personal movement 1, « Loyer », must not be 0'],
        FOOD_TRUCK,
        events,
      )
    })

    it('before day 0 is played, but for a choice made that morning', () => {
      const unchosen = withValue('events.history', [], DAY_0_SAVE)
      expectInvalid(
        unchosen,
        [`energy is ${FULL_ENERGY - 5} before day 0 is played, not 100`],
        FOOD_TRUCK,
        DAY_0_CARD,
      )
      for (const save of [
        withValue('energy', FULL_ENERGY, unchosen),
        withValue('personal.movements.0.label', LABELS.salary, DAY_0_SAVE),
        withValue('personal.unpaidRents', [0], DAY_0_SAVE),
      ]) {
        expectInvalid(
          save,
          ['personal holds movements before day 0 is played'],
          FOOD_TRUCK,
          DAY_0_CARD,
        )
      }
      expectInvalid(
        withValue('personal.movements.0.amount', 0, DAY_0_SAVE),
        ['personal movement 1, « Cadeau », must not be 0'],
        FOOD_TRUCK,
        DAY_0_CARD,
      )
    })
  })
})
