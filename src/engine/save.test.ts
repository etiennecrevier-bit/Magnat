import { describe, expect, it } from 'vitest'
import eventsJson from '../content/events.json'
import financingJson from '../content/financing.json'
import grocersJson from '../content/grocers.json'
import {
  loadDefiContent,
  loadDifficultyContent,
  loadEventContent,
  loadFinancingContent,
  loadFoodTruckContent,
  loadGrocerContent,
  type DifficultyContent,
  type DifficultyId,
  type EventContent,
  type RungId,
} from '../content/schema.ts'
import {
  balance,
  entriesOf,
  postEntry,
  type Journal,
} from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import { BAKERY, closedBakery } from './bakery.ts'
import { endOfMonth } from './calendar.ts'
import { allowedChoices } from './challenge.ts'
import { GROCERS, grocerAway, noContracts, startContract } from './contracts.ts'
import {
  createInitialState,
  startChallenge,
  tick,
  toCalendar,
} from './clock.ts'
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
import { applyDecision, type DecisionChange } from './decisions.ts'
import { noDream } from './dream.ts'
import { applyEffect } from './effects.ts'
import { FULL_ENERGY } from './energy.ts'
import { NO_EVENTS, drawEvent, noEvents, resolveEvent } from './events.ts'
import { FINANCING } from './financing.ts'
import { inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
import { netWorth, netWorthChange } from './netWorth.ts'
import { PERCENTILES } from './percentiles.ts'
import { LABELS } from './personal.ts'
import { PROFILE_CONTENT } from './profile.ts'
import { SAVE_VERSION, deserialize, serialize } from './save.ts'
import { STAFF } from './staff.ts'
import type { GameState, Profile } from './types.ts'

const SEED = 42
const LIMITS = FOOD_TRUCK.decisionLimits

type Json = Record<string, unknown>

function played(days: number, from = createInitialState(SEED)): GameState {
  let state = from
  for (let i = 0; i < days; i += 1) state = tick(state)
  return state
}

/** A new game of `difficulty`, with the default name and avatar. */
function startedAs(
  difficulty: DifficultyId,
  difficulties: DifficultyContent = DIFFICULTIES,
): GameState {
  return createInitialState(
    SEED,
    FOOD_TRUCK,
    { ...PROFILE_CONTENT.defaultProfile, difficulty },
    difficulties,
  )
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

/**
 * The shipped essai card alone, drawn every morning from day 1, without its
 * emergency loan and share sale: those came in version 15, and have tests
 * of their own, so the games it plays still save as older versions.
 */
const ESSAI: EventContent = {
  pacing: { firstDay: 1, minDaysBetween: 0, dailyChance: 1 },
  events: EVENTS.events
    .filter(({ id }) => id === 'essai')
    .map((event) => ({
      ...event,
      weight: 1,
      choices: event.choices.map((choice) => ({
        ...choice,
        outcomes: choice.outcomes.map((outcome) => ({
          ...outcome,
          effects: outcome.effects.filter(
            ({ kind }) => kind !== 'emergencyLoan' && kind !== 'shareSale',
          ),
        })),
      })),
    })),
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
// 2 alone and the truck closed on day 3, both queued, a contract signed with
// Épicerie Chez Normand and Dépanneur 24/24 away to day 30.
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

// The morning of day 3, before a Sunday is played; the morning of day 7,
// after the first; the morning of Thursday, day 17, with three days of the
// week under way; and the close of Sunday, day 20.
const DAY_3 = played(3)
const WEEK_1 = played(7)
const THURSDAY = played(17)
const SUNDAY_CLOSE = playDay(played(20))
const THURSDAY_SAVE = serialize(THURSDAY)

/** `state`, saved as version 9, before the week in numbers. */
function v9(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutWeek(save)
  return JSON.stringify({ ...save, saveVersion: 9 })
}

/**
 * Takes the week in numbers out of `save`, as version 9 wrote it, and the
 * Défi and the bakery, which came later.
 */
function withoutWeek(save: Json): void {
  delete save.weekSoFar
  delete save.lastWeek
  delete save.weekHistory
  delete save.challenge
  withoutBakery(save)
}

/**
 * Takes « Le rêve » out of `save`, as version 17 wrote it: the save of a
 * game that never bought a rung nor became « Magnat ».
 */
function withoutDream(save: Json): void {
  expect(save.dream).toEqual(noDream())
  delete save.dream
}

/** `state`, with no rung bought, saved as version 17, before « Le rêve ». */
function v17(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutDream(save)
  return JSON.stringify({ ...save, saveVersion: 17 })
}

/**
 * Takes the net worth out of each week of `save`'s history, if it has one,
 * as version 16 wrote it, and « Le rêve », which came later.
 */
function withoutNetWorths(save: Json): void {
  withoutDream(save)
  for (const week of (save.weekHistory as Json[] | undefined) ?? []) {
    delete week.netWorth
  }
}

/** `state`, saved as version 16, before the net worth of each week. */
function v16(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutNetWorths(save)
  return JSON.stringify({ ...save, saveVersion: 16 })
}

/**
 * `state` as a save written before the net worth of each week loads it:
 * with none for the weeks of its history.
 */
function unvalued(state: GameState): GameState {
  return {
    ...state,
    weekHistory: state.weekHistory.map((week) => ({ ...week, netWorth: null })),
  }
}

/**
 * Takes the end of the game out of `save`, as version 15 wrote it: the save
 * of a game that goes on, with no net worth for its weeks, which came
 * later.
 */
function withoutEnd(save: Json): void {
  withoutNetWorths(save)
  expect(save.ended).toBeNull()
  delete save.ended
}

/** `state`, not ended, saved as version 15, before the end of a game. */
function v15(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutEnd(save)
  return JSON.stringify({ ...save, saveVersion: 15 })
}

/**
 * Takes the financing out of `save`, as version 14 wrote it: the save of a
 * game that never took an emergency loan nor sold shares, and that nobody
 * came to lend to. Whether its encaisse closed below zero comes from its
 * books. Nor did it end, which came later.
 */
function withoutFinancing(save: Json): void {
  withoutEnd(save)
  expect(save.financing).toMatchObject({
    loans: [],
    shareSales: [],
    lastLoanRequestDay: null,
  })
  delete save.financing
}

/** `state`, with no financing, saved as version 14, before the financing. */
function v14(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutFinancing(save)
  return JSON.stringify({ ...save, saveVersion: 14 })
}

/**
 * Takes the staff out of `save`, as version 13 wrote it: the save of a game
 * that never hired anyone, with the owner at work, no strike and nothing
 * missed, nor any financing, which came later.
 */
function withoutStaff(save: Json): void {
  withoutFinancing(save)
  expect(save.staff).toEqual([])
  expect(save.ownerAway).toBe(false)
  delete save.staff
  delete save.ownerAway
  for (const key of ['decisions', 'pendingDecisions']) {
    const decisions = save[key] as Json | null
    if (decisions === null) continue
    expect(decisions.staff).toEqual([])
    delete decisions.staff
  }
  const contracts = save.contracts as Json
  expect(contracts.missed).toEqual([])
  delete contracts.missed
  for (const contract of contracts.running as Json[]) {
    expect(contract.strikes).toBe(0)
    delete contract.strikes
  }
  const lastDay = save.lastDay as Json | null
  if (lastDay === null) return
  expect(lastDay.missed).toEqual([])
  delete lastDay.missed
}

/** `state`, with no staff, saved as version 13, before the staff. */
function v13(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutStaff(save)
  return JSON.stringify({ ...save, saveVersion: 13 })
}

/**
 * Takes the contracts out of `save`, as version 12 wrote it: the save of a
 * game that never signed one, nor hired anyone, which came later.
 */
function withoutContracts(save: Json): void {
  withoutStaff(save)
  expect(save.contracts).toEqual({ running: [], deliveries: [], away: {} })
  delete save.contracts
  const lastDay = save.lastDay as Json | null
  if (lastDay === null) return
  expect(lastDay.deliveries).toEqual([])
  delete lastDay.deliveries
}

/** `state`, with no contract, saved as version 12, before the contracts. */
function v12(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutContracts(save)
  return JSON.stringify({ ...save, saveVersion: 12 })
}

/**
 * Takes the bakery out of `save`, as version 11 wrote it: the save of a game
 * that never planned one, with the croissants bought, nor signed a
 * contract, which came later.
 */
function withoutBakery(save: Json): void {
  withoutContracts(save)
  expect(save.bakery).toEqual(closedBakery())
  delete save.bakery
  for (const key of ['decisions', 'pendingDecisions']) {
    const decisions = save[key] as Json | null
    if (decisions === null) continue
    expect(decisions).toMatchObject({
      bakery: null,
      croissantSource: BAKERY.startingDecisions.croissantSource,
      bake: BAKERY.startingDecisions.bake,
    })
    delete decisions.bakery
    delete decisions.croissantSource
    delete decisions.bake
  }
}

/** `state`, with no bakery, saved as version 11, before the bakery. */
function v11(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  withoutBakery(save)
  return JSON.stringify({ ...save, saveVersion: 11 })
}

/** `state`, not a Défi, saved as version 10, before the Défis. */
function v10(state: GameState): string {
  const save = JSON.parse(serialize(state)) as Json
  expect(save.challenge).toBeNull()
  delete save.challenge
  withoutBakery(save)
  return JSON.stringify({ ...save, saveVersion: 10 })
}

/**
 * `state` as a save written before the week in numbers loads it: no week
 * reported, and the week under way counted from the last close, partial
 * unless that close was a Sunday's.
 */
function sinceLoaded(state: GameState): GameState {
  const { lastDay, journal } = state
  return {
    ...state,
    weekSoFar:
      lastDay === null
        ? state.weekSoFar
        : {
            cashAtStart: balance(journal, '1000', { toDay: lastDay.day }),
            partial: toCalendar(lastDay.day).weekday !== 7,
            days: [],
            modifiers: [],
          },
    lastWeek: null,
    weekHistory: [],
  }
}

/** Expects the load to fail, its message naming each of `reasons`. */
function expectInvalid(
  text: string,
  reasons: readonly string[],
  content = FOOD_TRUCK,
  events = EVENTS,
  difficulties = DIFFICULTIES,
  defis = DEFIS,
): void {
  let message: string | undefined
  try {
    deserialize(text, content, events, difficulties, defis)
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
    expect(SAVE_VERSION).toBe(18)
    expect(JSON.parse(serialize(DAY_400))).toMatchObject({ saveVersion: 18 })
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

  it('give back a closure for work, to come and in effect', () => {
    const working: GameState = {
      ...CHOSEN,
      events: {
        ...CHOSEN.events,
        delayed: [
          ...CHOSEN.events.delayed,
          {
            day: 5,
            event: 'essai',
            effect: { kind: 'closed', days: 1, work: true },
          },
        ],
        modifiers: [
          ...CHOSEN.events.modifiers,
          {
            event: 'essai',
            change: { kind: 'closed', work: true },
            fromDay: 1,
            lastDay: 1,
          },
        ],
      },
    }
    expect(reloaded(working)).toEqual(working)
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
      withoutWeek(save)
      save.saveVersion = 7
    })
    const back = deserialize(text)
    expect(back).toEqual(sinceLoaded(FORTNIGHT))
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
      withoutWeek(save)
      return JSON.stringify({ ...save, saveVersion: 8 })
    }
    expect(deserialize(v8(FORTNIGHT))).toEqual(sinceLoaded(FORTNIGHT))
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
      contracts: noContracts(),
    }
    expect(deserialize(v8(owed))).toEqual(sinceLoaded(owed))
    expect(deserialize(v8(createInitialState(SEED)))).toEqual(
      createInitialState(SEED),
    )
  })

  it('give back the week under way and the weeks reported, on a Monday morning, mid-week and at the close of a Sunday', () => {
    expect(FORTNIGHT.weekSoFar.days).toEqual([])
    expect(FORTNIGHT.weekHistory).toHaveLength(2)
    expect(THURSDAY.weekSoFar.days.map(({ day }) => day)).toEqual([14, 15, 16])
    expect(SUNDAY_CLOSE.lastWeek?.firstDay).toBe(14)
    for (const state of [
      DAY_3,
      WEEK_1,
      FORTNIGHT,
      THURSDAY,
      SUNDAY_CLOSE,
      playDay(THURSDAY),
      DAY_400,
    ]) {
      expect(reloaded(state)).toStrictEqual(state)
    }
  })

  it('load a game mid-week that reports the week as if it had never stopped', () => {
    const straight = played(4, THURSDAY)
    expect(played(4, reloaded(THURSDAY))).toEqual(straight)
    expect(straight.lastWeek?.days.map(({ day }) => day)).toEqual([
      14, 15, 16, 17, 18, 19, 20,
    ])
  })

  it('load a version 9 game mid-week, whose first week reported covers the days played after it', () => {
    const back = deserialize(v9(THURSDAY))
    const cash = balance(THURSDAY.journal, '1000', { toDay: 16 })
    expect(back).toEqual(sinceLoaded(THURSDAY))
    expect(back.weekSoFar).toEqual({
      cashAtStart: cash,
      partial: true,
      days: [],
      modifiers: [],
    })
    expect(reloaded(played(2, back))).toStrictEqual(played(2, back))
    const after = played(4, back)
    const report = after.lastWeek
    expect(report).toMatchObject({
      firstDay: 14,
      partial: true,
      cashAtStart: cash,
      sales: incomeStatement(after.journal, 17, 20).sales.amount,
      previousBest: null,
    })
    expect(report?.days.map(({ day }) => day)).toEqual([17, 18, 19, 20])
    expect(after.weekHistory).toHaveLength(1)
    expect(reloaded(after)).toStrictEqual(after)
    // The next week is whole, and has a week to beat.
    expect(played(7, after).lastWeek).toMatchObject({
      firstDay: 21,
      partial: false,
      previousBest: report?.sales,
    })
  })

  it('load a version 9 game after a Sunday, whose next week is reported whole', () => {
    const back = deserialize(v9(FORTNIGHT))
    expect(back.weekSoFar).toEqual(FORTNIGHT.weekSoFar)
    const straight = played(7, FORTNIGHT).lastWeek
    expect(straight?.previousBest).not.toBeNull()
    expect(played(7, back).lastWeek).toEqual({
      ...straight,
      previousBest: null,
    })
  })

  it('load a version 9 game at the close of a day, or before day 0 is played', () => {
    for (const state of [SUNDAY_CLOSE, playDay(THURSDAY)]) {
      expect(deserialize(v9(state))).toEqual(sinceLoaded(state))
    }
    expect(deserialize(v9(createInitialState(SEED)))).toEqual(
      createInitialState(SEED),
    )
    expect(deserialize(v9(DAY_0_CHOSEN), FOOD_TRUCK, DAY_0_CARD)).toEqual(
      DAY_0_CHOSEN,
    )
  })

  it('load a version 11 game as one with no bakery and the croissants bought', () => {
    const pending = applyDecision(THURSDAY, {
      kind: 'marketingDaily',
      budget: cents(1_000),
    })
    for (const state of [
      createInitialState(SEED),
      THURSDAY,
      pending,
      SUNDAY_CLOSE,
      DAY_400,
      { ...CHOSEN, contracts: noContracts() },
    ]) {
      expect(deserialize(v11(state))).toStrictEqual(unvalued(state))
    }
    const defi = startChallenge('travauxSaintDenis', SEED)
    expect(deserialize(v11(played(5, defi)))).toStrictEqual(
      unvalued(played(5, defi)),
    )
  })

  it('load a version 12 game as one with no contract and no delivery', () => {
    const pending = applyDecision(THURSDAY, {
      kind: 'marketingDaily',
      budget: cents(1_000),
    })
    for (const state of [
      createInitialState(SEED),
      THURSDAY,
      pending,
      SUNDAY_CLOSE,
      DAY_400,
      { ...CHOSEN, contracts: noContracts() },
    ]) {
      expect(deserialize(v12(state))).toStrictEqual(unvalued(state))
    }
  })

  it('load a version 10 game as one that is not a Défi', () => {
    for (const state of [
      createInitialState(SEED),
      THURSDAY,
      SUNDAY_CLOSE,
      DAY_400,
    ]) {
      expect(deserialize(v10(state))).toStrictEqual(unvalued(state))
    }
    expect(deserialize(v10(DAY_0_CHOSEN), FOOD_TRUCK, DAY_0_CARD)).toEqual(
      DAY_0_CHOSEN,
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

  it.each([
    0,
    1,
    6,
    19,
    '18',
    '17',
    '16',
    '15',
    '14',
    '13',
    '12',
    '11',
    '10',
    '9',
    '8',
    '7',
    null,
  ])('saveVersion %j', (version) => {
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
      ['the week under way', 'weekSoFar.bonus', 'weekSoFar'],
      ['the last week', 'lastWeek.bonus', 'lastWeek'],
      ['a day of the last week', 'lastWeek.days.0.tip', 'lastWeek.days[0]'],
      ['a week of the history', 'weekHistory.0.bonus', 'weekHistory[0]'],
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
    'weekSoFar',
    'weekSoFar.cashAtStart',
    'lastWeek',
    'lastWeek.previousBest',
    'lastWeek.days.0.cashReceived',
    'weekHistory',
    'weekHistory.0.netIncome',
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
      // The last week's net worth moves with the cash, as the check reads
      // the cash at its close back from the cash now.
      const last = FORTNIGHT.weekHistory.length - 1
      const before = FORTNIGHT.weekHistory[last]?.netWorth ?? 0
      const back = deserialize(
        withValue(
          'personal.cash',
          -500,
          withValue(
            `weekHistory.${last}.netWorth`,
            before - 500 - FORTNIGHT.personal.cash,
          ),
        ),
      )
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

    // A game of each difficulty, played 8 days, before the 1st of the month
    // charges the truck: only the opening books tell them apart.
    const BY_DIFFICULTY = {
      facile: serialize(played(8, startedAs('facile'))),
      moyen: serialize(played(8, startedAs('moyen'))),
      difficile: serialize(played(8, startedAs('difficile'))),
    }

    it.each([
      ['moyen', 'facile'],
      ['difficile', 'facile'],
      ['facile', 'moyen'],
      ['difficile', 'moyen'],
      ['facile', 'difficile'],
      ['moyen', 'difficile'],
    ] as const)(
      'with the difficulty %s on the books of a %s game',
      (difficulty, books) => {
        const text = withValue(
          'profile.difficulty',
          difficulty,
          BY_DIFFICULTY[books],
        )
        expectInvalid(text, ['difficulty', difficulty])
      },
    )

    // With Facile's starting cash, Difficile's lone Mise de fonds also
    // starts a Facile game's books: the truck the owner brings after it
    // makes the game Facile.
    it('with the difficulty difficile on the books of a facile game of the same cash', () => {
      const { facile, difficile } = DIFFICULTIES.difficulties
      const sameCash = loadDifficultyContent({
        ...DIFFICULTIES,
        difficulties: {
          ...DIFFICULTIES.difficulties,
          difficile: {
            ...difficile,
            startingCashCents: facile.startingCashCents,
          },
        },
      })
      for (const difficulty of ['facile', 'difficile'] as const) {
        const game = startedAs(difficulty, sameCash)
        expect(
          deserialize(serialize(game), FOOD_TRUCK, EVENTS, sameCash),
        ).toStrictEqual(game)
      }
      const text = withValue(
        'profile.difficulty',
        'difficile',
        serialize(startedAs('facile', sameCash)),
      )
      expectInvalid(
        text,
        [
          "the journal does not open with the books of the profile's difficulty difficile",
        ],
        FOOD_TRUCK,
        EVENTS,
        sameCash,
      )
    })
  })

  describe('a version 7 game', () => {
    const v7 = (change: (save: Json) => void = () => undefined) =>
      edited('events', (save, key) => {
        delete save[key]
        delete save.receivables
        delete (save.lastDay as Json).modifiers
        withoutWeek(save)
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
        withoutWeek(save)
        save.saveVersion = 8
        change(save)
      })

    it('which loads', () => {
      expect(deserialize(v8())).toEqual(sinceLoaded(FORTNIGHT))
    })

    it('with the week in numbers, which came in version 10', () => {
      expectInvalid(
        v8((save) => {
          save.weekHistory = []
        }),
        ['Unrecognized key: "weekHistory"'],
      )
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

  describe('a version 12 game', () => {
    it.each(['contracts', 'lastDay.deliveries'])(
      'with %s, which came in version 13',
      (path) => {
        const save = JSON.parse(v12(FORTNIGHT)) as Json
        const keys = path.split('.')
        const key = keys.pop() ?? ''
        const at = keys.reduce((json, k) => json[k] as Json, save)
        const now = keys.reduce(
          (json, k) => json[k] as Json,
          JSON.parse(serialize(FORTNIGHT)) as Json,
        )
        at[key] = now[key]
        expectInvalid(JSON.stringify(save), [`Unrecognized key: "${key}"`])
      },
    )

    it('with a field it breaks', () => {
      const save = JSON.parse(v12(FORTNIGHT)) as Json
      save.energy = 101
      expectInvalid(JSON.stringify(save), ['→ at energy'])
    })
  })

  describe('a version 11 game', () => {
    it.each(['bakery', 'decisions.croissantSource', 'pendingDecisions.bake'])(
      'with %s, which came in version 12',
      (path) => {
        const pending = applyDecision(FORTNIGHT, {
          kind: 'marketingDaily',
          budget: cents(1_000),
        })
        const save = JSON.parse(v11(pending)) as Json
        const keys = path.split('.')
        const key = keys.pop() ?? ''
        const at = keys.reduce((json, k) => json[k] as Json, save)
        at[key] = (JSON.parse(serialize(pending)) as Json)[key] ?? null
        expectInvalid(JSON.stringify(save), [`Unrecognized key: "${key}"`])
      },
    )

    it('with a field it breaks', () => {
      const save = JSON.parse(v11(FORTNIGHT)) as Json
      save.energy = 101
      expectInvalid(JSON.stringify(save), ['→ at energy'])
    })
  })

  describe('a version 10 game', () => {
    it('with a Défi, which came in version 11', () => {
      const save = JSON.parse(v10(FORTNIGHT)) as Json
      save.challenge = null
      expectInvalid(JSON.stringify(save), ['Unrecognized key: "challenge"'])
    })

    it('with a field it breaks', () => {
      const save = JSON.parse(v10(FORTNIGHT)) as Json
      save.energy = 101
      expectInvalid(JSON.stringify(save), ['→ at energy'])
    })
  })

  describe('a version 9 game', () => {
    it('which loads', () => {
      expect(deserialize(v9(FORTNIGHT))).toEqual(sinceLoaded(FORTNIGHT))
    })

    it.each(['weekSoFar', 'lastWeek', 'weekHistory'])(
      'with %s, which came in version 10',
      (key) => {
        const save = JSON.parse(v9(FORTNIGHT)) as Json
        save[key] = (JSON.parse(SAVED) as Json)[key]
        expectInvalid(JSON.stringify(save), [`Unrecognized key: "${key}"`])
      },
    )
  })

  describe('the week in numbers', () => {
    const START = serialize(createInitialState(SEED))
    const WEEK_1_SAVE = serialize(WEEK_1)
    const DAY_3_SAVE = serialize(DAY_3)
    const saved = JSON.parse(SAVED) as {
      lastWeek: { days: Json[]; previousBest: number }
      weekHistory: Json[]
    }
    const thursday = JSON.parse(THURSDAY_SAVE) as {
      weekSoFar: { days: Json[]; cashAtStart: number }
    }
    const unknown = {
      event: 'inconnu',
      change: { kind: 'closed' },
      fromDay: 14,
      lastDay: 14,
    }

    it.each<[string, string, string]>([
      [
        'a first week that is not partial before day 0 is played',
        withValue('weekSoFar.partial', false, START),
        'weekSoFar is not partial before day 0 is played',
      ],
      [
        'a day of the week under way before day 0 is played',
        withValue('weekSoFar.days', thursday.weekSoFar.days.slice(2), START),
        'weekSoFar ends on day 16, not day -1',
      ],
      [
        'the days of the week under way out of order',
        withValue('weekSoFar.days.1.day', 16, THURSDAY_SAVE),
        'weekSoFar day 2 is day 16, not day 15',
      ],
      [
        'the week under way without the last day played',
        withValue(
          'weekSoFar.days',
          thursday.weekSoFar.days.slice(0, 2),
          THURSDAY_SAVE,
        ),
        'weekSoFar ends on day 15, not day 16',
      ],
      [
        'the week under way without its Monday',
        withValue(
          'weekSoFar.days',
          thursday.weekSoFar.days.slice(1),
          THURSDAY_SAVE,
        ),
        'weekSoFar starts on day 15, not on its Monday, day 14, and is not partial',
      ],
      [
        'the week under way with no day, mid-week',
        withValue('weekSoFar.days', [], THURSDAY_SAVE),
        'weekSoFar starts on day 17, not on its Monday, day 14, and is not partial',
      ],
      [
        "the week under way holding the Sunday's close",
        withValue('weekSoFar.days', saved.lastWeek.days.slice(6)),
        'weekSoFar starts on day 13, before its Monday, day 14',
      ],
      [
        'a close of the week under way the bilan does not have',
        withValue(
          'weekSoFar.days.0.cashAtClose',
          Number(thursday.weekSoFar.days[0]?.cashAtClose) + 1,
          THURSDAY_SAVE,
        ),
        'weekSoFar day 1 closes with',
      ],
      [
        'the week under way starting with cash the bilan does not have',
        withValue(
          'weekSoFar.cashAtStart',
          thursday.weekSoFar.cashAtStart + 1,
          THURSDAY_SAVE,
        ),
        'in Encaisse at the close of day 13',
      ],
      [
        'the first week starting with cash the books do not open with',
        withValue('weekSoFar.cashAtStart', 1, START),
        'weekSoFar.cashAtStart is 1, not the',
      ],
      [
        'the week under way with a change to the street of an unknown event',
        withValue('weekSoFar.modifiers', [unknown], THURSDAY_SAVE),
        "weekSoFar's street modifier 1 is an unknown event: inconnu",
      ],
      [
        'a week reported before a Sunday is played',
        withValue('lastWeek', saved.lastWeek, DAY_3_SAVE),
        'lastWeek is reported before a Sunday is played',
      ],
      [
        'a week reported other than the last',
        withValue('lastWeek.firstDay', 0),
        'lastWeek starts on day 0, not on day 7, the Monday of the last Sunday played',
      ],
      [
        'a week reported without its Sunday',
        withValue('lastWeek.days', saved.lastWeek.days.slice(0, 6)),
        'lastWeek ends on day 12, not day 13',
      ],
      [
        'a week reported without its Monday',
        withValue('lastWeek.days', saved.lastWeek.days.slice(1)),
        'lastWeek starts on day 8, not on its Monday, day 7, and is not partial',
      ],
      [
        'a week reported with a close the bilan does not have',
        withValue(
          'lastWeek.days.3.cashAtClose',
          Number(saved.lastWeek.days[3]?.cashAtClose) + 1,
        ),
        'lastWeek day 4 closes with',
      ],
      [
        'a week reported starting with cash the bilan does not have',
        withValue('lastWeek.cashAtStart', 1),
        'lastWeek.cashAtStart is 1, not the',
      ],
      [
        'a week reported ending other than its Sunday',
        withValue('lastWeek.cashAtEnd', 1),
        'lastWeek ends with 1',
      ],
      [
        'a week reported whose lowest close is not',
        withValue('lastWeek.lowestCash', 1),
        'at its lowest, not as its days close',
      ],
      [
        'a week reported with ventes the état des résultats does not have',
        withValue('lastWeek.sales', 1),
        'lastWeek has 1 of ventes',
      ],
      [
        'a week reported with a bénéfice the état des résultats does not have',
        withValue('lastWeek.netIncome', 1),
        'of bénéfice net, not the',
      ],
      [
        'a week reported with an event that did not come up',
        withValue('lastWeek.events', [
          {
            day: 8,
            event: 'essai',
            followUp: false,
            choice: 'rienFaire',
            outcome: 0,
          },
        ]),
        "lastWeek's events are not those of the history on its days",
      ],
      [
        'a week reported with a change to the street of an unknown event',
        withValue('lastWeek.modifiers', [unknown]),
        "lastWeek's street modifier 1 is an unknown event: inconnu",
      ],
      [
        'a week reported with no best ventes, after an earlier week',
        withValue('lastWeek.previousBest', null),
        'lastWeek.previousBest is null with 1 earlier weeks in the history',
      ],
      [
        'a week reported with best ventes, as the first',
        withValue('lastWeek.previousBest', 5, WEEK_1_SAVE),
        'lastWeek.previousBest is 5 with 0 earlier weeks in the history',
      ],
      [
        'a week reported with best ventes below an earlier week',
        withValue('lastWeek.previousBest', saved.lastWeek.previousBest - 1),
        "below an earlier week's ventes",
      ],
      [
        'a history of more than 52 weeks',
        edited(
          'weekHistory',
          (save, key) => {
            const history = save[key] as { firstDay: number }[]
            const first = history[0]?.firstDay ?? 0
            save[key] = [{ ...history[0], firstDay: first - 7 }, ...history]
          },
          serialize(DAY_400),
        ),
        'weekHistory holds 53 weeks, more than 52',
      ],
      [
        'a history whose weeks are not 7 days apart',
        withValue('weekHistory.0.firstDay', 1),
        'week 2 of weekHistory starts on day 7, not 7 days after the one before',
      ],
      [
        "a history whose last week is not the week reported's",
        withValue(
          'weekHistory.1.sales',
          Number(saved.weekHistory[1]?.sales) + 1,
        ),
        "the last week of weekHistory is not lastWeek's",
      ],
      [
        'a week reported missing from the history',
        withValue('weekHistory', [], WEEK_1_SAVE),
        "the last week of weekHistory is not lastWeek's",
      ],
      [
        'a history with no week reported',
        withValue('weekHistory', saved.weekHistory.slice(0, 1), DAY_3_SAVE),
        "the last week of weekHistory is not lastWeek's",
      ],
    ])('%s', (_, text, reason) => {
      expectInvalid(text, [reason])
    })

    it('a week reported with no day', () => {
      expectInvalid(withValue('lastWeek.days', []), ['→ at lastWeek.days'])
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

describe('a Défi', () => {
  /** A Défi of the save's tests; `fields` replace its own. */
  const defi = (fields: Json): Json => ({
    id: 'essai',
    title: 'Un essai',
    story: 'Quelques jours pour essayer.',
    difficulty: 'moyen',
    start: { month: 5, dayOfMonth: 8 },
    lengthDays: 10,
    setup: { cashCents: 300_000 },
    locked: [],
    modifiers: [],
    events: [],
    randomEvents: false,
    goal: {
      metric: 'lowestCash',
      medals: { or: 300_000, argent: 200_000, bronze: 0 },
    },
    conditions: [{ kind: 'minCash', amountCents: 0 }],
    ...fields,
  })
  // From Monday, May 8th, day 7, open every day, locked: « Essai » on its
  // first morning, then on day 2 with every effect on the books and the
  // owner, then « La concurrence » on day 4, which tires the owner; the
  // construction from the first day, the festival from day 5. Then a
  // Défi from July 10th, day 70, over August 1st, and one from day 0.
  const SAVE_DEFIS = loadDefiContent(
    {
      defis: [
        defi({
          id: 'semaine',
          setup: { cashCents: 300_000, daysOpen: [1, 2, 3, 4, 5, 6, 7] },
          locked: ['daysOpen'],
          modifiers: [
            {
              day: 0,
              days: 3,
              event: 'conesOrange',
              change: { kind: 'walkIns', factor: 0.65 },
            },
            {
              day: 5,
              days: 3,
              event: 'festival',
              change: { kind: 'walkIns', factor: 1.8 },
            },
          ],
          events: [
            { day: 0, event: 'essai', choices: ['rienFaire'] },
            { day: 2, event: 'essai', choices: ['toutEssayer'] },
            { day: 4, event: 'concurrence', choices: ['allerLuiParler'] },
          ],
        }),
        defi({
          id: 'ete',
          start: { month: 7, dayOfMonth: 10 },
          lengthDays: 28,
          setup: {},
          randomEvents: true,
        }),
        defi({
          id: 'mai',
          difficulty: 'facile',
          start: { month: 5, dayOfMonth: 1 },
          lengthDays: 7,
          setup: { energy: 90 },
          goal: {
            metric: 'sales',
            medals: { or: 1_000_000, argent: 500_000, bronze: 100_000 },
          },
          conditions: [],
        }),
      ],
    },
    EVENTS,
  )

  // « Le remontant », forced on the first morning, a closed Monday, at 30
  // energy: « Maintenant » takes 20 of the owner's energy and gives it back
  // at once, « Demain » takes 70 and gives it back at the start of Tuesday.
  // Either way, the Défi of that name falls to its minimum energy.
  const PICK_ME_UP = loadEventContent({
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 0 },
    events: [
      {
        id: 'remontant',
        weight: 1,
        character: { id: 'gerant', name: 'Le gérant', role: 'Gérant' },
        title: 'Un remontant',
        situation: 'Un café bien serré?',
        choices: [
          ['maintenant', 0],
          ['demain', 1],
        ].map(([id, inDays]) => ({
          id,
          label: id,
          tags: ['Énergie'],
          outcomes: [
            {
              chance: 1,
              result: 'Ouf.',
              effects: [-1, 1].map((sign) => ({
                kind: 'energy',
                amount: sign * (inDays === 0 ? 20 : 70),
                ...(inDays === 0 ? {} : { inDays }),
              })),
            },
          ],
        })),
      },
    ],
  })
  const PICK_ME_UP_DEFIS = loadDefiContent(
    {
      defis: [
        ['maintenant', 1],
        ['demain', 2],
      ].map(([id, lengthDays]) =>
        defi({
          id,
          difficulty: 'facile',
          lengthDays,
          setup: { energy: 30, daysOpen: [3] },
          events: [{ day: 0, event: 'remontant', choices: [id] }],
          goal: {
            metric: 'lowestEnergy',
            medals: { or: 30, argent: 25, bronze: 20 },
          },
          conditions: [{ kind: 'minEnergy', amount: 25 }],
        }),
      ),
    },
    PICK_ME_UP,
  )

  /** `state` saved and loaded with the Défis of these tests. */
  const reloaded = (state: GameState, defis = SAVE_DEFIS) =>
    deserialize(serialize(state), FOOD_TRUCK, EVENTS, DIFFICULTIES, defis)

  /** The event waiting answered as the Défi allows, or the last choice. */
  const answered = (state: GameState): GameState => {
    const { pending } = state.events
    if (pending === null) return state
    const choice =
      allowedChoices(state, SAVE_DEFIS)?.[0] ??
      EVENTS.events.find(({ id }) => id === pending.event)?.choices.at(-1)?.id
    return resolveEvent(state, choice ?? '', EVENTS, FOOD_TRUCK, SAVE_DEFIS)
  }

  const nextMorning = (state: GameState) =>
    tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      EVENTS,
      SAVE_DEFIS,
    )

  const closed = (state: GameState) =>
    playDay(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      SAVE_DEFIS,
    )

  /** The Défi from `state`, a morning, played to its end. */
  const playedOut = (state: GameState): GameState => {
    let played = state
    while (played.challenge?.status === 'enCours') {
      played = nextMorning(answered(played))
    }
    return played
  }

  /**
   * Every state of the Défi `id`, from its first morning to the morning
   * after its end: each morning, then after its choice, if any, then its
   * close.
   */
  const states = (id: string): GameState[] => {
    let state = startChallenge(id, SEED, FOOD_TRUCK, SAVE_DEFIS)
    const all = [state]
    while (state.challenge?.status === 'enCours') {
      if (state.events.pending !== null) {
        state = answered(state)
        all.push(state)
      }
      all.push(closed(state))
      state = nextMorning(state)
      all.push(state)
    }
    return all
  }

  const WEEK = states('semaine')
  /** The morning of `day`, before its event is chosen if one waits. */
  const morningOf = (day: number, list = WEEK): GameState => {
    const found = list.find(
      (state) => state.day === day && state.lastDay?.day !== day,
    )
    if (found === undefined) throw new Error(`No morning of day ${day}`)
    return found
  }
  /** The morning of `day`, once its event is chosen. */
  const chosenOn = (day: number): GameState => {
    const found = WEEK.find(
      (state) =>
        state.events.history.at(-1)?.day === day && state.lastDay?.day !== day,
    )
    if (found === undefined) throw new Error(`No choice on day ${day}`)
    return found
  }
  const closeOf = (day: number, list = WEEK): GameState => {
    const found = list.find(
      (state) => state.lastDay?.day === day && state.day === day,
    )
    if (found === undefined) throw new Error(`No close of day ${day}`)
    return found
  }
  const END = WEEK.at(-1) as GameState
  const save = (state: GameState) => JSON.parse(serialize(state)) as Json
  const text = (json: Json) => JSON.stringify(json)
  const expectRejected = (json: Json, reasons: string[], defis = SAVE_DEFIS) =>
    expectInvalid(text(json), reasons, FOOD_TRUCK, EVENTS, DIFFICULTIES, defis)

  describe('saved and loaded', () => {
    it('gives back every morning, choice and close, to the morning after its end', () => {
      // The first morning, three choices, and ten mornings and closes.
      expect(WEEK.length).toBe(1 + 3 + 2 * 10)
      expect(END.challenge?.status).toBe('reussi')
      for (const state of WEEK) expect(reloaded(state)).toStrictEqual(state)
    })

    it('goes on as if it had never stopped: from its first morning, with its event waiting, from the mornings after a choice that sold, charged and tired the owner, before the day is played, and from the middle', () => {
      expect(WEEK[0]?.events.pending).toEqual({
        event: 'essai',
        followUp: false,
      })
      const money = chosenOn(9)
      expect(money.events.history.at(-1)?.choice).toBe('toutEssayer')
      expect(money.energy).toBeLessThan(morningOf(9).energy)
      expect(balance(money.journal, '1000', { toDay: 9 })).not.toBe(
        balance(money.journal, '1000', { toDay: 8 }),
      )
      const tired = chosenOn(11)
      expect(tired.energy).toBeLessThan(morningOf(11).energy)
      for (const state of [
        WEEK[0] as GameState,
        money,
        tired,
        morningOf(13),
        END,
      ]) {
        expect(playedOut(reloaded(state))).toStrictEqual(END)
      }
    })

    it('keeps its progress to the last close while a choice made that morning moved the cash and the energy, and the energy that choice took', () => {
      const money = chosenOn(9)
      const before = closeOf(8).challenge
      expect(money.energy).toBeLessThan(before?.lowestEnergySinceClose ?? 0)
      expect(money.challenge).toStrictEqual({
        ...before,
        lowestEnergySinceClose: money.energy,
      })
      expect(reloaded(money).challenge).toStrictEqual(money.challenge)
    })

    it('gives back a Défi that starts in July and pays the loan on August 1st, and goes on the same', () => {
      const summer = states('ete')
      const august = closeOf(92, summer)
      expect(
        entriesOf(august.journal).some(
          ({ day, memo }) => day === 92 && memo === "Intérêts sur l'emprunt",
        ),
      ).toBe(true)
      expect(reloaded(august)).toStrictEqual(august)
      const end = summer.at(-1) as GameState
      for (const state of [summer[0] as GameState, morningOf(93, summer)]) {
        expect(reloaded(state)).toStrictEqual(state)
        expect(playedOut(reloaded(state))).toStrictEqual(end)
      }
    })

    it('gives back a Défi that starts on day 0', () => {
      const may = states('mai')
      expect(may[0]?.day).toBe(0)
      for (const state of may) expect(reloaded(state)).toStrictEqual(state)
      expect(playedOut(reloaded(may[0] as GameState))).toStrictEqual(may.at(-1))
    })

    it('gives back the energy a choice took and gave back, after the choice and after each day, and goes on the same', () => {
      const loaded = (state: GameState) =>
        deserialize(
          serialize(state),
          FOOD_TRUCK,
          PICK_ME_UP,
          DIFFICULTIES,
          PICK_ME_UP_DEFIS,
        )
      const morningAfter = (state: GameState, id: string) =>
        tick(
          state.events.pending === null
            ? state
            : resolveEvent(state, id, PICK_ME_UP, FOOD_TRUCK, PICK_ME_UP_DEFIS),
          FOOD_TRUCK,
          CUSTOMERS,
          DIFFICULTIES,
          PERSONAL,
          ENERGY,
          PICK_ME_UP,
          PICK_ME_UP_DEFIS,
        )
      for (const id of ['maintenant', 'demain']) {
        // The first morning, its choice, then each close and morning after.
        let state = startChallenge(id, SEED, FOOD_TRUCK, PICK_ME_UP_DEFIS)
        const all = [state]
        state = resolveEvent(
          state,
          id,
          PICK_ME_UP,
          FOOD_TRUCK,
          PICK_ME_UP_DEFIS,
        )
        all.push(state)
        while (state.challenge?.status === 'enCours') {
          all.push(
            playDay(
              state,
              FOOD_TRUCK,
              CUSTOMERS,
              DIFFICULTIES,
              PERSONAL,
              ENERGY,
              PICK_ME_UP_DEFIS,
            ),
          )
          state = morningAfter(state, id)
          all.push(state)
        }
        expect(all[1]?.challenge?.lowestEnergySinceClose).toBe(
          id === 'maintenant' ? 10 : 30,
        )
        expect(state.challenge).toMatchObject({
          progress: { lowestEnergy: 10 },
          status: 'echoue',
          medal: null,
        })
        for (const saved of all) {
          expect(loaded(saved)).toStrictEqual(saved)
          if (saved.lastDay?.day === saved.day) continue
          let played = loaded(saved)
          while (played.challenge?.status === 'enCours') {
            played = morningAfter(played, id)
          }
          expect(played).toStrictEqual(state)
        }
      }
    })
  })

  describe('a save rejected', () => {
    it('of a Défi of no such id', () => {
      const json = save(WEEK[0] as GameState)
      ;(json.challenge as Json).id = 'inconnu'
      expectRejected(json, ['challenge is an unknown Défi: inconnu'])
    })

    it("that does not start on the Défi's first day", () => {
      const json = save(WEEK[0] as GameState)
      ;(json.challenge as Json).startDay = 8
      expectRejected(json, [
        'challenge starts on day 8, not on day 7, the first day of the Défi semaine',
      ])
    })

    it("at another difficulty than the Défi's", () => {
      const json = save(WEEK[0] as GameState)
      ;(json.profile as Json).difficulty = 'facile'
      expectRejected(json, [
        "the Défi semaine is played at moyen, not at the profile's difficulty facile",
      ])
    })

    it('that waits for its first day on another day', () => {
      const json = save(startChallenge('mai', SEED, FOOD_TRUCK, SAVE_DEFIS))
      json.day = 1
      expectRejected(json, ['lastDay is null on day 1'])
    })

    it('that played a day before its first', () => {
      // The same game, read as a Défi that starts a week later.
      const later = loadDefiContent(
        {
          defis: [
            defi({
              id: 'semaine',
              start: { month: 5, dayOfMonth: 15 },
              setup: { cashCents: 300_000, daysOpen: [1, 2, 3, 4, 5, 6, 7] },
            }),
          ],
        },
        EVENTS,
      )
      const json = save(closeOf(10))
      ;(json.challenge as Json).startDay = 14
      expectRejected(
        json,
        ["lastDay is day 10, before the game's first day, day 14"],
        later,
      )
    })

    it('with an entry or an event before its first day', () => {
      const entry = save(morningOf(10))
      const journal = entry.journal as Json[]
      journal.splice(3, 0, {
        day: 3,
        memo: 'Avant',
        lines: [
          { account: '6900', debit: 100, credit: 0 },
          { account: '3000', debit: 0, credit: 100 },
        ],
      })
      expectRejected(entry, [
        "journal entry 4 is on day 3, before the Défi's first day, day 7",
      ])
      const event = save(morningOf(10))
      const { history } = event.events as { history: Json[] }
      history.unshift({
        day: 3,
        event: 'essai',
        followUp: false,
        choice: 'rienFaire',
        outcome: 0,
      })
      expectRejected(event, [
        "an event came before the Défi's first day, day 7",
      ])
    })

    it('that played more days than the Défi has', () => {
      const shorter = loadDefiContent(
        {
          defis: [
            defi({
              id: 'semaine',
              lengthDays: 5,
              setup: { cashCents: 300_000, daysOpen: [1, 2, 3, 4, 5, 6, 7] },
              locked: ['daysOpen'],
            }),
          ],
        },
        EVENTS,
      )
      expectRejected(
        save(morningOf(13)),
        ['challenge has played 6 days of a Défi of 5'],
        shorter,
      )
    })

    it('with progress that is not what was played or what the books hold', () => {
      const at = (state: GameState, field: string, value: unknown) => {
        const json = save(state)
        ;((json.challenge as Json).progress as Json)[field] = value
        return json
      }
      const mid = morningOf(12)
      const { progress } = mid.challenge ?? {}
      if (progress === undefined) throw new Error('No Défi')
      expectRejected(at(mid, 'daysPlayed', 4), [
        'challenge.progress.daysPlayed is 4, not the 5 days played since day 7',
      ])
      expectRejected(at(mid, 'sales', progress.sales + 1), [
        `challenge has ${progress.sales + 1} of ventes`,
      ])
      expectRejected(at(mid, 'netIncome', progress.netIncome - 1), [
        'of bénéfice net, not the',
      ])
      // The lowest close is not the lowest cash.
      const lowestClose = Math.min(
        ...[7, 8, 9, 10, 11].map((day) =>
          balance(mid.journal, '1000', { toDay: day }),
        ),
      )
      expect(lowestClose).toBeGreaterThan(progress.lowestCash)
      expectRejected(at(mid, 'lowestCash', lowestClose), [
        `challenge.progress.lowestCash is ${lowestClose}, not the ${progress.lowestCash} the books went down to`,
      ])
      // The save keeps no energy but the last close's: the lowest is no
      // higher.
      const later = morningOf(14)
      const above = (later.lastDay?.energy ?? 0) + 1
      expect(above).toBeLessThanOrEqual(100)
      expectRejected(at(later, 'lowestEnergy', above), [
        `challenge.progress.lowestEnergy is ${above}, above`,
      ])
      expectRejected(at(WEEK[0] as GameState, 'customersServed', 1), [
        'challenge counts customers or units before its first day is played',
      ])
      expectRejected(at(WEEK[0] as GameState, 'lowestEnergy', 50), [
        'challenge.progress.lowestEnergy is 50 before its first day is played, not 100',
      ])
    })

    it('with a lowest energy since the last close the game could not leave', () => {
      const at = (state: GameState, value: number) => {
        const json = save(state)
        ;(json.challenge as Json).lowestEnergySinceClose = value
        return json
      }
      // With no choice made since, the last close's, or the starting energy.
      const mid = morningOf(12)
      const closing = mid.lastDay?.energy ?? 0
      expectRejected(at(mid, closing - 1), [
        `challenge.lowestEnergySinceClose is ${closing - 1}, not the ${closing} of the last close`,
      ])
      expectRejected(at(closeOf(12), 0), [
        `challenge.lowestEnergySinceClose is 0, not the ${closeOf(12).lastDay?.energy} of the last close`,
      ])
      expectRejected(at(WEEK[0] as GameState, 99), [
        'challenge.lowestEnergySinceClose is 99, not the 100 of its first morning',
      ])
      // A choice made that morning can only have lowered it, to the
      // owner's energy now or below.
      const tired = chosenOn(11)
      const limit = Math.min(closeOf(10).lastDay?.energy ?? 0, tired.energy)
      expect(tired.challenge?.lowestEnergySinceClose).toBe(limit)
      expectRejected(at(tired, limit + 1), [
        `challenge.lowestEnergySinceClose is ${limit + 1}, above ${limit}`,
      ])
    })

    it('with a status or a medal its progress does not give', () => {
      const won = save(END)
      ;(won.challenge as Json).medal = 'or'
      expectRejected(won, [
        'challenge is reussi with the medal or, not reussi with argent',
      ])
      const early = save(morningOf(12))
      ;(early.challenge as Json).status = 'reussi'
      ;(early.challenge as Json).medal = 'bronze'
      expectRejected(early, [
        'challenge is reussi with the medal bronze, not enCours with null',
      ])
    })

    it('with an event after its end', () => {
      const json = save(END)
      ;(json.events as Json).pending = { event: 'essai', followUp: true }
      expectRejected(json, ['an event came after the Défi semaine was over'])
    })

    it('lost to its minimum cash a day before its last day played', () => {
      // The Défi played on with no condition, then read as one whose
      // minimum cash, 90 000 $, broke before its first day was played.
      const lax = loadDefiContent(
        { defis: [defi({ id: 'semaine', setup: {}, conditions: [] })] },
        EVENTS,
      )
      let state = startChallenge('semaine', SEED, FOOD_TRUCK, lax)
      const play = (morning: GameState) =>
        tick(
          answered(morning),
          FOOD_TRUCK,
          CUSTOMERS,
          DIFFICULTIES,
          PERSONAL,
          ENERGY,
          EVENTS,
          lax,
        )
      for (let day = 7; day < 12; day += 1) state = play(state)
      const strict = loadDefiContent(
        {
          defis: [
            defi({
              id: 'semaine',
              setup: {},
              conditions: [{ kind: 'minCash', amountCents: 9_000_000 }],
            }),
          ],
        },
        EVENTS,
      )
      const json = save(state)
      Object.assign(json.challenge as Json, { status: 'echoue', medal: null })
      expectRejected(
        json,
        ['the Défi semaine was lost before day 11, the last day played'],
        strict,
      )
    })

    it('with decisions it locks changed, or waiting', () => {
      for (const field of ['decisions', 'pendingDecisions']) {
        const json = save(morningOf(12))
        json[field] = {
          ...(json.decisions as Json),
          daysOpen: [2, 3, 4, 5, 6, 7],
        }
        expectRejected(json, [
          `${field} change daysOpen, which the Défi semaine locks`,
        ])
      }
    })

    it('without the event it forces on a day played, or with a choice it does not allow', () => {
      const missing = save(morningOf(13))
      const events = missing.events as { history: Json[] }
      events.history = events.history.filter(({ day }) => day !== 7)
      expectRejected(missing, [
        'the event the Défi semaine forces on day 7 never came',
      ])
      const other = save(morningOf(13))
      const record = (other.events as { history: Json[] }).history[0] as Json
      record.choice = 'toutEssayer'
      expectRejected(other, [
        'the event the Défi semaine forces on day 7 is not the one chosen that morning, with a choice it allows',
      ])
    })

    it('with another event waiting on a morning it forces one', () => {
      const json = save(morningOf(11))
      ;(json.events as Json).pending = { event: 'essai', followUp: false }
      expectRejected(json, [
        'the event the Défi semaine forces on day 11 is not the one waiting',
      ])
    })

    it('with an event drawn though it has no random event', () => {
      const json = save(morningOf(13))
      const events = json.events as { history: Json[]; lastDrawnDay: number }
      events.history.push({
        day: 12,
        event: 'essai',
        followUp: false,
        choice: 'rienFaire',
        outcome: 0,
      })
      events.history.sort((a, b) => (a.day as number) - (b.day as number))
      expectRejected(json, [
        'an event was drawn on day 12 of the Défi semaine, which has no random event',
      ])
    })
  })
})

describe('the bakery', () => {
  const OPEN_LEASED = { kind: 'openBakery', oven: 'louer' } as const
  const OPEN_BOUGHT = { kind: 'openBakery', oven: 'acheter' } as const
  const CLOSE = { kind: 'closeBakery' } as const
  const MADE = { kind: 'croissantSource', source: 'fabriquer' } as const

  /** A new game played to the morning of `toDay`, with `plan`'s changes. */
  function playedWith(
    toDay: number,
    plan: Readonly<Record<number, readonly DecisionChange[]>>,
  ): GameState {
    let state = createInitialState(SEED)
    while (state.day < toDay) {
      for (const change of plan[state.day] ?? []) {
        state = applyDecision(state, change)
      }
      state = tick(state)
    }
    return state
  }

  // Planned on day 0, the bakery opens on day 1. Closed on day 20, it
  // gives notice on day 21 to June 30th, day 60, and closes on July 1st.
  const PLANNED = playedWith(1, { 0: [OPEN_LEASED, MADE] })
  const LEASED = playedWith(20, { 0: [OPEN_LEASED, MADE] })
  const LEASED_CLOSE = playDay(LEASED)
  const LEASED_PLAN = { 0: [OPEN_LEASED, MADE], 20: [CLOSE] }
  const NOTICE = playedWith(25, LEASED_PLAN)
  const NOTICE_OVER = playedWith(61, LEASED_PLAN)
  const BOUGHT = playedWith(20, { 0: [OPEN_BOUGHT, MADE] })
  const OWNED = playedWith(70, { 0: [OPEN_BOUGHT, MADE], 5: [CLOSE] })
  const PLANNED_BOUGHT = playedWith(1, { 0: [OPEN_BOUGHT, MADE] })
  // Closed and planned again on the morning it opens, with the same oven.
  const PLANNED_AGAIN = applyDecision(
    applyDecision(PLANNED, CLOSE),
    OPEN_LEASED,
  )
  // On the last day of its notice, the next bakery planned with a bought oven.
  const NOTICE_LAST_DAY = applyDecision(
    playedWith(60, LEASED_PLAN),
    OPEN_BOUGHT,
  )

  /** The save of `state` with its plan pending for the next morning. */
  function pendingBakery(plan: unknown, state: GameState): string {
    return withValue(
      'pendingDecisions',
      { ...state.decisions, bakery: plan },
      serialize(state),
    )
  }

  it('holds the bakery each state needs', () => {
    expect(PLANNED.bakery).toEqual(closedBakery())
    expect(LEASED.bakery).toMatchObject({ openedOnDay: 1, oven: 'louer' })
    expect(NOTICE.bakery.closesAfterDay).toBe(60)
    expect(NOTICE_OVER.bakery.closesAfterDay).toBe(60)
    expect(BOUGHT.bakery.ovenBoughtOnDay).toBe(1)
    expect(OWNED.bakery).toEqual({ ...closedBakery(), ovenBoughtOnDay: 1 })
    expect(PLANNED_BOUGHT.decisions.bakery).toEqual({ oven: 'acheter' })
    expect(PLANNED_AGAIN.pendingDecisions?.bakery).toEqual({ oven: 'louer' })
    expect(NOTICE_LAST_DAY.bakery.closesAfterDay).toBe(60)
    expect(NOTICE_LAST_DAY.pendingDecisions?.bakery).toEqual({
      oven: 'acheter',
    })
  })

  it.each([
    ['planned, before it opens', PLANNED],
    ['closed and planned again on the morning it opens', PLANNED_AGAIN],
    ['running with a leased oven', LEASED],
    ['at the close of a day it ran', LEASED_CLOSE],
    ['under notice', NOTICE],
    ['on the morning after its notice, before it closes', NOTICE_OVER],
    [
      'on the last day of its notice, the next one planned with other terms',
      NOTICE_LAST_DAY,
    ],
    ['running with a bought oven', BOUGHT],
    ['closed, with the oven it bought', OWNED],
  ])('loads back %s, and plays on as if it had never stopped', (_, state) => {
    const back = reloaded(state)
    expect(back).toStrictEqual(state)
    expect(serialize(played(3, back))).toBe(serialize(played(3, state)))
  })

  const LEASED_SAVE = serialize(LEASED)
  const OWNED_SAVE = serialize(OWNED)
  const NOTICE_OVER_SAVE = serialize(NOTICE_OVER)

  it.each<[string, string, string]>([
    [
      'oven terms with no bakery',
      withValue('bakery.oven', 'louer'),
      'both or neither',
    ],
    [
      'a bakery with no oven terms',
      withValue('bakery.oven', null, LEASED_SAVE),
      'both or neither',
    ],
    [
      'a bakery opened after the last day played',
      withValue('bakery.openedOnDay', 20, LEASED_SAVE),
      'bakery.openedOnDay is day 20, not a day played from day 0 to day 19',
    ],
    [
      'a notice with no bakery',
      withValue('bakery.closesAfterDay', 30),
      'bakery.closesAfterDay is day 30, with no bakery',
    ],
    [
      'a notice that ends mid-month',
      withValue('bakery.closesAfterDay', 59, LEASED_SAVE),
      'bakery.closesAfterDay is day 59, not the last day of a month',
    ],
    [
      'a notice over before the last day played',
      withValue('bakery.closesAfterDay', 30, NOTICE_OVER_SAVE),
      'bakery.closesAfterDay is day 30',
    ],
    [
      'a notice longer than the content gives',
      withValue('bakery.closesAfterDay', endOfMonth(19, 2), LEASED_SAVE),
      `bakery.closesAfterDay is day ${endOfMonth(19, 2)}`,
    ],
    [
      'a bought oven the business does not own',
      withValue('bakery.oven', 'acheter', LEASED_SAVE),
      'bakery.oven is acheter, but the business owns no oven',
    ],
    [
      'a leased oven when the business owns one',
      withValue('bakery.oven', 'louer', serialize(BOUGHT)),
      'bakery.oven is louer, but the business owns an oven since day 1',
    ],
    [
      'an oven owned with no purchase in the books',
      withValue('bakery.ovenBoughtOnDay', 3),
      'the journal does not hold one « Achat du four »',
    ],
    [
      'an oven bought on another day than the books say',
      withValue('bakery.ovenBoughtOnDay', 2, OWNED_SAVE),
      'on day 2',
    ],
    [
      'a purchase in the books with no oven owned',
      withValue('bakery.ovenBoughtOnDay', null, OWNED_SAVE),
      'the journal holds « Achat du four » on day 1, but the business owns no oven',
    ],
    [
      'a plan to lease an oven when the business owns one',
      withValue('decisions.bakery', { oven: 'louer' }, OWNED_SAVE),
      'decisions.bakery leases an oven',
    ],
    [
      'a plan with other oven terms than the running bakery',
      withValue('decisions.bakery', { oven: 'acheter' }, LEASED_SAVE),
      'decisions.bakery.oven is acheter on day 20, but the bakery runs with louer',
    ],
    [
      'a plan pending with other oven terms than the bakery opening that day',
      pendingBakery({ oven: 'acheter' }, PLANNED),
      'pendingDecisions.bakery.oven is acheter on day 2, but the bakery runs with louer',
    ],
    [
      'a plan pending to lease an oven bought that day',
      pendingBakery({ oven: 'louer' }, PLANNED_BOUGHT),
      'pendingDecisions.bakery leases an oven, but the business owns one since day 1',
    ],
    [
      'a plan pending with other oven terms than the bakery under notice',
      pendingBakery({ oven: 'acheter' }, NOTICE),
      'pendingDecisions.bakery.oven is acheter on day 26, but the bakery runs with louer',
    ],
    [
      'a close with a running bakery and none planned',
      withValue('decisions.bakery', null, serialize(LEASED_CLOSE)),
      'the bakery runs at the close of day 20, with none planned',
    ],
    [
      'a bake rule beyond the capacity',
      withValue('decisions.bake.quantity', BAKERY.capacityPerDay + 1),
      'decisions: Invalid decision: bake.quantity',
    ],
    [
      'an unknown oven',
      withValue('bakery.oven', 'emprunter', LEASED_SAVE),
      '→ at bakery.oven',
    ],
    [
      'an unknown key in the bakery',
      withValue('bakery.four', 1, LEASED_SAVE),
      'Unrecognized key: "four"',
    ],
  ])('rejects %s', (_, text, reason) => {
    expectInvalid(text, [reason])
  })
})

describe("the grocers' contracts", () => {
  /**
   * Seed 42 with contracts signed on day 0 with Épicerie Chez Normand and
   * Marché Bio-Logique, and Dépanneur 24/24 away, played to the morning of
   * day 30, after four Mondays of deliveries.
   */
  const SIGNED: GameState = (() => {
    const start = createInitialState(SEED)
    const both = ['chezNormand', 'marcheBioLogique'] as const
    const contracts = both.reduce(
      (signed, grocer) => startContract(signed, 0, grocer),
      start.contracts,
    )
    return {
      ...start,
      contracts: grocerAway(contracts, 0, 'depanneur2424', 60),
    }
  })()
  const MORNING = played(30, SIGNED)
  const MORNING_SAVE = serialize(MORNING)
  // The close of Monday, day 28, with its two deliveries.
  const MONDAY_CLOSE = playDay(played(28, SIGNED))
  const MONDAY_SAVE = serialize(MONDAY_CLOSE)

  it('give back a game in the middle of its contracts, which then plays on the same', () => {
    expect(MORNING.contracts.deliveries.map(({ day }) => day)).toEqual([
      7, 7, 14, 14, 21, 21, 28, 28,
    ])
    expect(MORNING.contracts.running.map(({ weeksLeft }) => weeksLeft)).toEqual(
      [8, 8],
    )
    expect(MONDAY_CLOSE.lastDay?.deliveries).toHaveLength(2)
    for (const state of [MORNING, MONDAY_CLOSE]) {
      const back = reloaded(state)
      expect(back).toStrictEqual(state)
      expect(played(30, back)).toStrictEqual(played(30, state))
    }
  })

  /** The load of `text` fails, naming `reason`, against `grocers`. */
  function rejects(
    text: string,
    reason: string,
    grocers = loadGrocerContent(grocersJson, EVENTS),
  ): void {
    expect(() =>
      deserialize(
        text,
        FOOD_TRUCK,
        EVENTS,
        DIFFICULTIES,
        DEFIS,
        BAKERY,
        grocers,
      ),
    ).toThrow(reason)
  }

  it('rejects more contracts running than the most at once', () => {
    rejects(
      MORNING_SAVE,
      '2 contracts run, more than the 1 at once',
      loadGrocerContent({ ...grocersJson, maxContracts: 1 }, EVENTS),
    )
  })

  const normand = MORNING.contracts.running[0]
  it.each([
    [
      'a second contract with a grocer',
      withValue('contracts.running', [normand, normand], MORNING_SAVE),
      'contract 2 is a second contract with chezNormand',
    ],
    [
      'a contract signed after the day',
      withValue('contracts.running.0.startDay', 31, MORNING_SAVE),
      'contract 1 was signed on day 31, after day 30',
    ],
    [
      "more deliveries left than the grocer's weeks",
      withValue('contracts.running.0.weeksLeft', 13, MORNING_SAVE),
      'contract 1 has 13 deliveries left, more than the 12 of a contract with chezNormand',
    ],
    [
      'deliveries left that do not match those made',
      withValue('contracts.running.0.weeksLeft', 12, MORNING_SAVE),
      'contract 1 has 12 of its 12 deliveries left, after 4 made and 0 missed since day 0',
    ],
    [
      'no delivery left',
      withValue('contracts.running.0.weeksLeft', 0, MORNING_SAVE),
      '→ at contracts.running[0].weeksLeft',
    ],
    [
      'a contract at no price',
      withValue('contracts.running.0.unitPrice', 0, MORNING_SAVE),
      '→ at contracts.running[0].unitPrice',
    ],
    [
      'an unknown grocer',
      withValue('contracts.running.0.grocer', 'costco', MORNING_SAVE),
      '→ at contracts.running[0].grocer',
    ],
    [
      'a delivery on a day not played',
      withValue('contracts.deliveries.7.day', 35, MORNING_SAVE),
      'delivery 8 is on day 35, a day not played',
    ],
    [
      'a delivery on another day than Monday',
      withValue('contracts.deliveries.0.day', 6, MORNING_SAVE),
      'delivery 1 is on day 6, not a delivery day',
    ],
    [
      'deliveries out of order',
      withValue('contracts.deliveries.0.day', 14, MORNING_SAVE),
      'delivery 2 comes before the one before it: day 7 < day 14',
    ],
    [
      'more croissants made than delivered',
      withValue('contracts.deliveries.0.baked', 751, MORNING_SAVE),
      'delivery 1 has 751 croissants made, more than its 750',
    ],
    [
      'a delivery due on its own day',
      withValue('contracts.deliveries.0.dueDay', 7, MORNING_SAVE),
      'delivery 1 is due on day 7, not after it',
    ],
    [
      'a grocer away to no game day',
      withValue('contracts.away.depanneur2424', -1, MORNING_SAVE),
      '→ at contracts.away.depanneur2424',
    ],
    [
      'a last day that lost its deliveries',
      withValue('lastDay.deliveries', [], MONDAY_SAVE),
      "lastDay's deliveries are not those of day 28",
    ],
    [
      'a last day with deliveries never made',
      withValue(
        'lastDay.deliveries',
        MORNING.contracts.deliveries.slice(0, 2),
        MONDAY_SAVE,
      ),
      "lastDay's deliveries are not those of day 28",
    ],
    [
      'a contract waiting for a later day',
      withValue(
        'events.delayed',
        [
          {
            day: 40,
            event: 'contratNormand',
            effect: { kind: 'contract', grocer: 'chezNormand' },
          },
        ],
        MORNING_SAVE,
      ),
      'delayed effect 1 is a contract, which never waits',
    ],
    [
      'no contracts at all',
      edited(
        'contracts',
        (parent, key) => {
          delete parent[key]
        },
        MORNING_SAVE,
      ),
      'contracts',
    ],
  ])('rejects %s', (_, text, reason) => {
    rejects(text, reason)
  })
})

describe('the staff and the missed deliveries', () => {
  /**
   * Seed 42 with Épicerie Chez Normand's contract signed on day 0 and
   * Amélie hired at the truck that morning, from day 1. The owner is away on
   * Monday 14 with nobody to deliver, so the delivery is missed: a strike.
   */
  const HIRED: GameState = applyDecision(
    {
      ...createInitialState(SEED),
      contracts: startContract(noContracts(), 0, 'chezNormand'),
    },
    { kind: 'hire', role: 'camion', candidate: 'amelie' },
  )
  const AWAY_MONDAY: GameState = { ...played(14, HIRED), ownerAway: true }
  const STRUCK = playDay(AWAY_MONDAY)
  const STRUCK_SAVE = serialize(STRUCK)
  // The morning of day 17.
  const AFTER = played(3, AWAY_MONDAY)
  const AFTER_SAVE = serialize(AFTER)

  it('give back a game mid-employment with a strike, which then plays on the same', () => {
    expect(STRUCK.lastDay?.missed).toEqual([{ day: 14, grocer: 'chezNormand' }])
    expect(STRUCK.contracts.running).toMatchObject([
      { grocer: 'chezNormand', weeksLeft: 10, strikes: 1 },
    ])
    expect(STRUCK.staff).toMatchObject([{ candidate: 'amelie', hiredOnDay: 1 }])
    expect(STRUCK.ownerAway).toBe(true)
    for (const state of [AWAY_MONDAY, STRUCK, AFTER]) {
      const back = reloaded(state)
      expect(back).toStrictEqual(state)
      expect(serialize(back)).toBe(serialize(state))
      expect(serialize(played(40, back))).toBe(serialize(played(40, state)))
    }
    expect(AFTER.ownerAway).toBe(false)
  })

  it('give back a hire, a firing and a raise waiting for the next morning', () => {
    const waiting = [
      { kind: 'hire', role: 'livreur', candidate: 'kevin' },
      { kind: 'fire', candidate: 'amelie' },
    ] satisfies DecisionChange[]
    const raised = applyDecision(AFTER, {
      kind: 'setWage',
      candidate: 'amelie',
      hourlyWage: cents(2_000),
    })
    for (const state of [
      waiting.reduce((next, change) => applyDecision(next, change), AFTER),
      raised,
    ]) {
      expect(reloaded(state)).toStrictEqual(state)
    }
  })

  it('load a version 13 game as one with nobody on staff, the owner at work and nothing missed', () => {
    const signed: GameState = played(30, {
      ...createInitialState(SEED),
      contracts: startContract(noContracts(), 0, 'chezNormand'),
    })
    expect(signed.contracts.deliveries).toHaveLength(4)
    for (const state of [
      signed,
      playDay(signed),
      createInitialState(SEED),
      DAY_400,
    ]) {
      expect(deserialize(v13(state))).toStrictEqual(unvalued(state))
    }
  })

  /** The load of `text` fails, naming `reason`. */
  function rejects(
    text: string,
    reason: string,
    grocers = loadGrocerContent(grocersJson, EVENTS),
  ): void {
    expect(() =>
      deserialize(
        text,
        FOOD_TRUCK,
        EVENTS,
        DIFFICULTIES,
        DEFIS,
        BAKERY,
        grocers,
      ),
    ).toThrow(reason)
  }

  const amelie = AFTER.staff[0]
  it.each([
    [
      'an employee hired on a day not played',
      withValue('staff.0.hiredOnDay', 17, AFTER_SAVE),
      'employee 1, amelie, was hired on day 17, not a day played from day 0 to day 16',
    ],
    [
      'a wage outside the range',
      withValue('staff.0.hourlyWage', 2_501, AFTER_SAVE),
      'staff: Invalid decision: staff.0.hourlyWage',
    ],
    [
      'an unknown candidate',
      withValue('staff.0.candidate', 'gilles', AFTER_SAVE),
      '→ at staff[0].candidate',
    ],
    [
      'an employee twice',
      withValue('staff', [amelie, amelie], AFTER_SAVE),
      'hired twice',
    ],
    [
      'more employees than the most at once',
      withValue(
        'staff',
        (['amelie', 'kevin', 'sophie', 'mathieu'] as const).map(
          (candidate) => ({
            ...amelie,
            candidate,
          }),
        ),
        AFTER_SAVE,
      ),
      'staff holds at most 3 employees: 4',
    ],
    [
      'a staff at the close other than the decisions want',
      withValue('decisions.staff', [], STRUCK_SAVE),
      'the staff at the close of day 14 is not the one the decisions want',
    ],
    [
      'decisions that give an employee another role',
      withValue('decisions.staff.0.role', 'livreur', AFTER_SAVE),
      'decisions.staff gives amelie the role livreur, but they work as camion',
    ],
    [
      'pending decisions that give an employee another role',
      withValue(
        'pendingDecisions',
        {
          ...AFTER.decisions,
          staff: [
            {
              ...AFTER.decisions.staff[0],
              role: 'boulanger',
              hourlyWage: 2_200,
            },
          ],
        },
        AFTER_SAVE,
      ),
      'pendingDecisions.staff gives amelie the role boulanger, but they work as camion',
    ],
    [
      'an owner away who is neither',
      withValue('ownerAway', 'parfois', AFTER_SAVE),
      '→ at ownerAway',
    ],
    [
      'strikes that are not the deliveries missed',
      withValue('contracts.running.0.strikes', 0, STRUCK_SAVE),
      'contract 1 has 0 strikes, after 1 deliveries missed since day 0',
    ],
    [
      'deliveries left that do not count those missed',
      withValue('contracts.running.0.weeksLeft', 11, STRUCK_SAVE),
      'contract 1 has 11 of its 12 deliveries left, after 1 made and 1 missed since day 0',
    ],
    [
      'a missed delivery on another day than Monday',
      withValue('contracts.missed.0.day', 15, AFTER_SAVE),
      'missed delivery 1 is on day 15, not a delivery day',
    ],
    [
      'a missed delivery on a day not played',
      withValue('contracts.missed.0.day', 21, AFTER_SAVE),
      'missed delivery 1 is on day 21, a day not played',
    ],
    [
      'missed deliveries out of order',
      withValue(
        'contracts.missed',
        [
          { day: 14, grocer: 'chezNormand' },
          { day: 7, grocer: 'marcheBioLogique' },
        ],
        AFTER_SAVE,
      ),
      'missed delivery 2 comes before the one before it: day 7 < day 14',
    ],
    [
      'a last day that lost its missed delivery',
      withValue('lastDay.missed', [], STRUCK_SAVE),
      "lastDay's missed deliveries are not those of day 14",
    ],
    [
      'a version 13 game with a staff',
      edited('staff', () => undefined, v13(createInitialState(SEED))).replace(
        '"saveVersion":13',
        '"saveVersion":13,"staff":[]',
      ),
      'Unrecognized key: "staff"',
    ],
    [
      'a version 13 game with missed deliveries',
      withValue('contracts.missed', [], v13(createInitialState(SEED))),
      'Unrecognized key: "missed"',
    ],
    [
      'a version 13 game with decisions.staff',
      withValue('decisions.staff', [], v13(createInitialState(SEED))),
      'Unrecognized key: "staff"',
    ],
  ])('rejects %s', (_, text, reason) => {
    rejects(text, reason)
  })

  it('rejects a contract running at the strikes that end it', () => {
    rejects(
      STRUCK_SAVE,
      'contract 1 has 1 strikes, after 1 deliveries missed since day 0, and fewer than 1 keep it running',
      loadGrocerContent({ ...grocersJson, maxStrikes: 1 }, EVENTS),
    )
  })
})

describe('the emergency loans and the share sales', () => {
  /** The shipped cards with only the financing's two, which no draw brings. */
  const CARDS: EventContent = {
    ...EVENTS,
    events: EVENTS.events.filter(
      ({ id }) => id === FINANCING.loanEvent || id === FINANCING.investorEvent,
    ),
  }
  const LENDER = 'Caisse populaire Saint-Prudent'

  /** The next morning, with the financing's cards in play. */
  function next(state: GameState): GameState {
    return tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      CARDS,
    )
  }

  /** `days` days played from `state`, every card refused. */
  function playOn(state: GameState, days: number): GameState {
    let played = state
    for (let day = 0; day < days; day += 1) {
      if (played.events.pending !== null) {
        played = resolveEvent(played, 'refuser', CARDS)
      }
      played = next(played)
    }
    return played
  }

  /** `state` with `event` waiting that morning, as if drawn. */
  function offering(state: GameState, event: string): GameState {
    return {
      ...state,
      events: {
        ...state.events,
        pending: { event, followUp: false },
        lastDrawnDay: state.day,
      },
    }
  }

  // Seed 42 at Moyen: a bill on the morning of day 59 leaves Encaisse
  // 3 000 $ below zero, so the morning of day 60, June 30, brings the
  // emergency loan, taken. Max Duvent buys shares on the morning of July
  // 1st, day 61, then the game plays to the morning of day 161, past the
  // loan's first payments and the dividend of October 1st, day 153.
  const BILLED = applyEffect(
    played(59),
    {
      kind: 'charge',
      amountCents: cents(
        balance(played(59).journal, '1000', { toDay: 59 }) + 300_000,
      ),
      description: 'Facture imprévue',
    },
    FOOD_TRUCK,
    'test',
  )
  const OFFERED = next(BILLED)
  const LOANED = resolveEvent(OFFERED, 'accepter', CARDS)
  const SOLD = resolveEvent(
    offering(next(LOANED), 'offreDuvent'),
    'accepter',
    CARDS,
  )
  const FINANCED = playOn(SOLD, 100)
  const FINANCED_SAVE = serialize(FINANCED)
  const [LOAN] = FINANCED.financing.loans
  const [SALE] = FINANCED.financing.shareSales

  it('give back a game with an emergency loan, shares sold, payments and dividends, which then plays on the same', () => {
    expect(OFFERED.events.pending?.event).toBe('pretUrgence')
    expect(FINANCED.financing).toMatchObject({
      loans: [{ day: 60, lender: LENDER }],
      shareSales: [{ day: 61, investor: 'Duvent Capital', share: 0.2 }],
      lastLoanRequestDay: 60,
    })
    const memos = new Set(entriesOf(FINANCED.journal).map(({ memo }) => memo))
    for (const memo of [
      `Intérêts · ${LENDER}`,
      `Remboursement · ${LENDER}`,
      'Dividende · Duvent Capital',
    ]) {
      expect(memos.has(memo), memo).toBe(true)
    }
    for (const state of [OFFERED, LOANED, SOLD, FINANCED]) {
      const back = reloaded(state)
      expect(back).toStrictEqual(state)
      expect(serialize(back)).toBe(serialize(state))
      expect(serialize(playOn(back, 40))).toBe(serialize(playOn(state, 40)))
    }
  })

  it("load a game that sold shares on a Monday morning, the Sunday before's net worth without them", () => {
    // Monday, July 3rd, day 63, the morning after Sunday, day 62.
    const monday = playOn(LOANED, 3)
    expect(monday.day).toBe(63)
    expect(monday.weekHistory.at(-1)?.firstDay).toBe(56)
    const sold = resolveEvent(
      offering(monday, 'offreDuvent'),
      'accepter',
      CARDS,
    )
    expect(sold.financing.shareSales).toMatchObject([{ day: 63 }])
    expect(netWorthChange(sold)).not.toBe(0)
    const back = reloaded(sold)
    expect(back).toStrictEqual(sold)
    expect(netWorthChange(back)).toBe(netWorthChange(sold))
  })

  it('load a version 14 game as one with no financing, the closes below zero read from its books', () => {
    // The bill's day closed below zero with no event content in play, so
    // nobody came.
    const below = tick(BILLED)
    expect(below.financing.belowZeroSince).toBe(59)
    expect(below.financing.lastLoanRequestDay).toBeNull()
    for (const state of [
      createInitialState(SEED),
      BILLED,
      below,
      played(10, below),
      DAY_400,
    ]) {
      expect(deserialize(v14(state))).toStrictEqual(unvalued(state))
    }
  })

  it('load a game with a loan on its own terms, whatever the cards hold now', () => {
    // The fee, the rate and the term tuned since the loan was taken.
    const raw = JSON.parse(JSON.stringify(eventsJson)) as {
      events: { id: string; choices: { outcomes: { effects: object[] }[] }[] }[]
    }
    for (const { choices } of raw.events.filter(
      ({ id }) => id === 'pretUrgence',
    )) {
      choices[0]?.outcomes[0]?.effects.splice(0, 1, {
        kind: 'emergencyLoan',
        lender: LENDER,
        monthsOfFixedCosts: 2,
        maxCents: 1_000_000,
        annualRateBasisPoints: 2400,
        termMonths: 6,
        feeShare: 0.05,
        name: 'pret',
      })
    }
    const tuned = loadEventContent(raw)
    expect(deserialize(FINANCED_SAVE, FOOD_TRUCK, tuned)).toStrictEqual(
      FINANCED,
    )
  })

  /** The load of `text` fails, naming `reason`. */
  function rejects(text: string, reason: string, rules = FINANCING): void {
    expect(() =>
      deserialize(
        text,
        FOOD_TRUCK,
        EVENTS,
        DIFFICULTIES,
        DEFIS,
        BAKERY,
        loadGrocerContent(grocersJson, EVENTS),
        STAFF,
        rules,
      ),
    ).toThrow(reason)
  }

  const { day } = FINANCED
  it.each([
    [
      'a loan taken after the save',
      withValue('financing.loans.0.day', day + 1, FINANCED_SAVE),
      `emergency loan 1 is on day ${day + 1}, not a morning from day 0 to day ${day}`,
    ],
    [
      'a loan taken while the one before it was still open',
      withValue('financing.loans', [LOAN, { ...LOAN, day: 90 }], FINANCED_SAVE),
      'emergency loan 2 was taken on day 90, while the one before it was still open',
    ],
    [
      'a fee above what was lent',
      withValue(
        'financing.loans.0.fee',
        (LOAN?.principal ?? 0) + 1,
        FINANCED_SAVE,
      ),
      `emergency loan 1 charged a fee of ${(LOAN?.principal ?? 0) + 1}, more than the ${LOAN?.principal} it lent`,
    ],
    [
      'a loan of another amount than the journal holds',
      withValue(
        'financing.loans.0.principal',
        (LOAN?.principal ?? 0) + 100,
        FINANCED_SAVE,
      ),
      `the journal holds « Emprunt d'urgence · ${LENDER} » on day 60, which the financing does not owe`,
    ],
    [
      'a loan the save forgot',
      withValue('financing.loans', [], FINANCED_SAVE),
      `the journal holds « Emprunt d'urgence · ${LENDER} » on day 60, which the financing does not owe`,
    ],
    [
      'a fee the journal does not hold',
      withValue('financing.loans.0.fee', (LOAN?.fee ?? 0) + 1, FINANCED_SAVE),
      `the journal holds « Frais de dossier · ${LENDER} » on day 60, which the financing does not owe`,
    ],
    [
      'a loan at another rate than its payments',
      withValue('financing.loans.0.annualRateBasisPoints', 1700, FINANCED_SAVE),
      `the journal holds « Intérêts · ${LENDER} » on day 61, which the financing does not owe`,
    ],
    [
      'a loan of another term than its payments',
      withValue('financing.loans.0.termMonths', 6, FINANCED_SAVE),
      `the journal holds « Remboursement · ${LENDER} » on day 61, which the financing does not owe`,
    ],
    [
      'a loan with no fee whose fee the journal holds',
      withValue('financing.loans.0.fee', 0, FINANCED_SAVE),
      `the journal holds « Frais de dossier · ${LENDER} » on day 60, which the financing does not owe`,
    ],
    [
      'shares sold for another amount than the journal holds',
      withValue(
        'financing.shareSales.0.amount',
        (SALE?.amount ?? 0) + 1,
        FINANCED_SAVE,
      ),
      "the journal holds « Émission d'actions · Duvent Capital » on day 61, which the financing does not owe",
    ],
    [
      'another share than its dividends',
      withValue('financing.shareSales.0.share', 0.3, FINANCED_SAVE),
      'the journal holds « Dividende · Duvent Capital » on day 153, which the financing does not owe',
    ],
    [
      'a share sale the journal does not hold',
      withValue(
        'financing.shareSales',
        [SALE, { ...SALE, day: 155 }],
        FINANCED_SAVE,
      ),
      "the journal does not hold « Émission d'actions · Duvent Capital » on day 155 as the financing owes it",
    ],
    [
      'share sales out of order',
      withValue(
        'financing.shareSales',
        [SALE, { ...SALE, day: 10 }],
        FINANCED_SAVE,
      ),
      'share sale 2 comes before the one before it: day 10 < day 61',
    ],
    [
      'more rounds than a game may sell',
      withValue('financing.shareSales', [SALE, SALE, SALE], FINANCED_SAVE),
      '3 rounds of shares were sold, more than the 2 a game may sell',
    ],
    [
      'the whole business sold',
      withValue('financing.shareSales.0.share', 1, FINANCED_SAVE),
      '→ at financing.shareSales[0].share',
    ],
    [
      'a loan of nothing',
      withValue('financing.loans.0.principal', 0, FINANCED_SAVE),
      '→ at financing.loans[0].principal',
    ],
    [
      'closes below zero the books do not give',
      withValue('financing.belowZeroSince', 10, FINANCED_SAVE),
      `financing.belowZeroSince is 10, but the closes in the books give ${FINANCED.financing.belowZeroSince}`,
    ],
    [
      'a lender who came after the save',
      withValue('financing.lastLoanRequestDay', day + 1, FINANCED_SAVE),
      `financing.lastLoanRequestDay is on day ${day + 1}, not a morning from day 0 to day ${day}`,
    ],
    [
      'shares sold on a later day',
      withValue(
        'events.delayed',
        [
          {
            day: day + 5,
            event: 'offreDuvent',
            effect: {
              kind: 'shareSale',
              investor: 'Duvent Capital',
              amountCents: 2_000_000,
              share: 0.2,
            },
          },
        ],
        FINANCED_SAVE,
      ),
      'delayed effect 1 is a shareSale, which never waits',
    ],
    [
      'a key a loan does not have',
      withValue('financing.loans.0.cheat', 1, FINANCED_SAVE),
      'Unrecognized key: "cheat"',
    ],
    [
      'no financing at all',
      edited(
        'financing',
        (parent, key) => {
          delete parent[key]
        },
        FINANCED_SAVE,
      ),
      'financing',
    ],
    [
      'a version 14 game with financing',
      v14(createInitialState(SEED)).replace(
        '"saveVersion":14',
        `"saveVersion":14,"financing":${JSON.stringify(FINANCED.financing)}`,
      ),
      'Unrecognized key: "financing"',
    ],
  ])('rejects %s', (_, text, reason) => {
    rejects(text, reason)
  })

  it('rejects a second loan at a difficulty that lends once, or rounds the rules no longer allow', () => {
    // A first loan of one payment, paid back on June 1st, day 31.
    const paidBack = { ...LOAN, day: 0, termMonths: 1 }
    rejects(
      withValue('financing.loans', [paidBack, LOAN], FINANCED_SAVE),
      'emergency loan 2 is a second emergency loan at moyen',
      loadFinancingContent({ ...financingJson, noSecondLoanAt: ['moyen'] }),
    )
    rejects(
      FINANCED_SAVE,
      '1 rounds of shares were sold, more than the 0 a game may sell',
      loadFinancingContent({ ...financingJson, maxShareRounds: 0 }),
    )
  })
})

describe('the end of a game', () => {
  // Seed 42 at Moyen: a bill on the morning of June 1st, day 31, leaves
  // Encaisse far below zero, so six whole months later the close of
  // November 30th, day 213, ends the game in bankruptcy (#160).
  const BILLED = applyEffect(
    played(31),
    {
      kind: 'charge',
      amountCents: cents(
        balance(played(31).journal, '1000', { toDay: 31 }) + 10_000_000,
      ),
      description: 'Facture imprévue',
    },
    FOOD_TRUCK,
    'test',
  )
  const LAST_MORNING = played(182, BILLED)
  const CLOSE = playDay(LAST_MORNING)
  const ENDED = tick(LAST_MORNING)
  const ENDED_SAVE = serialize(ENDED)
  const END = { reason: 'bankruptcy', day: 213 } as const

  /** The load of `text` fails, naming `reason`. */
  function rejects(text: string, reason: string, rules = FINANCING): void {
    expect(() =>
      deserialize(
        text,
        FOOD_TRUCK,
        EVENTS,
        DIFFICULTIES,
        DEFIS,
        BAKERY,
        loadGrocerContent(grocersJson, EVENTS),
        STAFF,
        rules,
      ),
    ).toThrow(reason)
  }

  it('give back a game ended in bankruptcy, at its close or the morning after, which plays no more', () => {
    expect(LAST_MORNING.ended).toBeNull()
    expect(CLOSE.ended).toEqual(END)
    expect(ENDED.ended).toEqual(END)
    for (const state of [CLOSE, ENDED]) {
      const back = reloaded(state)
      expect(back).toStrictEqual(state)
      expect(serialize(back)).toBe(serialize(state))
    }
    expect(() => tick(reloaded(ENDED))).toThrow(
      'the game ended in bankruptcy on day 213',
    )
  })

  it('load a version 15 game as one that goes on', () => {
    for (const state of [
      createInitialState(SEED),
      BILLED,
      played(150, BILLED),
      DAY_400,
    ]) {
      expect(deserialize(v15(state))).toStrictEqual(unvalued(state))
    }
  })

  it('load a version 15 game whose run is past the months, which ends at the close of its month', () => {
    // Played on to the close of December 10th, day 223, as version 15
    // played it, with no bankruptcy.
    const free = {
      ...FINANCING,
      bankruptcy: { ...FINANCING.bankruptcy, months: Number.MAX_SAFE_INTEGER },
    }
    let long = LAST_MORNING
    while (long.day <= 223) {
      long = tick(
        long,
        FOOD_TRUCK,
        CUSTOMERS,
        DIFFICULTIES,
        PERSONAL,
        ENERGY,
        NO_EVENTS,
        DEFIS,
        PERCENTILES,
        BAKERY,
        GROCERS,
        STAFF,
        free,
      )
    }
    expect(long.ended).toBeNull()
    expect(long.financing.belowZeroSince).toBe(31)
    const loaded = deserialize(v15(long))
    expect(loaded.ended).toBeNull()
    // December 31st, day 244.
    const ended = played(244 - long.day + 1, loaded)
    expect(ended.ended).toEqual({ reason: 'bankruptcy', day: 244 })
  })

  it.each([
    [
      'a Défi ended',
      withValue(
        'ended',
        END,
        serialize(startChallenge('travauxSaintDenis', SEED)),
      ),
      'the Défi travauxSaintDenis ended in bankruptcy',
    ],
    [
      'an end on another day than the last played',
      withValue('ended.day', 212, ENDED_SAVE),
      'the game ended on day 212, but the last day played is 213',
    ],
    [
      'an end before a day is played',
      withValue('ended', END, serialize(createInitialState(SEED))),
      'the game ended on day 213, but the last day played is none',
    ],
    [
      'an end on a day not the last of its month',
      withValue('ended', { ...END, day: 180 }, serialize(played(150, BILLED))),
      'the game ended on day 180, not the last day of a month',
    ],
    [
      'an end after fewer months below zero',
      withValue('ended', { ...END, day: 183 }, serialize(played(153, BILLED))),
      'the game ended in bankruptcy on day 183 after 5 whole months below zero, not 6',
    ],
    [
      'an event waiting after the end',
      edited(
        'events',
        (parent, key) => {
          parent[key] = {
            ...(parent[key] as Json),
            pending: { event: 'premierAvis', followUp: false },
            lastDrawnDay: 214,
          }
        },
        ENDED_SAVE,
      ),
      'an event waits after the game ended on day 213',
    ],
    [
      'an event chosen after the end',
      edited(
        'events.history',
        (parent, key) => {
          parent[key] = [
            ...(parent[key] as Json[]),
            {
              day: 214,
              event: 'premierAvis',
              followUp: false,
              choice: 'compris',
              outcome: 0,
            },
          ]
        },
        ENDED_SAVE,
      ),
      'the event premierAvis came up on day 214, after the game ended on day 213',
    ],
    [
      'an end of another kind',
      withValue('ended.reason', 'retraite', ENDED_SAVE),
      '→ at ended.reason',
    ],
  ])('reject %s', (_, text, reason) => {
    rejects(text, reason)
  })

  it('reject an ended game once the bankruptcy takes more months', () => {
    const rules = loadFinancingContent({
      ...financingJson,
      bankruptcy: { ...financingJson.bankruptcy, months: 7 },
    })
    rejects(
      ENDED_SAVE,
      'the game ended in bankruptcy on day 213 after 6 whole months below zero, not 7',
      rules,
    )
  })
})

describe('the net worth of each week', () => {
  // `FORTNIGHT`, the morning of day 14, has the weeks of days 0 and 7.
  const LAST = 1

  it("keep each Sunday's net worth through a save", () => {
    expect(FORTNIGHT.weekHistory).toHaveLength(2)
    for (const state of [FORTNIGHT, DAY_400]) {
      const worths = state.weekHistory.map(({ netWorth: worth }) => worth)
      expect(worths).not.toContain(null)
      expect(reloaded(state).weekHistory).toStrictEqual(state.weekHistory)
    }
    // Nothing came up on the Monday morning, so nothing moved since.
    expect(FORTNIGHT.weekHistory[LAST]?.netWorth).toBe(netWorth(FORTNIGHT))
  })

  it('load a version 17 game with nothing of « Le rêve »', () => {
    for (const state of [
      createInitialState(SEED),
      THURSDAY,
      SUNDAY_CLOSE,
      DAY_400,
    ]) {
      expect(deserialize(v17(state))).toStrictEqual(state)
    }
  })

  it('load a version 16 game with no net worth for its weeks', () => {
    for (const state of [
      createInitialState(SEED),
      THURSDAY,
      SUNDAY_CLOSE,
      DAY_400,
    ]) {
      const loaded = deserialize(v16(state))
      expect(loaded).toStrictEqual(unvalued(state))
      expect(netWorthChange(loaded)).toBeNull()
    }
  })

  it('load a version 16 game played on to its next Sunday, then saved again, with a net worth for that week alone', () => {
    const loaded = deserialize(v16(FORTNIGHT))
    // The morning of day 21, after Sunday, day 20.
    const after = played(7, loaded)
    expect(
      after.weekHistory.map(({ netWorth: worth }) => worth === null),
    ).toEqual([true, true, false])
    expect(netWorthChange(after)).toBe(0)
    const back = reloaded(after)
    expect(back).toStrictEqual(after)
    expect(serialize(played(7, back))).toBe(serialize(played(7, after)))
  })

  it('load a game saved the Monday morning an event moved the personal cash', () => {
    const card = pocketCard('Cadeau', 6_000)
    const chosen = resolveEvent(drawEvent(FORTNIGHT, card), 'oui', card)
    expect(chosen.personal.cash - FORTNIGHT.personal.cash).toBe(6_000)
    expect(netWorthChange(chosen)).toBe(6_000)
    expect(deserialize(serialize(chosen), FOOD_TRUCK, card)).toStrictEqual(
      chosen,
    )
  })

  it.each([1.5, '100', undefined])('reject the net worth %j', (worth) => {
    expectInvalid(withValue(`weekHistory.${LAST}.netWorth`, worth), [
      `→ at weekHistory[${LAST}].netWorth`,
    ])
  })

  it('reject a week with no net worth after one with it', () => {
    expectInvalid(withValue(`weekHistory.${LAST}.netWorth`, null), [
      'week 2 of weekHistory has no net worth, after week 1, which has one',
    ])
  })

  it.each([1, -1])(
    'reject a last week whose net worth is %j cent off the books and the personal account',
    (off) => {
      const worth = (FORTNIGHT.weekHistory[LAST]?.netWorth ?? 0) + off
      expectInvalid(withValue(`weekHistory.${LAST}.netWorth`, worth), [
        `the last week of weekHistory has a net worth of ${worth}, not the ${worth - off} the owner had at the close of day 13`,
      ])
    },
  )

  it("load an earlier week's net worth as it is", () => {
    const worth = (FORTNIGHT.weekHistory[0]?.netWorth ?? 0) + 1
    expect(
      deserialize(withValue('weekHistory.0.netWorth', worth)).weekHistory[0]
        ?.netWorth,
    ).toBe(worth)
  })
})

describe('« Le rêve »', () => {
  const JUNE_1 = 31
  // Facile, with the cash in the bank and the owner's savings to buy every
  // rung but the second truck from the first days.
  const { facile } = DIFFICULTIES.difficulties
  const RICH = loadDifficultyContent({
    ...DIFFICULTIES,
    difficulties: {
      ...DIFFICULTIES.difficulties,
      facile: {
        ...facile,
        startingCashCents: 100_000_000,
        startingPersonalCashCents: 100_000_000,
      },
    },
  })
  const START = startedAs('facile', RICH)

  /** `state` saved and loaded back, with `RICH` as the difficulties. */
  const back = (state: GameState) =>
    deserialize(serialize(state), FOOD_TRUCK, EVENTS, RICH)

  /** Expects the save `text` of a `RICH` game to fail for `reason`. */
  const refused = (text: string, reason: string) =>
    expectInvalid(text, [reason], FOOD_TRUCK, EVENTS, RICH)

  /** `state` with the rungs `ids` bought that morning. */
  const buying = (state: GameState, ...ids: RungId[]) =>
    ids.reduce(
      (game, rung) => applyDecision(game, { kind: 'buy', rung }),
      state,
    )

  const ALL: readonly RungId[] = [
    'velo',
    'voitureOccasion',
    'condo',
    'voitureLuxe',
    'espresso',
    'grandCamion',
  ]
  // The morning of June 1st, every rung but the house and the chalet bought,
  // the day's charges to come; then its close, and the morning after.
  const FIRST = buying(played(JUNE_1, START), ...ALL)
  const FIRST_CLOSE = playDay(FIRST)
  const SECOND = tick(FIRST)

  it.each<[string, GameState]>([
    ['a personal rung bought on day 0', buying(START, 'velo')],
    ['a company rung bought on day 0', buying(START, 'espresso')],
    ['the big truck bought on day 0', buying(START, 'espresso', 'grandCamion')],
    ['rungs bought on the morning of a 1st', FIRST],
    ['the close of that 1st', FIRST_CLOSE],
    ['the morning after', SECOND],
  ])('gives back %s', (_, state) => {
    expect(state.dream.bought.length).toBeGreaterThan(0)
    expect(back(state)).toStrictEqual(state)
  })

  it('gives back the house bought after the last Sunday, its week worth what it was', () => {
    // The morning of Monday, day 49, after the Sunday of day 48.
    const monday = played(49 - JUNE_1, FIRST)
    expect(toCalendar(48).weekday).toBe(7)
    const sunday = monday.weekHistory.at(-1)
    expect(sunday?.firstDay).toBe(42)
    const house = buying(monday, 'maison')
    expect(house.weekHistory.at(-1)).toBe(sunday)
    expect(netWorth(house)).toBe(netWorth(monday))
    expect(back(house)).toStrictEqual(house)
    const after = tick(house)
    expect(back(after)).toStrictEqual(after)
  })

  it('loads a restock the bigger truck allows, and refuses it without', () => {
    const rule = { kind: 'topUp', whenBelow: 100, upTo: 700 } as const
    const truck = applyDecision(FIRST, {
      kind: 'restock',
      product: 'chocolat',
      rule,
    })
    expect(back(truck)).toStrictEqual(truck)
    const espresso = buying(played(JUNE_1, START), 'espresso')
    refused(
      withValue(
        'pendingDecisions',
        JSON.parse(serialize(truck)).pendingDecisions,
        serialize(espresso),
      ),
      'pendingDecisions: Invalid decision: restock.chocolat.upTo must be a whole number from 0 to 500: 700',
    )
  })

  /** `FIRST`'s save, with `change` made to it. */
  const changed = (change: (save: Json) => void, text = serialize(FIRST)) => {
    const save = JSON.parse(text) as Json
    change(save)
    return JSON.stringify(save)
  }
  const dreamOf = (save: Json) =>
    save.dream as { bought: Json[]; magnatOn: unknown }

  it.each<[string, (save: Json) => void, string]>([
    [
      'a rung the game does not know',
      (save) => {
        dreamOf(save).bought[0]!.rung = 'yacht'
      },
      '→ at dream.bought[0].rung',
    ],
    [
      'a rung bought twice',
      (save) => {
        dreamOf(save).bought.push({ ...dreamOf(save).bought[0] })
      },
      'dream rung 7, velo, is bought twice',
    ],
    [
      'a rung bought after the save’s day',
      (save) => {
        for (const rung of dreamOf(save).bought) rung.day = JUNE_1 + 1
      },
      `is bought on day ${JUNE_1 + 1}, not a morning from day 0 to day ${JUNE_1}`,
    ],
    [
      'a rung bought before the one before it',
      (save) => {
        dreamOf(save).bought[1]!.day = JUNE_1 - 1
      },
      'is bought before the rung before it',
    ],
    [
      'a rung bought before a rung before it in its ladder',
      (save) => {
        const { bought } = dreamOf(save)
        ;[bought[0], bought[1]] = [bought[1]!, bought[0]!]
      },
      'is bought before a rung before it in its ladder',
    ],
    [
      'a rung that comes soon',
      (save) => {
        dreamOf(save).bought.push({
          rung: 'deuxiemeCamion',
          day: JUNE_1,
          cost: 1,
        })
      },
      'dream rung 7, deuxiemeCamion, is not for sale',
    ],
    [
      'a cost other than what the rung cost',
      (save) => {
        dreamOf(save).bought[5]!.cost = 1
      },
      'dream rung 6, grandCamion, cost 1, not',
    ],
    [
      'a company rung whose purchase the journal does not hold',
      (save) => {
        const journal = save.journal as Json[]
        save.journal = journal.filter(
          ({ memo }) => memo !== 'Achat · Machine à espresso pro',
        )
        // So the books still add up to the lots.
      },
      'the journal does not hold « Achat · Machine à espresso pro »',
    ],
    [
      'a purchase in the journal with no rung bought',
      (save) => {
        dreamOf(save).bought.splice(4)
      },
      'which no rung bought owes',
    ],
    [
      'a personal purchase the account does not hold',
      (save) => {
        const personal = save.personal as { movements: Json[] }
        personal.movements = personal.movements.filter(
          ({ label }) => label !== 'Achat · Vélo électrique',
        )
      },
      'personal does not hold the movement',
    ],
    [
      'a personal purchase with no rung bought',
      (save) => {
        // The company's rungs stay; the owner's go, the first one on.
        const { bought } = dreamOf(save)
        dreamOf(save).bought = bought.slice(4)
        for (const rung of dreamOf(save).bought) rung.day = JUNE_1
      },
      '« Achat · Vélo électrique » of',
    ],
    [
      'a « Magnat » on a day not played',
      (save) => {
        dreamOf(save).magnatOn = JUNE_1
      },
      `dream.magnatOn is day ${JUNE_1}, not a day played from day 0 to day ${JUNE_1 - 1}`,
    ],
  ])('rejects %s', (_, change, reason) => {
    refused(changed(change), reason)
  })

  it('rejects the old truck depreciated after it was replaced', () => {
    const text = serialize(SECOND)
    const save = JSON.parse(text) as Json
    const journal = save.journal as Json[]
    const at = journal.findIndex(
      ({ day, memo }) => day === JUNE_1 && memo === 'Assurances',
    )
    journal.splice(at + 1, 0, {
      day: JUNE_1,
      memo: 'Amortissement du camion',
      lines: [
        { account: '6400', debit: 1, credit: 0 },
        { account: '1510', debit: 0, credit: 1 },
      ],
    })
    refused(
      JSON.stringify(save),
      `the journal holds « Amortissement du camion » on day ${JUNE_1}, after the truck was replaced on day ${JUNE_1}`,
    )
  })

  it('rejects a home’s payment before its home was bought, or on a day not a 1st', () => {
    const condo = played(40, FIRST)
    const text = serialize(condo)
    const movements = (save: Json) =>
      (save.personal as { movements: Json[] }).movements
    const payment = (save: Json) =>
      movements(save).find(({ label }) => label === 'Hypothèque du condo')!
    expect(payment(JSON.parse(text) as Json)).toBeDefined()
    refused(
      changed((save) => {
        payment(save).day = JUNE_1 + 1
      }, text),
      `« Hypothèque du condo », is on day ${JUNE_1 + 1}, not a 1st`,
    )
    refused(
      changed((save) => {
        const first = movements(save).find(({ day }) => day === 0)!
        movements(save).splice(movements(save).indexOf(first), 0, {
          day: 0,
          label: 'Hypothèque du condo',
          amount: -110_000,
        })
      }, text),
      'before its home was bought',
    )
  })

  it('rejects a dream in a Défi', () => {
    const defi = startChallenge(DEFIS.defis[0]?.id ?? '', SEED)
    const text = changed((save) => {
      dreamOf(save).magnatOn = null
      dreamOf(save).bought = []
      save.dream = { bought: [], magnatOn: defi.day }
    }, serialize(defi))
    expectInvalid(text, [`the Défi ${defi.challenge?.id} has a dream`])
  })
})
