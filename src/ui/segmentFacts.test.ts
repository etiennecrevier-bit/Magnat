import { describe, expect, it } from 'vitest'
import { createInitialState, tick } from '../engine/clock.ts'
import { SEGMENTS } from '../engine/customers.ts'
import { PRODUCTS } from '../engine/inventory.ts'
import { cents } from '../engine/money.ts'
import type { DaySummary, Visit } from '../engine/types.ts'
import { segmentFacts } from './segmentFacts.ts'

const NONE = { cafe: 0, chocolat: 0, croissant: 0 }

function visit(segment: Visit['segment'], bought = NONE): Visit {
  const outcome = Object.values(bought).some((units) => units > 0)
    ? 'bought'
    : 'browsed'
  return {
    arrivalMinute: 420,
    segment,
    bought,
    outcome,
    servedMinute: outcome === 'bought' ? 420 : null,
    leftMinute: null,
    botched: 0,
  }
}

const DAY: DaySummary = {
  day: 3,
  sold: { cafe: 3, chocolat: 1, croissant: 2 },
  revenue: cents(2100),
  lostSales: { cafe: 0, chocolat: 2, croissant: 0 },
  spoiled: NONE,
  segments: {
    aubaine: { visits: 3, buyers: 1, tooExpensive: 2, soldOut: 0 },
    habitue: { visits: 3, buyers: 2, tooExpensive: 0, soldOut: 1 },
    chic: { visits: 1, buyers: 1, tooExpensive: 0, soldOut: 0 },
  },
  visits: [
    visit('habitue', { cafe: 1, chocolat: 0, croissant: 1 }),
    visit('aubaine', { cafe: 1, chocolat: 0, croissant: 0 }),
    visit('aubaine'),
    visit('chic', { cafe: 1, chocolat: 1, croissant: 0 }),
    visit('habitue', { cafe: 0, chocolat: 0, croissant: 1 }),
    visit('aubaine'),
    visit('habitue'),
  ],
  leftLine: 0,
  averageWaitSeconds: 0,
  longestWaitSeconds: 0,
  energy: 100,
  botched: 0,
  modifiers: [],
  deliveries: [],
  missed: [],
}

describe('segmentFacts', () => {
  it('sums the units each segment bought and copies its visits without a sale', () => {
    expect(segmentFacts(DAY)).toEqual({
      segments: [
        {
          segment: 'aubaine',
          facts: {
            sold: { cafe: 1, chocolat: 0, croissant: 0 },
            tooExpensive: 2,
            soldOut: 0,
          },
        },
        {
          segment: 'habitue',
          facts: {
            sold: { cafe: 1, chocolat: 0, croissant: 2 },
            tooExpensive: 0,
            soldOut: 1,
          },
        },
        {
          segment: 'chic',
          facts: {
            sold: { cafe: 1, chocolat: 1, croissant: 0 },
            tooExpensive: 0,
            soldOut: 0,
          },
        },
      ],
      total: {
        sold: { cafe: 3, chocolat: 1, croissant: 2 },
        tooExpensive: 2,
        soldOut: 1,
      },
    })
  })

  it('adds up to the day the engine played', () => {
    const { lastDay } = tick(tick(createInitialState(42)))
    if (lastDay === null) throw new Error('No day played')
    expect(lastDay.visits.length).toBeGreaterThan(0)

    const { segments, total } = segmentFacts(lastDay)

    expect(segments.map(({ segment }) => segment)).toEqual(SEGMENTS)
    expect(total.sold).toEqual(lastDay.sold)
    for (const { segment, facts } of segments) {
      expect(facts.tooExpensive).toBe(lastDay.segments[segment].tooExpensive)
      expect(facts.soldOut).toBe(lastDay.segments[segment].soldOut)
    }
    for (const product of PRODUCTS) {
      expect(
        segments.reduce((units, { facts }) => units + facts.sold[product], 0),
      ).toBe(lastDay.sold[product])
    }
  })
})
