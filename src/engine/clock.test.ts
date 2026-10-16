import { describe, expect, it } from 'vitest'
import {
  difficultyIdSchema,
  loadDifficultyContent,
  loadEnergyContent,
} from '../content/schema.ts'
import { balance } from '../finance/journal.ts'
import * as calendar from './calendar.ts'
import { createInitialState, tick, toCalendar } from './clock.ts'
import {
  CUSTOMERS,
  DIFFICULTIES,
  ENERGY,
  FOOD_TRUCK,
  PERSONAL,
  openingJournal,
  playDay,
} from './day.ts'
import { startingDecisions } from './decisions.ts'
import { FULL_ENERGY } from './energy.ts'
import { noEvents } from './events.ts'
import { cents } from './money.ts'
import { openingAccount } from './personal.ts'
import { defaultProfile } from './profile.ts'
import { seedRng } from './rng.ts'
import type { Profile } from './types.ts'

const CUSTOM: Profile = {
  businessName: 'Chez Mimi 🥐',
  avatar: 'homme',
  difficulty: 'difficile',
}

/** The personal account a game of the default difficulty opens with. */
const DEFAULT_ACCOUNT = openingAccount(
  DIFFICULTIES.difficulties[defaultProfile().difficulty]
    .startingPersonalCashCents,
)

describe('createInitialState', () => {
  it("starts on day 0, seeded, with no stock, no marketing spent, the default difficulty's opening books and savings, the starting decisions, the default profile, the owner at full energy, no event, nobody owing anything, a first week to come, partial, from the opening cash, and no Défi", () => {
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
      personal: DEFAULT_ACCOUNT,
      energy: 100,
      events: noEvents(),
      receivables: [],
      weekSoFar: {
        cashAtStart: balance(
          openingJournal(defaultProfile().difficulty),
          '1000',
          {
            toDay: 0,
          },
        ),
        partial: true,
        days: [],
        modifiers: [],
      },
      lastWeek: null,
      weekHistory: [],
      challenge: null,
    })
    expect(FULL_ENERGY).toBe(100)
  })

  it.each([-1, 1.5, 2 ** 32, Number.NaN])('rejects seed %s', (seed) => {
    expect(() => createInitialState(seed)).toThrow(RangeError)
  })

  it("keeps the player's profile, as a copy, and opens its difficulty's books, savings and first week", () => {
    const profile = { ...CUSTOM }
    const state = createInitialState(42, FOOD_TRUCK, profile)
    expect(state.profile).toEqual(CUSTOM)
    expect(state.profile).not.toBe(profile)
    expect(state.journal).toEqual(openingJournal(CUSTOM.difficulty))
    expect(state.journal).not.toEqual(createInitialState(42).journal)
    expect(state.personal).toEqual(
      openingAccount(
        DIFFICULTIES.difficulties[CUSTOM.difficulty].startingPersonalCashCents,
      ),
    )
    expect(state.personal).not.toEqual(DEFAULT_ACCOUNT)
    expect(state.weekSoFar.cashAtStart).toBe(
      balance(openingJournal(CUSTOM.difficulty), '1000', { toDay: 0 }),
    )
    expect(state.weekSoFar).not.toEqual(createInitialState(42).weekSoFar)
    expect({
      ...state,
      profile: defaultProfile(),
      journal: openingJournal(defaultProfile().difficulty),
      personal: DEFAULT_ACCOUNT,
      weekSoFar: createInitialState(42).weekSoFar,
    }).toEqual(createInitialState(42))
  })

  it.each(difficultyIdSchema.options)(
    "opens the owner's account of a %s game with its savings, and nothing moved",
    (difficulty) => {
      const { startingPersonalCashCents } =
        DIFFICULTIES.difficulties[difficulty]
      const state = createInitialState(42, FOOD_TRUCK, {
        ...CUSTOM,
        difficulty,
      })
      expect(state.personal).toEqual({
        cash: startingPersonalCashCents,
        movements: [],
        unpaidRents: [],
      })
    },
  )

  it('reads the savings from the difficulties it is given', () => {
    const difficulties = loadDifficultyContent({
      difficulties: {
        ...DIFFICULTIES.difficulties,
        facile: {
          ...DIFFICULTIES.difficulties.facile,
          startingPersonalCashCents: 12_345,
        },
      },
    })
    const profile = { ...CUSTOM, difficulty: 'facile' } as const
    expect(
      createInitialState(42, FOOD_TRUCK, profile, difficulties).personal,
    ).toEqual(openingAccount(cents(12_345)))
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
  it('plays the day, then moves on to the next day after a night of rest', () => {
    let state = createInitialState(42)
    for (let day = 0; day < 8; day += 1) {
      const next = tick(state)
      const played = playDay(state)
      expect(next).toEqual({
        ...played,
        day: day + 1,
        energy: Math.min(FULL_ENERGY, played.energy + ENERGY.nightRecovery),
      })
      expect(next.lastDay?.day).toBe(day)
      expect(next.lastDay?.energy).toBe(played.energy)
      state = next
    }
  })

  it('rests the owner each night by the energy it is given, up to full', () => {
    // Day 1 is a Tuesday, the shipped truck's first open day.
    const morning = tick(createInitialState(42))
    expect(morning.energy).toBe(FULL_ENERGY)
    const tiring = loadEnergyContent({ ...ENERGY, nightRecovery: 0.5 })
    const play = (energy = ENERGY) =>
      tick(morning, FOOD_TRUCK, CUSTOMERS, DIFFICULTIES, PERSONAL, energy)
    const closed = playDay(morning).energy
    expect(closed).toBeLessThan(FULL_ENERGY - ENERGY.nightRecovery)
    expect(play().energy).toBe(closed + ENERGY.nightRecovery)
    expect(play(tiring).energy).toBe(closed + 0.5)
    const restful = loadEnergyContent({ ...ENERGY, nightRecovery: 100 })
    expect(play(restful).energy).toBe(FULL_ENERGY)
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
