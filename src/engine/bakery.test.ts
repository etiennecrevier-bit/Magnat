import { describe, expect, it } from 'vitest'
import {
  loadBakeryContent,
  type BakeryContent,
  type DifficultyId,
  type EventCard,
  type FinancingContent,
  type OvenTerms,
} from '../content/schema.ts'
import type { AccountCode } from '../finance/accounts.ts'
import {
  balance,
  emptyJournal,
  trialBalance,
  type JournalEntry,
} from '../finance/journal.ts'
import { balanceSheet } from '../finance/statements.ts'
import {
  BAKED,
  BAKERY,
  BAKERY_MEMO,
  bake,
  bakeryMonthlyCosts,
  bakeryMorning,
  closedBakery,
  holdsPremises,
  isBakeryRunning,
  morningBakery,
  runsOn,
  supplyRule,
} from './bakery.ts'
import { endOfMonth, toCalendar } from './calendar.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  playDay,
} from './day.ts'
import { applyDecision, type DecisionChange } from './decisions.ts'
import { NO_EVENTS, conditionsHold } from './events.ts'
import { FINANCING } from './financing.ts'
import { monthlyFixedCosts } from './fixedCosts.ts'
import { inventoryValue } from './inventory.ts'
import { cents } from './money.ts'
import { PERCENTILES } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import { deserialize, serialize } from './save.ts'
import { STAFF } from './staff.ts'
import type { BakeryState, Day, GameState } from './types.ts'

const SEED = 42
const PRICES = DIFFICULTIES.bakery.moyen
const CASH: AccountCode = '1000'
const STOCKS: AccountCode = '1200'

// Day 0 is Monday, May 1st, closed under the starting decisions; day 1 is a
// Tuesday, open. The 1sts of June, July and August are days 31, 61 and 92.
const JUNE_1 = 31
const JULY_1 = 61
const AUGUST_1 = 92
const SEPTEMBER_1 = 123

const MEMO = {
  purchases: 'Achat de marchandises',
  costOfSales: 'Coût des marchandises vendues',
}

const OPEN: Record<OvenTerms, DecisionChange> = {
  louer: { kind: 'openBakery', oven: 'louer' },
  acheter: { kind: 'openBakery', oven: 'acheter' },
}
const CLOSE: DecisionChange = { kind: 'closeBakery' }
const MADE: DecisionChange = { kind: 'croissantSource', source: 'fabriquer' }

/** A plan for a game: the changes the player makes on each day. */
type Plan = Readonly<Record<Day, readonly DecisionChange[]>>

/**
 * A new Moyen game of `SEED`, played up to the morning of `toDay` with the
 * changes of `plan` made on the morning of their day, with the shipped
 * content but `bakery`.
 */
function playTo(
  toDay: Day,
  plan: Plan = {},
  bakery: BakeryContent = BAKERY,
  from: GameState = createInitialState(SEED),
): GameState {
  let state = from
  while (state.day < toDay) {
    for (const change of plan[state.day] ?? []) {
      state = applyDecision(state, change, FOOD_TRUCK, DEFIS, bakery)
    }
    state = tick(
      state,
      FOOD_TRUCK,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      NO_EVENTS,
      DEFIS,
      PERCENTILES,
      bakery,
    )
  }
  return state
}

function entriesOn(state: GameState, day: Day): JournalEntry[] {
  return state.journal.entries.filter((entry) => entry.day === day)
}

function memosOn(state: GameState, day: Day): string[] {
  return entriesOn(state, day).map(({ memo }) => memo)
}

/** The one entry of `day` with `memo`, as debit and credit lines. */
function entry(state: GameState, day: Day, memo: string) {
  const found = entriesOn(state, day).filter((e) => e.memo === memo)
  expect(found, `${memo} on day ${day}`).toHaveLength(1)
  return (found[0] as JournalEntry).lines.map(({ account, debit, credit }) =>
    debit > 0
      ? { debit: account, amount: debit }
      : { credit: account, amount: credit },
  )
}

/** What the day's entry `memo` debits, 0 when there is none. */
function debited(state: GameState, day: Day, memo: string): number {
  return entriesOn(state, day)
    .filter((e) => e.memo === memo)
    .reduce((total, e) => total + (e.lines[0]?.debit ?? 0), 0)
}

function paid(account: AccountCode, amount: number) {
  return [
    { debit: account, amount },
    { credit: CASH, amount },
  ]
}

describe('the bakery content', () => {
  it('ships the bakery Étienne decided', () => {
    expect(BAKERY).toMatchObject({
      oven: {
        priceCents: 2_500_000,
        usefulLifeMonths: 120,
        monthlyLeaseCents: 60_000,
      },
      capacityPerDay: 300,
      movingCostCents: 150_000,
      noticeMonths: 1,
      bakingEnergyCost: 8,
      startingDecisions: {
        croissantSource: 'acheter',
        bake: { kind: 'buyDaily', quantity: 70 },
      },
    })
  })

  it('makes a croissant for less than one costs to buy, at every difficulty', () => {
    const bought = FOOD_TRUCK.products.croissant.unitCostCents
    for (const prices of Object.values(DIFFICULTIES.bakery)) {
      expect(prices.ingredientCostCents).toBeLessThan(bought)
    }
  })
})

describe('closedBakery', () => {
  it('neither runs nor owns an oven', () => {
    const bakery = closedBakery()
    expect(bakery).toEqual({
      openedOnDay: null,
      oven: null,
      closesAfterDay: null,
      ovenBoughtOnDay: null,
    })
    expect(isBakeryRunning(bakery)).toBe(false)
    expect(holdsPremises(bakery, 0)).toBe(false)
    expect(runsOn(bakery, null, 0)).toBe(false)
    expect(runsOn(bakery, { oven: 'louer' }, 0)).toBe(true)
  })
})

describe('opening the bakery', () => {
  it('with a leased oven: the move, the rent and the lease, then both again each 1st', () => {
    const state = playTo(AUGUST_1 + 1, { 0: [OPEN.louer] })
    expect(state.bakery).toEqual({
      openedOnDay: 1,
      oven: 'louer',
      closesAfterDay: null,
      ovenBoughtOnDay: null,
    })
    expect(entry(state, 1, BAKERY_MEMO.moving)).toEqual(
      paid('6900', BAKERY.movingCostCents),
    )
    expect(entry(state, 1, BAKERY_MEMO.rent)).toEqual(
      paid('6100', PRICES.monthlyRentCents),
    )
    expect(entry(state, 1, BAKERY_MEMO.lease)).toEqual(
      paid('6130', BAKERY.oven.monthlyLeaseCents),
    )
    expect(memosOn(state, 1)).not.toContain(BAKERY_MEMO.ovenBought)
    for (const first of [JUNE_1, JULY_1, AUGUST_1]) {
      expect(entry(state, first, BAKERY_MEMO.rent)).toEqual(
        paid('6100', PRICES.monthlyRentCents),
      )
      expect(entry(state, first, BAKERY_MEMO.lease)).toEqual(
        paid('6130', BAKERY.oven.monthlyLeaseCents),
      )
      expect(memosOn(state, first)).not.toContain(BAKERY_MEMO.moving)
    }
    expect(memosOn(state, 2)).not.toContain(BAKERY_MEMO.rent)
  })

  it('with a bought oven: the oven to Équipement, the rent and no lease', () => {
    const state = playTo(JUNE_1 + 1, { 0: [OPEN.acheter] })
    expect(state.bakery).toEqual({
      openedOnDay: 1,
      oven: 'acheter',
      closesAfterDay: null,
      ovenBoughtOnDay: 1,
    })
    expect(memosOn(state, 1)).toEqual(
      expect.arrayContaining([BAKERY_MEMO.moving, BAKERY_MEMO.rent]),
    )
    expect(entry(state, 1, BAKERY_MEMO.ovenBought)).toEqual(
      paid('1500', BAKERY.oven.priceCents),
    )
    expect(memosOn(state, 1)).not.toContain(BAKERY_MEMO.lease)
    expect(memosOn(state, JUNE_1)).not.toContain(BAKERY_MEMO.lease)
    expect(balance(state.journal, '1500', { toDay: JUNE_1 })).toBe(
      FOOD_TRUCK.truck.priceCents + BAKERY.oven.priceCents,
    )
  })

  it('on a 1st pays that month once, in full', () => {
    const state = playTo(JUNE_1 + 1, { [JUNE_1 - 1]: [OPEN.louer] })
    expect(state.bakery.openedOnDay).toBe(JUNE_1)
    expect(entry(state, JUNE_1, BAKERY_MEMO.rent)).toEqual(
      paid('6100', PRICES.monthlyRentCents),
    )
    expect(entry(state, JUNE_1, BAKERY_MEMO.lease)).toEqual(
      paid('6130', BAKERY.oven.monthlyLeaseCents),
    )
  })

  it('reads its rent from the difficulty and its costs from the content', () => {
    const bakery = loadBakeryContent({
      ...BAKERY,
      movingCostCents: 1_234,
      oven: { ...BAKERY.oven, monthlyLeaseCents: 5_678 },
    })
    const state = playTo(2, { 0: [OPEN.louer] }, bakery)
    expect(debited(state, 1, BAKERY_MEMO.moving)).toBe(1_234)
    expect(debited(state, 1, BAKERY_MEMO.lease)).toBe(5_678)
    const hard = DIFFICULTIES.bakery.difficile
    const difficile = playTo(
      2,
      { 0: [OPEN.louer] },
      BAKERY,
      startAs('difficile'),
    )
    expect(debited(difficile, 1, BAKERY_MEMO.rent)).toBe(hard.monthlyRentCents)
  })
})

function startAs(difficulty: DifficultyId): GameState {
  return createInitialState(SEED, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
}

describe('the oven bought', () => {
  // An oven of 10 $ over 3 months: 3,33 $, 3,33 $, then 3,34 $.
  const SMALL = loadBakeryContent({
    ...BAKERY,
    oven: { ...BAKERY.oven, priceCents: 1_000, usefulLifeMonths: 3 },
  })

  it('is depreciated on each 1st after its day, the last month taking the rounding', () => {
    const state = playTo(SEPTEMBER_1 + 1, { 0: [OPEN.acheter] }, SMALL)
    const months = [JUNE_1, JULY_1, AUGUST_1, SEPTEMBER_1].map((day) =>
      debited(state, day, BAKERY_MEMO.depreciation),
    )
    expect(months).toEqual([333, 333, 334, 0])
    expect(entry(state, JUNE_1, BAKERY_MEMO.depreciation)).toEqual([
      { debit: '6400', amount: 333 },
      { credit: '1510', amount: 333 },
    ])
    expect(memosOn(state, 1)).not.toContain(BAKERY_MEMO.depreciation)
  })

  it('bought on a 1st waits for the next 1st', () => {
    const state = playTo(JULY_1 + 1, { [JUNE_1 - 1]: [OPEN.acheter] }, SMALL)
    expect(debited(state, JUNE_1, BAKERY_MEMO.depreciation)).toBe(0)
    expect(debited(state, JULY_1, BAKERY_MEMO.depreciation)).toBe(333)
  })

  it('stays on the books once the bakery closes, and is not bought again', () => {
    const plan: Plan = {
      0: [OPEN.acheter],
      10: [CLOSE],
      70: [OPEN.acheter],
    }
    const state = playTo(AUGUST_1 + 1, plan, SMALL)
    // Under notice from day 11 to June 30th, closed on July 1st, reopened
    // on day 71.
    expect(debited(state, JULY_1, BAKERY_MEMO.rent)).toBe(0)
    expect(debited(state, JULY_1, BAKERY_MEMO.depreciation)).toBe(333)
    expect(memosOn(state, 71)).toContain(BAKERY_MEMO.moving)
    expect(memosOn(state, 71)).not.toContain(BAKERY_MEMO.ovenBought)
    expect(
      state.journal.entries.filter(
        ({ memo }) => memo === BAKERY_MEMO.ovenBought,
      ),
    ).toHaveLength(1)
    expect(state.bakery).toEqual({
      openedOnDay: 71,
      oven: 'acheter',
      closesAfterDay: null,
      ovenBoughtOnDay: 1,
    })
  })
})

describe('closing the bakery', () => {
  it('gives notice to the end of the next month, whose rent is still due', () => {
    const plan: Plan = { 0: [OPEN.louer], 10: [CLOSE] }
    const notice = playTo(12, plan)
    expect(notice.bakery).toEqual({
      openedOnDay: 1,
      oven: 'louer',
      closesAfterDay: endOfMonth(11, 1),
      ovenBoughtOnDay: null,
    })
    expect(notice.bakery.closesAfterDay).toBe(JULY_1 - 1)
    const bakeryMemos: readonly string[] = Object.values(BAKERY_MEMO)
    expect(
      memosOn(notice, 11).filter((memo) => bakeryMemos.includes(memo)),
    ).toEqual([])

    const state = playTo(AUGUST_1 + 1, {}, BAKERY, notice)
    expect(debited(state, JUNE_1, BAKERY_MEMO.rent)).toBe(
      PRICES.monthlyRentCents,
    )
    expect(debited(state, JUNE_1, BAKERY_MEMO.lease)).toBe(
      BAKERY.oven.monthlyLeaseCents,
    )
    for (const first of [JULY_1, AUGUST_1]) {
      expect(debited(state, first, BAKERY_MEMO.rent)).toBe(0)
      expect(debited(state, first, BAKERY_MEMO.lease)).toBe(0)
    }
    expect(state.bakery).toEqual(closedBakery())
  })

  it('runs the bakery to the last day of its notice, and closes it the morning after', () => {
    const plan: Plan = { 0: [OPEN.louer, MADE], 10: [CLOSE] }
    const lastDay = playTo(JULY_1, plan)
    expect(lastDay.bakery.closesAfterDay).toBe(JULY_1 - 1)
    expect(isBakeryRunning(lastDay.bakery)).toBe(true)
    expect(holdsPremises(lastDay.bakery, JULY_1 - 1)).toBe(true)
    expect(holdsPremises(lastDay.bakery, JULY_1)).toBe(false)
    expect(debited(lastDay, JULY_1 - 1, BAKERY_MEMO.ingredients)).toBe(
      70 * PRICES.ingredientCostCents,
    )
    // The morning after, saved before it is played, still holds it.
    expect(deserialize(serialize(lastDay))).toStrictEqual(lastDay)
    const after = playTo(JULY_1 + 1, {}, BAKERY, lastDay)
    expect(after.bakery).toEqual(closedBakery())
    expect(debited(after, JULY_1, BAKERY_MEMO.ingredients)).toBe(0)
    expect(debited(after, JULY_1, MEMO.purchases)).toBeGreaterThan(0)
  })

  it('takes the notice back, at no cost, when planned again before its end', () => {
    const plan: Plan = { 0: [OPEN.louer], 10: [CLOSE], 20: [OPEN.louer] }
    const state = playTo(JULY_1 + 1, plan)
    expect(memosOn(state, 21)).not.toContain(BAKERY_MEMO.moving)
    expect(state.bakery).toEqual({
      openedOnDay: 1,
      oven: 'louer',
      closesAfterDay: null,
      ovenBoughtOnDay: null,
    })
    expect(debited(state, JULY_1, BAKERY_MEMO.rent)).toBe(
      PRICES.monthlyRentCents,
    )
  })

  it('closed and planned again the same day, never gives notice', () => {
    const plan: Plan = { 0: [OPEN.louer], 10: [CLOSE, OPEN.louer] }
    const state = playTo(13, plan)
    expect(state.bakery.closesAfterDay).toBeNull()
    expect(
      state.journal.entries.filter(({ memo }) => memo === BAKERY_MEMO.moving),
    ).toHaveLength(1)
  })
})

describe('the oven terms of a bakery planned again', () => {
  /** The game of `plan` on the morning of `day`, with `changes` made then. */
  function morningOf(
    day: Day,
    plan: Plan,
    ...changes: DecisionChange[]
  ): GameState {
    return changes.reduce(
      (state, change) => applyDecision(state, change),
      playTo(day, plan),
    )
  }

  /**
   * `state` played to the morning of `toDay`, after checking that it loads
   * back as it was and plays on from the save as it does without one.
   */
  function playedOn(state: GameState, toDay: Day): GameState {
    const back = deserialize(serialize(state))
    expect(back).toStrictEqual(state)
    const on = playTo(toDay, {}, BAKERY, state)
    expect(serialize(playTo(toDay, {}, BAKERY, back))).toBe(serialize(on))
    return on
  }

  function moves(state: GameState): number {
    return state.journal.entries.filter(
      ({ memo }) => memo === BAKERY_MEMO.moving,
    ).length
  }

  const OTHER: Record<OvenTerms, [OvenTerms, string]> = {
    louer: ['acheter', 'must stay louer'],
    acheter: ['louer', 'cannot be louer'],
  }

  it.each<OvenTerms>(['louer', 'acheter'])(
    'stay %s on the morning the bakery opens, closed and planned again',
    (oven) => {
      // Planned on day 0, the bakery opens on the morning of day 1.
      const closed = morningOf(1, { 0: [OPEN[oven]] }, CLOSE)
      const [other, reason] = OTHER[oven]
      expect(() => applyDecision(closed, OPEN[other])).toThrow(RangeError)
      expect(() => applyDecision(closed, OPEN[other])).toThrow(reason)

      const state = playedOn(applyDecision(closed, OPEN[oven]), JUNE_1 + 1)
      expect(state.bakery).toEqual({
        openedOnDay: 1,
        oven,
        closesAfterDay: null,
        ovenBoughtOnDay: oven === 'acheter' ? 1 : null,
      })
      expect(moves(state)).toBe(1)
      expect(debited(state, JUNE_1, BAKERY_MEMO.rent)).toBe(
        PRICES.monthlyRentCents,
      )
    },
  )

  it.each<OvenTerms>(['louer', 'acheter'])(
    'stay %s on the morning the bakery opens again, closed and planned again',
    (oven) => {
      // Under notice from day 11 to June 30th, closed on July 1st, planned
      // again on day 70 and open again on day 71.
      const plan: Plan = { 0: [OPEN[oven]], 10: [CLOSE], 70: [OPEN[oven]] }
      const closed = morningOf(71, plan, CLOSE)
      const [other, reason] = OTHER[oven]
      expect(() => applyDecision(closed, OPEN[other])).toThrow(RangeError)
      expect(() => applyDecision(closed, OPEN[other])).toThrow(reason)

      const state = playedOn(applyDecision(closed, OPEN[oven]), AUGUST_1 + 1)
      expect(state.bakery).toEqual({
        openedOnDay: 71,
        oven,
        closesAfterDay: null,
        ovenBoughtOnDay: oven === 'acheter' ? 1 : null,
      })
      expect(moves(state)).toBe(2)
    },
  )

  it('may change from the last day of a notice, for the bakery opened the morning after', () => {
    // Under notice from day 11 to June 30th, the day before July 1st.
    const plan: Plan = { 0: [OPEN.louer], 10: [CLOSE] }
    expect(() => applyDecision(playTo(JULY_1 - 2, plan), OPEN.acheter)).toThrow(
      'must stay louer',
    )

    const lastDay = morningOf(JULY_1 - 1, plan, OPEN.acheter)
    expect(lastDay.bakery.closesAfterDay).toBe(JULY_1 - 1)
    const state = playedOn(lastDay, JULY_1 + 1)
    expect(state.bakery).toEqual({
      openedOnDay: JULY_1,
      oven: 'acheter',
      closesAfterDay: null,
      ovenBoughtOnDay: JULY_1,
    })
    expect(memosOn(state, JULY_1)).toEqual(
      expect.arrayContaining([
        BAKERY_MEMO.moving,
        BAKERY_MEMO.ovenBought,
        BAKERY_MEMO.rent,
      ]),
    )
    expect(debited(state, JULY_1, BAKERY_MEMO.rent)).toBe(
      PRICES.monthlyRentCents,
    )
    expect(debited(state, JULY_1, BAKERY_MEMO.lease)).toBe(0)
  })
})

describe('baking', () => {
  const MADE_PLAN: Plan = { 0: [OPEN.louer, MADE] }
  const BOUGHT_PLAN: Plan = { 0: [OPEN.louer] }

  it('makes the croissants at their ingredients, and buys none', () => {
    const made = playTo(2, MADE_PLAN)
    const bought = playTo(2, BOUGHT_PLAN)
    const croissants = 70
    expect(entry(made, 1, BAKERY_MEMO.ingredients)).toEqual([
      { debit: '1200', amount: croissants * PRICES.ingredientCostCents },
      { credit: CASH, amount: croissants * PRICES.ingredientCostCents },
    ])
    const buy = FOOD_TRUCK.products.croissant.unitCostCents
    expect(
      debited(bought, 1, MEMO.purchases) - debited(made, 1, MEMO.purchases),
    ).toBe(croissants * buy)
    expect(memosOn(bought, 1)).not.toContain(BAKERY_MEMO.ingredients)
    // The same customers buy the same croissants, which cost less.
    expect(made.lastDay?.sold).toEqual(bought.lastDay?.sold)
    const sold = made.lastDay?.sold.croissant ?? 0
    expect(sold).toBeGreaterThan(0)
    expect(
      debited(bought, 1, MEMO.costOfSales) - debited(made, 1, MEMO.costOfSales),
    ).toBe(sold * (buy - PRICES.ingredientCostCents))
  })

  it('follows the bake rule, of either kind', () => {
    const daily = playTo(2, {
      0: [
        OPEN.louer,
        MADE,
        { kind: 'bake', rule: { kind: 'buyDaily', quantity: 120 } },
      ],
    })
    expect(debited(daily, 1, BAKERY_MEMO.ingredients)).toBe(
      120 * PRICES.ingredientCostCents,
    )
    const topUp = playTo(2, {
      0: [
        OPEN.louer,
        MADE,
        { kind: 'bake', rule: { kind: 'topUp', whenBelow: 10, upTo: 90 } },
      ],
    })
    expect(debited(topUp, 1, BAKERY_MEMO.ingredients)).toBe(
      90 * PRICES.ingredientCostCents,
    )
    const none = playTo(2, {
      0: [
        OPEN.louer,
        MADE,
        { kind: 'bake', rule: { kind: 'buyDaily', quantity: 0 } },
      ],
    })
    expect(memosOn(none, 1)).not.toContain(BAKERY_MEMO.ingredients)
    expect(none.lastDay?.sold.croissant).toBe(0)
  })

  it('makes no more than its capacity', () => {
    const lots = [
      { product: BAKED, quantity: 20, unitCost: cents(110), boughtOnDay: 0 },
    ]
    const made = bake(
      emptyJournal(),
      lots,
      1,
      { kind: 'buyDaily', quantity: 1_000 },
      PRICES,
    )
    expect(made.quantity).toBe(BAKERY.capacityPerDay)
    expect(made.lots).toEqual([
      ...lots,
      {
        product: BAKED,
        quantity: BAKERY.capacityPerDay,
        unitCost: PRICES.ingredientCostCents,
        boughtOnDay: 1,
      },
    ])
    expect(balance(made.journal, STOCKS, { toDay: 1 })).toBe(
      BAKERY.capacityPerDay * PRICES.ingredientCostCents,
    )
    const topped = bake(
      emptyJournal(),
      lots,
      1,
      {
        kind: 'topUp',
        whenBelow: 50,
        upTo: 60,
      },
      PRICES,
    )
    expect(topped.quantity).toBe(40)
  })

  it('buys the croissants when they are made but the bakery does not run', () => {
    const state = playTo(2, { 0: [MADE] })
    expect(state.decisions.croissantSource).toBe('fabriquer')
    expect(memosOn(state, 1)).not.toContain(BAKERY_MEMO.ingredients)
    expect(debited(state, 1, MEMO.purchases)).toBe(
      debited(playTo(2), 1, MEMO.purchases),
    )
  })

  it('makes nothing on a closed day', () => {
    // Day 7 is a Monday, closed under the starting decisions.
    const state = playTo(8, MADE_PLAN)
    expect(memosOn(state, 6)).toContain(BAKERY_MEMO.ingredients)
    expect(memosOn(state, 7)).not.toContain(BAKERY_MEMO.ingredients)
  })

  it('makes nothing, and buys none, when the street takes the croissants off sale', () => {
    const morning = playTo(1, MADE_PLAN)
    const offSale: GameState = {
      ...morning,
      events: {
        ...morning.events,
        modifiers: [
          {
            event: 'essai',
            change: { kind: 'unavailable', product: BAKED },
            fromDay: 1,
            lastDay: 1,
          },
        ],
      },
    }
    const state = playTo(2, {}, BAKERY, offSale)
    expect(memosOn(state, 1)).not.toContain(BAKERY_MEMO.ingredients)
    expect(state.lastDay?.sold.croissant).toBe(0)
    expect(debited(state, 1, MEMO.purchases)).toBe(
      debited(playTo(2, MADE_PLAN), 1, MEMO.purchases),
    )
  })

  it('takes the owner a morning of energy', () => {
    const made = playTo(2, MADE_PLAN)
    const bought = playTo(2, BOUGHT_PLAN)
    expect(made.lastDay?.visits).toEqual(bought.lastDay?.visits)
    expect((bought.lastDay?.energy ?? 0) - (made.lastDay?.energy ?? 0)).toBe(
      BAKERY.bakingEnergyCost,
    )
  })
})

describe('the rule that supplies a product', () => {
  const CROISSANT_ON_MENU = {
    id: 'menu',
    conditions: { productOnMenu: 'croissant' },
  } as EventCard
  const NO_BOUGHT: DecisionChange = {
    kind: 'restock',
    product: 'croissant',
    rule: { kind: 'buyDaily', quantity: 0 },
  }
  const NO_BAKED: DecisionChange = {
    kind: 'bake',
    rule: { kind: 'buyDaily', quantity: 0 },
  }

  /** The morning of day 2, with `changes` made on day 0. */
  function morning(...changes: DecisionChange[]): GameState {
    return playTo(2, { 0: changes })
  }

  function onMenu(state: GameState): boolean {
    return conditionsHold(CROISSANT_ON_MENU, state, new Map())
  }

  it('is the bake rule for croissants the running bakery makes', () => {
    const state = morning(OPEN.louer, MADE, NO_BOUGHT)
    expect(supplyRule(state.bakery, state.decisions, state.day, BAKED)).toBe(
      state.decisions.bake,
    )
    expect(onMenu(state)).toBe(true)
    expect(onMenu(morning(OPEN.louer, MADE, NO_BAKED))).toBe(false)
  })

  it('is the restock rule otherwise: bought croissants, or no bakery', () => {
    expect(onMenu(morning(OPEN.louer, NO_BAKED))).toBe(true)
    expect(onMenu(morning(OPEN.louer, NO_BOUGHT))).toBe(false)
    expect(onMenu(morning(MADE, NO_BAKED))).toBe(true)
    expect(onMenu(morning(MADE, NO_BOUGHT))).toBe(false)
    const state = morning(OPEN.louer, MADE)
    expect(supplyRule(state.bakery, state.decisions, state.day, 'cafe')).toBe(
      state.decisions.restock.cafe,
    )
  })

  it('reads the bakery as the morning will run it', () => {
    // Planned on day 0, it opens on day 1: the morning of day 1 already
    // counts on it.
    const planned = playTo(1, { 0: [OPEN.louer, MADE, NO_BOUGHT] })
    expect(isBakeryRunning(planned.bakery)).toBe(false)
    expect(onMenu(planned)).toBe(true)
  })
})

describe('monthlyFixedCosts with the bakery', () => {
  const truck = (day: Day) => monthlyFixedCosts(day, 'moyen')
  const rentAndLease = PRICES.monthlyRentCents + BAKERY.oven.monthlyLeaseCents

  it('adds the rent and the lease of a bakery that holds its premises on the next 1st', () => {
    const leased: BakeryState = {
      openedOnDay: 1,
      oven: 'louer',
      closesAfterDay: null,
      ovenBoughtOnDay: null,
    }
    const costs = (day: Day, bakery: BakeryState) =>
      monthlyFixedCosts(day, 'moyen', 0, FOOD_TRUCK, DIFFICULTIES, bakery)
    expect(costs(5, leased)).toBe(truck(5) + rentAndLease)
    expect(costs(JUNE_1, leased)).toBe(truck(JUNE_1) + rentAndLease)
    const bought = { ...leased, oven: 'acheter', ovenBoughtOnDay: 1 } as const
    expect(costs(5, bought)).toBe(truck(5) + PRICES.monthlyRentCents)
    // Under notice to June 30th: due on June 1st, not on July 1st.
    const notice = { ...leased, closesAfterDay: JULY_1 - 1 }
    expect(costs(20, notice)).toBe(truck(20) + rentAndLease)
    expect(costs(JUNE_1 + 5, notice)).toBe(truck(JUNE_1 + 5))
    expect(costs(5, closedBakery())).toBe(truck(5))
    expect(costs(5, { ...closedBakery(), ovenBoughtOnDay: 1 })).toBe(truck(5))
  })

  it('reads the same as bakeryMonthlyCosts on a 1st', () => {
    const bakery: BakeryState = {
      openedOnDay: 1,
      oven: 'louer',
      closesAfterDay: null,
      ovenBoughtOnDay: null,
    }
    expect(bakeryMonthlyCosts(bakery, JUNE_1, PRICES)).toBe(rentAndLease)
    expect(bakeryMonthlyCosts(bakery, JUNE_1, DIFFICULTIES.bakery.facile)).toBe(
      DIFFICULTIES.bakery.facile.monthlyRentCents +
        BAKERY.oven.monthlyLeaseCents,
    )
  })
})

describe('bakeryMorning', () => {
  it('throws on a plan that gives the running bakery other oven terms', () => {
    const running: BakeryState = {
      openedOnDay: 1,
      oven: 'louer',
      closesAfterDay: null,
      ovenBoughtOnDay: null,
    }
    expect(() =>
      bakeryMorning(emptyJournal(), running, { oven: 'acheter' }, 5, PRICES),
    ).toThrow('runs with its oven louer')
    const owned = { ...closedBakery(), ovenBoughtOnDay: 1 }
    expect(() =>
      bakeryMorning(emptyJournal(), owned, { oven: 'louer' }, 5, PRICES),
    ).toThrow('cannot lease an oven')
  })

  it('leaves the bakery as morningBakery does, which finds it again at the close', () => {
    // The morning the bakery opens, gives notice, takes it back, closes,
    // and opens again with the oven it bought, each played to its close.
    const plan: Plan = {
      0: [OPEN.louer],
      10: [CLOSE],
      20: [OPEN.louer],
      25: [CLOSE],
      70: [OPEN.acheter],
    }
    for (const day of [1, 11, 21, 26, JULY_1, 71]) {
      const morning = playTo(day, plan)
      const closing = playDay(morning)
      const { bakery } = bakeryMorning(
        morning.journal,
        morning.bakery,
        morning.decisions.bakery,
        day,
        PRICES,
      )
      expect(bakery, `day ${day}`).toEqual(closing.bakery)
      expect(
        morningBakery(morning.bakery, morning.decisions.bakery, day),
        `day ${day}`,
      ).toEqual(closing.bakery)
      expect(
        morningBakery(closing.bakery, closing.decisions.bakery, day),
        `day ${day}, at the close`,
      ).toEqual(closing.bakery)
    }
  })

  it('never mutates what it is given', () => {
    const bakery = Object.freeze(closedBakery())
    const journal = emptyJournal()
    const opened = bakeryMorning(journal, bakery, { oven: 'louer' }, 3, PRICES)
    expect(bakery).toEqual(closedBakery())
    expect(journal.entries).toEqual([])
    expect(opened.bakery.openedOnDay).toBe(3)
  })
})

// Two years of play at each difficulty, the bakery opened with a leased
// oven, closed, opened with a bought one, closed and taken back during its
// notice, then closed for good, the croissants made all along, a day saved
// and loaded back each month. The games run far below zero, so no
// bankruptcy ends them (#160).
describe('two years with the bakery', () => {
  const DAYS = 730
  const NO_BANKRUPTCY: FinancingContent = {
    ...FINANCING,
    bankruptcy: { ...FINANCING.bankruptcy, months: Number.MAX_SAFE_INTEGER },
  }
  const PLAN: Plan = {
    0: [
      OPEN.louer,
      MADE,
      { kind: 'bake', rule: { kind: 'buyDaily', quantity: 150 } },
    ],
    120: [CLOSE],
    250: [OPEN.acheter],
    400: [CLOSE],
    410: [OPEN.acheter],
    500: [CLOSE],
  }

  function run(difficulty: DifficultyId) {
    let state = startAs(difficulty)
    const failures: string[] = []
    const fail = (message: string) => {
      if (failures.length < 10) failures.push(message)
    }
    while (state.day < DAYS) {
      for (const change of PLAN[state.day] ?? []) {
        state = applyDecision(state, change)
      }
      state = tick(
        state,
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
        NO_BANKRUPTCY,
      )
      const day = state.day - 1
      const { totalDebit, totalCredit } = trialBalance(state.journal, day)
      if (totalDebit !== totalCredit) {
        fail(`day ${day}: trial balance ${totalDebit} ≠ ${totalCredit}`)
      }
      const sheet = balanceSheet(state.journal, day)
      if (
        sheet.assets.total.amount !== sheet.totalLiabilitiesAndEquity.amount
      ) {
        fail(`day ${day}: the bilan does not balance`)
      }
      const stocks = balance(state.journal, STOCKS, { toDay: day })
      if (stocks !== inventoryValue(state.inventory)) {
        fail(`day ${day}: Stocks ${stocks} ≠ the lots`)
      }
      if (toCalendar(state.day).dayOfMonth === 1) {
        const text = serialize(state)
        if (serialize(deserialize(text)) !== text) {
          fail(`day ${state.day}: the save does not load back as it was`)
        }
      }
    }
    return { state, failures }
  }

  it.each<DifficultyId>(['facile', 'moyen', 'difficile'])(
    'keeps the books balanced and the game deterministic at %s',
    (difficulty) => {
      const { state, failures } = run(difficulty)
      expect(failures).toEqual([])
      const memos = new Set(state.journal.entries.map(({ memo }) => memo))
      for (const memo of Object.values(BAKERY_MEMO)) {
        expect(memos).toContain(memo)
      }
      expect(state.bakery).toEqual({
        ...closedBakery(),
        ovenBoughtOnDay: 251,
      })
      // The same seed and plan post the same entries, in the same order.
      expect(JSON.stringify(run(difficulty).state.journal.entries)).toBe(
        JSON.stringify(state.journal.entries),
      )
    },
  )
})
