import { describe, expect, it } from 'vitest'
import grocersJson from '../content/grocers.json'
import {
  loadGrocerContent,
  type DifficultyId,
  type EventCard,
  type EventContent,
  type GrocerContent,
  type GrocerId,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, entriesOf, type JournalEntry } from '../finance/journal.ts'
import { balanceSheet } from '../finance/statements.ts'
import { BAKERY, BAKERY_MEMO } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import {
  GROCERS,
  deliverContracts,
  grocerAway,
  mayOffer,
  noContracts,
  startContract,
} from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import {
  applyDecision,
  latestDecisions,
  type DecisionChange,
} from './decisions.ts'
import { applyEffect } from './effects.ts'
import { energyAtClose } from './energy.ts'
import { NO_EVENTS, conditionsHold, drawEvent, resolveEvent } from './events.ts'
import { inventoryValue } from './inventory.ts'
import { cents, type Cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import type { Contract, Day, GameState } from './types.ts'

// The grocers' weekly croissant contracts (#156): signing one, the Monday
// deliveries, open or closed, the bakery making their croissants, the
// grocers paying 45 or 60 days later, the renewal, and the cash trap of the
// issue.

const SEED = 1
const CASH: AccountCode = '1000'
const RECEIVABLES: AccountCode = '1100'
const STOCKS: AccountCode = '1200'
const SALES: AccountCode = '4000'
const COST_OF_GOODS_SOLD: AccountCode = '5000'
const PRICES = DIFFICULTIES.bakery.moyen

/** Day 0 is Monday, May 1st; the Monday after it. */
const MONDAY = 7

/** The grocers' cards, the renewals coming as follow-ups, nothing drawn. */
const RENEWALS_ONLY: EventContent = {
  ...EVENTS,
  pacing: { ...EVENTS.pacing, dailyChance: 0 },
}

/** The shipped grocers, at most `maxContracts` contracts at once. */
function atMost(maxContracts: number): GrocerContent {
  return loadGrocerContent({ ...grocersJson, maxContracts }, EVENTS)
}

/** The shipped grocers, with `grocer` delivering `units` a week. */
function delivering(grocer: GrocerId, units: number): GrocerContent {
  return {
    ...GROCERS,
    grocers: {
      ...GROCERS.grocers,
      [grocer]: { ...GROCERS.grocers[grocer], unitsPerWeek: units },
    },
  }
}

/** A new game at `difficulty` with `changes` already in effect on day 0. */
function started(
  changes: readonly DecisionChange[] = [],
  difficulty: DifficultyId = 'moyen',
): GameState {
  let state = createInitialState(SEED, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
  for (const change of changes) state = applyDecision(state, change)
  return { ...state, decisions: latestDecisions(state), pendingDecisions: null }
}

/** `state` with contracts signed that morning with each of `grocers`. */
function signed(state: GameState, ...grocers: readonly GrocerId[]): GameState {
  return {
    ...state,
    contracts: grocers.reduce(
      (contracts, grocer) => startContract(contracts, state.day, grocer),
      state.contracts,
    ),
  }
}

/**
 * `state` played on to the morning of `day`, with `events` and `grocers`,
 * each renewal refused.
 */
function playedTo(
  state: GameState,
  day: Day,
  events: EventContent = NO_EVENTS,
  grocers: GrocerContent = GROCERS,
): GameState {
  let current = state
  while (current.day < day) {
    if (current.events.pending !== null) {
      current = resolveEvent(
        current,
        'refuser',
        events,
        FOOD_TRUCK,
        DEFIS,
        grocers,
      )
    }
    current = tick(
      current,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      events,
      DEFIS,
      PERCENTILES,
      BAKERY,
      grocers,
    )
  }
  return current
}

/** The close of `day`, played from `state`'s morning before it. */
function closeOf(
  state: GameState,
  day: Day,
  grocers: GrocerContent = GROCERS,
): GameState {
  const morning = playedTo(state, day, NO_EVENTS, grocers)
  return playedTo(morning, day + 1, NO_EVENTS, grocers)
}

/**
 * Like `closeOf`, the owner away all of `day`: the morning after it, with
 * `events` and `grocers`.
 */
function awayOn(
  state: GameState,
  day: Day,
  events: EventContent = NO_EVENTS,
  grocers: GrocerContent = GROCERS,
): GameState {
  const morning = playedTo(state, day, events, grocers)
  return playedTo({ ...morning, ownerAway: true }, day + 1, events, grocers)
}

function entriesOn(state: GameState, day: Day): JournalEntry[] {
  return entriesOf(state.journal).filter((entry) => entry.day === day)
}

/** The entry's debited and credited accounts with the amount it moves. */
function shape({ memo, lines }: JournalEntry) {
  return {
    memo,
    debited: lines.find(({ debit }) => debit > 0)?.account,
    credited: lines.find(({ credit }) => credit > 0)?.account,
    amount: lines.reduce((sum, { debit }) => sum + debit, 0),
  }
}

/** What the open state of a game owes and holds agrees with its books. */
function expectBooksAgree(state: GameState, day: Day): void {
  const sheet = balanceSheet(state.journal, day)
  expect(sheet.assets.total.amount, `day ${day}`).toBe(
    sheet.totalLiabilitiesAndEquity.amount,
  )
  expect(balance(state.journal, STOCKS, { toDay: day })).toBe(
    inventoryValue(state.inventory),
  )
  expect(balance(state.journal, RECEIVABLES, { toDay: day })).toBe(
    state.receivables.reduce((total, { amount }) => total + amount, 0),
  )
}

describe('the shipped grocers', () => {
  it('are the three of the issue, five times its volumes, at its prices and terms', () => {
    const terms = Object.fromEntries(
      Object.entries(GROCERS.grocers).map(([id, grocer]) => [
        id,
        [
          grocer.name,
          grocer.unitsPerWeek,
          grocer.unitPriceCents,
          grocer.paymentDays,
          grocer.weeks,
          grocer.artisanalPremiumCents,
        ],
      ]),
    )
    expect(terms).toEqual({
      chezNormand: ['Épicerie Chez Normand', 750, 210, 60, 12, 0],
      marcheBioLogique: ['Marché Bio-Logique', 1250, 225, 60, 12, 40],
      depanneur2424: ['Dépanneur 24/24', 500, 195, 45, 8, 0],
    })
    expect(GROCERS).toMatchObject({
      maxContracts: 3,
      deliveryWeekday: 1,
      deliveryEnergyCost: 4,
    })
  })
})

describe('startContract', () => {
  it("signs a contract after the others, for the grocer's weeks, at their price", () => {
    const one = startContract(noContracts(), 3, 'chezNormand')
    const two = startContract(one, 5, 'depanneur2424')
    expect(two.running).toEqual([
      {
        grocer: 'chezNormand',
        startDay: 3,
        weeksLeft: 12,
        unitPrice: 210,
        strikes: 0,
      },
      {
        grocer: 'depanneur2424',
        startDay: 5,
        weeksLeft: 8,
        unitPrice: 195,
        strikes: 0,
      },
    ])
    expect(two.deliveries).toEqual([])
  })

  it('prices a negotiated contract to the cent, half away from zero, and never below a cent', () => {
    const price = (grocer: GrocerId, factor: number) =>
      startContract(noContracts(), 0, grocer, factor).running[0]?.unitPrice
    expect(price('chezNormand', 1.1)).toBe(231)
    expect(price('marcheBioLogique', 1.1)).toBe(248)
    expect(price('depanneur2424', 1.1)).toBe(215)
    expect(price('chezNormand', 0.001)).toBe(1)
  })

  it('changes nothing while one of theirs runs, nor while the most at once do', () => {
    const one = startContract(noContracts(), 0, 'chezNormand')
    expect(startContract(one, 8, 'chezNormand')).toBe(one)
    const max = atMost(2)
    const two = startContract(one, 1, 'marcheBioLogique', 1, max)
    expect(two.running).toHaveLength(2)
    expect(startContract(two, 2, 'depanneur2424', 1, max)).toBe(two)
  })
})

describe('mayOffer and grocerAway', () => {
  it('lets a grocer offer while none of theirs runs, fewer than the most do, and they are not away', () => {
    const none = noContracts()
    expect(mayOffer(none, 30, 'chezNormand')).toBe(true)
    const one = startContract(none, 30, 'chezNormand')
    expect(mayOffer(one, 31, 'chezNormand')).toBe(false)
    expect(mayOffer(one, 31, 'depanneur2424')).toBe(true)
    expect(mayOffer(one, 31, 'depanneur2424', atMost(1))).toBe(false)
  })

  it('keeps a grocer away to the last of their days, that day included', () => {
    const away = grocerAway(noContracts(), 40, 'marcheBioLogique', 180)
    expect(away.away).toEqual({ marcheBioLogique: 219 })
    expect(mayOffer(away, 219, 'marcheBioLogique')).toBe(false)
    expect(mayOffer(away, 220, 'marcheBioLogique')).toBe(true)
    expect(mayOffer(away, 100, 'chezNormand')).toBe(true)
    // A shorter stay away does not bring them back sooner.
    expect(grocerAway(away, 50, 'marcheBioLogique', 30)).toBe(away)
    expect(grocerAway(away, 50, 'marcheBioLogique', 180).away).toEqual({
      marcheBioLogique: 229,
    })
  })
})

describe('a delivery', () => {
  const SIGNED = signed(started(), 'chezNormand')
  const DELIVERED = closeOf(SIGNED, MONDAY)
  const NORMAND = GROCERS.grocers.chezNormand
  const AMOUNT = 750 * 210

  it('comes on each Monday after the day it was signed, not that day', () => {
    expect(closeOf(SIGNED, 0).lastDay?.deliveries).toEqual([])
    expect(DELIVERED.lastDay?.deliveries).toEqual([
      {
        day: MONDAY,
        grocer: 'chezNormand',
        units: 750,
        baked: 0,
        amount: AMOUNT,
        dueDay: MONDAY + 60,
      },
    ])
    // Signed on a Tuesday, it delivers the next Monday all the same.
    const tuesday = signed(playedTo(started(), 1), 'chezNormand')
    expect(closeOf(tuesday, MONDAY).lastDay?.deliveries).toHaveLength(1)
    for (let day = 1; day < MONDAY; day += 1) {
      expect(closeOf(SIGNED, day).lastDay?.deliveries, `day ${day}`).toEqual([])
    }
  })

  it('buys the croissants, sells them out of stock at cost, and on credit to the grocer', () => {
    // Monday is closed: the delivery is all the day posts.
    expect(entriesOn(DELIVERED, MONDAY).map(shape)).toEqual([
      {
        memo: 'Achat de marchandises',
        debited: STOCKS,
        credited: CASH,
        amount: 750 * 110,
      },
      {
        memo: 'Coût des marchandises vendues',
        debited: COST_OF_GOODS_SOLD,
        credited: STOCKS,
        amount: 750 * 110,
      },
      {
        memo: 'Vente à crédit · Épicerie Chez Normand',
        debited: RECEIVABLES,
        credited: SALES,
        amount: AMOUNT,
      },
    ])
    expect(DELIVERED.receivables).toEqual([
      {
        client: NORMAND.name,
        amount: AMOUNT,
        soldOnDay: MONDAY,
        dueDay: MONDAY + 60,
      },
    ])
    expectBooksAgree(DELIVERED, MONDAY)
    expect(DELIVERED.contracts.deliveries).toEqual(
      DELIVERED.lastDay?.deliveries,
    )
  })

  it("is collected in full the morning it is due, the grocer's « Encaissement »", () => {
    const paid = closeOf(DELIVERED, MONDAY + 60)
    expect(
      entriesOn(paid, MONDAY + 60)
        .map(shape)
        .filter(({ memo }) => memo.startsWith('Encaissement')),
    ).toEqual([
      {
        memo: 'Encaissement · Épicerie Chez Normand',
        debited: CASH,
        credited: RECEIVABLES,
        amount: AMOUNT,
      },
    ])
    expect(paid.receivables.map(({ soldOnDay }) => soldOnDay)).not.toContain(
      MONDAY,
    )
    expectBooksAgree(paid, MONDAY + 60)
  })

  it('comes on a Monday the truck opens, and on one a card closes it', () => {
    const everyDay = signed(
      started([{ kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] }]),
      'chezNormand',
    )
    const open = closeOf(everyDay, MONDAY)
    expect(open.lastDay?.visits.length).toBeGreaterThan(0)
    expect(open.lastDay?.deliveries).toHaveLength(1)
    expectBooksAgree(open, MONDAY)

    const morning = playedTo(everyDay, MONDAY)
    const closedByCard: GameState = {
      ...morning,
      events: {
        ...morning.events,
        modifiers: [
          {
            event: 'chalet',
            change: { kind: 'closed' },
            fromDay: MONDAY,
            lastDay: MONDAY,
          },
        ],
      },
    }
    const closed = playedTo(closedByCard, MONDAY + 1)
    expect(closed.lastDay?.visits).toEqual([])
    expect(closed.lastDay?.deliveries).toHaveLength(1)
  })

  it("takes the owner's energy for each delivery, the truck open or closed", () => {
    const cost = GROCERS.deliveryEnergyCost
    const pair = (changes: readonly DecisionChange[]) => {
      const game = started(changes)
      const morning = playedTo(game, MONDAY)
      const without = playedTo(morning, MONDAY + 1)
      const contracts = signed(game, 'chezNormand', 'depanneur2424')
      const withTwo = playedTo(contracts, MONDAY + 1)
      return { morning, without, withTwo }
    }
    const open = pair([{ kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] }])
    expect(open.withTwo.lastDay?.energy).toBeCloseTo(
      (open.without.lastDay?.energy ?? 0) - 2 * cost,
      10,
    )
    const closed = pair([])
    expect(closed.withTwo.lastDay?.energy).toBe(
      energyAtClose(
        closed.morning.energy,
        {
          worked: false,
          away: false,
          customersServed: 0,
          stressed: false,
          bakingCost: 0,
          deliveryCost: 2 * cost,
        },
        ENERGY,
      ),
    )
    expect(closed.withTwo.lastDay?.energy).toBeLessThan(
      closed.without.lastDay?.energy ?? 0,
    )
  })

  it('counts down the weeks, ends the contract with its last delivery and brings the renewal the next morning', () => {
    const last = MONDAY * 12
    const morning = playedTo(SIGNED, last + 1, RENEWALS_ONLY)
    expect(morning.contracts.deliveries.map(({ day }) => day)).toEqual(
      Array.from({ length: 12 }, (_, week) => MONDAY * (week + 1)),
    )
    expect(morning.contracts.running).toEqual([])
    expect(morning.events.pending).toEqual({
      event: 'renouvellementNormand',
      followUp: true,
    })
    const weeks = (day: Day) =>
      playedTo(SIGNED, day).contracts.running[0]?.weeksLeft
    expect(weeks(MONDAY)).toBe(12)
    expect(weeks(MONDAY + 1)).toBe(11)
    expect(weeks(last)).toBe(1)

    const renewed = resolveEvent(morning, 'accepter', RENEWALS_ONLY)
    expect(renewed.contracts.running).toEqual([
      {
        grocer: 'chezNormand',
        startDay: last + 1,
        weeksLeft: 12,
        unitPrice: 210,
        strikes: 0,
      },
    ])
    expect(
      closeOf(renewed, last + MONDAY).lastDay?.deliveries.map(
        ({ grocer }) => grocer,
      ),
    ).toEqual(['chezNormand'])
  })

  it('posts the same books for the same seed', () => {
    const twice = () =>
      playedTo(signed(started(), 'chezNormand', 'depanneur2424'), 120)
    expect(twice().journal.entries).toEqual(twice().journal.entries)
  })
})

describe('a missed delivery', () => {
  const SIGNED = signed(started(), 'chezNormand')
  const HIRE_DELIVERER: DecisionChange = {
    kind: 'hire',
    role: 'livreur',
    candidate: 'kevin',
  }

  it('posts nothing and owes nothing, takes a week off the contract and counts a strike', () => {
    const before = playedTo(SIGNED, MONDAY)
    const missed = awayOn(SIGNED, MONDAY)
    expect(missed.lastDay?.deliveries).toEqual([])
    expect(missed.lastDay?.missed).toEqual([
      { day: MONDAY, grocer: 'chezNormand' },
    ])
    expect(missed.contracts.missed).toEqual([
      { day: MONDAY, grocer: 'chezNormand' },
    ])
    expect(missed.contracts.deliveries).toEqual([])
    expect(missed.contracts.running).toEqual([
      { ...SIGNED.contracts.running[0], weeksLeft: 11, strikes: 1 },
    ])
    // A closed Monday: no entry at all, and the owner's energy held.
    expect(entriesOn(missed, MONDAY)).toEqual([])
    expect(missed.receivables).toEqual([])
    expect(missed.lastDay?.energy).toBe(before.energy)
    // The next Monday, the owner back, delivers as usual.
    const next = closeOf(missed, 2 * MONDAY)
    expect(next.lastDay?.deliveries).toHaveLength(1)
    expect(next.contracts.running[0]).toMatchObject({
      weeksLeft: 10,
      strikes: 1,
    })
  })

  it("ends the contract at the grocers' third strike, with no renewal", () => {
    expect(GROCERS.maxStrikes).toBe(3)
    let state = SIGNED
    for (const week of [1, 2, 3])
      state = awayOn(state, week * MONDAY, RENEWALS_ONLY)
    expect(state.contracts.missed.map(({ day }) => day)).toEqual([7, 14, 21])
    expect(state.contracts.running).toEqual([])
    expect(state.events.followUps).toEqual([])
    expect(state.events.pending).toBeNull()
    // Two strikes leave it running.
    const twice = awayOn(awayOn(SIGNED, MONDAY), 2 * MONDAY)
    expect(twice.contracts.running[0]).toMatchObject({
      weeksLeft: 10,
      strikes: 2,
    })
  })

  it('ends the contract with its last week missed, which still brings the renewal', () => {
    const last = MONDAY * 12
    const morning = awayOn(SIGNED, last, RENEWALS_ONLY)
    expect(morning.contracts.deliveries).toHaveLength(11)
    expect(morning.contracts.missed).toEqual([
      { day: last, grocer: 'chezNormand' },
    ])
    expect(morning.contracts.running).toEqual([])
    expect(morning.events.pending).toEqual({
      event: 'renouvellementNormand',
      followUp: true,
    })
  })

  it('ends it at the strikes the content sets', () => {
    const once = loadGrocerContent({ ...grocersJson, maxStrikes: 1 }, EVENTS)
    const state = awayOn(SIGNED, MONDAY, NO_EVENTS, once)
    expect(state.contracts.running).toEqual([])
    expect(state.events.followUps).toEqual([])
  })

  it('never happens with a deliverer, who delivers while the owner is away, at no energy to the owner', () => {
    const hired = signed(started([HIRE_DELIVERER]), 'chezNormand')
    const before = playedTo(hired, MONDAY)
    const away = awayOn(hired, MONDAY)
    expect(away.lastDay?.missed).toEqual([])
    expect(away.lastDay?.deliveries).toHaveLength(1)
    expect(away.lastDay?.energy).toBe(before.energy)
    // With the owner there, the delivery takes nothing from them either.
    const there = closeOf(hired, MONDAY)
    expect(there.lastDay?.deliveries).toHaveLength(1)
    expect(there.lastDay?.energy).toBe(
      energyAtClose(
        before.energy,
        {
          worked: false,
          away: false,
          customersServed: 0,
          stressed: false,
          bakingCost: 0,
          deliveryCost: 0,
        },
        ENERGY,
      ),
    )
    expect(there.lastDay?.energy).toBeGreaterThan(
      closeOf(SIGNED, MONDAY).lastDay?.energy ?? 0,
    )
  })
})

describe('a delivery the bakery makes', () => {
  const BAKING: readonly DecisionChange[] = [
    { kind: 'openBakery', oven: 'louer' },
    { kind: 'croissantSource', source: 'fabriquer' },
  ]
  const capacity = BAKERY.capacityPerDay
  const bio = GROCERS.grocers.marcheBioLogique

  it('makes the croissants of the grocers who pay a premium first, within its capacity, and buys the rest', () => {
    const state = signed(started(BAKING), 'chezNormand', 'marcheBioLogique')
    const close = closeOf(state, MONDAY)
    expect(
      close.lastDay?.deliveries.map(({ grocer, baked, amount }) => ({
        grocer,
        baked,
        amount,
      })),
    ).toEqual([
      { grocer: 'chezNormand', baked: 0, amount: 750 * 210 },
      {
        grocer: 'marcheBioLogique',
        baked: capacity,
        amount: 1250 * 225 + capacity * bio.artisanalPremiumCents,
      },
    ])
    expect(
      entriesOn(close, MONDAY)
        .map(shape)
        .filter(({ memo }) => !memo.startsWith('Vente à crédit')),
    ).toEqual([
      // Normand's croissants, all bought.
      {
        memo: 'Achat de marchandises',
        debited: STOCKS,
        credited: CASH,
        amount: 750 * 110,
      },
      {
        memo: 'Coût des marchandises vendues',
        debited: COST_OF_GOODS_SOLD,
        credited: STOCKS,
        amount: 750 * 110,
      },
      // Bio-Logique's, the bakery's capacity made and the rest bought.
      {
        memo: BAKERY_MEMO.ingredients,
        debited: STOCKS,
        credited: CASH,
        amount: capacity * PRICES.ingredientCostCents,
      },
      {
        memo: 'Achat de marchandises',
        debited: STOCKS,
        credited: CASH,
        amount: (1250 - capacity) * 110,
      },
      {
        memo: 'Coût des marchandises vendues',
        debited: COST_OF_GOODS_SOLD,
        credited: STOCKS,
        amount: capacity * PRICES.ingredientCostCents + (1250 - capacity) * 110,
      },
    ])
    expectBooksAgree(close, MONDAY)
  })

  it("leaves the truck's own bake the capacity the deliveries left", () => {
    const small = delivering('chezNormand', 100)
    const state = signed(
      started([
        ...BAKING,
        { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] },
        { kind: 'bake', rule: { kind: 'buyDaily', quantity: 250 } },
      ]),
      'chezNormand',
    )
    const close = closeOf(state, MONDAY, small)
    const made = (day: Day) =>
      entriesOn(close, day)
        .filter(({ memo }) => memo === BAKERY_MEMO.ingredients)
        .map((entry) => shape(entry).amount / PRICES.ingredientCostCents)
    expect(close.lastDay?.deliveries[0]?.baked).toBe(100)
    expect(made(MONDAY)).toEqual([100, capacity - 100])
    // A day with no delivery leaves the truck the whole capacity.
    expect(made(MONDAY - 1)).toEqual([250])
    expectBooksAgree(close, MONDAY)
  })

  it('pays the premium only on the croissants made, whatever the truck has on hand, and leaves its lots as they were', () => {
    const morning = signed(
      playedTo(started(BAKING), MONDAY - 1),
      'marcheBioLogique',
    )
    const monday: GameState = {
      ...playedTo(morning, MONDAY),
      inventory: [
        {
          product: 'croissant',
          quantity: 100,
          unitCost: cents(110),
          boughtOnDay: 6,
        },
      ],
    }
    const { state, deliveries, baked } = deliverContracts(
      monday,
      true,
      true,
      PRICES,
      FOOD_TRUCK,
      BAKERY,
    )
    expect(baked).toBe(capacity)
    expect(deliveries).toEqual([
      {
        day: MONDAY,
        grocer: 'marcheBioLogique',
        units: 1250,
        baked: capacity,
        amount: 1250 * 225 + capacity * bio.artisanalPremiumCents,
        dueDay: MONDAY + bio.paymentDays,
      },
    ])
    expect(state.inventory).toBe(monday.inventory)
    // What went into Stocks came out of it: the batch never joined the lots.
    const moved = (account: AccountCode) =>
      balance(state.journal, account, { toDay: MONDAY }) -
      balance(monday.journal, account, { toDay: MONDAY })
    expect(moved(STOCKS)).toBe(0)
    expect(moved(COST_OF_GOODS_SOLD)).toBe(
      capacity * PRICES.ingredientCostCents + (1250 - capacity) * 110,
    )
    expect(moved(RECEIVABLES)).toBe(deliveries[0]?.amount)
  })

  it("buys every croissant when the bakery does not make the truck's, and makes none of them", () => {
    const state = signed(
      started([{ kind: 'openBakery', oven: 'louer' }]),
      'marcheBioLogique',
    )
    const close = closeOf(state, MONDAY)
    expect(close.lastDay?.deliveries[0]).toMatchObject({
      baked: 0,
      amount: 1250 * 225,
    })
  })

  it('makes nothing when nobody bakes: a deliverer then buys every croissant', () => {
    const state = signed(
      started([
        ...BAKING,
        { kind: 'hire', role: 'livreur', candidate: 'kevin' },
      ]),
      'marcheBioLogique',
    )
    const away = awayOn(state, MONDAY)
    expect(away.lastDay?.deliveries).toMatchObject([
      { grocer: 'marcheBioLogique', units: 1250, baked: 0, amount: 1250 * 225 },
    ])
    expect(
      entriesOn(away, MONDAY).filter(
        ({ memo }) => memo === BAKERY_MEMO.ingredients,
      ),
    ).toEqual([])
  })

  it('bakes with a baker at no energy to the owner', () => {
    const state = signed(
      started([
        ...BAKING,
        { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
      ]),
      'chezNormand',
    )
    const morning = playedTo(state, MONDAY)
    const close = playedTo(morning, MONDAY + 1)
    expect(close.lastDay?.deliveries).toMatchObject([{ baked: 300 }])
    expect(close.lastDay?.energy).toBe(
      energyAtClose(
        morning.energy,
        {
          worked: false,
          away: false,
          customersServed: 0,
          stressed: false,
          bakingCost: 0,
          deliveryCost: GROCERS.deliveryEnergyCost,
        },
        ENERGY,
      ),
    )
  })

  it('takes a morning of baking from the owner on a closed Monday that baked only for the deliveries', () => {
    const game = signed(started(BAKING), 'chezNormand')
    const morning = playedTo(game, MONDAY)
    const close = playedTo(morning, MONDAY + 1)
    expect(close.lastDay?.energy).toBe(
      energyAtClose(
        morning.energy,
        {
          worked: false,
          away: false,
          customersServed: 0,
          stressed: false,
          bakingCost: BAKERY.bakingEnergyCost,
          deliveryCost: GROCERS.deliveryEnergyCost,
        },
        ENERGY,
      ),
    )
  })
})

describe('the grocer condition of a card', () => {
  const card = EVENTS.events.find(({ id }) => id === 'contratNormand')
  if (card === undefined) throw new Error('No contratNormand card')
  // The grocer condition alone, drawn every morning.
  const offer: EventCard = { ...card, conditions: { grocer: 'chezNormand' } }
  const OFFER: EventContent = {
    pacing: { firstDay: 0, minDaysBetween: 0, dailyChance: 1 },
    events: [offer],
  }
  const morning = playedTo(started(), 40)
  const holds = (state: GameState, grocers: GrocerContent = GROCERS) =>
    conditionsHold(offer, state, new Map(), grocers)

  it('lets the grocer offer while they may (see mayOffer), and draws the card then', () => {
    expect(holds(morning)).toBe(true)
    expect(drawEvent(morning, OFFER).events.pending).toEqual({
      event: 'contratNormand',
      followUp: false,
    })
  })

  it('keeps the card away while their contract runs, the most at once run, or they are away', () => {
    const running = signed(morning, 'chezNormand')
    expect(holds(running)).toBe(false)
    expect(drawEvent(running, OFFER).events.pending).toBeNull()
    expect(holds(signed(morning, 'depanneur2424'), atMost(1))).toBe(false)
    const away: GameState = {
      ...morning,
      contracts: grocerAway(morning.contracts, 30, 'chezNormand', 11),
    }
    expect(holds(away)).toBe(false)
    expect(holds({ ...away, day: 41 })).toBe(true)
  })

  it("signs the contract when the card's choice does, and refusing changes nothing", () => {
    const waiting = drawEvent(morning, OFFER)
    const running: Contract[] = [
      {
        grocer: 'chezNormand',
        startDay: 40,
        weeksLeft: 12,
        unitPrice: cents(210),
        strikes: 0,
      },
    ]
    expect(resolveEvent(waiting, 'accepter', OFFER).contracts.running).toEqual(
      running,
    )
    expect(resolveEvent(waiting, 'refuser', OFFER).contracts).toEqual(
      noContracts(),
    )
  })

  it('applies a negotiated contract and a grocer walking away, both that morning', () => {
    const negotiated = applyEffect(
      morning,
      { kind: 'contract', grocer: 'chezNormand', priceFactor: 1.1 },
      FOOD_TRUCK,
      'contratNormand',
    )
    expect(negotiated.contracts.running).toEqual([
      {
        grocer: 'chezNormand',
        startDay: 40,
        weeksLeft: 12,
        unitPrice: 231,
        strikes: 0,
      },
    ])
    const away = applyEffect(
      morning,
      { kind: 'grocerAway', grocer: 'chezNormand', days: 180 },
      FOOD_TRUCK,
      'contratNormand',
    )
    expect(away.contracts.away).toEqual({ chezNormand: 219 })
    expect(away.journal).toBe(morning.journal)
  })
})

/**
 * The lowest Encaisse after any entry from day 0 to the day before the
 * first grocer pays, and that day.
 */
function lowestBeforeFirstPayment(state: GameState): {
  lowest: Cents
  firstPayment: Day
} {
  const names = Object.values(GROCERS.grocers).map(({ name }) => name)
  let cash = 0
  let lowest = Infinity
  let firstPayment = -1
  for (const { day, memo, lines } of entriesOf(state.journal)) {
    if (names.some((name) => memo === `Encaissement · ${name}`)) {
      firstPayment = day
      break
    }
    for (const { account, debit, credit } of lines) {
      if (account === CASH) cash += debit - credit
    }
    lowest = Math.min(lowest, cash)
  }
  return { lowest: cents(lowest), firstPayment }
}

/** The lowest Encaisse after any entry from day 0 to the close of `last`. */
function lowestTo(state: GameState, last: Day): Cents {
  let cash = 0
  let lowest = Infinity
  for (const { day, lines } of entriesOf(state.journal)) {
    if (day > last) break
    for (const { account, debit, credit } of lines) {
      if (account === CASH) cash += debit - credit
    }
    lowest = Math.min(lowest, cash)
  }
  return cents(lowest)
}

describe('the cash trap of #156', () => {
  const ACCEPTED_ON = 30
  const EIGHT_WEEKS = 56
  // The Monday after day 30, then Dépanneur 24/24's 45 days.
  const FIRST_DELIVERY = 35
  const FIRST_PAYMENT =
    FIRST_DELIVERY + GROCERS.grocers.depanneur2424.paymentDays

  /**
   * Seed 1 at `difficulty`, the starting decisions, no other event, the
   * three grocers' offers accepted on day 30, played to day 200.
   */
  function trap(difficulty: DifficultyId): GameState {
    let state = playedTo(started([], difficulty), ACCEPTED_ON)
    for (const event of [
      'contratNormand',
      'contratBioLogique',
      'contratDepanneur',
    ]) {
      state = resolveEvent(
        {
          ...state,
          events: { ...state.events, pending: { event, followUp: false } },
        },
        'accepter',
        EVENTS,
      )
    }
    expect(state.contracts.running).toHaveLength(3)
    return playedTo(state, 200)
  }

  it.each<DifficultyId>(['moyen', 'facile'])(
    'at %s, makes the best week of sales of the game in the eight weeks after',
    (difficulty) => {
      const { weekHistory } = trap(difficulty)
      const best = weekHistory.reduce((top, week) =>
        week.sales > top.sales ? week : top,
      )
      expect(best.firstDay).toBeGreaterThanOrEqual(ACCEPTED_ON)
      expect(best.firstDay).toBeLessThan(ACCEPTED_ON + EIGHT_WEEKS)
      const before = weekHistory.filter(
        ({ firstDay }) => firstDay < ACCEPTED_ON,
      )
      expect(best.sales).toBeGreaterThan(
        2 * Math.max(...before.map(({ sales }) => sales)),
      )
    },
  )

  it('at Moyen, takes the cash below zero before the first grocer pays', () => {
    const { lowest, firstPayment } = lowestBeforeFirstPayment(trap('moyen'))
    expect(firstPayment).toBe(FIRST_PAYMENT)
    expect(lowest).toBeLessThan(0)
  })

  it('at Facile, takes the cash below 1 500 $ before the first grocer pays', () => {
    const { lowest, firstPayment } = lowestBeforeFirstPayment(trap('facile'))
    expect(firstPayment).toBe(FIRST_PAYMENT)
    expect(lowest).toBeLessThan(150_000)
  })

  it('opening the bakery with three contracts and 10 000 $ at Moyen goes below zero within two months (#157)', () => {
    const moyen = started([
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
    ])
    expect(DIFFICULTIES.difficulties.moyen.startingCashCents).toBe(1_000_000)
    const state = signed(
      moyen,
      'chezNormand',
      'marcheBioLogique',
      'depanneur2424',
    )
    // Day 60 is June 30: two months from May 1st.
    const played = playedTo(state, 61)
    expect(lowestTo(played, 60)).toBeLessThan(0)
    expect(played.contracts.deliveries.some(({ baked }) => baked > 0)).toBe(
      true,
    )
  })
})
