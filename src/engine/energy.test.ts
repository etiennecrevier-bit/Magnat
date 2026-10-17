import { describe, expect, it } from 'vitest'
import { loadEnergyContent, type EnergyContent } from '../content/schema.ts'
import { ENERGY } from './day.ts'
import {
  FULL_ENERGY,
  effectsOf,
  energyAtClose,
  fatigueOf,
  nightRest,
  type Workday,
} from './energy.ts'

/** Round numbers, so the arithmetic below reads plainly. */
const PLAIN: EnergyContent = loadEnergyContent({
  openDayCost: 6,
  costPerCustomerServed: 0.25,
  nightRecovery: 5,
  closedDayRecovery: 45,
  debtStress: 10,
  tired: { below: 50, serviceTimeIncrease: 0.2, botchedShare: 0.02 },
  exhausted: { below: 25, serviceTimeIncrease: 0.4, botchedShare: 0.05 },
})

const OPEN: Workday = {
  worked: true,
  away: false,
  customersServed: 0,
  stressed: false,
  bakingCost: 0,
  deliveryCost: 0,
  tripCost: 0,
}
const CLOSED: Workday = { ...OPEN, worked: false }

describe('fatigueOf', () => {
  it.each([
    [FULL_ENERGY, 'rested'],
    [50, 'rested'],
    [49.99, 'tired'],
    [25, 'tired'],
    [24.99, 'exhausted'],
    [0, 'exhausted'],
  ])('finds the owner at %d %s', (energy, fatigue) => {
    expect(fatigueOf(energy, PLAIN)).toBe(fatigue)
  })

  it('reads its thresholds from the content', () => {
    const later = loadEnergyContent({
      ...PLAIN,
      tired: { ...PLAIN.tired, below: 80 },
    })
    expect(fatigueOf(60, PLAIN)).toBe('rested')
    expect(fatigueOf(60, later)).toBe('tired')
  })

  it('ships Fatigué below 50 and Épuisé below 25', () => {
    expect(ENERGY.tired.below).toBe(50)
    expect(ENERGY.exhausted.below).toBe(25)
  })
})

describe('effectsOf', () => {
  it('changes nothing for a rested owner', () => {
    expect(effectsOf(FULL_ENERGY, PLAIN)).toEqual({
      serviceTimeIncrease: 0,
      botchedShare: 0,
    })
    expect(effectsOf(50, PLAIN)).toEqual(effectsOf(FULL_ENERGY, PLAIN))
  })

  it("is the content's for a tired, then an exhausted owner", () => {
    expect(effectsOf(49, PLAIN)).toEqual({
      serviceTimeIncrease: 0.2,
      botchedShare: 0.02,
    })
    expect(effectsOf(24, PLAIN)).toEqual({
      serviceTimeIncrease: 0.4,
      botchedShare: 0.05,
    })
  })
})

describe('energyAtClose', () => {
  it('takes the open day cost, plus a cost for each customer served', () => {
    expect(energyAtClose(80, OPEN, PLAIN)).toBe(74)
    expect(energyAtClose(80, { ...OPEN, customersServed: 40 }, PLAIN)).toBe(64)
  })

  it('tires the owner more on a busier day', () => {
    const quiet = energyAtClose(90, { ...OPEN, customersServed: 30 }, ENERGY)
    const busy = energyAtClose(90, { ...OPEN, customersServed: 90 }, ENERGY)
    expect(busy).toBeLessThan(quiet)
    expect(quiet - busy).toBeCloseTo(60 * ENERGY.costPerCustomerServed, 9)
  })

  it('takes a morning of baking on top of the open day', () => {
    expect(energyAtClose(80, { ...OPEN, bakingCost: 8 }, PLAIN)).toBe(66)
    expect(
      energyAtClose(80, { ...OPEN, customersServed: 40, bakingCost: 8 }, PLAIN),
    ).toBe(56)
    expect(energyAtClose(5, { ...OPEN, bakingCost: 8 }, PLAIN)).toBe(0)
  })

  it("takes each morning's deliveries on top of the open day, and of the baking", () => {
    expect(energyAtClose(80, { ...OPEN, deliveryCost: 12 }, PLAIN)).toBe(62)
    expect(
      energyAtClose(80, { ...OPEN, bakingCost: 8, deliveryCost: 4 }, PLAIN),
    ).toBe(62)
    expect(energyAtClose(10, { ...OPEN, deliveryCost: 12 }, PLAIN)).toBe(0)
  })

  it('takes the deliveries and the baking of a closed morning from the day back, once it stops at full', () => {
    expect(energyAtClose(30, { ...CLOSED, deliveryCost: 12 }, PLAIN)).toBe(63)
    expect(
      energyAtClose(30, { ...CLOSED, bakingCost: 8, deliveryCost: 4 }, PLAIN),
    ).toBe(63)
    // Full by the rest, then the morning's work.
    expect(energyAtClose(90, { ...CLOSED, deliveryCost: 12 }, PLAIN)).toBe(88)
    expect(
      energyAtClose(
        90,
        { ...CLOSED, bakingCost: 8, deliveryCost: 12, stressed: true },
        PLAIN,
      ),
    ).toBe(70)
  })

  it('gives a closed day back, whoever would have come', () => {
    expect(energyAtClose(30, CLOSED, PLAIN)).toBe(75)
    expect(energyAtClose(30, { ...CLOSED, customersServed: 40 }, PLAIN)).toBe(
      75,
    )
  })

  it('takes the stress of debt on top, open or closed', () => {
    expect(energyAtClose(80, { ...OPEN, stressed: true }, PLAIN)).toBe(64)
    expect(energyAtClose(30, { ...CLOSED, stressed: true }, PLAIN)).toBe(65)
  })

  it('holds the energy of an owner away all day, the truck open or not', () => {
    const away = { ...OPEN, away: true, customersServed: 40 }
    expect(energyAtClose(37, away, PLAIN)).toBe(37)
    expect(energyAtClose(37, { ...away, worked: false }, PLAIN)).toBe(37)
    expect(energyAtClose(0, away, PLAIN)).toBe(0)
    expect(energyAtClose(FULL_ENERGY, away, PLAIN)).toBe(FULL_ENERGY)
  })

  it("takes a trip's energy on top of the day, open, closed or away", () => {
    expect(energyAtClose(80, { ...OPEN, tripCost: 3 }, PLAIN)).toBe(71)
    expect(
      energyAtClose(80, { ...OPEN, customersServed: 40, tripCost: 3 }, PLAIN),
    ).toBe(61)
    expect(energyAtClose(30, { ...CLOSED, tripCost: 3 }, PLAIN)).toBe(72)
    // Full by the rest, then the trip.
    expect(energyAtClose(90, { ...CLOSED, tripCost: 3 }, PLAIN)).toBe(97)
    const away = { ...OPEN, away: true, customersServed: 40, tripCost: 3 }
    expect(energyAtClose(37, away, PLAIN)).toBe(34)
    expect(energyAtClose(2, away, PLAIN)).toBe(0)
    expect(
      energyAtClose(37, { ...away, worked: false, stressed: true }, PLAIN),
    ).toBe(24)
  })

  it('still takes the stress of debt from an owner away', () => {
    const away = { ...CLOSED, away: true, stressed: true }
    expect(energyAtClose(37, away, PLAIN)).toBe(27)
    expect(energyAtClose(4, away, PLAIN)).toBe(0)
  })

  it('never goes below 0 nor above full, at each change', () => {
    const busy = { ...OPEN, customersServed: 1_000 }
    expect(energyAtClose(10, busy, PLAIN)).toBe(0)
    expect(energyAtClose(10, { ...busy, stressed: true }, PLAIN)).toBe(0)
    expect(energyAtClose(90, CLOSED, PLAIN)).toBe(FULL_ENERGY)
    // The rest stops at full before the stress takes its share.
    expect(energyAtClose(90, { ...CLOSED, stressed: true }, PLAIN)).toBe(90)
  })
})

describe('nightRest', () => {
  it('gives the night back, up to full', () => {
    expect(nightRest(40, PLAIN)).toBe(45)
    expect(nightRest(0, PLAIN)).toBe(5)
    expect(nightRest(97, PLAIN)).toBe(FULL_ENERGY)
    expect(nightRest(FULL_ENERGY, PLAIN)).toBe(FULL_ENERGY)
  })
})

describe('the shipped energy', () => {
  /**
   * The lowest morning energy over `count` weeks of `open` days of about 60
   * customers each, a typical day, then the rest of the week closed.
   */
  function lowest(open: number, count: number): number {
    const served = { ...OPEN, customersServed: 60 }
    let energy = FULL_ENERGY
    let low = energy
    for (let day = 0; day < 7 * count; day += 1) {
      const workday = day % 7 < open ? served : CLOSED
      energy = nightRest(energyAtClose(energy, workday, ENERGY), ENERGY)
      low = Math.min(low, energy)
    }
    return low
  }

  it('keeps an owner open 6 days a week rested, and drains one open 7 days', () => {
    expect(fatigueOf(lowest(6, 8), ENERGY)).toBe('rested')
    expect(fatigueOf(lowest(7, 2), ENERGY)).toBe('tired')
    expect(fatigueOf(lowest(7, 3), ENERGY)).toBe('exhausted')
  })
})
