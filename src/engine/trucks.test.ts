import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import {
  loadDreamContent,
  type CandidateId,
  type DreamContent,
} from '../content/schema.ts'
import { salesByTruck } from '../finance/byTruck.ts'
import { entriesOf, type JournalEntry } from '../finance/journal.ts'
import { incomeStatement } from '../finance/statements.ts'
import { BAKERY } from './bakery.ts'
import { toCalendar } from './calendar.ts'
import { createInitialState, tick } from './clock.ts'
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
import { applyDecision, type DecisionChange } from './decisions.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING } from './financing.ts'
import { add, cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { PLACES } from './places.ts'
import { seedRng } from './rng.ts'
import { deserialize, serialize } from './save.ts'
import { STAFF, askingWage, isAbsent } from './staff.ts'
import {
  FIRST_TRUCK,
  newTruck,
  ownerAtOf,
  truckDecisionsOf,
  truckIds,
  truckStream,
  trucksOf,
  withTrucks,
} from './trucks.ts'
import type { GameState, Visit } from './types.ts'

// More than one truck (#259): the second truck bought, who works where, and
// a day that plays each truck in turn with one set of books.

const SEED = 42
const SECOND = 'vieuxMontreal'

/**
 * « Le rêve » with « Deuxième camion » for sale first in its ladder, at a
 * price a game can pay on day 0; the shipped one shows it « Bientôt ».
 */
const DREAM: DreamContent = loadDreamContent({
  ...dreamJson,
  company: [
    {
      ...dreamJson.company[2],
      comingSoon: undefined,
      priceCents: 500_000,
    },
    dreamJson.company[0],
    dreamJson.company[1],
  ],
})

/** `change` made with `DREAM`. */
function decide(state: GameState, change: DecisionChange): GameState {
  return applyDecision(
    state,
    change,
    FOOD_TRUCK,
    DEFIS,
    BAKERY,
    STAFF,
    DREAM,
    DIFFICULTIES,
    PLACES,
  )
}

/** The changes made in order. */
function deciding(
  state: GameState,
  ...changes: readonly DecisionChange[]
): GameState {
  return changes.reduce(decide, state)
}

/** `days` days played with `DREAM`, no event coming up. */
function played(state: GameState, days = 1): GameState {
  let game = state
  for (let day = 0; day < days; day += 1) {
    game = tick(
      game,
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
      FINANCING,
      DREAM,
      PLACES,
    )
  }
  return game
}

/** A hire of `candidate` « Au camion » at the wage they ask. */
function hiring(candidate: CandidateId): DecisionChange {
  return {
    kind: 'hire',
    role: 'camion',
    candidate,
    hourlyWage: askingWage(candidate, 'camion'),
  }
}

/** The morning of day 0 with the second truck bought. */
const BOUGHT = decide(createInitialState(SEED), {
  kind: 'buy',
  rung: 'deuxiemeCamion',
})

/** Every day open, so the trucks open whenever someone works there. */
const EVERY_DAY: DecisionChange[] = [
  { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7] },
  { kind: 'daysOpen', weekdays: [1, 2, 3, 4, 5, 6, 7], truck: SECOND },
]

/** The second truck of `state`; fails when it has none. */
function second(state: GameState) {
  const truck = state.trucks?.[0]
  if (truck === undefined) throw new Error('No second truck')
  return truck
}

/** The trucks the lines of `entries` name, each once, in order. */
function named(entries: readonly JournalEntry[]): (string | undefined)[] {
  return [
    ...new Set(entries.flatMap(({ lines }) => lines.map(({ truck }) => truck))),
  ]
}

/** The entries of day `day`. */
function entriesOn(state: GameState, day: number): JournalEntry[] {
  return entriesOf(state.journal).filter((entry) => entry.day === day)
}

/** Who served `visits`, each once, in order; nobody for those not served. */
function servers(visits: readonly Visit[]): string[] {
  return [...new Set(visits.flatMap(({ servedBy }) => servedBy ?? []))].sort()
}

describe('the trucks of a game', () => {
  it('are the Plateau alone as a game starts, its own generator and stock', () => {
    const start = createInitialState(SEED)
    expect(start.trucks).toBeUndefined()
    expect(truckIds(start)).toEqual([FIRST_TRUCK])
    expect(trucksOf(start)).toEqual([
      {
        id: 'plateau',
        district: 'plateau',
        rngState: start.rngState,
        inventory: start.inventory,
      },
    ])
    expect(ownerAtOf(start.decisions)).toBe(FIRST_TRUCK)
    expect(truckDecisionsOf(start.decisions, FIRST_TRUCK)).toEqual({
      prices: start.decisions.prices,
      restock: start.decisions.restock,
      daysOpen: start.decisions.daysOpen,
    })
    expect(() => truckDecisionsOf(start.decisions, SECOND)).toThrow(RangeError)
  })

  it('put each truck back where it is kept', () => {
    const lot = { product: 'cafe', quantity: 3, unitCost: 40, boughtOnDay: 0 }
    const back = withTrucks(BOUGHT, [
      { id: FIRST_TRUCK, rngState: 7, inventory: [], lastDay: null },
      { id: SECOND, rngState: 9, inventory: [lot] as never, lastDay: null },
    ])
    expect(back.rngState).toBe(7)
    expect(back.trucks?.[0]).toMatchObject({ rngState: 9, inventory: [lot] })
    expect(trucksOf(back).map(({ id, rngState }) => [id, rngState])).toEqual([
      ['plateau', 7],
      [SECOND, 9],
    ])
    expect(() =>
      withTrucks(BOUGHT, [
        { id: 'laval', rngState: 1, inventory: [], lastDay: null },
      ]),
    ).toThrow(RangeError)
  })

  it('give each new truck a stream of its own, from the seed and its id alone', () => {
    const stream = truckStream(SEED, SECOND)
    expect(stream).toBe(truckStream(SEED, SECOND))
    expect(
      newTruck(SEED, { id: SECOND, district: 'vieuxMontreal' }, 3),
    ).toMatchObject({ rngState: stream, boughtOnDay: 3 })
    expect(
      newTruck(SEED, { id: SECOND, district: 'vieuxMontreal' }, 400).rngState,
    ).toBe(stream)
    expect(stream).not.toBe(seedRng(SEED))
    expect(truckStream(SEED, 'laval')).not.toBe(stream)
    expect(truckStream(SEED + 1, SECOND)).not.toBe(stream)
    // An id is no other's prefix: « ab » and « a », « b » draw apart.
    expect(truckStream(SEED, 'ab')).not.toBe(truckStream(SEED, 'a'))
  })
})

describe('buying « Deuxième camion »', () => {
  it('stays « Bientôt » in the shipped game', () => {
    expect(() =>
      applyDecision(createInitialState(SEED), {
        kind: 'buy',
        rung: 'deuxiemeCamion',
      }),
    ).toThrow('not for sale yet')
  })

  it('adds a truck in Vieux-Montréal, paid that morning, run as the first one', () => {
    const start = createInitialState(SEED)
    expect(BOUGHT.trucks).toEqual([
      {
        id: SECOND,
        district: 'vieuxMontreal',
        boughtOnDay: 0,
        rngState: truckStream(SEED, SECOND),
        inventory: [],
        lastDay: null,
      },
    ])
    expect(BOUGHT.rngState).toBe(start.rngState)
    expect(entriesOf(BOUGHT.journal).at(-1)).toEqual({
      day: 0,
      memo: 'Achat · Deuxième camion',
      lines: [
        { account: '1500', debit: 500_000, credit: 0 },
        { account: '1000', debit: 0, credit: 500_000 },
      ],
    })
    expect(BOUGHT.decisions.trucks).toEqual({
      [SECOND]: truckDecisionsOf(start.decisions, FIRST_TRUCK),
    })
    expect(BOUGHT.decisions.trucks?.[SECOND]?.prices).not.toBe(
      start.decisions.prices,
    )
    expect(BOUGHT.pendingDecisions).toBeNull()
  })

  it('runs it as the latest decisions run the first truck, waiting ones included', () => {
    const priced = decide(createInitialState(SEED), {
      kind: 'price',
      product: 'cafe',
      price: cents(300),
    })
    const bought = decide(priced, { kind: 'buy', rung: 'deuxiemeCamion' })
    expect(bought.decisions.trucks?.[SECOND]?.prices.cafe).toBe(
      FOOD_TRUCK.startingDecisions.pricesCents.cafe,
    )
    expect(bought.pendingDecisions?.trucks?.[SECOND]?.prices.cafe).toBe(300)
    expect(Object.keys(bought.pendingDecisions ?? {}).at(-1)).toBe('trucks')
  })

  it('depreciates it from the 1st after, naming it', () => {
    // Day 31 is June 1st, the first 1st after day 0.
    const june = played(BOUGHT, 32)
    const depreciation = entriesOf(june.journal).filter(
      ({ memo }) => memo === 'Amortissement · Deuxième camion',
    )
    expect(depreciation).toEqual([
      {
        day: 31,
        memo: 'Amortissement · Deuxième camion',
        lines: [
          {
            account: '6400',
            debit: Math.floor(500_000 / 120),
            credit: 0,
            truck: SECOND,
          },
          { account: '1510', debit: 0, credit: Math.floor(500_000 / 120) },
        ],
      },
    ])
  })

  it('cannot be bought twice', () => {
    expect(() =>
      decide(BOUGHT, { kind: 'buy', rung: 'deuxiemeCamion' }),
    ).toThrow('bought already')
  })
})

describe('the decisions of a truck', () => {
  it("change the truck they name, and the first one's when they name none", () => {
    const changed = deciding(
      BOUGHT,
      { kind: 'price', product: 'cafe', price: cents(350), truck: SECOND },
      {
        kind: 'restock',
        product: 'cafe',
        rule: { kind: 'topUp', whenBelow: 5, upTo: 20 },
        truck: SECOND,
      },
      { kind: 'daysOpen', weekdays: [7, 6], truck: SECOND },
      { kind: 'price', product: 'cafe', price: cents(250) },
    )
    const waiting = changed.pendingDecisions
    expect(waiting?.prices.cafe).toBe(250)
    expect(waiting?.trucks?.[SECOND]).toMatchObject({
      prices: { cafe: 350 },
      restock: { cafe: { kind: 'topUp', whenBelow: 5, upTo: 20 } },
      daysOpen: [6, 7],
    })
    // The day under way keeps its decisions.
    expect(changed.decisions).toBe(BOUGHT.decisions)
  })

  it("hold each truck's to the limits, and to its products' kinds of rule", () => {
    expect(() =>
      decide(BOUGHT, {
        kind: 'price',
        product: 'cafe',
        price: cents(1),
        truck: SECOND,
      }),
    ).toThrow(`trucks.${SECOND}.prices.cafe`)
    expect(() =>
      decide(BOUGHT, {
        kind: 'restock',
        product: 'cafe',
        rule: { kind: 'buyDaily', quantity: 3 },
        truck: SECOND,
      }),
    ).toThrow('must stay a topUp rule')
    expect(() =>
      decide(BOUGHT, { kind: 'daysOpen', weekdays: [], truck: SECOND }),
    ).toThrow(`trucks.${SECOND}.daysOpen`)
  })

  it('throw for a truck the game does not have', () => {
    const start = createInitialState(SEED)
    for (const change of [
      { kind: 'price', product: 'cafe', price: cents(300), truck: SECOND },
      { kind: 'daysOpen', weekdays: [1], truck: SECOND },
      { kind: 'ownerAt', truck: SECOND },
      { kind: 'assign', candidate: 'kevin', truck: SECOND },
    ] as const) {
      expect(() => decide(start, change)).toThrow(`unknown truck ${SECOND}`)
    }
  })
})

describe('who works where', () => {
  it('puts the owner at one truck from the next morning, kept until changed', () => {
    const moved = decide(BOUGHT, { kind: 'ownerAt', truck: SECOND })
    expect(ownerAtOf(moved.decisions)).toBe(FIRST_TRUCK)
    expect(moved.pendingDecisions?.ownerAt).toBe(SECOND)
    const later = played(moved, 3)
    expect(later.decisions.ownerAt).toBe(SECOND)
    const back = decide(later, { kind: 'ownerAt', truck: FIRST_TRUCK })
    expect(back.pendingDecisions).not.toHaveProperty('ownerAt')
  })

  it('assigns an employee « Au camion » to a truck, through mornings and wage changes', () => {
    const assigned = deciding(BOUGHT, hiring('kevin'), {
      kind: 'assign',
      candidate: 'kevin',
      truck: SECOND,
    })
    expect(assigned.pendingDecisions?.staff).toEqual([
      {
        candidate: 'kevin',
        role: 'camion',
        hourlyWage: askingWage('kevin', 'camion'),
        truck: SECOND,
      },
    ])
    const later = played(assigned, 3)
    expect(later.staff[0]?.truck).toBe(SECOND)
    const raised = played(
      decide(later, {
        kind: 'setWage',
        candidate: 'kevin',
        hourlyWage: add(askingWage('kevin', 'camion'), cents(100)),
      }),
      2,
    )
    expect(raised.staff[0]).toMatchObject({ truck: SECOND, hiredOnDay: 1 })
    const home = decide(raised, {
      kind: 'assign',
      candidate: 'kevin',
      truck: FIRST_TRUCK,
    })
    expect(home.pendingDecisions?.staff[0]).not.toHaveProperty('truck')
  })

  it('assigns only someone the player wants, « Au camion »', () => {
    expect(() =>
      decide(BOUGHT, { kind: 'assign', candidate: 'kevin', truck: SECOND }),
    ).toThrow('kevin is not hired')
    const deliverer = decide(BOUGHT, {
      kind: 'hire',
      role: 'livreur',
      candidate: 'kevin',
    })
    expect(() =>
      decide(deliverer, { kind: 'assign', candidate: 'kevin', truck: SECOND }),
    ).toThrow('kevin works as livreur, not at a truck')
  })
})

describe('a day with two trucks', () => {
  /** Day 1's morning, both trucks open every day. */
  const OPEN = played(deciding(BOUGHT, ...EVERY_DAY))

  it('keeps a truck with nobody closed, its generator unmoved', () => {
    const day = played(OPEN)
    const truck = second(day)
    expect(truck.lastDay).toMatchObject({ day: 1, open: false, revenue: 0 })
    expect(truck.lastDay?.visits).toEqual([])
    expect(truck.rngState).toBe(truckStream(SEED, SECOND))
    expect(named(entriesOn(day, 1))).not.toContain(SECOND)
    expect(day.lastDay?.visits.length).toBeGreaterThan(0)
  })

  it('opens a truck with an employee assigned to it, naming it on its own lines', () => {
    const staffed = played(
      deciding(OPEN, hiring('kevin'), {
        kind: 'assign',
        candidate: 'kevin',
        truck: SECOND,
      }),
      2,
    )
    const truck = second(staffed)
    expect(truck.lastDay).toMatchObject({ day: 2, open: true })
    expect(servers(truck.lastDay?.visits ?? [])).toEqual(['kevin'])
    expect(servers(staffed.lastDay?.visits ?? [])).toEqual(['owner'])
    expect(truck.rngState).not.toBe(truckStream(SEED, SECOND))
    const own = entriesOn(staffed, 2).filter(({ lines }) =>
      lines.some((line) => line.truck === SECOND),
    )
    expect(own.map(({ memo }) => memo)).toEqual([
      'Ventes au comptant',
      'Coût des marchandises vendues',
      'Produits ratés',
      'Emballages',
      'Frais de cartes',
      'Carburant et entretien',
      'Marchandises périmées',
    ])
    for (const { lines } of own) {
      expect(lines.filter(({ truck }) => truck !== undefined)).toHaveLength(1)
    }
    const sales = salesByTruck(staffed.journal, { fromDay: 2, toDay: 2 })
    expect(sales.get(SECOND)).toBe(truck.lastDay?.revenue)
    expect(sales.get(FIRST_TRUCK)).toBe(staffed.lastDay?.revenue)
    expect([...sales.values()].reduce((a, b) => a + b, 0)).toBe(
      incomeStatement(staffed.journal, 2, 2).sales.amount,
    )
    // The week counts every truck's customers.
    const week = staffed.weekSoFar.days.at(-1)
    const served = (visits: readonly Visit[]) =>
      visits.filter(({ servedMinute }) => servedMinute !== null).length
    expect(week?.customersServed).toBe(
      served(staffed.lastDay?.visits ?? []) +
        served(truck.lastDay?.visits ?? []),
    )
  })

  it("leaves the first truck's day as it would be without the second", () => {
    const alone = played(
      deciding(createInitialState(SEED), EVERY_DAY[0] as DecisionChange),
      3,
    )
    const both = played(
      deciding(OPEN, hiring('kevin'), {
        kind: 'assign',
        candidate: 'kevin',
        truck: SECOND,
      }),
      2,
    )
    expect(both.rngState).toBe(alone.rngState)
    expect(both.lastDay?.visits).toEqual(alone.lastDay?.visits)
    expect(both.lastDay?.revenue).toBe(alone.lastDay?.revenue)
  })

  it('takes the owner to one truck only: the other opens only with an employee', () => {
    const away = played(decide(OPEN, { kind: 'ownerAt', truck: SECOND }), 2)
    expect(away.lastDay?.visits).toEqual([])
    expect(second(away).lastDay?.open).toBe(true)
    expect(servers(second(away).lastDay?.visits ?? [])).toEqual(['owner'])

    const staffed = played(
      deciding(OPEN, { kind: 'ownerAt', truck: SECOND }, hiring('amelie')),
      2,
    )
    expect(servers(staffed.lastDay?.visits ?? [])).toEqual(['amelie'])
    expect(servers(second(staffed).lastDay?.visits ?? [])).toEqual(['owner'])
    // The owner's energy counts the customers they served, at their truck.
    const work = staffed.lastDay?.work ?? []
    const owner = work.find(({ who }) => who === 'owner')
    const amelie = work.find(({ who }) => who === 'amelie')
    expect(owner?.sales).toBe(second(staffed).lastDay?.revenue)
    expect(amelie?.sales).toBe(staffed.lastDay?.revenue)
  })

  it("takes the owner on a trip away from their own truck, and leaves the other's day as it was", () => {
    // The owner at the second truck, an employee at the first.
    const morning = played(
      deciding(OPEN, { kind: 'ownerAt', truck: SECOND }, hiring('amelie')),
    )
    const stay = played(morning)
    const trip = played(decide(morning, { kind: 'goTo', place: 'meunerie' }))
    expect(trip.lastDay?.visits).toEqual(stay.lastDay?.visits)
    expect(second(trip).lastDay?.visits).not.toEqual(
      second(stay).lastDay?.visits,
    )
  })

  it('reports an employee absent on a day their own truck was to open, though it stayed closed', () => {
    // Nobody but Kevin at the second truck, the owner at the first.
    const kevin = {
      candidate: 'kevin',
      role: 'camion',
      hourlyWage: askingWage('kevin', 'camion'),
    } as const
    const assigned = played(
      deciding(OPEN, hiring('kevin'), {
        kind: 'assign',
        candidate: 'kevin',
        truck: SECOND,
      }),
    )
    let day = assigned.day
    while (!isAbsent(SEED, day, kevin)) day += 1
    expect(day).toBeLessThan(assigned.day + 400)
    const absent = played(assigned, day - assigned.day + 1)
    expect(absent.lastDay).toMatchObject({ day, absent: ['kevin'] })
    expect(second(absent).lastDay).toMatchObject({ day, open: false })
    // On a day the second truck is not to open, Kevin misses nothing.
    const closedDays = played(
      decide(assigned, {
        kind: 'daysOpen',
        weekdays: [1, 2, 3, 4, 5, 6, 7].filter(
          (weekday) => weekday !== toCalendar(day).weekday,
        ),
        truck: SECOND,
      }),
      day - assigned.day + 1,
    )
    expect(closedDays.lastDay?.day).toBe(day)
    expect(closedDays.lastDay?.absent).toBeUndefined()
  })
})

describe('a save with two trucks', () => {
  /** `text` loaded with `DREAM`. */
  function load(text: string): GameState {
    return deserialize(
      text,
      FOOD_TRUCK,
      EVENTS,
      DIFFICULTIES,
      DEFIS,
      BAKERY,
      GROCERS,
      STAFF,
      FINANCING,
      DREAM,
    )
  }

  type Json = Record<string, unknown>

  /** The save of `state` with `change` made to it. */
  function edited(state: GameState, change: (save: Json) => void): string {
    const save = JSON.parse(serialize(state)) as Json
    change(save)
    return JSON.stringify(save)
  }

  /** The second truck of a save. */
  const truckOf = (save: Json) => (save.trucks as Json[])[0] as Json

  // Kevin at the second truck, Amélie at the first, the owner moving to
  // the second, played a fortnight, then both again waiting to move back.
  const STAFFED = played(
    deciding(
      BOUGHT,
      ...EVERY_DAY,
      hiring('kevin'),
      { kind: 'assign', candidate: 'kevin', truck: SECOND },
      hiring('amelie'),
      { kind: 'ownerAt', truck: SECOND },
    ),
    14,
  )
  const WAITING = deciding(
    STAFFED,
    { kind: 'ownerAt', truck: FIRST_TRUCK },
    { kind: 'assign', candidate: 'kevin', truck: FIRST_TRUCK },
    { kind: 'price', product: 'cafe', price: cents(320), truck: SECOND },
  )

  it.each<[string, GameState]>([
    ['the morning it is bought', BOUGHT],
    ['a fortnight later', STAFFED],
    ['with a move and a price waiting', WAITING],
    ['at a close', playDayOf(WAITING)],
  ])('gives back the game %s, and writes the same save', (_, state) => {
    const text = serialize(state)
    const back = load(text)
    expect(back).toStrictEqual(state)
    expect(serialize(back)).toBe(text)
  })

  it('plays on from a save as the game it was', () => {
    const back = load(serialize(WAITING))
    expect(played(back, 20)).toStrictEqual(played(WAITING, 20))
  })

  it.each<[string, (save: Json) => void, string]>([
    [
      'another id',
      (save) => {
        truckOf(save).id = 'laval'
      },
      'truck 1, laval, is not the truck its rung adds',
    ],
    [
      'another day bought',
      (save) => {
        truckOf(save).boughtOnDay = 1
      },
      'is not the truck its rung adds',
    ],
    [
      'no last day once a day is played',
      (save) => {
        truckOf(save).lastDay = null
      },
      'has no last day, though day 13 was played',
    ],
    [
      "a last day before the game's",
      (save) => {
        ;(truckOf(save).lastDay as Json).day = 12
      },
      'last played day 12',
    ],
    [
      'a lot bought after the save',
      (save) => {
        const [lot] = truckOf(save).inventory as Json[]
        if (lot === undefined) throw new Error('No lot')
        lot.boughtOnDay = 20
      },
      `truck ${SECOND}'s lot 1 was bought on day 20, after day 14`,
    ],
    [
      'lots that do not cost what Stocks carries',
      (save) => {
        truckOf(save).inventory = []
      },
      'does not equal the lots',
    ],
    [
      'a line naming a truck the game does not have',
      (save) => {
        const entry = (save.journal as Json[]).at(-1) as Json
        ;((entry.lines as Json[])[0] as Json).truck = 'laval'
      },
      'names the truck laval, which the game does not have',
    ],
    [
      'the owner at a truck the game does not have',
      (save) => {
        ;(save.decisions as Json).ownerAt = 'laval'
      },
      'ownerAt names no truck after the first: laval',
    ],
    [
      'an employee at a truck the game does not have',
      (save) => {
        const staff = (save.decisions as Json).staff as Json[]
        ;(staff[0] as Json).truck = 'laval'
      },
      'names no truck after the first: laval',
    ],
    [
      'a deliverer at a truck',
      (save) => {
        const staff = (save.pendingDecisions as Json).staff as Json[]
        ;(staff[1] as Json).role = 'livreur'
        ;(staff[1] as Json).truck = SECOND
      },
      'truck is for an employee at a truck, not livreur',
    ],
    [
      'decisions running no second truck',
      (save) => {
        delete (save.pendingDecisions as Json).trucks
      },
      `trucks must run exactly ${SECOND}, in order: none`,
    ],
    [
      'the first truck in the trucks run after it',
      (save) => {
        const decisions = save.decisions as Json
        decisions.trucks = {
          ...(decisions.trucks as Json),
          plateau: (decisions.trucks as Json)[SECOND],
        }
      },
      `trucks must run exactly ${SECOND}, in order: ${SECOND}, plateau`,
    ],
  ])('rejects %s', (_, change, reason) => {
    expect(() => load(edited(WAITING, change))).toThrow(reason)
  })

  it('rejects a truck missing from a game whose rung adds it', () => {
    const text = edited(BOUGHT, (save) => {
      delete save.trucks
    })
    expect(() => load(text)).toThrow(
      'the game has 0 truck(s) after the first, not the 1 the rungs bought add',
    )
  })

  it('rejects a generator drawn from before its first day', () => {
    const text = edited(BOUGHT, (save) => {
      truckOf(save).rngState = 1
    })
    expect(() => load(text)).toThrow(
      'has drawn from its generator before its first day',
    )
  })
})

/** The close of `state`'s day. */
function playDayOf(state: GameState): GameState {
  return playDay(
    state,
    FOOD_TRUCK,
    CUSTOMERS,
    DIFFICULTIES,
    PERSONAL,
    ENERGY,
    DEFIS,
    BAKERY,
    GROCERS,
    STAFF,
    FINANCING,
    DREAM,
    PLACES,
  )
}
