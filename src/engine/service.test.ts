import { describe, expect, it } from 'vitest'
import type { Service } from '../content/schema.ts'
import { createInitialState, tick } from './clock.ts'
import { CUSTOMERS, FOOD_TRUCK } from './day.ts'
import { SEGMENTS } from './customers.ts'
import {
  openLine,
  patienceSeconds,
  servers,
  type Ahead,
  type Line,
  type Server,
} from './service.ts'

/** 40 s a customer, plus 15 s a unit: 55 s for one unit. */
const SERVICE: Service = {
  baseSeconds: 40,
  perItemSeconds: 15,
  maxAheadInLine: 8,
}

const ONE: readonly Server[] = [{ speed: 1 }]

/** Each customer looks at the line, then joins it ordering `items` units. */
function waits(
  line: Line,
  arrivals: readonly { second: number; items: number }[],
): { ahead: Ahead; start: number }[] {
  return arrivals.map(({ second, items }) => ({
    ahead: line.ahead(second),
    start: line.join(second, items),
  }))
}

/** `count` customers arriving at second 0, each ordering one unit. */
function together(count: number) {
  return Array.from({ length: count }, () => ({ second: 0, items: 1 }))
}

describe('servers', () => {
  it('is the avatar alone, at speed 1', () => {
    let state = createInitialState(42)
    expect(servers(state)).toEqual([{ speed: 1 }])
    for (let day = 0; day < 10; day += 1) state = tick(state)
    expect(servers(state)).toEqual([{ speed: 1 }])
  })
})

describe('patienceSeconds', () => {
  it("is the segment's minutes × the day type's multiplier, in seconds", () => {
    const { semaine } = FOOD_TRUCK.walkIns.dayTypes
    for (const id of SEGMENTS) {
      const segment = CUSTOMERS.segments[id]
      expect(patienceSeconds(segment, semaine)).toBeCloseTo(
        segment.patienceMinutes * semaine.patienceMultiplier * 60,
        9,
      )
    }
  })

  it.each(SEGMENTS)('is shorter on weekdays than on weekends for %s', (id) => {
    const { semaine, finDeSemaine } = FOOD_TRUCK.walkIns.dayTypes
    const segment = CUSTOMERS.segments[id]
    expect(patienceSeconds(segment, semaine)).toBeLessThan(
      patienceSeconds(segment, finDeSemaine),
    )
  })
})

describe('openLine', () => {
  it('serves a lone customer at once', () => {
    const line = openLine(ONE, SERVICE)
    expect(line.ahead(600)).toEqual({ wait: 0, waiting: 0 })
    expect(line.join(600, 3)).toBe(600)
  })

  it('makes customers who come together wait their turn', () => {
    const line = openLine(ONE, SERVICE)
    // The first is at the counter, so the third sees one customer waiting.
    expect(waits(line, together(3))).toEqual([
      { ahead: { wait: 0, waiting: 0 }, start: 0 },
      { ahead: { wait: 55, waiting: 0 }, start: 55 },
      { ahead: { wait: 110, waiting: 1 }, start: 110 },
    ])
  })

  it('takes the time of each unit ordered', () => {
    const line = openLine(ONE, SERVICE)
    line.join(0, 3)
    expect(line.ahead(0).wait).toBe(40 + 3 * 15)
    line.join(0, 0)
    expect(line.ahead(0).wait).toBe(40 + 3 * 15 + 40)
  })

  it('serves at once a customer who comes after the server is free', () => {
    const line = openLine(ONE, SERVICE)
    line.join(0, 1)
    expect(line.ahead(55)).toEqual({ wait: 0, waiting: 0 })
    expect(line.ahead(120)).toEqual({ wait: 0, waiting: 0 })
    expect(line.join(120, 1)).toBe(120)
  })

  it('stops counting a customer as waiting once they reach the counter', () => {
    const line = openLine(ONE, SERVICE)
    waits(line, together(4))
    expect(line.ahead(0).waiting).toBe(3)
    expect(line.ahead(54).waiting).toBe(3)
    expect(line.ahead(55).waiting).toBe(2)
    expect(line.ahead(165)).toEqual({ wait: 55, waiting: 0 })
  })

  it('sends each customer to the server free first', () => {
    const line = openLine([{ speed: 1 }, { speed: 1 }], SERVICE)
    expect(waits(line, together(4)).map(({ start }) => start)).toEqual([
      0, 0, 55, 55,
    ])
  })

  it('serves twice as fast at speed 2', () => {
    const line = openLine([{ speed: 2 }], SERVICE)
    expect(waits(line, together(3)).map(({ start }) => start)).toEqual([
      0, 27.5, 55,
    ])
  })

  it.each([
    ['no server', []],
    ['a speed of 0', [{ speed: 0 }]],
    ['a negative speed', [{ speed: 1 }, { speed: -1 }]],
    ['a speed that is not a number', [{ speed: Number.NaN }]],
    ['an infinite speed', [{ speed: Number.POSITIVE_INFINITY }]],
  ] as const)('rejects %s', (_, crew) => {
    expect(() => openLine(crew, SERVICE)).toThrow(RangeError)
  })

  it('rejects a customer who comes before the last one', () => {
    const line = openLine(ONE, SERVICE)
    line.join(120, 1)
    expect(() => line.ahead(60)).toThrow(RangeError)
    expect(() => line.join(60, 1)).toThrow(RangeError)
  })
})
