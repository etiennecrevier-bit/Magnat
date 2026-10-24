import { describe, expect, it } from 'vitest'
import dreamJson from '../content/dream.json'
import {
  loadDreamContent,
  type DifficultyId,
  type DistrictId,
  type DreamContent,
  type WinterStorage,
} from '../content/schema.ts'
import { entriesOf, type JournalEntry } from '../finance/journal.ts'
import { balanceSheet } from '../finance/statements.ts'
import { BAKERY } from './bakery.ts'
import { toCalendar } from './calendar.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import { NO_CHANGES, serveWalkIns } from './customers.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import { applyDecision, type DecisionChange } from './decisions.ts'
import {
  DISTRICTS,
  defaultWinterStorage,
  districtWalkIns,
  isStored,
  permitOn,
  truckChargesOn,
  withRival,
} from './districts.ts'
import { NO_EVENTS } from './events.ts'
import { FINANCING } from './financing.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { perProduct } from './inventory.ts'
import { cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { PLACES } from './places.ts'
import { defaultProfile } from './profile.ts'
import { seedRng } from './rng.ts'
import { STAFF, askingWage } from './staff.ts'
import { FIRST_TRUCK } from './trucks.ts'
import type { Day, GameState, StreetModifier, Truck } from './types.ts'

// The districts (#260): each its crowd and its seasons, Vieux-Montréal's
// yearly permit and its rival, and « Remiser pour l'hiver ».

const SEED = 42
const SECOND = 'vieuxMontreal'
const PLATEAU = DISTRICTS.districts.plateau
const VIEUX = DISTRICTS.districts.vieuxMontreal
const RIVAL = VIEUX.rival
if (RIVAL === undefined) throw new Error('Vieux-Montréal has a rival')

// Days of the game's first year: day 0 is May 1st.
const DEC_1: Day = 214
const JAN_15: Day = 259
const MARCH_15: Day = 318
const APRIL_1: Day = 335
const APRIL_30: Day = 364
const MAY_1: Day = 365
const JULY_1: Day = 61
const JULY_7: Day = 67

const PERMIT_MEMO = 'Permis annuel · Vieux-Montréal'
const INSURANCE_MEMO = 'Assurances'
const FUEL_MEMO = 'Carburant et entretien'
const SALES_MEMO = 'Ventes au comptant'
const DEPRECIATION_MEMO = 'Amortissement · Deuxième camion'
const WINTER: WinterStorage = {
  from: { month: 12, day: 1 },
  to: { month: 4, day: 30 },
}

/**
 * « Le rêve » with « Deuxième camion » for sale first in its ladder, at a
 * price a game can pay on day 0; the shipped one sells it last.
 */
const DREAM: DreamContent = loadDreamContent({
  ...dreamJson,
  company: [
    { ...dreamJson.company[2], priceCents: 500_000 },
    dreamJson.company[0],
    dreamJson.company[1],
  ],
})

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

/**
 * A game of `difficulty` with the second truck bought on day 0 and Kevin «
 * Au camion » there, the owner at the first, with `changes` made too.
 */
function twoTrucks(
  difficulty: DifficultyId = 'moyen',
  ...changes: readonly DecisionChange[]
): GameState {
  return [
    { kind: 'buy', rung: 'deuxiemeCamion' },
    {
      kind: 'hire',
      role: 'camion',
      candidate: 'kevin',
      hourlyWage: askingWage('kevin', 'camion'),
    },
    { kind: 'assign', candidate: 'kevin', truck: SECOND },
    ...changes,
  ].reduce<GameState>(
    (game, change) => decide(game, change as DecisionChange),
    createInitialState(SEED, FOOD_TRUCK, { ...defaultProfile(), difficulty }),
  )
}

/** Each close of `days` days from `state`. */
function played(state: GameState, days: number): GameState[] {
  const closes: GameState[] = []
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
    closes.push(game)
  }
  return closes
}

/** The entries of `state` with `memo`, on `day` if given. */
function withMemo(state: GameState, memo: string, day?: Day): JournalEntry[] {
  return entriesOf(state.journal).filter(
    (entry) => entry.memo === memo && (day === undefined || entry.day === day),
  )
}

/** The entries of `state` on `day` with a line naming the truck `id`. */
function truckEntries(state: GameState, id: string, day: Day): JournalEntry[] {
  return entriesOf(state.journal).filter(
    (entry) =>
      entry.day === day && entry.lines.some((line) => line.truck === id),
  )
}

/** The days from `from` to `to`, both included. */
function daysFrom(from: Day, to: Day): Day[] {
  return Array.from({ length: to - from + 1 }, (_, n) => from + n)
}

/**
 * The visits of a weekday in `district` in `month`, seeded `SEED`, served
 * at once with plenty on hand.
 */
function served(district: 'plateau' | 'vieuxMontreal', month: number) {
  return serveWalkIns(
    seedRng(SEED),
    districtWalkIns(district, month, FOOD_TRUCK.walkIns),
    'semaine',
    CUSTOMERS,
    () => cents(300),
    perProduct(() => 10_000),
    {
      service: { ...FOOD_TRUCK.service, baseSeconds: 0, perItemSeconds: 0 },
      servers: [{ speed: 1, owner: true, botchedShare: 0, who: 'owner' }],
    },
  ).visits
}

describe('districtWalkIns', () => {
  it("keeps the Plateau's crowd as it is every month", () => {
    for (let month = 1; month <= 12; month += 1) {
      const walkIns = districtWalkIns('plateau', month, FOOD_TRUCK.walkIns)
      expect(walkIns.dayTypes).toBe(PLATEAU.dayTypes)
      expect(walkIns).toMatchObject(FOOD_TRUCK.walkIns)
    }
  })

  it("multiplies Vieux-Montréal's customers by each month's factor", () => {
    for (let month = 1; month <= 12; month += 1) {
      const factor = VIEUX.monthlyWalkIns[month - 1] ?? NaN
      const { dayTypes } = districtWalkIns(
        'vieuxMontreal',
        month,
        FOOD_TRUCK.walkIns,
      )
      expect(dayTypes.semaine.customers).toBeCloseTo(
        VIEUX.dayTypes.semaine.customers * factor,
        9,
      )
      expect(dayTypes.finDeSemaine.customers).toBeCloseTo(
        VIEUX.dayTypes.finDeSemaine.customers * factor,
        9,
      )
    }
  })

  it('brings far more customers to Vieux-Montréal in July than in January, and the Plateau the same', () => {
    const plateau = served('plateau', 1)
    for (let month = 2; month <= 12; month += 1) {
      expect(served('plateau', month)).toEqual(plateau)
    }
    const january = served('vieuxMontreal', 1).length
    expect(january).toBeGreaterThan(0)
    expect(served('vieuxMontreal', 7).length).toBeGreaterThan(january * 10)
  })

  it('throws a RangeError for a month that is not one', () => {
    expect(() => districtWalkIns('plateau', 13, FOOD_TRUCK.walkIns)).toThrow(
      RangeError,
    )
  })
})

describe('the tourists', () => {
  it('come to Vieux-Montréal mostly from 11 h, never in its first hour and a half', () => {
    const visits = served('vieuxMontreal', 7)
    const tourists = visits.filter(({ segment }) => segment === 'touriste')
    expect(tourists.length).toBeGreaterThan(100)
    const minutes = tourists.map(({ arrivalMinute }) => arrivalMinute)
    expect(Math.min(...minutes)).toBeGreaterThanOrEqual(8 * 60 + 30)
    const fromEleven = minutes.filter((minute) => minute >= 11 * 60)
    expect(fromEleven.length / minutes.length).toBeGreaterThan(0.75)
    // The others still come when the day type's crowd does.
    const others = visits.filter(({ segment }) => segment !== 'touriste')
    expect(
      Math.min(...others.map(({ arrivalMinute }) => arrivalMinute)),
    ).toBeLessThan(8 * 60)
  })

  it('never come to the Plateau', () => {
    for (const dayType of ['semaine', 'finDeSemaine'] as const) {
      expect(PLATEAU.dayTypes[dayType].segmentShares.touriste).toBe(0)
    }
  })
})

describe('withRival', () => {
  it('takes its share of the tourists in June, July and August only', () => {
    for (let month = 1; month <= 12; month += 1) {
      const changes = withRival(NO_CHANGES, 'vieuxMontreal', month)
      const summer = RIVAL.months.includes(month)
      expect(changes.walkIns).toEqual({
        ...NO_CHANGES.walkIns,
        touriste: summer ? RIVAL.walkInsFactor : 1,
      })
      if (!summer) expect(changes).toBe(NO_CHANGES)
    }
    expect(RIVAL.months).toEqual([6, 7, 8])
    expect(RIVAL.walkInsFactor).toBeLessThan(1)
  })

  it('leaves the Plateau, which has none, as it is', () => {
    for (let month = 1; month <= 12; month += 1) {
      expect(withRival(NO_CHANGES, 'plateau', month)).toBe(NO_CHANGES)
    }
  })

  it('leaves Vieux-Montréal about three times the Plateau in summer', () => {
    const { segmentShares } = VIEUX.dayTypes.semaine
    const summer =
      (VIEUX.monthlyWalkIns[6] ?? NaN) *
      (1 - segmentShares.touriste * (1 - RIVAL.walkInsFactor))
    expect(summer).toBeGreaterThan(2.5)
    expect(summer).toBeLessThan(3.5)
  })
})

describe('permitOn', () => {
  it('takes the Plateau its monthly permit on each 1st, and nothing on other days', () => {
    expect(PLATEAU.permit).toEqual({ kind: 'monthly', monthlyCents: 150_000 })
    expect(permitOn('plateau', 0, 'moyen', DIFFICULTIES)).toBe(150_000)
    expect(permitOn('plateau', APRIL_1, 'moyen', DIFFICULTIES)).toBe(150_000)
    expect(permitOn('plateau', 1, 'moyen', DIFFICULTIES)).toBe(0)
  })

  it.each([
    ['facile', 400_000],
    ['moyen', 480_000],
    ['difficile', 560_000],
  ] as const)(
    "takes Vieux-Montréal %s's yearly permit on April 1st alone",
    (difficulty, amount) => {
      expect(DIFFICULTIES.districtPermits[difficulty].vieuxMontreal).toBe(
        amount,
      )
      for (const day of daysFrom(0, 2 * MAY_1)) {
        const { month, dayOfMonth } = toCalendar(day)
        expect(permitOn('vieuxMontreal', day, difficulty, DIFFICULTIES)).toBe(
          month === 4 && dayOfMonth === 1 ? amount : 0,
        )
      }
    },
  )
})

describe('truckChargesOn', () => {
  const vieux = (
    boughtOnDay: Day,
  ): Pick<Truck, 'id' | 'district' | 'boughtOnDay'> => ({
    id: SECOND,
    district: 'vieuxMontreal',
    boughtOnDay,
  })
  const charges = (day: Day, boughtOnDay = 0) =>
    truckChargesOn([vieux(boughtOnDay)], day, 'moyen', FOOD_TRUCK, DIFFICULTIES)
  const insurance = (day: Day): JournalEntry => ({
    day,
    memo: INSURANCE_MEMO,
    lines: [
      {
        account: '6150',
        debit: cents(25_000),
        credit: cents(0),
        truck: SECOND,
      },
      { account: '1000', debit: cents(0), credit: cents(25_000) },
    ],
  })

  it('charges a later truck its insurance on each 1st, naming it', () => {
    expect(charges(JULY_1)).toEqual([insurance(JULY_1)])
    expect(charges(JULY_1 + 1)).toEqual([])
  })

  it('charges the yearly permit before the insurance on April 1st', () => {
    expect(charges(APRIL_1)).toEqual([
      {
        day: APRIL_1,
        memo: PERMIT_MEMO,
        lines: [
          {
            account: '6100',
            debit: cents(480_000),
            credit: cents(0),
            truck: SECOND,
          },
          { account: '1000', debit: cents(0), credit: cents(480_000) },
        ],
      },
      insurance(APRIL_1),
    ])
  })

  it('charges nothing for a truck not bought yet', () => {
    expect(charges(APRIL_1, APRIL_1 + 1)).toEqual([])
    expect(charges(APRIL_1, APRIL_1)).toHaveLength(2)
  })
})

describe('monthlyFixedCosts', () => {
  const fixed = (
    day: Day,
    trucks: readonly Pick<Truck, 'id' | 'district' | 'boughtOnDay'>[],
  ) =>
    monthlyFixedCosts(
      day,
      'facile',
      0,
      FOOD_TRUCK,
      DIFFICULTIES,
      undefined,
      BAKERY,
      null,
      DISTRICTS,
      trucks,
    )
  const second = [
    { id: SECOND, district: 'vieuxMontreal' as const, boughtOnDay: 0 },
  ]

  it('counts the second truck’s insurance every month and its permit in March', () => {
    const plateau = 150_000 + 25_000
    expect(fixed(JULY_7, [])).toBe(plateau)
    expect(fixed(JULY_7, second)).toBe(plateau + 25_000)
    expect(fixed(MARCH_15, second)).toBe(plateau + 25_000 + 400_000)
    expect(fixed(APRIL_1, second)).toBe(plateau + 25_000 + 400_000)
    expect(fixed(APRIL_1 + 1, second)).toBe(plateau + 25_000)
  })
})

describe('isStored', () => {
  it('stores from December 1st to April 30th, both included, over the year’s end', () => {
    expect(defaultWinterStorage()).toEqual(WINTER)
    const stored = (day: Day) => isStored(WINTER, day)
    expect(stored(DEC_1 - 1)).toBe(false)
    expect(stored(DEC_1)).toBe(true)
    expect(stored(JAN_15)).toBe(true)
    expect(stored(APRIL_30)).toBe(true)
    expect(stored(MAY_1)).toBe(false)
    expect(stored(MAY_1 + DEC_1)).toBe(true)
  })

  it('stores within one year when the end comes after the start, and on a single day', () => {
    const summer: WinterStorage = {
      from: { month: 7, day: 1 },
      to: { month: 7, day: 31 },
    }
    expect(isStored(summer, JULY_1 - 1)).toBe(false)
    expect(isStored(summer, JULY_1)).toBe(true)
    expect(isStored(summer, JULY_1 + 30)).toBe(true)
    expect(isStored(summer, JULY_1 + 31)).toBe(false)
    const once = { from: { month: 7, day: 7 }, to: { month: 7, day: 7 } }
    expect(daysFrom(0, MAY_1).filter((day) => isStored(once, day))).toEqual([
      JULY_7,
    ])
  })

  it('never stores without storage', () => {
    expect(isStored(undefined, JAN_15)).toBe(false)
  })

  it('gives a copy of the default each time', () => {
    const storage = defaultWinterStorage()
    expect(storage).not.toBe(DISTRICTS.winterStorage)
    expect(storage.from).not.toBe(DISTRICTS.winterStorage.from)
  })
})

describe('the storage decision', () => {
  it('stores the truck it names from the next morning, and no more when null', () => {
    const game = twoTrucks()
    const stored = decide(game, {
      kind: 'storage',
      truck: SECOND,
      storage: WINTER,
    })
    expect(stored.pendingDecisions?.trucks?.[SECOND]?.storage).toEqual(WINTER)
    expect(stored.decisions.trucks?.[SECOND]?.storage).toBeUndefined()
    const first = decide(stored, { kind: 'storage', storage: WINTER })
    expect(first.pendingDecisions?.storage).toEqual(WINTER)
    // Last of the decisions, as a save holds them.
    expect(Object.keys(first.pendingDecisions ?? {}).at(-1)).toBe('storage')
    const none = decide(first, {
      kind: 'storage',
      truck: SECOND,
      storage: null,
    })
    expect(none.pendingDecisions?.trucks?.[SECOND]).not.toHaveProperty(
      'storage',
    )
    expect(none.pendingDecisions?.storage).toEqual(WINTER)
  })

  it.each([
    { from: { month: 2, day: 30 }, to: { month: 4, day: 30 } },
    { from: { month: 12, day: 1 }, to: { month: 13, day: 1 } },
    { from: { month: 12, day: 0 }, to: { month: 4, day: 30 } },
    { from: { month: 12, day: 1.5 }, to: { month: 4, day: 30 } },
  ])('rejects storage between days no year has: %j', (storage) => {
    expect(() =>
      decide(twoTrucks(), { kind: 'storage', truck: SECOND, storage }),
    ).toThrow(/^Invalid decision: trucks\.vieuxMontreal\.storage/)
    expect(() => decide(twoTrucks(), { kind: 'storage', storage })).toThrow(
      /^Invalid decision: storage/,
    )
  })

  it('rejects a truck the game does not have', () => {
    expect(() =>
      decide(createInitialState(SEED), {
        kind: 'storage',
        truck: SECOND,
        storage: WINTER,
      }),
    ).toThrow(RangeError)
  })

  it('gives a truck bought later no storage, whatever the first truck’s', () => {
    const game = decide(createInitialState(SEED), {
      kind: 'storage',
      storage: WINTER,
    })
    const bought = decide(game, { kind: 'buy', rung: 'deuxiemeCamion' })
    expect(bought.pendingDecisions?.storage).toEqual(WINTER)
    expect(bought.pendingDecisions?.trucks?.[SECOND]).not.toHaveProperty(
      'storage',
    )
  })
})

describe('a year with a truck in Vieux-Montréal', () => {
  // Day 0 to May 7th of year 2, through the winter and April 1st.
  const DAYS = MAY_1 + 7
  const stored = played(
    twoTrucks('moyen', { kind: 'storage', truck: SECOND, storage: WINTER }),
    DAYS,
  )
  const open = played(twoTrucks('moyen'), DAYS)
  const end = (closes: readonly GameState[]) => closes.at(-1) as GameState
  /** The close of `day` in `closes`. */
  const closeOf = (closes: readonly GameState[], day: Day) =>
    closes[day] as GameState

  it('balances its books every day, stored or not', () => {
    for (const closes of [stored, open]) {
      for (const [day, state] of closes.entries()) {
        const sheet = balanceSheet(state.journal, day)
        expect(sheet.assets.total.amount, `day ${day}`).toBe(
          sheet.totalLiabilitiesAndEquity.amount,
        )
      }
      expect(end(closes).ended).toBeNull()
    }
  })

  it('sells nothing, burns no fuel and needs nobody while stored', () => {
    const state = end(stored)
    for (const day of daysFrom(DEC_1, APRIL_30)) {
      const memos = truckEntries(state, SECOND, day).map(({ memo }) => memo)
      expect(memos, `day ${day}`).not.toContain(SALES_MEMO)
      expect(memos, `day ${day}`).not.toContain(FUEL_MEMO)
      const close = closeOf(stored, day)
      const truck = close.trucks?.find(({ id }) => id === SECOND)
      expect(truck?.lastDay?.open, `day ${day}`).toBe(false)
      expect(truck?.lastDay?.visits).toEqual([])
      expect(close.lastDay?.absent ?? []).not.toContain('kevin')
    }
    // It opens again in May.
    expect(
      daysFrom(MAY_1, DAYS - 1).flatMap((day) =>
        withMemo(state, SALES_MEMO, day).filter(({ lines }) =>
          lines.some(({ truck }) => truck === SECOND),
        ),
      ).length,
    ).toBeGreaterThan(0)
  })

  it('keeps paying its depreciation, its insurance and its permit while stored', () => {
    const state = end(stored)
    for (const day of daysFrom(DEC_1, APRIL_30)) {
      if (toCalendar(day).dayOfMonth !== 1) continue
      const memos = truckEntries(state, SECOND, day).map(({ memo }) => memo)
      expect(memos, `day ${day}`).toContain(INSURANCE_MEMO)
      expect(memos, `day ${day}`).toContain(DEPRECIATION_MEMO)
    }
    expect(withMemo(state, PERMIT_MEMO)).toEqual([
      expect.objectContaining({ day: APRIL_1 }),
    ])
  })

  it('pays the same permit open, and its insurance every 1st from the day it came', () => {
    const state = end(open)
    expect(withMemo(state, PERMIT_MEMO)).toEqual(
      withMemo(end(stored), PERMIT_MEMO),
    )
    const firsts = daysFrom(0, DAYS - 1).filter(
      (day) => toCalendar(day).dayOfMonth === 1,
    )
    expect(
      withMemo(state, INSURANCE_MEMO)
        .filter(({ lines }) => lines.some(({ truck }) => truck === SECOND))
        .map(({ day }) => day),
    ).toEqual(firsts)
    // The first truck pays its own permit, the Plateau's, every 1st.
    expect(
      withMemo(state, 'Permis, stationnement et cuisine').map(({ day }) => day),
    ).toEqual(firsts)
  })

  it('still sells in winter when left open, if far less than in summer', () => {
    const state = end(open)
    const sales = (from: Day, to: Day) =>
      daysFrom(from, to).reduce(
        (total, day) =>
          total +
          truckEntries(state, SECOND, day)
            .filter(({ memo }) => memo === SALES_MEMO)
            .reduce((sum, { lines }) => sum + (lines[0]?.debit ?? 0), 0),
        0,
      )
    const january = sales(JAN_15 - 14, JAN_15 + 16)
    const july = sales(JULY_1, JULY_1 + 30)
    expect(january).toBeGreaterThan(0)
    expect(july).toBeGreaterThan(january * 5)
  })

  it('stores the first truck, its Plateau sales stopping, when it is the one stored', () => {
    const closes = played(
      decide(createInitialState(SEED), {
        kind: 'storage',
        storage: { from: { month: 5, day: 2 }, to: { month: 5, day: 8 } },
      }),
      10,
    )
    const state = end(closes)
    // May 2nd to 8th are days 1 to 7; May 9th, day 8, is a Tuesday.
    for (const day of daysFrom(1, 7)) {
      expect(withMemo(state, SALES_MEMO, day), `day ${day}`).toEqual([])
      expect(closeOf(closes, day).lastDay?.visits).toEqual([])
    }
    expect(withMemo(state, SALES_MEMO, 8)).toHaveLength(1)
    expect(truckEntries(state, FIRST_TRUCK, 8).length).toBeGreaterThan(1)
  })
})

describe("a card's changes to the street, by district (#262)", () => {
  // Day 2, a Wednesday in May: Kevin opens the Vieux-Montréal, the owner
  // the Plateau.
  const end = (closes: readonly GameState[]) => closes.at(-1) as GameState
  const morning = end(played(twoTrucks('moyen'), 2))
  /** The close of `morning` with `change` in effect that day, for `district`. */
  const closeWith = (
    change: StreetModifier['change'],
    district?: DistrictId,
  ): GameState => {
    const modifier: StreetModifier = {
      event: 'b',
      change,
      fromDay: morning.day,
      lastDay: morning.day,
      ...(district === undefined ? {} : { district }),
    }
    return end(
      played(
        { ...morning, events: { ...morning.events, modifiers: [modifier] } },
        1,
      ),
    )
  }
  const plain = end(played(morning, 1))
  const second = (state: GameState) =>
    state.trucks?.find(({ id }) => id === SECOND)?.lastDay
  const first = (state: GameState) => state.lastDay

  it('opens both trucks on the plain day', () => {
    expect(first(plain)?.visits.length).toBeGreaterThan(0)
    expect(second(plain)?.visits.length).toBeGreaterThan(0)
  })

  it("closes the Vieux-Montréal's truck alone for its district", () => {
    const closed = closeWith({ kind: 'closed' }, SECOND)
    expect(second(closed)?.open).toBe(false)
    expect(second(closed)?.visits).toEqual([])
    expect(first(closed)?.visits).toEqual(first(plain)?.visits)
    expect(first(closed)?.revenue).toBe(first(plain)?.revenue)
  })

  it("brings more customers to the Vieux-Montréal's truck alone for its district", () => {
    const crowded = closeWith({ kind: 'walkIns', factor: 2 }, SECOND)
    expect(second(crowded)?.visits.length).toBeGreaterThan(
      second(plain)?.visits.length ?? 0,
    )
    expect(first(crowded)?.visits).toEqual(first(plain)?.visits)
  })

  it('changes the first truck alone for no district, or the Plateau', () => {
    for (const district of [undefined, 'plateau'] as const) {
      const closed = closeWith({ kind: 'closed' }, district)
      expect(first(closed)?.visits, district).toEqual([])
      expect(second(closed)?.visits, district).toEqual(second(plain)?.visits)
    }
  })
})
