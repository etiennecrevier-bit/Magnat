import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { Marketing, ProductId } from '../content/schema.ts'
import { createInitialState, tick } from './clock.ts'
import { FOOD_TRUCK } from './day.ts'
import { applyDecision } from './decisions.ts'
import {
  awareness,
  extraCustomers,
  MARKETING_DAYS_KEPT,
  marketingCrowd,
  marketingDayOf,
  marketingOver,
  rememberMarketingDay,
  rememberSpend,
} from './marketing.ts'
import { cents, type Cents } from './money.ts'
import type { GameState, Visit } from './types.ts'

const SHIPPED = FOOD_TRUCK.marketing

/** Seven days of awareness, bringing 0,5 walk-ins per √cent. */
const WEEK: Marketing = {
  awarenessDays: 7,
  extraCustomersPerSqrtCent: 0.5,
  segmentShares: { aubaine: 0.1, habitue: 0.3, chic: 0.6, touriste: 0 },
}

function spend(...amounts: number[]): Cents[] {
  return amounts.map((amount) => cents(amount))
}

/** `amount` spent on each of seven days. */
function week(amount: number): Cents[] {
  return spend(...Array.from({ length: 7 }, () => amount))
}

describe('awareness', () => {
  it('is 0 before anything was spent', () => {
    expect(awareness([], WEEK)).toBe(0)
  })

  it('averages the spend over every day of the window, missing days as 0', () => {
    expect(awareness(spend(7_000), WEEK)).toBe(1_000)
    expect(awareness(spend(7_000, 7_000), WEEK)).toBe(2_000)
    expect(awareness(week(3_000), WEEK)).toBe(3_000)
  })

  it('counts a closed day as 0', () => {
    expect(awareness(spend(7_000, 0, 7_000, 0, 7_000, 0, 7_000), WEEK)).toBe(
      4_000,
    )
  })

  it('counts only the last awarenessDays days', () => {
    const history = spend(70_000, 700, 700, 700, 700, 700, 700, 700)
    expect(awareness(history, WEEK)).toBe(700)
    expect(awareness(spend(900, 300), { ...WEEK, awarenessDays: 1 })).toBe(300)
  })
})

describe('extraCustomers', () => {
  it('brings no one with no awareness', () => {
    expect(extraCustomers(0, WEEK)).toBe(0)
    expect(
      extraCustomers(10_000, { ...WEEK, extraCustomersPerSqrtCent: 0 }),
    ).toBe(0)
  })

  it('is k × √awareness', () => {
    expect(extraCustomers(10_000, WEEK)).toBe(50)
    expect(extraCustomers(2_500, WEEK)).toBe(25)
  })

  it('brings more with more awareness, but fewer than double for double', () => {
    fc.assert(
      fc.property(fc.double({ min: 1, max: 1e9, noNaN: true }), (level) => {
        const once = extraCustomers(level, SHIPPED)
        const twice = extraCustomers(2 * level, SHIPPED)
        expect(twice).toBeGreaterThan(once)
        expect(twice).toBeLessThan(2 * once)
        expect(twice / once).toBeCloseTo(Math.SQRT2, 9)
      }),
    )
  })
})

describe('marketingCrowd', () => {
  it("brings the history's walk-ins, from the marketing's segment shares", () => {
    expect(marketingCrowd(week(10_000), WEEK)).toEqual({
      customers: 50,
      segmentShares: WEEK.segmentShares,
      fromMarketing: true,
    })
    expect(marketingCrowd([], WEEK).customers).toBe(0)
  })
})

describe('rememberSpend', () => {
  it('adds the day last, keeping the last awarenessDays', () => {
    let history: readonly Cents[] = []
    for (let day = 1; day <= 9; day += 1) {
      history = rememberSpend(history, cents(day * 100), WEEK)
    }
    expect(history).toEqual(spend(300, 400, 500, 600, 700, 800, 900))
    expect(rememberSpend(spend(5), cents(0), WEEK)).toEqual(spend(5, 0))
  })

  it('never mutates the history', () => {
    const history = Object.freeze(spend(1, 2, 3, 4, 5, 6, 7))
    const after = rememberSpend(history, cents(8), WEEK)
    expect(history).toEqual(spend(1, 2, 3, 4, 5, 6, 7))
    expect(after).toEqual(spend(2, 3, 4, 5, 6, 7, 8))
  })
})

describe('the days marketing brought (#284)', () => {
  const visit = (
    bought: [number, number, number],
    fromMarketing: boolean,
    outcome: Visit['outcome'] = 'bought',
  ): Visit => ({
    arrivalMinute: 480,
    segment: 'habitue',
    bought: {
      cafe: bought[0],
      chocolat: bought[1],
      croissant: bought[2],
      limonade: 0,
    },
    outcome,
    servedMinute: outcome === 'bought' ? 481 : null,
    leftMinute: outcome === 'leftLine' ? 482 : null,
    botched: 0,
    ...(fromMarketing ? { fromMarketing: true as const } : {}),
  })
  const price = (product: ProductId) =>
    cents({ cafe: 300, chocolat: 400, croissant: 350, limonade: 400 }[product])

  it('counts every visit marketing brought, whatever it came to, and what they paid', () => {
    expect(
      marketingDayOf(
        12,
        cents(3_000),
        [
          visit([1, 0, 1], true),
          visit([1, 0, 0], false),
          visit([0, 0, 0], true, 'tooExpensive'),
          visit([0, 0, 0], true, 'leftLine'),
          visit([0, 0, 0], true, 'browsed'),
          visit([0, 1, 0], true),
        ],
        price,
      ),
    ).toEqual({ day: 12, spent: 3_000, customers: 5, sales: 300 + 350 + 400 })
  })

  it('keeps the last 28 days, an older save starting empty', () => {
    const day = (n: number) => ({
      day: n,
      spent: cents(n),
      customers: n,
      sales: cents(2 * n),
    })
    let history = rememberMarketingDay(undefined, day(0))
    expect(history).toEqual([day(0)])
    for (let n = 1; n < 40; n += 1) {
      history = rememberMarketingDay(history, day(n))
    }
    expect(MARKETING_DAYS_KEPT).toBe(28)
    expect(history.map(({ day: at }) => at)).toEqual(
      Array.from({ length: 28 }, (_, index) => 12 + index),
    )
    expect(marketingOver(history, 30, 36)).toEqual({
      spent: 30 + 31 + 32 + 33 + 34 + 35 + 36,
      customers: 30 + 31 + 32 + 33 + 34 + 35 + 36,
      sales: 2 * (30 + 31 + 32 + 33 + 34 + 35 + 36),
    })
    expect(marketingOver(history, 100, 106)).toEqual({
      spent: 0,
      customers: 0,
      sales: 0,
    })
  })
})

describe('a seeded month with a budget (#284)', () => {
  const budget = cents(4_000)
  let game: GameState = applyDecision(createInitialState(42), {
    kind: 'marketingDaily',
    budget,
  })
  const days: GameState[] = []
  for (let day = 0; day < 35; day += 1) {
    game = tick(game)
    days.push(game)
  }

  it('records each day what was spent and the visits it brought, whatever they came to', () => {
    for (const state of days) {
      const lastDay = state.lastDay
      if (lastDay === null) throw new Error('no day played')
      const today = state.marketingDays?.at(-1)
      const brought = lastDay.visits.filter(
        ({ fromMarketing }) => fromMarketing === true,
      )
      const spent = state.journal.entries
        .filter(({ day, memo }) => day === lastDay.day && memo === 'Marketing')
        .flatMap(({ lines }) => lines)
        .filter(({ account }) => account === '6300')
        .reduce((total, { debit }) => total + debit, 0)
      expect(today).toEqual({
        day: lastDay.day,
        spent,
        customers: brought.length,
        sales: brought.reduce(
          (total, { bought }) =>
            total +
            bought.cafe * state.decisions.prices.cafe +
            bought.chocolat * state.decisions.prices.chocolat +
            bought.croissant * state.decisions.prices.croissant,
          0,
        ),
      })
    }
    const brought = days.reduce(
      (total, state) => total + (state.marketingDays?.at(-1)?.customers ?? 0),
      0,
    )
    expect(brought).toBeGreaterThan(0)
    // Not only those who bought: some browsed or found the prices too high.
    const outcomes = new Set(
      days.flatMap(
        (state) =>
          state.lastDay?.visits
            .filter(({ fromMarketing }) => fromMarketing === true)
            .map(({ outcome }) => outcome) ?? [],
      ),
    )
    expect(outcomes.size).toBeGreaterThan(1)
    expect(days.at(-1)?.marketingDays).toHaveLength(MARKETING_DAYS_KEPT)
  })

  it('reports the week’s spend and what it brought, on the Sunday', () => {
    const sundays = days.filter(
      (state, index) =>
        state.lastWeek !== null && state.lastWeek !== days[index - 1]?.lastWeek,
    )
    expect(sundays.length).toBeGreaterThan(0)
    for (const state of sundays) {
      const week = state.lastWeek
      if (week === null) throw new Error('no week')
      const first = week.days[0]?.day ?? 0
      const inWeek = (state.marketingDays ?? []).filter(
        ({ day }) => day >= first,
      )
      expect(week.marketing).toEqual({
        spent: inWeek.reduce((total, { spent }) => total + spent, 0),
        customers: inWeek.reduce(
          (total, { customers }) => total + customers,
          0,
        ),
        sales: inWeek.reduce((total, { sales }) => total + sales, 0),
      })
    }
  })

  it('reports no marketing for a week that spent nothing', () => {
    let quiet = createInitialState(42)
    for (let day = 0; day < 10; day += 1) quiet = tick(quiet)
    expect(quiet.lastWeek).not.toBeNull()
    expect(quiet.lastWeek?.marketing).toBeUndefined()
  })
})
