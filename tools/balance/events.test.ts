import { afterEach, describe, expect, it, vi } from 'vitest'
import { cents } from '../../src/engine/money.ts'
import { simulate } from '../sim/simulate.ts'
import { playStrategy, runBalance } from './play.ts'
import { strategyChanges, type Strategy } from './strategies.ts'

// The balance bot hands its events policy on to every game it plays: a spy
// on simulate() checks what each game was asked to play.

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

afterEach(() => {
  vi.mocked(simulate).mockClear()
})

describe('playStrategy', () => {
  it('plays the events policy it is given, none by default', () => {
    playStrategy(BASE, 'facile', 1, DAYS, 'first')
    playStrategy(BASE, 'facile', 1, DAYS)
    expect(vi.mocked(simulate).mock.calls).toEqual([
      [1, DAYS, 'facile', strategyChanges(BASE), 'first'],
      [1, DAYS, 'facile', strategyChanges(BASE), 'none'],
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
  })
})
