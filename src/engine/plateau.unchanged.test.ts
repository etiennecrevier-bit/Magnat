import { describe, expect, it } from 'vitest'
import type { DifficultyId, FoodTruckContent } from '../content/schema.ts'
import { entriesOf } from '../finance/journal.ts'
import { BAKERY } from './bakery.ts'
import { createInitialState, tick } from './clock.ts'
import { GROCERS } from './contracts.ts'
import {
  CUSTOMERS,
  DEFIS,
  DIFFICULTIES,
  ENERGY,
  EVENTS,
  FOOD_TRUCK,
  PERSONAL,
} from './day.ts'
import { applyDecision } from './decisions.ts'
import { NO_EVENTS, resolveEvent } from './events.ts'
import { withoutLemonade } from './fixtures/lemonade.ts'
import { PERCENTILES } from './percentiles.ts'
import { defaultProfile } from './profile.ts'
import type { GameState } from './types.ts'

// The Plateau as it played before the districts (#260): one truck, seeded
// 42, played 100 days into August at each difficulty, with the event cards
// and with marketing. Its fingerprint, the books, the generator and each
// day's visits and segments, was taken on main before the districts came,
// so moving the Plateau's crowd to districts.json and adding the tourists
// must leave every draw and every entry as it was. The segments are read
// for those the game had then.
//
// Lemonade (#261) sells from June 1st, so those 100 days are played with
// its season in December, out of them, and the days read without it: out
// of season, it changes nothing. Through May, the shipped game plays as
// that one does.
//
// #298 raised the bargain hunters' reference price of chocolat, a change
// of balance, not of rules, so the fingerprints were taken again then,
// with the code otherwise as it was.

const DAYS = 100
const MAY = 31
const OLD_SEGMENTS = ['aubaine', 'habitue', 'chic'] as const

/** The shipped content, with lemonade on sale only in December. */
const DECEMBER_LEMONADE: FoodTruckContent = {
  ...FOOD_TRUCK,
  products: {
    ...FOOD_TRUCK.products,
    limonade: {
      ...FOOD_TRUCK.products.limonade,
      season: { from: { month: 12, day: 1 }, to: { month: 12, day: 31 } },
    },
  },
}

/** A 32-bit FNV-1a hash of `text`, as 8 hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/**
 * What each close of `days` days of `game` leaves, as text, played with
 * `content`, its days read without lemonade.
 */
function fingerprint(
  game: GameState,
  withEvents: boolean,
  content: FoodTruckContent = DECEMBER_LEMONADE,
  days: number = DAYS,
): string {
  const closes: string[] = []
  let state = game
  for (let day = 0; day < days; day += 1) {
    state = tick(
      state,
      content,
      CUSTOMERS,
      DIFFICULTIES,
      PERSONAL,
      ENERGY,
      withEvents ? EVENTS : NO_EVENTS,
      DEFIS,
      PERCENTILES,
      BAKERY,
      GROCERS,
    )
    const { pending } = state.events
    if (pending !== null) {
      const choice = EVENTS.events.find(({ id }) => id === pending.event)
        ?.choices[0]?.id
      if (choice === undefined) throw new Error(`No choice: ${pending.event}`)
      state = resolveEvent(state, choice)
    }
    const last = state.lastDay
    closes.push(
      JSON.stringify(
        withoutLemonade({
          rng: state.rngState,
          visits: last?.visits,
          segments: OLD_SEGMENTS.map((id) => last?.segments[id]),
          sold: last?.sold,
        }),
      ),
    )
  }
  return fnv1a(
    JSON.stringify([closes, entriesOf(state.journal), state.inventory]),
  )
}

function game(difficulty: DifficultyId): GameState {
  return createInitialState(42, FOOD_TRUCK, {
    ...defaultProfile(),
    difficulty,
  })
}

describe('the Plateau after the districts (#260)', () => {
  it('plays every difficulty exactly as before', () => {
    expect({
      facile: fingerprint(game('facile'), false),
      moyen: fingerprint(game('moyen'), false),
      difficile: fingerprint(game('difficile'), false),
    }).toEqual({
      facile: 'e1b7db90',
      moyen: '7d0570a9',
      difficile: '2a9ef0e4',
    })
  })

  it('plays the event cards and marketing exactly as before', () => {
    const marketing = applyDecision(game('moyen'), {
      kind: 'marketingDaily',
      budget: 2_000 as never,
    })
    expect({
      events: fingerprint(game('moyen'), true),
      marketing: fingerprint(marketing, false),
    }).toEqual({ events: '7c34dff4', marketing: 'dcc2be7b' })
  })
})

describe('the Plateau after the lemonade (#261)', () => {
  it('plays May exactly as with no lemonade before winter', () => {
    for (const difficulty of ['facile', 'moyen', 'difficile'] as const) {
      expect(fingerprint(game(difficulty), true, FOOD_TRUCK, MAY)).toBe(
        fingerprint(game(difficulty), true, DECEMBER_LEMONADE, MAY),
      )
    }
  })

  it('plays June otherwise: customers ask for lemonade', () => {
    expect(fingerprint(game('moyen'), false, FOOD_TRUCK, MAY + 1)).not.toBe(
      fingerprint(game('moyen'), false, DECEMBER_LEMONADE, MAY + 1),
    )
  })
})
