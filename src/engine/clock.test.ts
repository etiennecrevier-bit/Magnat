import { describe, expect, it } from 'vitest'
import { loadDifficultyContent } from '../content/schema.ts'
import * as calendar from './calendar.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import { DIFFICULTIES, FOOD_TRUCK, openingJournal, playDay } from './day.ts'
import { startingDecisions } from './decisions.ts'
import { defaultProfile } from './profile.ts'
import { seedRng } from './rng.ts'
import type { Profile } from './types.ts'

const CUSTOM: Profile = {
  businessName: 'Chez Mimi 🥐',
  avatar: 'homme',
  difficulty: 'difficile',
}

describe('createInitialState', () => {
  it("starts on day 0, seeded, with no stock, no marketing spent, the default difficulty's opening books, the starting decisions and the default profile", () => {
    expect(createInitialState(42)).toEqual({
      day: 0,
      seed: 42,
      rngState: seedRng(42),
      journal: openingJournal(defaultProfile().difficulty),
      inventory: [],
      lastDay: null,
      marketingHistory: [],
      decisions: startingDecisions(),
      pendingDecisions: null,
      profile: defaultProfile(),
    })
  })

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('rejects seed %s', (seed) => {
    expect(() => createInitialState(seed)).toThrow(RangeError)
  })

  it("keeps the player's profile, as a copy, and opens its difficulty's books", () => {
    const profile = { ...CUSTOM }
    const state = createInitialState(42, FOOD_TRUCK, profile)
    expect(state.profile).toEqual(CUSTOM)
    expect(state.profile).not.toBe(profile)
    expect(state.journal).toEqual(openingJournal(CUSTOM.difficulty))
    expect(state.journal).not.toEqual(createInitialState(42).journal)
    expect({
      ...state,
      profile: defaultProfile(),
      journal: openingJournal(defaultProfile().difficulty),
    }).toEqual(createInitialState(42))
  })

  it('rejects a loan above the truck and the starting cash together', () => {
    const moyen = DIFFICULTIES.difficulties.moyen
    const { startingCashCents, truck } = moyen
    if (truck.kind !== 'loan') throw new Error('Moyen borrows')
    const loanCents = startingCashCents + FOOD_TRUCK.truck.priceCents + 1
    const difficulties = loadDifficultyContent({
      difficulties: {
        ...DIFFICULTIES.difficulties,
        moyen: { ...moyen, truck: { ...truck, loanCents } },
      },
    })
    const profile = { ...CUSTOM, difficulty: 'moyen' } as const
    expect(() =>
      createInitialState(42, FOOD_TRUCK, profile, difficulties),
    ).toThrow(RangeError)
  })

  it('keeps only the fields of a profile', () => {
    const profile = { ...CUSTOM, extra: 1 } as Profile
    expect(createInitialState(42, FOOD_TRUCK, profile).profile).toEqual(CUSTOM)
  })

  it.each([
    [{ ...CUSTOM, businessName: '' }, 'businessName'],
    [{ ...CUSTOM, businessName: ' Chez Mimi' }, 'businessName'],
    [{ ...CUSTOM, avatar: 'robot' }, 'avatar'],
    [{ ...CUSTOM, difficulty: 'extreme' }, 'difficulty'],
  ])('rejects the profile %j', (profile, field) => {
    expect(() =>
      createInitialState(42, FOOD_TRUCK, profile as Profile),
    ).toThrow(new RegExp(`^Invalid profile: .*${field}`))
    expect(() =>
      createInitialState(42, FOOD_TRUCK, profile as Profile),
    ).toThrow(RangeError)
  })
})

describe('tick', () => {
  it('plays the day, then moves on to the next day', () => {
    let state = createInitialState(42)
    for (let day = 0; day < 8; day += 1) {
      const next = tick(state)
      expect(next).toEqual({ ...playDay(state), day: day + 1 })
      expect(next.lastDay?.day).toBe(day)
      state = next
    }
  })

  it('returns a new state without mutating its input', () => {
    const state = Object.freeze(createInitialState(42))
    const next = tick(state)
    expect(next).not.toBe(state)
    expect(state).toEqual(createInitialState(42))
  })

  it('counts one day per tick and keeps the seed and the profile', () => {
    let state = createInitialState(7, FOOD_TRUCK, CUSTOM)
    for (let i = 0; i < 400; i += 1) state = tick(state)
    expect(state).toMatchObject({ day: 400, seed: 7, profile: CUSTOM })
  })
})

describe('toCalendar', () => {
  it("is the calendar's, exported from the clock too", () => {
    expect(toCalendar).toBe(calendar.toCalendar)
  })
})
