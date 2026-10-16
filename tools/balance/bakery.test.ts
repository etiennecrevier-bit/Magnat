import { describe, expect, it } from 'vitest'
import { BAKERY, BAKERY_MEMO } from '../../src/engine/bakery.ts'
import { DIFFICULTIES, FOOD_TRUCK } from '../../src/engine/day.ts'
import { cents, type Cents } from '../../src/engine/money.ts'
import type { Day, GameState } from '../../src/engine/types.ts'
import { balance } from '../../src/finance/journal.ts'
import { STAFF } from '../../src/engine/staff.ts'
import {
  AT_TRUCK_HIRE,
  BAKER_HIRE,
  OVENS,
  PRICE_SETS,
  TRUCK_STRATEGIES,
  bakeryChanges,
  breakEvenPerOpenDay,
  monthEnds,
  monthlyBakerWage,
  monthlyBakeryCosts,
  monthlyResult,
  openDaysPerMonth,
  paybackMonth,
  playBakeryGame,
  runBakery,
  savingPerCroissant,
  truckChanges,
  truckStrategy,
  withPrices,
} from './bakery.ts'

const [LOW, MID, HIGH] = PRICE_SETS
const BAKERY_PRICES = DIFFICULTIES.bakery.moyen
const START = truckStrategy('start')
// The 1st of June is day 31; day 1, a Tuesday, is the first day open.
const JUNE_1 = 31

function amounts(values: readonly number[]): Cents[] {
  return values.map((value) => cents(value))
}

/** What the entries of `day` with `memo` debit, together. */
function debited(state: GameState, day: Day, memo: string): number {
  return state.journal.entries
    .filter((entry) => entry.day === day && entry.memo === memo)
    .reduce((total, { lines }) => total + (lines[0]?.debit ?? 0), 0)
}

describe('the grid', () => {
  it("tries #157's three price sets, both ovens and six trucks, two with two contracts and two with an employee at the truck", () => {
    expect(
      PRICE_SETS.map(({ name, prices }) => [
        name,
        prices.ingredientCostCents,
        prices.monthlyRentCents,
      ]),
    ).toEqual([
      ['low', 45, 200_000],
      ['mid', 55, 240_000],
      ['high', 65, 280_000],
    ])
    expect(OVENS).toEqual(['louer', 'acheter'])
    expect(
      TRUCK_STRATEGIES.map(({ croissantsPerDay, contracts, atTruck }) => [
        croissantsPerDay,
        contracts,
        atTruck,
      ]),
    ).toEqual([
      [70, [], false],
      [110, [], false],
      [150, [], false],
      [150, ['marcheBioLogique', 'chezNormand'], false],
      [110, [], true],
      [150, ['marcheBioLogique', 'chezNormand'], true],
    ])
    expect(() => truckStrategy('lazy')).toThrow(
      'No truck strategy is named lazy',
    )
  })

  it('makes in the bakery game the croissants its twin buys, with a baker', () => {
    const busy = truckStrategy('busy')
    expect(truckChanges(busy)).toEqual([
      { kind: 'price', product: 'croissant', price: 300 },
      {
        kind: 'restock',
        product: 'croissant',
        rule: { kind: 'buyDaily', quantity: 110 },
      },
      { kind: 'marketingDaily', budget: 8_000 },
    ])
    expect(bakeryChanges(busy, 'acheter')).toEqual([
      ...truckChanges(busy),
      { kind: 'openBakery', oven: 'acheter' },
      { kind: 'croissantSource', source: 'fabriquer' },
      { kind: 'bake', rule: { kind: 'buyDaily', quantity: 110 } },
      { kind: 'hire', role: 'boulanger', candidate: 'sophie' },
    ])
    // An employee at the truck, in the game and its twin alike.
    const helped = truckStrategy('busy, employee at the truck')
    expect(truckChanges(helped)).toEqual([
      ...truckChanges(busy),
      { kind: 'hire', role: 'camion', candidate: 'amelie' },
    ])
    expect(bakeryChanges(helped, 'louer')).toEqual([
      ...truckChanges(helped),
      { kind: 'openBakery', oven: 'louer' },
      { kind: 'croissantSource', source: 'fabriquer' },
      { kind: 'bake', rule: { kind: 'buyDaily', quantity: 110 } },
      BAKER_HIRE,
    ])
    expect(AT_TRUCK_HIRE.role).toBe('camion')
    expect(truckChanges(START)[0]).toEqual({
      kind: 'price',
      product: 'croissant',
      price: FOOD_TRUCK.startingDecisions.pricesCents.croissant,
    })
  })

  it('sets the prices at every difficulty, and nothing else', () => {
    const prices = LOW?.prices ?? DIFFICULTIES.bakery.moyen
    const changed = withPrices(prices)
    expect(changed.bakery).toEqual({
      facile: prices,
      moyen: prices,
      difficile: prices,
    })
    expect(changed.difficulties).toBe(DIFFICULTIES.difficulties)
  })
})

describe('monthEnds', () => {
  it('is the last day of each month from May 1st', () => {
    expect(monthEnds(3)).toEqual([30, 60, 91])
    expect(monthEnds(24).at(-1)).toBe(729)
  })
})

describe('paybackMonth', () => {
  it.each<[string, number[], number[], number | null]>([
    ['ahead from the first month', [5, 6, 7], [1, 2, 3], 1],
    ['ahead from the second month', [0, 3, 4], [1, 2, 3], 2],
    ['level counts as ahead', [1, 2, 3], [1, 2, 3], 1],
    ['ahead, behind, then ahead for good', [5, 1, 9], [1, 2, 3], 3],
    ['behind at the end', [5, 6, 2], [1, 2, 3], null],
    ['behind all along', [0, 0, 0], [1, 2, 3], null],
    ['one month, ahead', [3], [3], 1],
  ])('is right %s', (_, bakery, twin, month) => {
    expect(paybackMonth(amounts(bakery), amounts(twin))).toBe(month)
  })

  it('throws on months of different lengths, or none', () => {
    expect(() => paybackMonth(amounts([1, 2]), amounts([1]))).toThrow(
      RangeError,
    )
    expect(() => paybackMonth([], [])).toThrow(RangeError)
  })
})

describe('the books of the bakery', () => {
  const mid = MID?.prices ?? DIFFICULTIES.bakery.moyen
  const high = HIGH?.prices ?? DIFFICULTIES.bakery.moyen

  it('saves what a croissant bought costs less its ingredients', () => {
    expect(savingPerCroissant(mid)).toBe(110 - 55)
  })

  it("pays the baker a week's wage each week: 22 $ × 30 h, in an average month", () => {
    expect(STAFF.roles.boulanger.hourlyWageCents.start).toBe(2_200)
    expect(monthlyBakerWage()).toBeCloseTo((2_200 * 30 * 365) / 12 / 7, 9)
  })

  it("costs the rent and the lease, or the month of depreciation, and the baker's wages", () => {
    const baker = monthlyBakerWage()
    expect(monthlyBakeryCosts(mid, 'louer')).toBeCloseTo(
      240_000 + 60_000 + baker,
      9,
    )
    expect(monthlyBakeryCosts(mid, 'acheter')).toBeCloseTo(
      240_000 + BAKERY.oven.priceCents / BAKERY.oven.usefulLifeMonths + baker,
      9,
    )
  })

  it('breaks even where the savings meet the costs', () => {
    expect(openDaysPerMonth(7)).toBeCloseTo(365 / 12, 9)
    const perDay = breakEvenPerOpenDay(mid, 'louer', 6)
    expect(perDay).toBeCloseTo(409.2, 1)
    expect(monthlyResult(mid, 'louer', perDay, 6)).toBeCloseTo(0, 6)
    expect(monthlyResult(mid, 'louer', 80, 6)).toBeLessThan(0)
    expect(breakEvenPerOpenDay(high, 'louer', 6)).toBeGreaterThan(perDay)
    expect(breakEvenPerOpenDay(mid, 'acheter', 6)).toBeLessThan(perDay)
  })
})

describe('playBakeryGame', () => {
  it('plays each price set every day, the opening rent, the next one and the ingredients', () => {
    const play = (prices: (typeof PRICE_SETS)[number]['prices']) =>
      playBakeryGame(
        1,
        'moyen',
        bakeryChanges(START, 'louer'),
        withPrices(prices),
        2,
      ).state
    for (const { prices } of PRICE_SETS) {
      const state = play(prices)
      expect(debited(state, 0, BAKERY_MEMO.rent)).toBe(prices.monthlyRentCents)
      expect(debited(state, JUNE_1, BAKERY_MEMO.rent)).toBe(
        prices.monthlyRentCents,
      )
      expect(debited(state, 1, BAKERY_MEMO.ingredients)).toBe(
        70 * prices.ingredientCostCents,
      )
    }
  })

  it('hires the baker on day 0 in the bakery game only, and the employee at the truck in both', () => {
    const strategy = truckStrategy('busy, employee at the truck')
    const play = (bakery: boolean) =>
      playBakeryGame(
        1,
        'moyen',
        bakery ? bakeryChanges(strategy, 'louer') : truckChanges(strategy),
        DIFFICULTIES,
        1,
      ).state
    expect(
      play(true).staff.map(({ role, hiredOnDay }) => [role, hiredOnDay]),
    ).toEqual([
      ['camion', 0],
      ['boulanger', 0],
    ])
    expect(play(false).staff.map(({ role }) => role)).toEqual(['camion'])
    expect(
      playBakeryGame(1, 'moyen', truckChanges(START), DIFFICULTIES, 1).state
        .staff,
    ).toEqual([])
  })

  it('sums the game up: cash at each month end, open days, croissants and energy', () => {
    const { game, state } = playBakeryGame(
      1,
      'moyen',
      bakeryChanges(START, 'louer'),
      DIFFICULTIES,
      2,
    )
    expect(game.cashAtMonthEnds).toEqual(
      monthEnds(2).map((day) => balance(state.journal, '1000', { toDay: day })),
    )
    // May 1st to June 30th, closed on Mondays: 61 days, 9 of them Mondays.
    expect(game.openDays).toBe(52)
    expect(game.croissantsMade).toBe(70 * game.openDays)
    expect(game.croissantsSold).toBeGreaterThan(0)
    expect(game.croissantsSold).toBeLessThanOrEqual(game.croissantsMade)
    expect(game.energyAtOpenCloses).toBeGreaterThan(0)
    expect(game.energyAtOpenCloses).toBeLessThanOrEqual(100 * game.openDays)
  })

  it('signs the contracts on day 0, renews them as they end, and makes their croissants only in the bakery game', () => {
    const strategy = truckStrategy('150 a day, 2 contracts')
    const months = 4
    const play = (bakery: boolean) =>
      playBakeryGame(
        1,
        'moyen',
        bakery ? bakeryChanges(strategy, 'louer') : truckChanges(strategy),
        withPrices(MID?.prices ?? BAKERY_PRICES),
        months,
        strategy.contracts,
      ).state
    const baked = play(true)
    const twin = play(false)
    for (const state of [baked, twin]) {
      // Twelve weeks, then renewed: Mondays from day 7 to August's end.
      const days = [
        ...new Set(state.contracts.deliveries.map(({ day }) => day)),
      ]
      expect(days).toEqual(
        Array.from({ length: 17 }, (_, week) => 7 * (week + 1)),
      )
      expect(
        state.events.history.map(({ event, choice }) => [event, choice]),
      ).toEqual([
        ['renouvellementBioLogique', 'accepter'],
        ['renouvellementNormand', 'accepter'],
      ])
    }
    expect(
      twin.contracts.deliveries.every(({ baked: made }) => made === 0),
    ).toBe(true)
    expect(
      baked.contracts.deliveries
        .filter(({ grocer }) => grocer === 'marcheBioLogique')
        .every(({ baked: made }) => made === BAKERY.capacityPerDay),
    ).toBe(true)
  })
})

describe('runBakery', () => {
  it('plays each seed as the twin, then each price set and oven, the same every time', () => {
    const job = {
      kind: 'bakery',
      difficulty: 'moyen',
      strategy: 'start',
      games: 1,
      months: 2,
    } as const
    const run = runBakery(job)
    expect(run).toMatchObject({
      difficulty: 'moyen',
      strategy: 'start',
      games: 1,
      months: 2,
    })
    expect(run.twins).toHaveLength(1)
    expect(run.twins[0]?.croissantsMade).toBe(0)
    expect(run.cells.map(({ set, oven }) => `${set} ${oven}`)).toEqual(
      PRICE_SETS.flatMap(({ name }) => OVENS.map((oven) => `${name} ${oven}`)),
    )
    for (const cell of run.cells) {
      expect(cell.games).toHaveLength(1)
      expect(cell.games[0]?.cashAtMonthEnds).toHaveLength(2)
      // Two months of rent and a move do not pay back at 70 a day.
      expect(cell.paybacks).toEqual([null])
    }
    expect(runBakery(job)).toEqual(run)
  })
})
