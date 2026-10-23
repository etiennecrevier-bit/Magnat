import { describe, expect, it } from 'vitest'
import type { Service } from '../content/schema.ts'
import { createInitialState, tick } from './clock.ts'
import { CUSTOMERS, ENERGY, FOOD_TRUCK } from './day.ts'
import { SEGMENTS } from './customers.ts'
import { FULL_ENERGY, effectsOf } from './energy.ts'
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

const ONE: readonly Server[] = [{ speed: 1, owner: true, botchedShare: 0 }]

/** The rested owner at the counter. */
const RESTED: Server = {
  speed: 1,
  owner: true,
  botchedShare: 0,
}

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
    expect(servers(state, ENERGY)).toEqual([RESTED])
    for (let day = 0; day < 10; day += 1) state = tick(state)
    expect(servers(state, ENERGY)).toEqual([RESTED])
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
    const { botchedShare } = effectsOf(energy, ENERGY)
    expect(servers(state, ENERGY)).toEqual([
      { speed, owner: true, botchedShare },
    ])
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

  /**
   * Amélie at the truck: weak in rapidité, normal in minutie (she is strong
   * in accueil).
   */
  const AMELIE: Server = {
    speed: STAFF.truckSpeed * STAFF.traits.rapidite.weak,
    owner: false,
    botchedShare: STAFF.employeeBotchedShare,
  }

  it('adds each employee at the truck after the owner, at truckSpeed × rapidité, botching by minutie', () => {
    const state = {
      ...createInitialState(42),
      energy: 24,
      staff: [camion, { ...camion, candidate: 'kevin' as const }],
    }
    expect(servers(state, ENERGY)).toEqual([
      {
        speed: 1 / 1.8,
        owner: true,
        botchedShare: ENERGY.exhausted.botchedShare,
      },
      AMELIE,
      {
        speed: STAFF.truckSpeed * STAFF.traits.rapidite.strong,
        owner: false,
        botchedShare: STAFF.employeeBotchedShare * STAFF.traits.minutie.weak,
      },
    ])
    expect(STAFF.truckSpeed).toBe(0.85)
  })

  it('leaves out an employee absent that day', () => {
    const state = {
      ...createInitialState(42),
      staff: [camion, { ...camion, candidate: 'kevin' as const }],
    }
    expect(
      servers(state, ENERGY, STAFF, null, ['kevin']).map(({ speed }) => speed),
    ).toEqual([1, AMELIE.speed])
    expect(servers(state, ENERGY, STAFF, null, ['kevin', 'amelie'])).toEqual([
      RESTED,
    ])
    expect(
      servers({ ...state, ownerAway: true }, ENERGY, STAFF, null, [
        'kevin',
        'amelie',
      ]),
    ).toEqual([])
  })

  it('leaves the owner out while they are away', () => {
    const away = { ...createInitialState(42), ownerAway: true }
    expect(servers(away, ENERGY)).toEqual([])
    expect(servers({ ...away, staff: [camion] }, ENERGY)).toEqual([AMELIE])
  })

  it('gives the owner alone the window they are away from the counter', () => {
    const away = { from: 36_000, to: 40_800 }
    const state = { ...createInitialState(42), staff: [camion] }
    expect(servers(state, ENERGY, STAFF, away)).toEqual([
      { ...RESTED, away },
      AMELIE,
    ])
    expect(servers({ ...state, ownerAway: true }, ENERGY, STAFF, away)).toEqual(
      [AMELIE],
    )
  })

  it('serves with nobody else when the staff neither serves', () => {
    const state = {
      ...createInitialState(42),
      staff: [
        { ...camion, role: 'livreur' as const },
        { ...camion, candidate: 'kevin' as const, role: 'boulanger' as const },
      ],
    }
    expect(servers(state, ENERGY)).toEqual([RESTED])
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
        { speed: 1, owner: true, botchedShare: 0 },
        { speed: 1, owner: false, botchedShare: 0 },
      ],
      SERVICE,
    )
    expect(waits(line, together(4)).map(({ start }) => start)).toEqual([
      0, 0, 55, 55,
    ])
  })

  it('says which server each customer reached, the first on a tie', () => {
    const owner: Server = { speed: 1, owner: true, botchedShare: 0 }
    const employee: Server = { speed: 0.5, owner: false, botchedShare: 0 }
    const line = openLine([owner, employee], SERVICE)
    // The owner is free at 55, the employee at 110.
    expect(together(4).map(({ second }) => line.join(second, 1))).toEqual([
      { start: 0, server: owner },
      { start: 0, server: employee },
      { start: 55, server: owner },
      { start: 110, server: owner },
    ])
  })

  it('starts nobody while the server is away, from its first second to the one before it is back', () => {
    const away = { from: 100, to: 200 }
    const line = openLine(
      [{ speed: 1, owner: true, botchedShare: 0, away }],
      SERVICE,
    )
    expect(line.isOpen(99)).toBe(true)
    expect(line.isOpen(100)).toBe(false)
    expect(line.isOpen(199)).toBe(false)
    expect(line.isOpen(200)).toBe(true)
  })

  it('makes a customer wait until the server is back, and serves in full one started before', () => {
    const owner: Server = {
      speed: 1,
      owner: true,
      botchedShare: 0,
      away: { from: 100, to: 200 },
    }
    const line = openLine([owner], SERVICE)
    // Started at 99, before the owner leaves, served in full until 154.
    expect(line.ahead(99)).toEqual({ wait: 0, waiting: 0 })
    expect(line.join(99, 1)).toEqual({ start: 99, server: owner })
    // Free at 154, but away: the next customer waits until 200.
    expect(line.ahead(120)).toEqual({ wait: 80, waiting: 0 })
    expect(line.join(120, 1).start).toBe(200)
    // Then the line goes on from there, without the owner leaving again.
    expect(line.join(200, 1).start).toBe(255)
  })

  it('serves at once a customer who comes as the server is back', () => {
    const line = openLine(
      [
        {
          speed: 1,
          owner: true,
          botchedShare: 0,
          away: { from: 100, to: 200 },
        },
      ],
      SERVICE,
    )
    expect(line.ahead(200)).toEqual({ wait: 0, waiting: 0 })
    expect(line.join(200, 1).start).toBe(200)
  })

  it('sends a customer to the employee rather than to an owner who is free but away', () => {
    const owner: Server = {
      speed: 1,
      owner: true,
      botchedShare: 0,
      away: { from: 0, to: 1000 },
    }
    const employee: Server = { speed: 1, owner: false, botchedShare: 0 }
    const line = openLine([owner, employee], SERVICE)
    expect(line.isOpen(10)).toBe(true)
    expect(line.ahead(10)).toEqual({ wait: 0, waiting: 0 })
    expect(line.join(10, 1)).toEqual({ start: 10, server: employee })
    // The employee is free at 65, long before the owner is back.
    expect(line.ahead(20)).toEqual({ wait: 45, waiting: 0 })
    expect(line.join(20, 1)).toEqual({ start: 65, server: employee })
    expect(line.join(30, 1)).toEqual({ start: 120, server: employee })
    // Back at 1000, the owner serves again, before the employee does.
    expect(line.join(1000, 1)).toEqual({ start: 1000, server: owner })
  })

  it('sends a customer to the server free since earliest when both are, as before the absences', () => {
    const owner: Server = { speed: 1, owner: true, botchedShare: 0 }
    const employee: Server = { speed: 1, owner: false, botchedShare: 0 }
    const line = openLine([owner, employee], SERVICE)
    // The owner is free at 100, the employee at 55.
    expect(line.join(0, 4).server).toBe(owner)
    expect(line.join(0, 1).server).toBe(employee)
    expect(line.join(200, 1)).toEqual({ start: 200, server: employee })
    expect(line.join(200, 1)).toEqual({ start: 200, server: owner })
  })

  it('serves twice as fast at speed 2', () => {
    const line = openLine([{ speed: 2, owner: true, botchedShare: 0 }], SERVICE)
    expect(waits(line, together(3)).map(({ start }) => start)).toEqual([
      0, 27.5, 55,
    ])
  })

  it.each([
    ['no server', []],
    ['a speed of 0', [{ speed: 0, owner: true, botchedShare: 0 }]],
    [
      'a negative speed',
      [
        { speed: 1, owner: true, botchedShare: 0 },
        { speed: -1, owner: false, botchedShare: 0 },
      ],
    ],
    [
      'a speed that is not a number',
      [{ speed: Number.NaN, owner: true, botchedShare: 0 }],
    ],
    [
      'an infinite speed',
      [{ speed: Number.POSITIVE_INFINITY, owner: true, botchedShare: 0 }],
    ],
    [
      'an absence that ends before it starts',
      [
        {
          speed: 1,
          owner: true,
          botchedShare: 0,
          away: { from: 200, to: 100 },
        },
      ],
    ],
    [
      'an absence that never ends',
      [
        {
          speed: 1,
          owner: true,
          botchedShare: 0,
          away: { from: 100, to: Number.POSITIVE_INFINITY },
        },
      ],
    ],
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
