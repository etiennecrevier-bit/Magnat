import { describe, expect, it } from 'vitest'
import type {
  EventEffect,
  StreetChange,
  TimedEventEffect,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import { balance, type JournalEntry } from '../finance/journal.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import { FOOD_TRUCK, playDay } from './day.ts'
import {
  applyEffect,
  insertByDay,
  startOfDay,
  untimed,
  whenDue,
} from './effects.ts'
import { FULL_ENERGY } from './energy.ts'
import { inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
import { next } from './rng.ts'
import type { GameState, Lot } from './types.ts'

// What each effect of an event's choice does to the game, now or at the
// start of a later day.

// Day 1, a Tuesday the shipped truck opens, before it is played.
const MORNING = tick(createInitialState(42))

function lines(entry: JournalEntry | undefined) {
  return entry?.lines.map(
    ({ account, debit, credit }) => `${account} ${debit}/${credit}`,
  )
}

/** The entries `after` posted since `before`. */
function posted(before: GameState, after: GameState): JournalEntry[] {
  return after.journal.entries.slice(before.journal.entries.length)
}

function apply(effect: EventEffect, state = MORNING): GameState {
  return applyEffect(state, effect, FOOD_TRUCK, 'essai')
}

function balanceOf(state: GameState, account: AccountCode): number {
  return balance(state.journal, account, { toDay: state.day })
}

function lot(quantity: number, unitCost: number, boughtOnDay = 1): Lot {
  return {
    product: 'croissant',
    quantity,
    unitCost: cents(unitCost),
    boughtOnDay,
  }
}

describe('whenDue', () => {
  // Day 1 is a Tuesday, ISO weekday 2.
  it('is the day itself with no timing', () => {
    expect(whenDue({}, 1)).toBe(1)
  })

  it('is inDays later', () => {
    expect(whenDue({ inDays: 1 }, 1)).toBe(2)
    expect(whenDue({ inDays: 60 }, 1)).toBe(61)
  })

  it.each([
    [4, 3],
    [7, 6],
    [1, 7],
    [3, 2],
  ])(
    'is the next weekday %i, on day %i, from a Tuesday',
    (weekday, expected) => {
      expect(toCalendar(1).weekday).toBe(2)
      expect(whenDue({ onNextWeekday: weekday }, 1)).toBe(expected)
      expect(toCalendar(expected).weekday).toBe(weekday)
    },
  )

  it('is a week later on that weekday', () => {
    expect(whenDue({ onNextWeekday: 2 }, 1)).toBe(8)
    expect(whenDue({ onNextWeekday: 4 }, 3)).toBe(10)
  })
})

describe('untimed', () => {
  it('drops the timing and keeps the rest', () => {
    const timed: TimedEventEffect = {
      kind: 'energy',
      amount: -15,
      onNextWeekday: 4,
    }
    expect(untimed(timed)).toEqual({ kind: 'energy', amount: -15 })
    expect(Object.keys(untimed({ ...timed, inDays: 2 }))).toEqual([
      'kind',
      'amount',
    ])
    expect(timed).toEqual({ kind: 'energy', amount: -15, onNextWeekday: 4 })
  })
})

describe('applyEffect', () => {
  it('charges Autres charges by default, with the description as the memo', () => {
    const after = apply({
      kind: 'charge',
      amountCents: cents(15_000),
      description: 'Amende du formulaire 14-B',
    })
    const [entry] = posted(MORNING, after)
    expect(entry?.memo).toBe('Amende du formulaire 14-B')
    expect(entry?.day).toBe(1)
    expect(lines(entry)).toEqual(['6900 15000/0', '1000 0/15000'])
    expect(posted(MORNING, after)).toHaveLength(1)
  })

  it.each(['5200', '6100', '6150', '6200', '6300', '6500'] as const)(
    'charges %s when the effect names it',
    (account) => {
      const after = apply({
        kind: 'charge',
        amountCents: cents(65_000),
        description: 'Réparation',
        account,
      })
      expect(lines(posted(MORNING, after)[0])).toEqual([
        `${account} 65000/0`,
        '1000 0/65000',
      ])
    },
  )

  it('sells for cash', () => {
    const after = apply({
      kind: 'cashSale',
      amountCents: cents(67_500),
      description: 'Commande du congrès',
    })
    const [entry] = posted(MORNING, after)
    expect(entry?.memo).toBe('Commande du congrès')
    expect(lines(entry)).toEqual(['1000 67500/0', '4000 0/67500'])
  })

  describe('a credit sale', () => {
    const sold = apply({
      kind: 'creditSale',
      amountCents: cents(75_000),
      client: 'Gilles Lacasse',
      dueInDays: 60,
    })

    it('is revenue today, owed by the client', () => {
      const [entry] = posted(MORNING, sold)
      expect(entry?.memo).toBe('Vente à crédit · Gilles Lacasse')
      expect(lines(entry)).toEqual(['1100 75000/0', '4000 0/75000'])
      expect(sold.receivables).toEqual([
        {
          client: 'Gilles Lacasse',
          amount: 75_000,
          soldOnDay: 1,
          dueDay: 61,
        },
      ])
    })

    it('of 750 $ due in 60 days: Ventes +750 $ that day, Encaisse +750 $ exactly 60 days later, Comptes clients back to 0', () => {
      const salesBefore = balanceOf(MORNING, '4000')
      let state = sold
      const cashMoves: number[] = []
      const receivable: number[] = []
      while (state.day <= 61) {
        state = tick(state)
        const day = state.day - 1
        const collected = state.journal.entries.filter(
          (entry) =>
            entry.day === day && entry.memo === 'Encaissement · Gilles Lacasse',
        )
        if (collected.length > 0) {
          cashMoves.push(day)
          expect(collected).toHaveLength(1)
          expect(lines(collected[0])).toEqual(['1000 75000/0', '1100 0/75000'])
        }
        receivable.push(balance(state.journal, '1100', { toDay: day }))
      }
      expect(balance(sold.journal, '4000', { toDay: 1 }) - salesBefore).toBe(
        75_000,
      )
      expect(cashMoves).toEqual([61])
      expect(receivable.slice(0, 60)).toEqual(Array(60).fill(75_000))
      expect(receivable.slice(60)).toEqual([0])
      expect(state.receivables).toEqual([])
    })
  })

  describe('receivables of a client', () => {
    // Two sales to Gilles, one to Réjean, sold in that order.
    const owed = [
      { client: 'Gilles', amount: 10_000, dueInDays: 30 },
      { client: 'Réjean', amount: 20_000, dueInDays: 10 },
      { client: 'Gilles', amount: 5_000, dueInDays: 5 },
    ].reduce(
      (state, { client, amount, dueInDays }) =>
        apply(
          { kind: 'creditSale', amountCents: cents(amount), client, dueInDays },
          state,
        ),
      MORNING,
    )

    it('are kept by due day', () => {
      expect(
        owed.receivables.map(({ client, amount, dueDay }) => [
          client,
          amount,
          dueDay,
        ]),
      ).toEqual([
        ['Gilles', 5_000, 6],
        ['Réjean', 20_000, 11],
        ['Gilles', 10_000, 31],
      ])
      expect(balanceOf(owed, '1100')).toBe(35_000)
    })

    it('are all collected at once, one entry each, the others still owed', () => {
      const after = apply({ kind: 'collectReceivable', client: 'Gilles' }, owed)
      const entries = posted(owed, after)
      expect(entries.map(({ memo }) => memo)).toEqual([
        'Encaissement · Gilles',
        'Encaissement · Gilles',
      ])
      expect(entries.map(lines)).toEqual([
        ['1000 5000/0', '1100 0/5000'],
        ['1000 10000/0', '1100 0/10000'],
      ])
      expect(after.receivables.map(({ client }) => client)).toEqual(['Réjean'])
      expect(balanceOf(after, '1100')).toBe(20_000)
    })

    it('are all written off at once, as Créances irrécouvrables', () => {
      const after = apply({ kind: 'writeOff', client: 'Gilles' }, owed)
      const entries = posted(owed, after)
      expect(entries.map(({ memo }) => memo)).toEqual([
        'Mauvaise créance · Gilles',
        'Mauvaise créance · Gilles',
      ])
      expect(entries.map(lines)).toEqual([
        ['6950 5000/0', '1100 0/5000'],
        ['6950 10000/0', '1100 0/10000'],
      ])
      expect(balanceOf(after, '1000')).toBe(balanceOf(owed, '1000'))
      expect(balanceOf(after, '1100')).toBe(20_000)
    })

    it('all come due later, still by due day', () => {
      const after = apply(
        { kind: 'delayReceivable', client: 'Gilles', days: 10 },
        owed,
      )
      expect(posted(owed, after)).toEqual([])
      expect(
        after.receivables.map(({ client, dueDay }) => [client, dueDay]),
      ).toEqual([
        ['Réjean', 11],
        ['Gilles', 16],
        ['Gilles', 41],
      ])
    })

    it.each<EventEffect>([
      { kind: 'collectReceivable', client: 'Personne' },
      { kind: 'writeOff', client: 'Personne' },
    ])('change nothing for a client who owes nothing: $kind', (effect) => {
      expect(apply(effect, owed)).toBe(owed)
      expect(apply(effect)).toBe(MORNING)
    })

    it('change nothing when delayed for a client who owes nothing', () => {
      const after = apply(
        { kind: 'delayReceivable', client: 'Personne', days: 5 },
        owed,
      )
      expect(after.receivables).toEqual(owed.receivables)
      expect(after.journal).toBe(owed.journal)
    })
  })

  it('buys stock at its unit cost, paid now, as a new lot after the others', () => {
    const stocked: GameState = { ...MORNING, inventory: [lot(3, 100, 0)] }
    const after = apply(
      { kind: 'buyStock', product: 'croissant', units: 200 },
      stocked,
    )
    const unitCost = FOOD_TRUCK.products.croissant.unitCostCents
    expect(after.inventory).toEqual([
      lot(3, 100, 0),
      { product: 'croissant', quantity: 200, unitCost, boughtOnDay: 1 },
    ])
    const [entry] = posted(stocked, after)
    expect(entry?.memo).toBe('Achat de marchandises')
    expect(lines(entry)).toEqual([
      `1200 ${200 * unitCost}/0`,
      `1000 0/${200 * unitCost}`,
    ])
  })

  it('buys stock at its own unit cost when it gives one', () => {
    const after = apply({
      kind: 'buyStock',
      product: 'cafe',
      units: 300,
      unitCostCents: cents(20),
    })
    expect(after.inventory.at(-1)).toEqual({
      product: 'cafe',
      quantity: 300,
      unitCost: 20,
      boughtOnDay: 1,
    })
    const [entry] = posted(MORNING, after)
    expect(entry?.memo).toBe('Achat de marchandises')
    expect(lines(entry)).toEqual(['1200 6000/0', '1000 0/6000'])
    expect(balanceOf(after, '1200')).toBe(inventoryValue(after.inventory))
  })

  describe('using stock', () => {
    // 5 croissants at 1 $, then 10 at 1,20 $, oldest first, with café
    // between them, as the books carry them.
    const stocked = [
      { kind: 'buyStock', product: 'croissant', units: 5 },
      { kind: 'buyStock', product: 'cafe', units: 4 },
      { kind: 'buyStock', product: 'croissant', units: 10 },
    ].reduce(
      (state, effect, index) =>
        applyEffect(
          state,
          effect as EventEffect,
          {
            ...FOOD_TRUCK,
            products: {
              ...FOOD_TRUCK.products,
              croissant: {
                ...FOOD_TRUCK.products.croissant,
                unitCostCents: cents(index === 0 ? 100 : 120),
              },
            },
          },
          'essai',
        ),
      MORNING,
    )

    it('starts from two lots of croissants', () => {
      expect(stocked.inventory.map(({ quantity }) => quantity)).toEqual([
        5, 4, 10,
      ])
      expect(balanceOf(stocked, '1200')).toBe(inventoryValue(stocked.inventory))
    })

    it('takes an order out oldest lot first, to Coût des marchandises vendues', () => {
      const after = apply(
        { kind: 'useStock', product: 'croissant', units: 8, to: 'order' },
        stocked,
      )
      expect(
        after.inventory.map(({ product, quantity }) => [product, quantity]),
      ).toEqual([
        ['cafe', 4],
        ['croissant', 7],
      ])
      const [entry] = posted(stocked, after)
      expect(entry?.memo).toBe('Coût des marchandises vendues')
      // 5 at 1 $, then 3 at 1,20 $.
      expect(lines(entry)).toEqual(['5000 860/0', '1200 0/860'])
      expect(balanceOf(after, '1200')).toBe(inventoryValue(after.inventory))
    })

    it('gives away to Marketing', () => {
      const after = apply(
        { kind: 'useStock', product: 'croissant', units: 6, to: 'giveaway' },
        stocked,
      )
      const [entry] = posted(stocked, after)
      expect(entry?.memo).toBe('Marchandises offertes')
      expect(lines(entry)).toEqual(['6300 620/0', '1200 0/620'])
    })

    it('loses stock to Pertes sur stocks', () => {
      const after = apply(
        { kind: 'useStock', product: 'croissant', units: 6, to: 'loss' },
        stocked,
      )
      const [entry] = posted(stocked, after)
      expect(entry?.memo).toBe('Marchandises perdues')
      expect(lines(entry)).toEqual(['5100 620/0', '1200 0/620'])
      expect(balanceOf(after, '1200')).toBe(inventoryValue(after.inventory))
    })

    it('takes only what is on hand', () => {
      const after = apply(
        { kind: 'useStock', product: 'croissant', units: 200, to: 'order' },
        stocked,
      )
      expect(after.inventory.map(({ product }) => product)).toEqual(['cafe'])
      expect(lines(posted(stocked, after)[0])).toEqual([
        '5000 1700/0',
        '1200 0/1700',
      ])
    })

    it('posts nothing with none on hand', () => {
      const after = apply(
        { kind: 'useStock', product: 'chocolat', units: 3, to: 'order' },
        stocked,
      )
      expect(posted(stocked, after)).toEqual([])
      expect(after.inventory).toEqual(stocked.inventory)
    })
  })

  it.each([
    [80, -15, 65],
    [95, 20, FULL_ENERGY],
    [10, -30, 0],
    [0, 100, FULL_ENERGY],
  ])("moves the owner's energy from %i by %i to %i", (from, by, to) => {
    const after = apply(
      { kind: 'energy', amount: by },
      { ...MORNING, energy: from },
    )
    expect(after.energy).toBe(to)
    expect(after.journal).toBe(MORNING.journal)
  })

  it("moves the owner's own cash, with no entry", () => {
    const after = apply({
      kind: 'personal',
      amountCents: cents(6_000),
      label: 'Normand vous remercie',
    })
    expect(after.personal.cash).toBe(MORNING.personal.cash + 6_000)
    expect(after.personal.movements.at(-1)).toEqual({
      day: 1,
      label: 'Normand vous remercie',
      amount: 6_000,
    })
    expect(after.journal).toBe(MORNING.journal)
    const spent = apply(
      { kind: 'personal', amountCents: cents(-2_500), label: 'Essence' },
      after,
    )
    expect(spent.personal.cash).toBe(MORNING.personal.cash + 3_500)
  })

  describe('a follow-up', () => {
    it('comes back days later, with no draw at a chance of 1', () => {
      const queued: GameState = {
        ...MORNING,
        events: {
          ...MORNING.events,
          followUps: [
            { day: 30, event: 'a' },
            { day: 61, event: 'b' },
          ],
        },
      }
      const after = apply(
        { kind: 'followUp', event: 'cheque', days: 60, chance: 1 },
        queued,
      )
      expect(after.events.followUps).toEqual([
        { day: 30, event: 'a' },
        { day: 61, event: 'b' },
        { day: 61, event: 'cheque' },
      ])
      expect(after.rngState).toBe(MORNING.rngState)
    })

    it('comes back when one draw falls below its chance', () => {
      const [value, after] = next(MORNING.rngState)
      const effect = (chance: number): EventEffect => ({
        kind: 'followUp',
        event: 'cheque',
        days: 3,
        chance,
      })
      const below = apply(effect(Math.min(1, value + 0.01)))
      expect(below.events.followUps).toEqual([{ day: 4, event: 'cheque' }])
      expect(below.rngState).toBe(after)
      const above = apply(effect(Math.max(0.001, value)))
      expect(above.events.followUps).toEqual([])
      expect(above.rngState).toBe(after)
    })
  })

  it('queues a headline', () => {
    const after = apply({ kind: 'headline', id: 'critiqueTiede' })
    expect(after.events.headlines).toEqual([{ day: 1, id: 'critiqueTiede' }])
    const again = apply({ kind: 'headline', id: 'festival' }, after)
    expect(again.events.headlines.map(({ id }) => id)).toEqual([
      'critiqueTiede',
      'festival',
    ])
  })

  it.each<[EventEffect, StreetChange]>([
    [
      { kind: 'walkIns', factor: 0.65, days: 15 },
      { kind: 'walkIns', factor: 0.65 },
    ],
    [
      { kind: 'walkIns', factor: 1.8, segment: 'chic', days: 3 },
      { kind: 'walkIns', factor: 1.8, segment: 'chic' },
    ],
    [
      { kind: 'appeal', product: 'chocolat', factor: 0.3, days: 5 },
      { kind: 'appeal', product: 'chocolat', factor: 0.3 },
    ],
    [
      { kind: 'willingness', factor: 1.1, days: 1 },
      { kind: 'willingness', factor: 1.1 },
    ],
    [
      { kind: 'unavailable', product: 'cafe', days: 4 },
      { kind: 'unavailable', product: 'cafe' },
    ],
    [{ kind: 'closed', days: 2 }, { kind: 'closed' }],
  ])(
    'changes the street with %j, from today, with no entry and no draw',
    (effect, change) => {
      const after = apply(effect)
      const days = 'days' in effect ? effect.days : 0
      expect(after.events.modifiers).toEqual([
        { event: 'essai', change, fromDay: 1, lastDay: days },
      ])
      expect(after.journal).toBe(MORNING.journal)
      expect(after.rngState).toBe(MORNING.rngState)
      expect(after.events.delayed).toEqual(MORNING.events.delayed)
    },
  )

  it('keeps the changes to the street in the order they were made, each with its event', () => {
    const first = apply({ kind: 'closed', days: 1 })
    const later = applyEffect(
      { ...first, day: 4 },
      { kind: 'walkIns', factor: 2, days: 3 },
      FOOD_TRUCK,
      'festival',
    )
    expect(later.events.modifiers).toEqual([
      { event: 'essai', change: { kind: 'closed' }, fromDay: 1, lastDay: 1 },
      {
        event: 'festival',
        change: { kind: 'walkIns', factor: 2 },
        fromDay: 4,
        lastDay: 6,
      },
    ])
  })

  it('never mutates the state', () => {
    const state = Object.freeze({
      ...MORNING,
      receivables: Object.freeze([]),
      events: Object.freeze({ ...MORNING.events }),
    })
    expect(() =>
      apply(
        {
          kind: 'creditSale',
          amountCents: cents(100),
          client: 'A',
          dueInDays: 1,
        },
        state,
      ),
    ).not.toThrow()
    expect(state.receivables).toEqual([])
  })
})

describe('insertByDay', () => {
  it('puts an item after those of its day or before', () => {
    const list = [
      { day: 1, id: 'a' },
      { day: 3, id: 'b' },
      { day: 3, id: 'c' },
      { day: 5, id: 'd' },
    ]
    expect(insertByDay(list, { day: 3, id: 'x' }).map(({ id }) => id)).toEqual([
      'a',
      'b',
      'c',
      'x',
      'd',
    ])
    expect(insertByDay(list, { day: 0, id: 'x' })[0]?.id).toBe('x')
    expect(insertByDay(list, { day: 9, id: 'x' }).at(-1)?.id).toBe('x')
    expect(insertByDay([], { day: 2, id: 'x' })).toEqual([{ day: 2, id: 'x' }])
  })
})

describe('startOfDay', () => {
  /** MORNING with `effects` queued, each for its day. */
  function queued(
    effects: readonly [number, EventEffect][],
    state = MORNING,
  ): GameState {
    return {
      ...state,
      events: {
        ...state.events,
        delayed: effects.map(([day, effect]) => ({ day, event: 'e', effect })),
      },
    }
  }

  it('runs the effects due today, in order, and keeps the later ones', () => {
    const later: EventEffect = { kind: 'energy', amount: -50 }
    const state = queued([
      [1, { kind: 'energy', amount: -30 }],
      [1, { kind: 'charge', amountCents: cents(100), description: 'A' }],
      [1, { kind: 'charge', amountCents: cents(200), description: 'B' }],
      [2, later],
    ])
    const started = startOfDay(state, FOOD_TRUCK)
    expect(posted(state, started).map(({ memo }) => memo)).toEqual(['A', 'B'])
    expect(started.energy).toBe(MORNING.energy - 30)
    expect(started.events.delayed).toEqual([
      { day: 2, event: 'e', effect: later },
    ])
  })

  it('collects the receivables due today after the effects, which may delay them', () => {
    const owed = [
      { client: 'A', dueInDays: 1 },
      { client: 'B', dueInDays: 1 },
      { client: 'C', dueInDays: 2 },
    ].reduce(
      (state, { client, dueInDays }) =>
        apply(
          { kind: 'creditSale', amountCents: cents(1_000), client, dueInDays },
          state,
        ),
      { ...MORNING, day: 0 },
    )
    const morning = queued(
      [[1, { kind: 'delayReceivable', client: 'B', days: 5 }]],
      { ...owed, day: 1 },
    )
    const started = startOfDay(morning, FOOD_TRUCK)
    expect(posted(morning, started).map(({ memo }) => memo)).toEqual([
      'Encaissement · A',
    ])
    expect(
      started.receivables.map(({ client, dueDay }) => [client, dueDay]),
    ).toEqual([
      ['C', 2],
      ['B', 6],
    ])
  })

  it('changes nothing with nothing due', () => {
    expect(startOfDay(MORNING, FOOD_TRUCK)).toBe(MORNING)
  })

  it('changes the street from today, as the event that queued it', () => {
    const state: GameState = {
      ...MORNING,
      events: {
        ...MORNING.events,
        delayed: [
          {
            day: 1,
            event: 'machine',
            effect: { kind: 'unavailable', product: 'cafe', days: 2 },
          },
        ],
      },
    }
    expect(startOfDay(state, FOOD_TRUCK).events).toEqual({
      ...MORNING.events,
      modifiers: [
        {
          event: 'machine',
          change: { kind: 'unavailable', product: 'cafe' },
          fromDay: 1,
          lastDay: 2,
        },
      ],
    })
  })

  it("runs before the day's restock and sales, in the day's books", () => {
    const state = queued([
      [1, { kind: 'charge', amountCents: cents(100), description: 'Avant' }],
    ])
    const memos = posted(state, playDay(state)).map(({ memo }) => memo)
    expect(memos[0]).toBe('Avant')
    expect(memos.slice(1)).toEqual(
      posted(MORNING, playDay(MORNING)).map(({ memo }) => memo),
    )
  })

  it("changes the owner's energy before the day's service", () => {
    const rested = playDay(MORNING)
    const worn = playDay(queued([[1, { kind: 'energy', amount: -100 }]]))
    expect(rested.lastDay?.botched).toBe(0)
    expect(worn.lastDay?.botched ?? 0).toBeGreaterThan(0)
    expect(worn.lastDay?.averageWaitSeconds ?? 0).toBeGreaterThan(
      rested.lastDay?.averageWaitSeconds ?? 0,
    )
    expect(worn.energy).toBe(0)
  })
})
