import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { cents } from '../engine/money.ts'
import type { DaySummary, Visit } from '../engine/types.ts'
import { applyDecision } from '../engine/decisions.ts'
import { todayNumbers, totalUnits, truckWithout } from './todayNumbers.ts'

const NONE = { cafe: 0, chocolat: 0, croissant: 0 }

function visit(
  outcome: Visit['outcome'],
  servedMinute: number | null,
  leftMinute: number | null = null,
): Visit {
  return {
    arrivalMinute: 420,
    segment: 'habitue',
    bought: outcome === 'bought' ? { ...NONE, cafe: 1 } : NONE,
    outcome,
    servedMinute,
    leftMinute,
    botched: 0,
  }
}

const DAY: DaySummary = {
  day: 3,
  sold: { cafe: 2, chocolat: 0, croissant: 0 },
  revenue: cents(123_456),
  lostSales: { cafe: 1, chocolat: 3, croissant: 6 },
  pricedOut: NONE,
  spoiled: NONE,
  segments: {
    aubaine: { visits: 1, buyers: 0, tooExpensive: 0, soldOut: 0 },
    habitue: { visits: 4, buyers: 2, tooExpensive: 0, soldOut: 1 },
    chic: { visits: 0, buyers: 0, tooExpensive: 0, soldOut: 0 },
    touriste: { visits: 0, buyers: 0, tooExpensive: 0, soldOut: 0 },
  },
  visits: [
    visit('bought', 425),
    visit('bought', 431),
    // At the counter, but what they wanted had sold out.
    visit('soldOut', 436),
    // Left the line before reaching the counter.
    visit('leftLine', null, 450),
    visit('browsed', null),
  ],
  leftLine: 1,
  averageWaitSeconds: 0,
  longestWaitSeconds: 0,
  energy: 100,
  botched: 0,
  modifiers: [],
  deliveries: [],
  missed: [],
}

describe('todayNumbers', () => {
  it("gives the day's revenue, the customers who reached the counter and every lost sale", () => {
    expect(todayNumbers(DAY)).toEqual({
      revenue: cents(123_456),
      customersServed: 3,
      lostSales: 10,
    })
  })

  it('counts no customer and no lost sale on a day with none', () => {
    expect(
      todayNumbers({ ...DAY, revenue: cents(0), visits: [], lostSales: NONE }),
    ).toEqual({ revenue: cents(0), customersServed: 0, lostSales: 0 })
  })

  it('agrees with what the engine counts for the week', () => {
    const state = tick(tick(createInitialState(42)))
    const { lastDay } = state
    if (lastDay === null) throw new Error('A played day has a summary')
    const weekDay = state.weekSoFar.days.find(({ day }) => day === lastDay.day)
    expect(weekDay).toBeDefined()
    expect(todayNumbers(lastDay).customersServed).toBe(weekDay?.customersServed)
    expect(todayNumbers(lastDay).customersServed).toBeGreaterThan(0)
  })
})

describe('totalUnits', () => {
  it('adds up every product', () => {
    expect(totalUnits({ cafe: 87, chocolat: 12, croissant: 54 })).toBe(153)
    expect(totalUnits(NONE)).toBe(0)
  })
})

describe('truckWithout (#283)', () => {
  /** A game with `candidates` at the truck from day 1, the owner away on day 2. */
  function awayWith(...candidates: ('amelie' | 'kevin')[]) {
    let game = candidates.reduce(
      (state, candidate) =>
        applyDecision(state, {
          kind: 'hire',
          role: 'camion',
          candidate,
          hourlyWage: cents(2500),
        }),
      createInitialState(42),
    )
    game = tick(tick(game))
    return tick({ ...game, ownerAway: true })
  }

  it('names who kept the truck open while the owner was away', () => {
    const one = awayWith('kevin')
    expect(one.lastDay?.visits.length).toBeGreaterThan(0)
    expect(truckWithout(one.lastDay!, one.staff)).toBe(
      'Sans Kevin, le camion aurait été fermé',
    )
    const two = awayWith('amelie', 'kevin')
    expect(truckWithout(two.lastDay!, two.staff)).toBe(
      'Sans Amélie et Kevin, le camion aurait été fermé',
    )
    // A third at the truck, as the staff would have them.
    const day = two.lastDay!
    const nadia = { ...two.staff[0]!, candidate: 'nadia' as const }
    expect(
      truckWithout(
        {
          ...day,
          work: [...(day.work ?? []), { ...day.work![0]!, who: 'nadia' }],
        },
        [...two.staff, nadia],
      ),
    ).toBe('Sans Amélie, Kevin et Nadia, le camion aurait été fermé')
  })

  it('says nothing on a day the owner was at work, or the truck closed', () => {
    const game = tick(tick(awayWith('kevin')))
    expect(truckWithout(game.lastDay!, game.staff)).toBeNull()
    const nobody = tick({
      ...tick(tick(createInitialState(42))),
      ownerAway: true,
    })
    expect(nobody.lastDay?.visits).toEqual([])
    expect(truckWithout(nobody.lastDay!, nobody.staff)).toBeNull()
  })
})
