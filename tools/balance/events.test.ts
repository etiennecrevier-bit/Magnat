import { afterEach, describe, expect, it, vi } from 'vitest'
import { DIFFICULTIES, EVENTS } from '../../src/engine/day.ts'
import { cents } from '../../src/engine/money.ts'
import { simulate } from '../sim/simulate.ts'
import { playStrategy, runBalance } from './play.ts'
import { strategyChanges, type Strategy } from './strategies.ts'

// The balance bot hands its events, contracts and financing policies on to
// every game it plays: a spy on simulate() checks what each game was asked
// to play.

vi.mock('../sim/simulate.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim/simulate.ts')>()
  return { ...actual, simulate: vi.fn(actual.simulate) }
})

const BASE: Strategy = {
  priceChange: 0,
  croissantsPerDay: 70,
  marketingDaily: cents(0),
  daysOpen: 6,
  ownerWeeklyPay: cents(70_000),
}

const DAYS = 10

/** The events policy each call to simulate() was given. */
function policies(): unknown[] {
  return vi.mocked(simulate).mock.calls.map((call) => call[4])
}

/** The contracts policy each call to simulate() was given. */
function contractPolicies(): unknown[] {
  return vi.mocked(simulate).mock.calls.map((call) => call[7])
}

/** The financing policy each call to simulate() was given. */
function financingPolicies(): unknown[] {
  return vi.mocked(simulate).mock.calls.map((call) => call[8])
}

afterEach(() => {
  vi.mocked(simulate).mockClear()
})

describe('playStrategy', () => {
  it('plays the events, contracts and financing policies it is given, none by default', () => {
    playStrategy(BASE, 'facile', 1, DAYS, 'first', 'all', 'refuse')
    playStrategy(BASE, 'facile', 1, DAYS)
    expect(vi.mocked(simulate).mock.calls).toEqual([
      [
        1,
        DAYS,
        'facile',
        strategyChanges(BASE),
        'first',
        EVENTS,
        DIFFICULTIES,
        'all',
        'refuse',
      ],
      [
        1,
        DAYS,
        'facile',
        strategyChanges(BASE),
        'none',
        EVENTS,
        DIFFICULTIES,
        null,
        null,
      ],
    ])
  })
})

describe('runBalance', () => {
  it('plays every game with its events policy, and says which', () => {
    const run = runBalance({
      years: 1,
      games: 2,
      strategies: [BASE, { ...BASE, daysOpen: 7 }],
      difficulties: ['moyen'],
      events: 'random',
    })
    expect(run.events).toBe('random')
    expect(policies()).toEqual(['random', 'random', 'random', 'random'])
  })

  it('plays none by default', () => {
    const run = runBalance({
      years: 1,
      games: 1,
      strategies: [BASE],
      difficulties: ['facile'],
    })
    expect(run.events).toBe('none')
    expect(policies()).toEqual(['none'])
    expect(run.contracts).toBeUndefined()
    expect(contractPolicies()).toEqual([null])
    expect(run.financing).toBeUndefined()
    expect(financingPolicies()).toEqual([null])
  })

  it('plays every game with its financing policy, and says which', () => {
    const run = runBalance({
      years: 1,
      games: 2,
      strategies: [BASE],
      difficulties: ['moyen'],
      financing: 'accept',
    })
    expect(run.financing).toBe('accept')
    expect(financingPolicies()).toEqual(['accept', 'accept'])
  })

  it('plays every game with its contracts policy, and says which', () => {
    const run = runBalance({
      years: 1,
      games: 2,
      strategies: [BASE],
      difficulties: ['moyen'],
      contracts: 'first',
    })
    expect(run.contracts).toBe('first')
    expect(contractPolicies()).toEqual(['first', 'first'])
  })
})
