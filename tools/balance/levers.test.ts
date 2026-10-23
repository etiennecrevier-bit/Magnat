import { describe, expect, it } from 'vitest'
import { endOfMonth, toCalendar } from '../../src/engine/calendar.ts'
import { netWorth } from '../../src/engine/netWorth.ts'
import {
  AFFORDABLE_MONTHS_LEFT,
  CALM_DAY,
  CRUNCH_MONTHS,
  SUMMER_DAY,
  affordableMornings,
  firstOf,
  levers,
  playBranch,
  reachSituation,
  type Lever,
} from './levers.ts'
import { lastDayOf, playSensibleGame } from './sensible.ts'

// The lever check of #298: the situations it branches from, each lever's
// settings and setup, and that a branch plays on from its morning as the
// game would.

// Each branch plays up to two years of days: well over Vitest's default
// on a slow CI runner (#305).
const SLOW = 60_000

function lever(id: string): Lever {
  const found = levers().find((each) => each.id === id)
  if (found === undefined) throw new Error(`No lever ${id}`)
  return found
}

describe('the situations', () => {
  it('fall on October 1 of year 1 and June 1 of year 2', () => {
    expect(CALM_DAY).toBe(firstOf(1, 10))
    expect(toCalendar(CALM_DAY)).toMatchObject({
      year: 1,
      month: 10,
      dayOfMonth: 1,
    })
    expect(toCalendar(SUMMER_DAY)).toMatchObject({
      year: 2,
      month: 6,
      dayOfMonth: 1,
    })
    expect(() => firstOf(1, 2)).toThrow(RangeError)
  })

  it('reach their mornings: calm with no contract, crunch after the first close below zero', () => {
    const calm = reachSituation('calm', 1, 'moyen')
    expect(calm?.player.state.day).toBe(CALM_DAY)
    expect(calm?.player.memory.signings).toEqual([])
    const summer = reachSituation('summer', 1, 'moyen')
    expect(summer?.player.state.day).toBe(SUMMER_DAY)
    const crunch = reachSituation('crunch', 1, 'moyen')
    expect(crunch?.player.memory.cash).toBeLessThan(0)
    expect(crunch?.player.memory.signings).toHaveLength(3)
    expect(crunch?.player.state.day).toBeLessThanOrEqual(
      endOfMonth(0, CRUNCH_MONTHS - 1) + 1,
    )
  })

  it(
    'find the morning each rung is affordable, with time left to matter',
    () => {
      const mornings = affordableMornings(1, 'moyen', 24)
      const last = lastDayOf(24 - AFFORDABLE_MONTHS_LEFT)
      expect(mornings.has('velo')).toBe(true)
      for (const [, situation] of mornings) {
        expect(situation.player.state.day).toBeLessThanOrEqual(last)
        expect(situation.player.state.dream.bought).toEqual([])
      }
    },
    SLOW,
  )
})

describe('levers', () => {
  it('each name their baseline among their settings, once each', () => {
    for (const each of levers()) {
      const ids = each.settings.map(({ id }) => id)
      expect(new Set(ids).size, each.id).toBe(ids.length)
      expect(ids, each.id).toContain(each.baseline)
      expect(each.situations.length, each.id).toBeGreaterThan(0)
    }
    expect(new Set(levers().map(({ id }) => id)).size).toBe(levers().length)
  })

  it('cover every kind of decision a player makes in a game', () => {
    const ids = levers().map(({ id }) => id)
    for (const id of [
      'price-cafe',
      'price-chocolat',
      'price-croissant',
      'price-limonade',
      'restock-croissant',
      'restock-cafe',
      'restock-chocolat',
      'restock-limonade',
      'days-open',
      'owner-pay',
      'marketing',
      'contracts',
      'bakery',
      'croissant-source',
      'production',
      'hire-camion',
      'hire-livreur',
      'hire-boulanger',
      'wage-camion',
      'fire-camion',
      'trip-meunerie',
      'financing',
      'storage',
      'rung-espresso',
      'rung-deuxiemeCamion',
    ]) {
      expect(ids).toContain(id)
    }
  })
})

describe('playBranch', () => {
  it(
    'plays the baseline on as the uninterrupted game would',
    () => {
      const summer = reachSituation('summer', 2, 'facile')
      if (summer === null) throw new Error('No summer')
      const marketing = lever('marketing')
      const baseline = marketing.settings.find(({ id }) => id === '30')
      if (baseline === undefined) throw new Error('No baseline')
      const branch = playBranch(summer, marketing, baseline, 24)
      const { game } = playSensibleGame(2, 'facile', 24)
      expect(branch?.netWorth).toBe(game.netWorthAtEnd)
      expect(branch?.bankrupt).toBe(false)
    },
    SLOW,
  )

  it(
    'decides the setup for every setting, so every candidate can bake',
    () => {
      const calm = reachSituation('calm', 1, 'moyen')
      if (calm === null) throw new Error('No calm')
      const bakers = lever('hire-boulanger')
      const months = 9 // to the end of year 1's January
      const played = bakers.settings
        .slice(0, 3)
        .map((setting) => playBranch(calm, bakers, setting, months))
      expect(played.every((game) => game !== null)).toBe(true)
      const deliverers = lever('hire-livreur')
      const setup = deliverers.setup?.(calm.player)
      expect(setup?.contracts.running).toHaveLength(1)
    },
    SLOW,
  )

  it(
    'buys a rung on top of the ones before it',
    () => {
      const mornings = affordableMornings(1, 'moyen', 24)
      const espresso = mornings.get('espresso')
      if (espresso === undefined) throw new Error('No espresso morning')
      const rung = lever('rung-espresso')
      const buy = rung.settings.find(({ id }) => id === 'buy')
      if (buy === undefined) throw new Error('No buy')
      const bought = buy.decide?.(espresso.player)
      expect(bought?.dream.bought.map(({ rung: id }) => id)).toEqual([
        'espresso',
      ])
      expect(netWorth(bought ?? espresso.player.state)).toBeGreaterThan(0)
    },
    SLOW,
  )

  it('is null when the game refuses the setting there', () => {
    const calm = reachSituation('calm', 1, 'moyen')
    if (calm === null) throw new Error('No calm')
    const refused = {
      id: 'refused',
      decide: () => {
        throw new RangeError('Invalid decision')
      },
    }
    expect(playBranch(calm, lever('wage-camion'), refused, 9)).toBeNull()
  })
})
