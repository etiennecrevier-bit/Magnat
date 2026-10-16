import { describe, expect, it } from 'vitest'
import type { Service } from '../content/schema.ts'
import { createInitialState, tick } from './clock.ts'
import { CUSTOMERS, ENERGY, FOOD_TRUCK } from './day.ts'
import { SEGMENTS } from './customers.ts'
import { FULL_ENERGY } from './energy.ts'
import { STAFF } from './staff.ts'
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

const ONE: readonly Server[] = [{ speed: 1, owner: true }]

/** Each customer looks at the line, then joins it ordering `items` units. */
function waits(
  line: Line,
  arrivals: readonly { second: number; items: number }[],
): { ahead: Ahead; start: number }[] {
  return arrivals.map(({ second, items }) => ({
    ahead: line.ahead(second),
    start: line.join(second, items).start,
  }))
}

/** `count` customers arriving at second 0, each ordering one unit. */
function together(count: number) {
  return Array.from({ length: count }, () => ({ second: 0, items: 1 }))
}

describe('servers', () => {
  it('is the avatar alone, at speed 1 when rested', () => {
    let state = createInitialState(42)
    expect(servers(state, ENERGY)).toEqual([{ speed: 1, owner: true }])
    for (let day = 0; day < 10; day += 1) state = tick(state)
    expect(servers(state, ENERGY)).toEqual([{ speed: 1, owner: true }])
  })

  it.each([
    [FULL_ENERGY, 1],
    [ENERGY.tired.below, 1],
    [ENERGY.tired.below - 0.01, 1 / (1 + ENERGY.tired.serviceTimeIncrease)],
    [ENERGY.exhausted.below, 1 / (1 + ENERGY.tired.serviceTimeIncrease)],
    [
      ENERGY.exhausted.below - 0.01,
      1 / (1 + ENERGY.exhausted.serviceTimeIncrease),
    ],
    [0, 1 / (1 + ENERGY.exhausted.serviceTimeIncrease)],
  ])('serves at energy %d at speed %d', (energy, speed) => {
    const state = { ...createInitialState(42), energy }
    expect(servers(state, ENERGY)).toEqual([{ speed, owner: true }])
  })

  it('takes 20 % longer tired and 80 % longer exhausted, as shipped', () => {
    const at = (energy: number) =>
      servers({ ...createInitialState(42), energy }, ENERGY)[0]?.speed
    expect(at(49)).toBe(1 / 1.2)
    expect(at(24)).toBe(1 / 1.8)
  })

  const camion = {
    candidate: 'amelie',
    role: 'camion',
    hourlyWage: STAFF.roles.camion.hourlyWageCents.start,
    hiredOnDay: 0,
  } as const

  it('adds each employee at the truck after the owner, at truckSpeed', () => {
    const state = {
      ...createInitialState(42),
      energy: 24,
      staff: [camion, { ...camion, candidate: 'kevin' as const }],
    }
    expect(servers(state, ENERGY)).toEqual([
      { speed: 1 / 1.8, owner: true },
      { speed: STAFF.truckSpeed, owner: false },
      { speed: STAFF.truckSpeed, owner: false },
    ])
    expect(STAFF.truckSpeed).toBe(0.85)
  })

  it('leaves the owner out while they are away', () => {
    const away = { ...createInitialState(42), ownerAway: true }
    expect(servers(away, ENERGY)).toEqual([])
    expect(servers({ ...away, staff: [camion] }, ENERGY)).toEqual([
      { speed: STAFF.truckSpeed, owner: false },
    ])
  })

  it('serves with nobody else when the staff neither serves', () => {
    const state = {
      ...createInitialState(42),
      staff: [
        { ...camion, role: 'livreur' as const },
        { ...camion, candidate: 'kevin' as const, role: 'boulanger' as const },
      ],
    }
    expect(servers(state, ENERGY)).toEqual([{ speed: 1, owner: true }])
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
    expect(line.join(600, 3)).toEqual({ start: 600, server: ONE[0] })
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
    expect(line.join(120, 1).start).toBe(120)
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
    const line = openLine(
      [
        { speed: 1, owner: true },
        { speed: 1, owner: false },
      ],
      SERVICE,
    )
    expect(waits(line, together(4)).map(({ start }) => start)).toEqual([
      0, 0, 55, 55,
    ])
  })

  it('says which server each customer reached, the first on a tie', () => {
    const owner: Server = { speed: 1, owner: true }
    const employee: Server = { speed: 0.5, owner: false }
    const line = openLine([owner, employee], SERVICE)
    // The owner is free at 55, the employee at 110.
    expect(together(4).map(({ second }) => line.join(second, 1))).toEqual([
      { start: 0, server: owner },
      { start: 0, server: employee },
      { start: 55, server: owner },
      { start: 110, server: owner },
    ])
  })

  it('serves twice as fast at speed 2', () => {
    const line = openLine([{ speed: 2, owner: true }], SERVICE)
    expect(waits(line, together(3)).map(({ start }) => start)).toEqual([
      0, 27.5, 55,
    ])
  })

  it.each([
    ['no server', []],
    ['a speed of 0', [{ speed: 0, owner: true }]],
    [
      'a negative speed',
      [
        { speed: 1, owner: true },
        { speed: -1, owner: false },
      ],
    ],
    ['a speed that is not a number', [{ speed: Number.NaN, owner: true }]],
    ['an infinite speed', [{ speed: Number.POSITIVE_INFINITY, owner: true }]],
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
