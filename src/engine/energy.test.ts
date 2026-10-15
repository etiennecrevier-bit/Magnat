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

const OPEN: Workday = { open: true, customersServed: 0, stressed: false }
const CLOSED: Workday = { open: false, customersServed: 0, stressed: false }

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
